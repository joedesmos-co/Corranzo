"""V2.5 Score Adapter: PDF -> canonical V2.5 batch -> semantic events -> MusicXML.

Architecture (unchanged, now actually honoured end to end):

- The visual detector owns object existence and type.
- ``server.piano_vision_service.v25_canonical_features`` converts those
  proposals into the exact source records the qualified V2.5 checkpoint was
  trained on, by calling the runtime's own ``build_inputs``/``collate``/
  ``prepare_batch``. Object order is one canonical reading order and is
  asserted end to end.
- ``server.piano_vision_service.v25_semantics`` decodes the trained object,
  relation and context heads with the runtime's own vocabulary, MIDI
  derivation, lane/voice decoders and pointer resolver.
- This module assembles onsets, voices, measure rhythm and MusicXML, using the
  runtime's canonical ``make_note`` element constructor.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np
import torch
from PIL import Image

try:
    import fitz
except ImportError:
    fitz = None

from .omr_staff_geometry import detect_staff_line_staves, group_staves_into_systems, continuous_grand_staff_barlines
from .omr_raster_filters import detect_filtered_noteheads
from .omr_pdf_glyphs import extract_pdf_glyphs, has_vector_noteheads, vector_objects_for_measure
from .runtime import V25Runtime
from .v25_canonical_features import (
    CanonicalProposal,
    assert_object_alignment,
    build_measure_batch,
    build_page_records,
    staff_space,
)
from .v25_semantics import (
    ACCIDENTAL_NAMES,
    MUSICXML_ACCIDENTAL,
    TUPLET_SCALE,
    TYPE_QUARTERS,
    WRITABLE_DURATION_TYPES,
    MeasureSemantics,
    ObjectSemantics,
    apply_relations,
    decode_context,
    decode_measure,
    group_onsets,
    pointer_owner_for_measure,
)
from .omr_notehead_detection import detect_rests_in_measure

log = logging.getLogger(__name__)

# Divisions per quarter note. Every writable MusicXML note type divides 3840
# exactly, so no decoded duration is ever rounded into a different note value.
DIVISIONS = 3840
RENDER_DPI = 150
INK_THRESHOLD = 170
# Beam budget for the trained notation decoder. The qualified generation gate
# uses 1024; a measure region converges far earlier and this keeps the PDF
# service bounded.
NOTATION_BEAM_WIDTH = 4
NOTATION_TOKEN_BUDGET = 1024


@dataclass
class StaffBand:
    y0: float
    y1: float
    staff_index: int


@dataclass
class System:
    y0: float
    y1: float
    staff_bands: list[StaffBand]
    system_index: int
    line_ys: list[float] = field(default_factory=list)
    staff_lines: dict = field(default_factory=dict)


@dataclass
class MeasureBox:
    x0: float
    x1: float
    y0: float
    y1: float
    measure_number: int
    system_index: int
    staff_lines: dict[str, list[float]] = field(default_factory=dict)
    playable_x0: float | None = None


@dataclass
class PageAnalysis:
    page_number: int
    image: Image.Image
    width: int
    height: int
    systems: list[System]
    measure_boxes: list[MeasureBox]
    staff_gap: float
    content_bounds: tuple[float, float, float, float]
    glyphs: list[dict] = field(default_factory=list)


@dataclass
class MeasureResult:
    """Per-measure output of the canonical V2.5 path."""

    measure_number: int
    page: int
    system_index: int
    box: tuple[float, float, float, float]
    proposals: list[CanonicalProposal]
    semantics: MeasureSemantics
    context: dict
    pointer_owner: Optional[int]
    generated_notation: Optional[dict]
    staff_count: int = 1


class V25ScoreAdapter:
    """Production adapter that runs V2.5 on a PDF and returns complete score result."""

    def __init__(self, runtime: V25Runtime, generate_notation: bool = True):
        self.runtime = runtime
        self.config = runtime.config
        self.device = runtime.device
        self.generate_notation = generate_notation

    # ------------------------------------------------------------------ entry

    def recognize_pdf(self, pdf_bytes: bytes) -> dict[str, Any]:
        """Main entry point: PDF bytes -> complete score result."""
        log.info("Starting V2.5 PDF recognition")

        pages = self._render_pdf_pages(pdf_bytes)
        if not pages:
            raise ValueError("No pages rendered from PDF")

        all_results: list[MeasureResult] = []
        measure_counter = 1
        for page_num, page_image in enumerate(pages, 1):
            log.info("Processing page %d/%d", page_num, len(pages))
            analysis = self._analyze_page(page_image, page_num, measure_counter)
            page_results, next_measure = self._run_v25_on_page(analysis, measure_counter)
            all_results.extend(page_results)
            measure_counter = next_measure

        if not all_results:
            raise ValueError("No musical content detected in PDF")

        musical = self._extract_musical_metadata(all_results)
        staff_count = max((result.staff_count for result in all_results), default=1)
        measure_rhythms = [self._to_measure_rhythm(result, musical, staff_count)
                           for result in all_results]
        music_xml = self._build_music_xml(measure_rhythms, musical)
        source_visual_map = self._build_source_visual_map(measure_rhythms, all_results)
        measure_grid_output = self._format_measure_grid(measure_rhythms)
        acceptance = self._assess_acceptance(measure_rhythms, all_results)

        return {
            "complete": True,
            "musicXml": music_xml,
            "acceptance": acceptance,
            "measureGrid": measure_grid_output,
            "sourceVisualMap": source_visual_map,
            "v25Audit": self._build_audit(all_results, musical),
        }

    # ------------------------------------------------------------------ pages

    def _render_pdf_pages(self, pdf_bytes: bytes) -> list[Image.Image]:
        """Render PDF pages to PIL images at analysis resolution."""
        if fitz is None:
            raise RuntimeError("PyMuPDF (fitz) required for PDF rendering")
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        except fitz.FileDataError as exc:
            raise ValueError("Invalid or empty PDF") from exc
        pages = []
        target_dpi = RENDER_DPI
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(target_dpi / 72.0, target_dpi / 72.0)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            gray = img.convert("L")
            gray.info["omrGlyphs"] = extract_pdf_glyphs(page, pix.width, pix.height)
            pages.append(gray)
        doc.close()
        log.info("Rendered %d pages at %d DPI", len(pages), target_dpi)
        return pages

    def _detect_content_bounds(self, img: np.ndarray) -> tuple[float, float, float, float]:
        """Detect content bounds (normalized 0-1)."""
        h, w = img.shape
        coords = np.argwhere(img < 0.95)
        if len(coords) == 0:
            return (0.0, 0.0, 1.0, 1.0)
        y0, x0 = coords.min(axis=0)
        y1, x1 = coords.max(axis=0)
        pad_x = max(0.004, (x1 - x0) * 0.02 / w)
        pad_y = max(0.004, (y1 - y0) * 0.02 / h)
        return (
            max(0.0, x0 / w - pad_x),
            max(0.0, y0 / h - pad_y),
            min(1.0, x1 / w + pad_x),
            min(1.0, y1 / h + pad_y),
        )

    def _detect_staff_systems(self, img: np.ndarray, content_bounds: tuple) -> list[System]:
        """Detect staff lines and group into systems."""
        staves = detect_staff_line_staves(img.astype(np.float64) * 255, content_bounds)
        systems = []
        for group in group_staves_into_systems(staves):
            if any(not stave["lineYs"] for stave in group):
                continue
            upper = group[0]["lineYs"]
            lower = group[1]["lineYs"] if len(group) > 1 else []
            lines = {"treble": upper, "bass": lower,
                     "splitY": (upper[-1] + lower[0]) / 2 if lower else None,
                     "singleStaff": not bool(lower)}
            systems.append(System(group[0]["y0"], group[-1]["y1"],
                [StaffBand(stave["y0"], stave["y1"], i) for i, stave in enumerate(group)],
                len(systems), upper, lines))
        log.info("Page: detected %d systems", len(systems))
        return systems

    def _build_measure_grid(
        self,
        img: np.ndarray,
        systems: list[System],
        content_bounds: tuple,
        measure_start: int,
    ) -> tuple[list[MeasureBox], float]:
        """Build measure boxes for each system using vertical projection."""
        h, w = img.shape
        measure_boxes = []
        all_staff_gaps = []

        for system in systems:
            if system.staff_lines.get("bass"):
                positions = continuous_grand_staff_barlines(img.astype(np.float64) * 255, content_bounds,
                    system.staff_lines["treble"], system.staff_lines["bass"])
                if len(positions) >= 2:
                    # buildOmrMeasureGrid.js:boundariesToSpans header exclusion.
                    spans = [(a, b) for a, b in zip(positions, positions[1:]) if b - a >= .03]
                    if len(spans) >= 2:
                        first, second = spans[0][1] - spans[0][0], spans[1][1] - spans[1][0]
                        if first < (content_bounds[2] - content_bounds[0]) * .11 and second > first * 1.8:
                            spans = spans[1:]
                    for i, (mx0, mx1) in enumerate(spans):
                        if mx1 - mx0 <= 0.01:
                            continue
                        measure_boxes.append(MeasureBox(mx0, mx1, system.y0, system.y1,
                            measure_start, system.system_index, system.staff_lines,
                            mx0 + (max(min((mx1 - mx0) * .34, .085), .06) if i == 0 else 0)))
                        measure_start += 1
                    all_staff_gaps.append((system.line_ys[-1] - system.line_ys[0]) * h / 4)
                    continue
            band_top = int(system.y0 * h)
            band_bottom = int(system.y1 * h)
            band = img[band_top:band_bottom, :]

            row_sums = band.mean(axis=1)
            threshold = row_sums.min() + 0.3 * (row_sums.max() - row_sums.min())
            staff_rows = np.where(row_sums < threshold)[0]

            if len(staff_rows) >= 2:
                gaps = np.diff(staff_rows)
                staff_gap = float(np.median(gaps[gaps > 1]))
                all_staff_gaps.append(staff_gap)
            else:
                staff_gap = 20.0

            col_sums = band.mean(axis=0)
            barline_threshold = col_sums.min() + 0.15 * (col_sums.max() - col_sums.min())
            barline_candidates = np.where(col_sums < barline_threshold)[0]

            if len(barline_candidates) < 2:
                measure_boxes.append(
                    MeasureBox(
                        x0=content_bounds[0],
                        x1=content_bounds[2],
                        y0=system.y0,
                        y1=system.y1,
                        measure_number=measure_start,
                        system_index=system.system_index,
                    )
                )
                measure_start += 1
                continue

            barlines = []
            last_bar = -100
            for x in barline_candidates:
                if x - last_bar > staff_gap * 2:
                    barlines.append(x)
                    last_bar = x

            if len(barlines) < 2:
                continue

            x0_abs = int(content_bounds[0] * w)
            x1_abs = int(content_bounds[2] * w)
            barlines = [max(x0_abs, min(x1_abs, b)) for b in barlines]
            barlines = sorted(set(barlines))

            for i in range(len(barlines) - 1):
                mx0 = barlines[i] / w
                mx1 = barlines[i + 1] / w
                if mx1 - mx0 < 0.02:
                    continue
                measure_boxes.append(
                    MeasureBox(
                        x0=mx0,
                        x1=mx1,
                        y0=system.y0,
                        y1=system.y1,
                        measure_number=measure_start,
                        system_index=system.system_index,
                        # estimateGrandStaffLines/singleStaffLines: a five-line
                        # band is one staff, not two partial treble/bass staffs.
                        staff_lines={"treble": system.line_ys or np.linspace(system.y0, system.y1, 5).tolist(),
                                     "bass": [], "singleStaff": True, "splitY": None},
                        # buildOmrMeasureGrid.js:spansToMeasureBoxes.
                        playable_x0=mx0 + (max(min((mx1 - mx0) * 0.34, 0.085), 0.06) if i == 0 else 0),
                    )
                )
                measure_start += 1

        avg_staff_gap = float(np.median(all_staff_gaps)) if all_staff_gaps else 20.0
        return measure_boxes, avg_staff_gap

    def _analyze_page(self, page_image: Image.Image, page_number: int, measure_start: int) -> PageAnalysis:
        """Analyze a single page: detect systems, build measure grid."""
        img_array = np.array(page_image, dtype=np.float32) / 255.0
        h, w = img_array.shape

        content_bounds = self._detect_content_bounds(img_array)
        systems = self._detect_staff_systems(img_array, content_bounds)
        measure_boxes, staff_gap = self._build_measure_grid(img_array, systems, content_bounds, measure_start)

        return PageAnalysis(
            page_number=page_number,
            image=page_image,
            width=w,
            height=h,
            systems=systems,
            measure_boxes=measure_boxes,
            staff_gap=staff_gap,
            content_bounds=content_bounds,
            glyphs=page_image.info.get("omrGlyphs", []),
        )

    def _extract_measure_crop(
        self, analysis: PageAnalysis, measure_box: MeasureBox
    ) -> tuple[dict, dict]:
        """Measure crop plus the affine page->view transform.

        The canonical V2.5 batch builder makes its own crops; this remains the
        adapter's own page/view geometry for the source visual map.
        """
        img_array = np.array(analysis.image, dtype=np.float32) / 255.0
        h, w = img_array.shape

        y0 = int(measure_box.y0 * h)
        y1 = int(measure_box.y1 * h)
        x0 = int(measure_box.x0 * w)
        x1 = int(measure_box.x1 * w)

        pad_h = max(4, int((y1 - y0) * 0.1))
        pad_w = max(4, int((x1 - x0) * 0.1))
        y0 = max(0, y0 - pad_h)
        y1 = min(h, y1 + pad_h)
        x0 = max(0, x0 - pad_w)
        x1 = min(w, x1 + pad_w)

        crop = img_array[y0:y1, x0:x1]
        crop_h, crop_w = crop.shape

        target_h = self.config.image_height
        target_w = self.config.image_width
        scale = min(target_w / crop_w, target_h / crop_h)
        new_w = max(1, int(crop_w * scale))
        new_h = max(1, int(crop_h * scale))

        crop_resized = Image.fromarray((crop * 255).astype(np.uint8)).resize(
            (new_w, new_h), Image.Resampling.BILINEAR
        )

        canvas = Image.new("L", (target_w, target_h), 255)
        ox = (target_w - new_w) // 2
        oy = (target_h - new_h) // 2
        canvas.paste(crop_resized, (ox, oy))

        crop_tensor = torch.from_numpy(np.array(canvas, dtype=np.float32) / 255.0).unsqueeze(0)

        matrix = np.array(
            [
                [w * new_w / crop_w / target_w, 0, (ox - x0 * new_w / crop_w) / target_w],
                [0, h * new_h / crop_h / target_h, (oy - y0 * new_h / crop_h) / target_h],
                [0, 0, 1],
            ],
            dtype=np.float64,
        )

        crop_dict = {"tensor": crop_tensor, "page_dims": (w, h)}
        meta = {
            "source_box": (measure_box.x0, measure_box.y0, measure_box.x1, measure_box.y1),
            "crop_box_pixels": (x0, y0, x1, y1),
            "transform": matrix,
            "inverse_transform": np.linalg.inv(matrix),
            "page_dims": (w, h),
            "staff_lines": measure_box.staff_lines,
        }
        return crop_dict, meta

    # -------------------------------------------------------------- detection

    def _detect_page_objects(self, analysis: PageAnalysis) -> list[dict]:
        """Visual proposals per measure, in canonical reading order."""
        img_array = np.array(analysis.image, dtype=np.uint8)
        h, w = img_array.shape
        img_rgba = np.zeros((h, w, 4), dtype=np.uint8)
        img_rgba[:, :, 0] = img_array
        img_rgba[:, :, 1] = img_array
        img_rgba[:, :, 2] = img_array
        img_rgba[:, :, 3] = 255
        image_data = {"data": img_rgba.flatten(), "width": w, "height": h}
        page_boxes = [dict(x0=b.x0, x1=b.x1, y0=b.y0, y1=b.y1,
                           staffLines=b.staff_lines, systemIndex=b.system_index)
                      for b in analysis.measure_boxes]
        vector_source = has_vector_noteheads(analysis.glyphs)
        measures = []
        for order, measure_box in enumerate(analysis.measure_boxes):
            measure_box_dict = {
                "x0": measure_box.x0,
                "x1": measure_box.x1,
                "y0": measure_box.y0,
                "y1": measure_box.y1,
                "measureNumber": order,
                "systemIndex": measure_box.system_index,
                "page": analysis.page_number,
                "staffLines": measure_box.staff_lines,
                "staffClefs": {"upper": "treble", "lower": "bass"},
                "playableX0": measure_box.playable_x0 if measure_box.playable_x0 is not None else measure_box.x0,
                "ledgerMarginNorm": 0.02,
            }
            if vector_source:
                noteheads, rests = vector_objects_for_measure(
                    analysis.glyphs, image_data, measure_box_dict, page_boxes)
            else:
                noteheads = detect_filtered_noteheads(image_data, measure_box_dict, INK_THRESHOLD)
                rests = detect_rests_in_measure(
                    image_data, measure_box_dict, INK_THRESHOLD,
                    [{"cx": nh.cx, "cy": nh.cy} for nh in noteheads])
            # One canonical reading order for the whole measure: left to right,
            # then top to bottom. V2.5 object slots, noteheads, rests and final
            # events all follow this order, so index N means the same object at
            # every stage.
            candidates = sorted(
                list(noteheads) + list(rests), key=lambda c: (c.cx, c.cy))
            measures.append({
                "index": order,
                "measureNumber": measure_box.measure_number,
                "systemIndex": measure_box.system_index,
                "x0": measure_box.x0, "x1": measure_box.x1,
                "y0": measure_box.y0, "y1": measure_box.y1,
                "staff_lines": measure_box.staff_lines,
                "candidates": candidates,
            })
        return measures

    # ------------------------------------------------------------- V2.5 stage

    def _run_v25_on_page(
        self, analysis: PageAnalysis, measure_start: int
    ) -> tuple[list[MeasureResult], int]:
        """Run canonical V2.5 inference on every detected measure of a page."""
        measures = self._detect_page_objects(analysis)
        aspect = analysis.height / max(1, analysis.width)
        records, proposals = build_page_records(
            score_id="corranzo-pdf-score", page_number=analysis.page_number,
            measures=measures, aspect=aspect)

        results: list[MeasureResult] = []
        for index, measure in enumerate(measures):
            if not measure["candidates"]:
                continue
            log.info("Measure %d: detector proposals=%d", measure["measureNumber"],
                     len(measure["candidates"]))
            results.append(self._run_v25_on_measure(
                records, index, analysis, measure, proposals[index]))
        return results, measure_start + len(measures)

    def _run_v25_on_measure(self, records, index, analysis: PageAnalysis, measure,
                            proposals: list[CanonicalProposal]) -> MeasureResult:
        batch, sample, selected = build_measure_batch(
            records, index, analysis.image, self.config)
        # Visual proposal N must be V2.5 object slot N before anything is decoded.
        current = assert_object_alignment(sample, selected)
        if current != len(proposals):
            raise AssertionError(
                f"measure {measure['measureNumber']}: {len(proposals)} visual proposals "
                f"but {current} V2.5 object slots")
        batch = self.runtime._to_device(batch)

        with self.runtime.torch.inference_mode():
            output = self.runtime.model(batch, decode_notation=False, return_memory=True)

        slots = list(range(current))
        kinds = [proposal.kind for proposal in proposals]
        max_staff = 2 if measure["staff_lines"].get("bass") else 1
        semantics, chord_pairs = decode_measure(
            output, batch, measure_number=measure["measureNumber"],
            slots=slots, kinds=kinds, max_staff=max_staff)
        apply_relations(semantics, output, batch, chord_pairs)
        semantics.pointer_owner = pointer_owner_for_measure(output, batch)

        x_by_slot = {proposal.index: proposal.x for proposal in proposals}
        width = staff_space(measure["staff_lines"])
        notehead_widths = [p.bounds[2] - p.bounds[0] for p in proposals
                           if p.kind == "notehead"]
        tolerance = max(0.35 * (max(notehead_widths) if notehead_widths else width),
                        0.15 * width)
        semantics.onsets = group_onsets(semantics.objects, x_by_slot, chord_pairs, tolerance)

        context_node = self._context_node_index(batch, sample, index)
        context = decode_context(output, context_node) if context_node is not None else {}
        semantics.key_fifths = int(context.get("key_fifths", 0))
        semantics.meter_numerator = int(context.get("meter_numerator", 4))
        semantics.meter_denominator = int(context.get("meter_denominator", 4))
        semantics.meter_confidence = float(context.get("meter_confidence", 0.0))
        semantics.clef_by_staff = {1: (str(context.get("clef", "G")),
                                       int(context.get("clef_line", 2)))}
        semantics.generated_notation = self._generate_notation(output, batch)

        return MeasureResult(
            measure_number=measure["measureNumber"],
            page=analysis.page_number,
            system_index=measure["systemIndex"],
            box=(measure["x0"], measure["y0"], measure["x1"], measure["y1"]),
            proposals=proposals,
            semantics=semantics,
            context=context,
            pointer_owner=semantics.pointer_owner,
            generated_notation=semantics.generated_notation,
            staff_count=max_staff,
        )

    def _context_node_index(self, batch, sample, record_index) -> Optional[int]:
        """Hierarchy slot of the current measure's context node, if any."""
        example_id = sample["metadata"]["example_id"]
        scope_nodes = sample["metadata"].get("scope_node_ids") or {}
        if example_id not in scope_nodes:
            return None
        node = int(scope_nodes[example_id])
        hierarchy = int(batch["hierarchy_mask"].sum())
        if not 0 <= node < hierarchy:
            return None
        return node

    def _generate_notation(self, output: dict, batch: dict) -> Optional[dict]:
        """Run the trained notation decoder on the measure's object-set memory.

        The notation decoder's supervision vocabulary is sidecar notation
        (articulations, fermatas, dynamics, pedal, tempo/metronome marks); note
        pitch and duration are object-head semantics, not generated tokens. The
        decoded node is therefore reported, never used to overwrite a head.
        """
        if not self.generate_notation or "notation_memory" not in output:
            return None
        from piano_vision.v25.generation import beam_generate
        from piano_vision.v2.notation import NotationCodec

        active = batch["notation_mask"].flatten().nonzero(as_tuple=False).flatten()
        if not len(active):
            return None
        memory = output["notation_memory"].index_select(0, active)
        pad = output.get("notation_memory_pad")
        if pad is not None:
            pad = pad.index_select(0, active)
        budget = min(NOTATION_TOKEN_BUDGET, self.model_max_length() - 1)
        generated = beam_generate(self.runtime.model.notation_decoder, memory, pad,
                                  width=NOTATION_BEAM_WIDTH, max_new_tokens=budget)
        tokens = generated["tokens"][0].tolist()
        try:
            node = NotationCodec.decode(tokens)
            decodable = True
            reason = None
        except (ValueError, TypeError, KeyError, UnicodeError) as error:
            node, decodable, reason = None, False, type(error).__name__
        return {
            "terminated": bool(generated["terminated"][0]),
            "logProbability": float(generated["log_probability"][0]),
            "tokenCount": len(tokens),
            "decodable": decodable,
            "reason": reason,
            "node": node,
        }

    def model_max_length(self) -> int:
        return int(self.runtime.model.notation_decoder.max_length)

    # ---------------------------------------------------------- score assembly

    def _meter(self, musical: dict) -> tuple[int, int]:
        numerator = int(musical["timeSignature"]["beats"])
        denominator = int(musical["timeSignature"]["beatType"])
        return numerator, denominator

    def _measure_divisions(self, musical: dict) -> int:
        numerator, denominator = self._meter(musical)
        return int(round(numerator * DIVISIONS * 4 / denominator))

    def _to_measure_rhythm(self, result: MeasureResult, musical: dict,
                           staff_count: int) -> dict:
        """Assemble onsets -> events with measure rhythm, keeping object order."""
        semantics = result.semantics
        by_slot = {entry.slot: entry for entry in semantics.objects}
        measure_divisions = self._measure_divisions(musical)

        events: list[dict] = []
        for staff in range(1, max(1, staff_count) + 1):
            staff_onsets = [onset for onset in semantics.onsets
                            if any(by_slot[slot].staff == staff for slot in onset)]
            cursor = 0
            for onset in staff_onsets:
                members = sorted(
                    (by_slot[slot] for slot in onset if by_slot[slot].staff == staff),
                    key=lambda entry: entry.midi)
                if not members:
                    continue
                lead = members[0]
                duration_type = WRITABLE_DURATION_TYPES.get(
                    lead.duration_type, "quarter")
                dots = min(3, max(0, lead.dots))
                divisions = (0 if lead.grace else
                             self._quarters_to_divisions(
                                 TYPE_QUARTERS[duration_type], dots, lead.tuplet_ratio))
                if divisions <= 0:
                    divisions = DIVISIONS
                # Never truncate or drop a decoded event: the visual detector
                # owns how many objects the measure contains. A measure whose
                # decoded rhythm overflows the predicted meter is recorded as
                # irregular instead of losing notes.
                event = self._build_event(
                    lead, members, result, staff, duration_type, dots, divisions)
                if event is not None:
                    events.append(event)
                    cursor += divisions
            if cursor < measure_divisions:
                events.extend(self._fill_rest(
                    cursor, measure_divisions, staff, result))
        return {
            "measureNumber": result.measure_number,
            "page": result.page,
            "systemIndex": result.system_index,
            "box": result.box,
            "staffCount": max(1, staff_count),
            "measureDivisions": measure_divisions,
            "events": events,
            "noteCount": sum(len(e.get("notes", [])) for e in events),
            "restCount": sum(1 for e in events if e["type"] == "rest"),
            "detectorObjectCount": len(result.proposals),
            "v25ObjectCount": len(semantics.objects),
            "onsetCount": len(semantics.onsets),
            "pointerOwner": result.pointer_owner,
            "confidence": self._measure_confidence(semantics),
            "uncertain": not semantics.objects,
        }

    def _quarters_to_divisions(self, quarters: float, dots: int, ratio: int) -> int:
        value = quarters * (2.0 - 0.5 ** dots)
        scale = TUPLET_SCALE.get(int(ratio))
        if scale:
            value *= scale
        return int(round(value * DIVISIONS))

    def _build_event(self, lead: ObjectSemantics, members: list[ObjectSemantics],
                     result: MeasureResult, staff: int, duration_type: str,
                     dots: int, divisions: int) -> Optional[dict]:
        proposal_by_slot = {p.index: p for p in result.proposals}
        base = {
            "startDivision": 0,
            "durationDivisions": divisions,
            "durationType": duration_type,
            "dotted": dots > 0,
            "dots": dots,
            "voice": staff,
            "staff": staff,
            "objectSlots": [entry.slot for entry in members],
        }
        if lead.rest:
            proposal = proposal_by_slot.get(lead.slot)
            return {
                "type": "rest",
                **base,
                "clef": "bass" if staff == 2 else "treble",
                "xNorm": proposal.x if proposal else 0.5,
                "yNorm": proposal.y if proposal else 0.5,
                "sourceBBox": proposal.source_bbox if proposal else None,
                "sourceNoteheadId": self._notehead_id(result, lead.slot),
            }
        notes = []
        for entry in members:
            proposal = proposal_by_slot.get(entry.slot)
            accidental = MUSICXML_ACCIDENTAL.get(ACCIDENTAL_NAMES[entry.alter + 3])
            notes.append({
                "midi": entry.midi,
                "pitchStep": entry.step,
                "pitchAlter": entry.alter,
                "pitchOctave": entry.octave,
                "accidental": accidental,
                "durationType": duration_type,
                "durationDivisions": divisions,
                "dots": dots,
                "dotted": dots > 0,
                "tieStart": entry.tie_start,
                "tieStop": entry.tie_stop,
                "grace": lead.grace,
                "tuplet": entry.tuplet,
                "lane": entry.lane,
                "pitchConfidence": round(entry.pitch_confidence, 4),
                "durationConfidence": round(entry.duration_confidence, 4),
                "detectorMidi": proposal.detector_midi if proposal else None,
                "xNorm": proposal.x if proposal else 0.0,
                "yNorm": proposal.y if proposal else 0.0,
                "sourceBBox": proposal.source_bbox if proposal else None,
                "sourceNoteheadId": self._notehead_id(result, entry.slot),
            })
        return {
            "type": "note",
            **base,
            "clef": "bass" if staff == 2 else "treble",
            "notes": notes,
        }

    def _fill_rest(self, cursor: int, measure_divisions: int, staff: int,
                   result: MeasureResult) -> list[dict]:
        """Metric completion for one staff. Rests are structural, not detected."""
        remaining = measure_divisions - cursor
        if remaining <= 0:
            return []
        events = []
        for duration_type, divisions in _split_duration(remaining):
            events.append({
                "type": "rest",
                "startDivision": cursor,
                "durationDivisions": divisions,
                "durationType": duration_type,
                "dotted": False,
                "dots": 0,
                "voice": staff,
                "staff": staff,
                "clef": "bass" if staff == 2 else "treble",
                "objectSlots": [],
                "xNorm": None,
                "yNorm": None,
                "sourceBBox": None,
                "sourceNoteheadId": None,
                "structural": True,
            })
            cursor += divisions
        return events

    def _notehead_id(self, result: MeasureResult, slot: int) -> str:
        return f"sfnh-p{result.page}-m{result.measure_number}-o{slot}"

    def _measure_confidence(self, semantics: MeasureSemantics) -> float:
        if not semantics.objects:
            return 0.3
        pitch = float(np.mean([e.pitch_confidence for e in semantics.objects]))
        duration = float(np.mean([e.duration_confidence for e in semantics.objects]))
        return round(min(1.0, 0.5 * pitch + 0.5 * duration), 4)

    def _decoded_staff_quarters(self, result: MeasureResult) -> list[float]:
        """Decoded quarter-note length of each staff, from V2.5 durations only."""
        by_slot = {entry.slot: entry for entry in result.semantics.objects}
        totals: dict[int, float] = {}
        for onset in result.semantics.onsets:
            for staff in {by_slot[slot].staff for slot in onset if slot in by_slot}:
                lead = min((by_slot[slot] for slot in onset if slot in by_slot),
                           key=lambda entry: entry.midi)
                if lead.grace:
                    continue
                totals[staff] = totals.get(staff, 0.0) + lead.duration_quarters
        return [totals[key] for key in sorted(totals)]

    def _extract_musical_metadata(self, results: list[MeasureResult]) -> dict:
        """Score-level attributes from the V2.5 context heads and decoded rhythm.

        The key signature comes straight from the trained ``key_fifths`` head.
        The meter heads are only accepted when the decoded per-staff measure
        length agrees with them, because the measure fill is metric: a rejected
        meter falls back to 4/4 rather than silently rescaling every measure.
        """
        first = sorted(results, key=lambda r: (r.page, r.measure_number))[0]
        context = first.context or {}
        fifths = int(context.get("key_fifths", 0))
        musical = {
            "keySignature": {
                "fifths": fifths if -7 <= fifths <= 7 else 0, "mode": "major",
                "confidence": 0.8 if context else 0.0,
                "source": "v25-context-key_fifths" if context else "default",
            },
            "timeSignature": {"beats": 4, "beatType": 4, "confidence": 0.0,
                              "source": "default"},
            "tempo": {"bpm": 120, "fromDefault": True, "confidence": 0.0},
        }
        if not context:
            self._musical = musical
            return musical

        predicted = (int(context.get("meter_numerator", 4)),
                     int(context.get("meter_denominator", 4)))
        predicted_quarters = predicted[0] * 4 / predicted[1] if predicted[1] else 4.0
        lengths = [q for result in results for q in self._decoded_staff_quarters(result)]
        observed = float(np.median(lengths)) if lengths else 0.0

        candidates = [(num, den) for num in (2, 3, 4, 6, 9, 12)
                      for den in (1, 2, 4, 8, 16)]
        best = min(candidates, key=lambda pair: abs(pair[0] * 4 / pair[1] - observed))
        best_quarters = best[0] * 4 / best[1]
        chosen = best
        source = "v25-rhythm-consistency"
        if predicted in candidates and abs(predicted_quarters - observed) <= 0.12 * observed:
            chosen = predicted
            source = "v25-context-meter"
        musical["timeSignature"] = {
            "beats": chosen[0], "beatType": chosen[1],
            "confidence": round(float(context.get("meter_confidence", 0.0)), 4),
            "source": source,
            "predictedHead": list(predicted),
            "observedStaffQuarters": round(observed, 3),
            "selectedStaffQuarters": round(best_quarters, 3),
        }
        self._musical = musical
        return musical

    def _clef_sign(self, sign: str, line: int) -> tuple[str, int]:
        table = {"G": ("G", 2), "F": ("F", 4), "C": ("C", 3)}
        if sign in table:
            default = table[sign]
            return default[0], line if line > 0 else default[1]
        return "G", 2

    def _build_music_xml(self, measure_rhythms: list[dict], musical: dict) -> str:
        from xml.etree import ElementTree as ET
        from piano_vision.v2.notation import make_note, tree_element

        sorted_measures = sorted(measure_rhythms, key=lambda m: m["measureNumber"])
        score = ET.Element("score-partwise", version="3.1")
        work = ET.SubElement(score, "work")
        ET.SubElement(work, "work-title").text = "PDF OMR"
        part_list = ET.SubElement(score, "part-list")
        score_part = ET.SubElement(part_list, "score-part", id="P1")
        ET.SubElement(score_part, "part-name").text = "Piano"
        part = ET.SubElement(score, "part", id="P1")

        staff_count = max((m.get("staffCount", 1) for m in sorted_measures), default=1)
        key = musical.get("keySignature", {"fifths": 0, "mode": "major"})
        time = musical.get("timeSignature", {"beats": 4, "beatType": 4})

        for position, measure in enumerate(sorted_measures):
            measure_elem = ET.SubElement(part, "measure",
                                         number=str(measure["measureNumber"]))
            if position == 0:
                attributes = ET.SubElement(measure_elem, "attributes")
                ET.SubElement(attributes, "divisions").text = str(DIVISIONS)
                key_elem = ET.SubElement(attributes, "key")
                ET.SubElement(key_elem, "fifths").text = str(int(key.get("fifths", 0)))
                ET.SubElement(key_elem, "mode").text = key.get("mode", "major")
                time_elem = ET.SubElement(attributes, "time")
                ET.SubElement(time_elem, "beats").text = str(int(time.get("beats", 4)))
                ET.SubElement(time_elem, "beat-type").text = str(int(time.get("beatType", 4)))
                if staff_count > 1:
                    ET.SubElement(attributes, "staves").text = str(staff_count)
                    for number in range(1, staff_count + 1):
                        sign, line = self._clef_sign(
                            "F" if number == 2 else "G", 4 if number == 2 else 2)
                        clef = ET.SubElement(attributes, "clef", number=str(number))
                        ET.SubElement(clef, "sign").text = sign
                        ET.SubElement(clef, "line").text = str(line)
                else:
                    clef = ET.SubElement(attributes, "clef")
                    ET.SubElement(clef, "sign").text = "G"
                    ET.SubElement(clef, "line").text = "2"
                direction = ET.SubElement(measure_elem, "direction")
                direction_type = ET.SubElement(direction, "direction-type")
                ET.SubElement(direction_type, "words").text = \
                    "Generated by Corranzo OMR (experimental)"
                tempo = musical.get("tempo", {"bpm": 120})
                if tempo.get("bpm"):
                    ET.SubElement(direction, "sound", tempo=str(int(tempo["bpm"])))

            for staff in range(1, staff_count + 1):
                staff_events = [e for e in measure["events"] if e.get("staff", 1) == staff]
                if staff > 1:
                    previous = [e for e in measure["events"] if e.get("staff", 1) == staff - 1]
                    backup = ET.SubElement(measure_elem, "backup")
                    ET.SubElement(backup, "duration").text = str(
                        sum(int(e["durationDivisions"]) for e in previous))
                for event in staff_events:
                    if event["type"] == "rest":
                        note = make_note(
                            rest=True, duration=int(event["durationDivisions"]),
                            type=event["durationType"], dots=int(event.get("dots", 0)),
                            voice=str(staff), staff=staff,
                            attributes=({"id": event["sourceNoteheadId"]}
                                        if event.get("sourceNoteheadId") else None))
                        measure_elem.append(tree_element(note))
                        continue
                    for index, entry in enumerate(event["notes"]):
                        note = make_note(
                            pitch=(entry["pitchStep"], entry["pitchOctave"],
                                   entry["pitchAlter"] or None),
                            duration=None if entry.get("grace") else int(event["durationDivisions"]),
                            type=event["durationType"], dots=int(event.get("dots", 0)),
                            grace=({} if entry.get("grace") else None),
                            chord=index > 0, voice=str(staff), staff=staff,
                            accidental=({"value": entry["accidental"]}
                                        if entry.get("accidental") else None),
                            notations=([{"tag": "tied", "attributes": {"type": "start"}},
                                        {"tag": "tied", "attributes": {"type": "stop"}}]
                                       if entry.get("tieStart") else
                                       ([{"tag": "tied", "attributes": {"type": "stop"}}]
                                        if entry.get("tieStop") else [])),
                            attributes=({"id": entry["sourceNoteheadId"]}
                                        if entry.get("sourceNoteheadId") else None))
                        measure_elem.append(tree_element(note))

        ET.indent(score, space="  ")
        return ET.tostring(score, encoding="unicode")

    # ------------------------------------------------------------------ output

    def _build_source_visual_map(self, measure_rhythms: list[dict],
                                 results: list[MeasureResult]) -> dict:
        anchors = []
        for rhythm in sorted(measure_rhythms, key=lambda m: m["measureNumber"]):
            measure_number = rhythm["measureNumber"]
            page = rhythm.get("page", 1)
            event_index = 0
            for event in rhythm.get("events", []):
                if event["type"] not in {"note", "rest"}:
                    continue
                source_event_id = f"sfve-p{page}-m{measure_number}-e{event_index}"
                event_index += 1
                members = ([event] if event["type"] == "rest" else event.get("notes", []))
                for entry in members:
                    anchors.append(self._build_anchor(
                        entry, event, source_event_id, measure_number, page, rhythm))
        return {
            "schemaVersion": 1,
            "coordinateSpace": "pdf-source-normalized",
            "source": "visual-detector",
            "anchorCount": len(anchors),
            "anchors": anchors,
        }

    def _build_anchor(self, entry: dict, event: dict, source_event_id: str,
                      measure_number: int, page: int, rhythm: dict) -> dict:
        x_norm = entry.get("xNorm")
        y_norm = entry.get("yNorm")
        x_norm = 0.5 if x_norm is None else x_norm
        y_norm = 0.5 if y_norm is None else y_norm
        return {
            "sourceNoteheadId": entry.get("sourceNoteheadId"),
            "sourceEventId": source_event_id,
            "page": page,
            "systemIndex": rhythm.get("systemIndex", 0),
            "staffIndex": max(0, int(event.get("staff", 1)) - 1),
            "measureIndex": 0,
            "measureNumber": measure_number,
            "midi": entry.get("midi", 0),
            "voice": event.get("voice", 1),
            "kind": "rest" if event["type"] == "rest" else "notehead",
            "representation": "notation",
            "sourceCenter": {
                "x": round(x_norm, 6),
                "y": round(y_norm, 6),
                "coordinateSpace": "pdf-source-normalized",
            },
            "sourceBBox": {**(entry.get("sourceBBox") or {
                "x0": round(max(0, x_norm - 0.008), 6),
                "y0": round(max(0, y_norm - 0.006), 6),
                "x1": round(min(1, x_norm + 0.008), 6),
                "y1": round(min(1, y_norm + 0.006), 6),
            }), "coordinateSpace": "pdf-source-normalized"},
            "confidence": rhythm.get("confidence", 0.8),
            "geometrySource": "visual-detector",
            "staffGap": 0.01,
            "alternates": [],
        }

    def _format_measure_grid(self, measure_rhythms: list[dict]) -> list[dict]:
        return [
            {
                "measureNumber": m["measureNumber"],
                "page": m.get("page", 1),
                "systemIndex": m.get("systemIndex", 0),
                "measureIndex": 0,
                "xStart": m["box"][0],
                "xEnd": m["box"][2],
                "yTop": m["box"][1],
                "yBottom": m["box"][3],
                "rawMeasureXStart": m["box"][0],
                "rawMeasureXEnd": m["box"][2],
                "confidence": m.get("confidence", 0.8),
                "source": "v25",
            }
            for m in measure_rhythms
        ]

    def _assess_acceptance(self, measure_rhythms: list[dict],
                           results: list[MeasureResult]) -> str:
        total_notes = sum(len(m.get("events", [])) for m in measure_rhythms)
        total_measures = len(measure_rhythms)
        uncertain = sum(1 for m in measure_rhythms if m.get("uncertain", False))
        if total_measures == 0 or total_notes == 0:
            return "rejected"
        if uncertain / total_measures > 0.5:
            return "rejected"
        if float(np.mean([m.get("confidence", 0) for m in measure_rhythms])) < 0.5:
            return "rejected"
        return "accepted"

    def _build_audit(self, results: list[MeasureResult], musical: dict) -> dict:
        measures = []
        for result in results:
            semantics = result.semantics
            measures.append({
                "measureNumber": result.measure_number,
                "page": result.page,
                "detectorObjects": len(result.proposals),
                "v25Objects": len(semantics.objects),
                "onsets": len(semantics.onsets),
                "keyFifths": semantics.key_fifths,
                "meter": [semantics.meter_numerator, semantics.meter_denominator],
                "meterConfidence": round(semantics.meter_confidence, 4),
                "pointerOwner": result.pointer_owner,
                "generatedNotation": (
                    None if result.generated_notation is None else {
                        "decodable": result.generated_notation["decodable"],
                        "terminated": result.generated_notation["terminated"],
                        "tokenCount": result.generated_notation["tokenCount"],
                        "type": (result.generated_notation.get("node") or {}).get("type"),
                    }),
                "objects": [
                    {
                        "slot": entry.slot,
                        "kind": entry.kind,
                        "x": round(result.proposals[entry.slot].x, 6),
                        "y": round(result.proposals[entry.slot].y, 6),
                        "detectorBBox": result.proposals[entry.slot].bounds,
                        "pitch": f"{entry.step}{entry.alter:+d}{entry.octave}",
                        "midi": entry.midi,
                        "detectorMidi": result.proposals[entry.slot].detector_midi,
                        "staff": entry.staff,
                        "durationType": entry.duration_type,
                        "dots": entry.dots,
                        "tupletRatio": entry.tuplet_ratio,
                        "grace": entry.grace,
                        "lane": entry.lane,
                        "restHead": entry.rest,
                        "restProbability": round(entry.rest_probability, 4),
                        "tieStart": entry.tie_start,
                        "tieStop": entry.tie_stop,
                        "pitchConfidence": round(entry.pitch_confidence, 4),
                        "durationConfidence": round(entry.duration_confidence, 4),
                    }
                    for entry in semantics.objects
                ],
            })
        return {
            "musical": musical,
            "measureCount": len(results),
            "detectorObjectCount": sum(len(r.proposals) for r in results),
            "v25ObjectCount": sum(len(r.semantics.objects) for r in results),
            "measures": measures,
        }


def _split_duration(divisions: int) -> list[tuple[str, int]]:
    """Split a remaining measure length into writable note values."""
    table = [
        ("breve", 8 * DIVISIONS), ("whole", 4 * DIVISIONS), ("half", 2 * DIVISIONS),
        ("quarter", DIVISIONS), ("eighth", DIVISIONS // 2),
        ("16th", DIVISIONS // 4), ("32nd", DIVISIONS // 8),
        ("64th", DIVISIONS // 16), ("128th", DIVISIONS // 32),
        ("256th", DIVISIONS // 128),
    ]
    out = []
    remaining = int(divisions)
    guard = 0
    while remaining > 0 and guard < 32:
        guard += 1
        for name, value in table:
            if value and remaining >= value:
                out.append((name, value))
                remaining -= value
                break
        else:
            out.append(("64th", DIVISIONS // 16))
            remaining -= DIVISIONS // 16
    return [(name, value) for name, value in out if value > 0]


def create_v25_score_adapter(runtime: V25Runtime) -> V25ScoreAdapter:
    return V25ScoreAdapter(runtime)

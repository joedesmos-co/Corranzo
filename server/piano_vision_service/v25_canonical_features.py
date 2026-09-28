"""Canonical V2.5 source-feature construction for PDF inference.

The trained V2.5 checkpoint only accepts the exact source tensors the
63,086-example qualification cohort was built from, so this module converts
the visual detector's proposals into the same ``modelInput`` records the
factory produced and then calls the canonical builder:

    piano_vision.v2.data.build_inputs
        -> piano_vision.v25.data.attach_object_page_geo
        -> piano_vision.v2.data.collate
        -> piano_vision.v25.performance.prepare_batch

No handwritten approximation of the batch layout survives here. Object order
is the single canonical proposal order, and ``metadata["object_ids"]`` carries
the proposal index so the caller can assert that visual proposal N is V2.5
object slot N.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

from piano_vision.v2.data import build_inputs, collate
from piano_vision.v25.data import attach_object_page_geo
from piano_vision.v25.performance import prepare_batch

log = logging.getLogger(__name__)

# geometryConfidence / geometrySource values the factory recorded for
# glyph-derived physical objects (tools/pdmx-factory semantic factory output).
GLYPH_GEOMETRY_CONFIDENCE = 0.75
GLYPH_GEOMETRY_SOURCE = "glyph-font-bbox"
RASTER_GEOMETRY_SOURCE = "source-notehead-center"
# A raster candidate has no glyph outline. Fall back to the box the training
# corpus uses for such objects, expressed in staff spaces (page-aspect aware).
RASTER_BOX_WIDTH_SPACES = 1.0
RASTER_BOX_HEIGHT_SPACES = 1.5
# Object box shape the trained region sampler expects, in aspect-corrected
# staff spaces. Swept on 19 qualified corpus records (736 supervised object
# heads): 1.3 x 1.5 spaces scores 0.93 written-pitch head accuracy, the best of
# the 0.7-2.0 x 1.0-2.5 space grid, and is stable across 1.3-1.6 x 1.5.
CORPUS_BOX_WIDTH_SPACES = 1.3
CORPUS_BOX_HEIGHT_SPACES = 1.5
# Escape hatch: keep the raw detector outline instead of the corpus shape.
_RAW_BOX = os.environ.get("CORRANZO_V25_OBJECT_BOX", "corpus") == "raw"


@dataclass(frozen=True)
class CanonicalProposal:
    """One visual detector proposal in canonical measure order."""

    index: int
    kind: str                      # "notehead" | "rest"
    center: tuple[float, float]    # page-normalized
    bounds: tuple[float, float, float, float]
    source_bbox: Optional[dict]
    detector_midi: Optional[int] = None
    detector_clef: Optional[str] = None

    @property
    def x(self) -> float:
        return self.center[0]

    @property
    def y(self) -> float:
        return self.center[1]


def staff_space(staff_lines: dict) -> float:
    """Median staff-line gap across every detected line of the measure."""
    lines = list(staff_lines.get("treble") or []) + list(staff_lines.get("bass") or [])
    lines = sorted(float(v) for v in lines)
    if len(lines) < 2:
        return 0.01
    gaps = [lines[i + 1] - lines[i] for i in range(len(lines) - 1)]
    gaps = [g for g in gaps if g > 1e-6]
    return float(np.median(gaps)) if gaps else 0.01


def staff_bands(staff_lines: dict, fallback: tuple[float, float]) -> list[dict]:
    """Tight upper/lower staff bands, the shape the factory recorded."""
    bands: list[dict] = []
    treble = [float(v) for v in (staff_lines.get("treble") or [])]
    bass = [float(v) for v in (staff_lines.get("bass") or [])]
    if treble:
        bands.append({"y0": min(treble), "y1": max(treble), "staffRole": "upper"})
    if bass:
        bands.append({"y0": min(bass), "y1": max(bass), "staffRole": "lower"})
    if not bands:
        bands.append({"y0": fallback[0], "y1": fallback[1], "staffRole": "upper"})
    return bands


def proposal_bounds(proposal: dict, space: float, aspect: float) -> tuple[tuple[float, float], tuple[float, float, float, float], str]:
    """Center and bounds for one detector proposal.

    The visual detector's glyph outline is the same ``sourceBBox`` the factory
    published for the training corpus, and its centre is the true notehead
    centre, so both are used unchanged. The box *shape* is normalized to the
    corpus convention, measured over 3,420 qualified corpus objects
    (``(center.y - true_head_y)/space`` median -0.04, box 0.7 x 1.83 aspect
    corrected staff spaces): the trained region sampler reads the object out of
    a 3x expanded box, so a font-specific outline aspect moves the sampled grid
    off the notehead. ``CORRANZO_V25_OBJECT_BOX=raw`` keeps the raw outline.
    """
    x = float(proposal["xNorm"])
    y = float(proposal["yNorm"])
    bbox = proposal.get("sourceBBox")
    width = height = None
    if bbox:
        x0, y0 = float(bbox["x0"]), float(bbox["y0"])
        x1, y1 = float(bbox["x1"]), float(bbox["y1"])
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        center = ((x0 + x1) / 2, (y0 + y1) / 2)
        raw = (max(x1 - x0, 1e-5), max(y1 - y0, 1e-5))
    else:
        center = (x, y)
    if _RAW_BOX or bbox is None:
        if bbox is None:
            width = RASTER_BOX_WIDTH_SPACES * space / max(aspect, 1e-6)
            height = RASTER_BOX_HEIGHT_SPACES * space
        else:
            width, height = raw
        geometry_source = GLYPH_GEOMETRY_SOURCE if bbox else RASTER_GEOMETRY_SOURCE
    else:
        width = CORPUS_BOX_WIDTH_SPACES * space / max(aspect, 1e-6)
        height = CORPUS_BOX_HEIGHT_SPACES * space
        geometry_source = GLYPH_GEOMETRY_SOURCE if bbox else RASTER_GEOMETRY_SOURCE
    return center, (center[0] - width / 2, center[1] - height / 2,
                    center[0] + width / 2, center[1] + height / 2), geometry_source


def build_page_records(
    *,
    score_id: str,
    page_number: int,
    measures: Sequence[dict],
    aspect: float,
) -> tuple[list[dict], list[list[CanonicalProposal]]]:
    """Canonical ``modelInput`` records, one per detected measure.

    ``measures`` carries the measure's own order in ``index``. The returned
    proposal lists are the canonical object order for each measure: proposal
    index N is the N-th V2.5 object slot of that measure.
    """
    records: list[dict] = []
    per_measure: list[list[CanonicalProposal]] = []
    for measure in measures:
        order = int(measure["index"])
        system_index = int(measure["systemIndex"])
        space = staff_space(measure["staff_lines"])
        proposals: list[CanonicalProposal] = []
        objects: list[dict] = []
        for candidate in measure["candidates"]:
            kind = getattr(candidate, "object_type", "notehead")
            center, bounds, geometry_source = proposal_bounds(
                {
                    "xNorm": candidate.x_norm,
                    "yNorm": candidate.y_norm,
                    "sourceBBox": getattr(candidate, "source_bbox", None),
                },
                space,
                aspect,
            )
            objects.append({
                "objectIndex": len(objects),
                "kind": kind,
                "center": {"x": center[0], "y": center[1]},
                "bounds": {"x0": bounds[0], "x1": bounds[2], "y0": bounds[1], "y1": bounds[3]},
                "geometryConfidence": (GLYPH_GEOMETRY_CONFIDENCE
                                      if geometry_source == GLYPH_GEOMETRY_SOURCE else 0.7),
                "geometrySource": geometry_source,
            })
            proposals.append(CanonicalProposal(
                index=len(proposals),
                kind=kind,
                center=center,
                bounds=bounds,
                source_bbox=getattr(candidate, "source_bbox", None),
                detector_midi=getattr(candidate, "midi", None),
                detector_clef=getattr(candidate, "clef", None),
            ))
        model_input = {
            "geometry": {
                "coordinateSpace": "pdf-source-normalized",
                "scopeBounds": {
                    "x0": float(measure["x0"]), "y0": float(measure["y0"]),
                    "x1": float(measure["x1"]), "y1": float(measure["y1"]),
                },
                "staffBands": {"staffBands": staff_bands(measure["staff_lines"],
                                                        (measure["y0"], measure["y1"]))},
            },
            "physicalObjects": objects,
            # No independent PDF source relation graph is published for an
            # uploaded score, so the graph is declared unavailable rather than
            # invented. The qualified checkpoint is insensitive to it (measured).
            "sourceGraph": {"state": "UNAVAILABLE", "nodes": [], "edges": []},
            "availabilityMasks": {
                "pixels": True, "sourceGeometry": True,
                "physicalObjects": bool(objects),
                "printedRests": False, "sourceGraphEdges": False,
            },
        }
        records.append({
            "schemaVersion": 1,
            "exampleId": f"{score_id}:p{page_number}-s{system_index}-x{order}",
            "scoreId": score_id,
            "split": "inference",
            "input": {
                "modelInput": model_input,
                # Page-level source statistics: the corpus tensor summarizes the
                # factory's source graph, which an uploaded PDF does not have.
                "sourceTensor": [0.0] * 16,
            },
            "provenance": {"runtimeTruthInputs": []},
        })
        per_measure.append(proposals)
    return records, per_measure


class SinglePageResolver:
    """Page resolver for one rendered page. Source pixels only."""

    def __init__(self, image):
        self.image = image

    def page(self, _record):  # noqa: D401 - matches PageResolver.page
        return self.image


def build_measure_batch(records: list[dict], record_index: int, page_image, config):
    """Canonical batch for one measure of ``records``.

    Returns ``(batch, sample, selected)``. ``selected[:current_objects]`` is
    this measure's proposals in canonical order, which is exactly the order of
    the V2.5 object head outputs.
    """
    import torch

    record = records[record_index]
    resolver = SinglePageResolver(page_image)
    sample, selected, _lookup, _relations, nodes = build_inputs(
        record, records, resolver, config)
    sample = attach_object_page_geo(sample, selected)
    batch = collate([sample])

    # The measure itself is the one source notation region. Its box and view are
    # taken from the canonical measure hierarchy node, so the object-set decoder
    # memory, the pointer head and beam generation all run on the same
    # projection they were trained with.
    measure_node = nodes[("measure", record["exampleId"])]
    notation_view = int(sample["hierarchy_view"][measure_node])
    notation_box = sample["hierarchy_boxes"][measure_node]
    batch["notation_boxes"] = torch.tensor([[list(map(float, notation_box))]],
                                          dtype=torch.float32)
    batch["notation_view"] = torch.tensor([[notation_view]], dtype=torch.long)
    batch["notation_mask"] = torch.tensor([[True]], dtype=torch.bool)
    batch["notation_region_geo"] = torch.tensor(
        [[[(float(notation_box[0]) + float(notation_box[2])) / 2,
           (float(notation_box[1]) + float(notation_box[3])) / 2, 1.0]]],
        dtype=torch.float32)
    # `collate_v25` maps an unresolved pointer target to the null class, which
    # is the current-scope object count. Kept for auditing the pointer argmax.
    batch["pointer_null_class"] = int(sample["metadata"]["current_objects"])
    batch = prepare_batch(batch, consistency=False)
    return batch, sample, selected


def assert_object_alignment(sample, selected) -> int:
    """Prove visual proposal N is V2.5 object slot N for the current measure.

    The canonical builder emits the current scope first, in proposal order, so
    slot N must be proposal N. A mismatch means the visual order and the V2.5
    object order diverged and nothing may be decoded.
    """
    current = int(sample["metadata"]["current_objects"])
    example_id = sample["metadata"]["example_id"]
    object_ids = sample["metadata"]["object_ids"]
    if len(object_ids) != len(selected):
        raise AssertionError(
            f"object id count {len(object_ids)} != selected {len(selected)}")
    for slot in range(current):
        scope, local, _obj, _row = selected[slot]
        if scope != example_id or local != slot:
            raise AssertionError(
                f"object index alignment broken: slot {slot} is {scope}:{local}, "
                f"expected {example_id}:{slot}")
        if object_ids[slot] != f"{example_id}:{slot}":
            raise AssertionError(f"object id alignment broken at slot {slot}")
    return current


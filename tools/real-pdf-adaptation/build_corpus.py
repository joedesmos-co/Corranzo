#!/usr/bin/env python3
"""Build canonical V2.5 training records from real rendered PDFs.

Every pixel, box, staff band, staff gap and proposal comes from the PRODUCTION
adapter, not from a re-implementation:

    piano_vision_service.v25_adapter.V25ScoreAdapter._render_pdf_pages   (RENDER_DPI=150)
    piano_vision_service.v25_adapter.V25ScoreAdapter._analyze_page       (systems, measure grid)
    piano_vision_service.v25_adapter.V25ScoreAdapter._detect_page_objects (proposals)
    piano_vision_service.v25_canonical_features.build_page_records      (modelInput)
    piano_vision_service.v25_canonical_features.staff_bands / staff_space

Ground truth comes from the matched MusicXML through
``musicxml_truth`` + ``align_objects``. Nothing here reads a checkpoint, a model
output or a detector pitch estimate.

The rendered pages are written once as 8-bit grayscale PNGs so training can
re-crop them through the canonical ``piano_vision.v2.data.crop_view`` with
byte-identical pixels to inference. No crop is precomputed.

Layout produced under --out::

    pages/<score_id>/page-<n>.png     production 150 DPI grayscale render
    shards/<score_id>.jsonl.gz        canonical records + target.families
    index.json                        score -> split, shards, page paths
    coverage.json                     per-score alignment / exclusion report
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO / "server"))
sys.path.insert(0, str(REPO / "tools/piano-vision-v25-candidate"))

import fitz  # noqa: E402

from piano_vision.v25.config import config_from_dict  # noqa: E402
import piano_vision_service.v25_adapter as adapter_module  # noqa: E402
from piano_vision_service.omr_notehead_detection import detect_rests_in_measure  # noqa: E402
from piano_vision_service.omr_raster_filters import detect_filtered_noteheads  # noqa: E402
from piano_vision_service.v25_canonical_features import build_page_records, staff_space  # noqa: E402

from align_objects import (align_band, align_measure_sequence,  # noqa: E402
                          analytic_band_delta, build_targets)
from musicxml_truth import expected_measured_steps  # noqa: E402
from staff_geometry_verify import check_measure, label_is_admissible  # noqa: E402
from musicxml_truth import score_report  # noqa: E402

ASSEMBLER_VERSION = "real-pdf-adaptation/1.0"
MIN_DETECTED_LINES_PER_BAND = 4
CLEF_FOR_BAND = {"upper": ("G", 2), "lower": ("F", 4)}
# Campaign split -> the record "split" the canonical V2.5 code will open.
RECORD_SPLIT = {"adaptation": "train", "validation": "validation",
               "heldout-test": "validation", "diagnostic": "validation"}
MAX_PAGES_PER_SCORE = 4
MAX_MEASURES_PER_SCORE = 200


def sha256_file(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True))
    os.replace(tmp, path)


def render_page(document, index):
    """Byte-identical to V25ScoreAdapter._render_pdf_pages for one page."""
    page = document[index]
    matrix = fitz.Matrix(adapter_module.RENDER_DPI / 72.0, adapter_module.RENDER_DPI / 72.0)
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    gray = image.convert("L")
    from piano_vision_service.omr_pdf_glyphs import extract_pdf_glyphs
    gray.info["omrGlyphs"] = extract_pdf_glyphs(page, pixmap.width, pixmap.height)
    return gray, (pixmap.width, pixmap.height)


def page_dark_array(image):
    return np.array(image, dtype=np.float32) / 255.0


def detect_page(adapter, image, page_number, measure_start, printed_base):
    """Production page analysis + proposal detection, one page at a time.

    ``index`` stays PAGE-LOCAL and byte-identical to
    ``build_page_records`` so the canonical example ids match production exactly.
    ``printedIndex`` is the running count of printed measures across the whole
    score and is what the MusicXML measure bijection uses.
    """
    array = page_dark_array(image)
    content_bounds = adapter._detect_content_bounds(array)
    systems = adapter._detect_staff_systems(array, content_bounds)
    boxes, _gap = adapter._build_measure_grid(array, systems, content_bounds, measure_start)
    height, width = array.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    gray = np.array(image, dtype=np.uint8)
    rgba[:, :, 0] = gray
    rgba[:, :, 1] = gray
    rgba[:, :, 2] = gray
    rgba[:, :, 3] = 255
    image_data = {"data": rgba, "width": width, "height": height}
    from piano_vision_service.omr_pdf_glyphs import has_vector_noteheads, vector_objects_for_measure
    vector_source = has_vector_noteheads(image.info.get("omrGlyphs", []))
    page_boxes = [dict(x0=b.x0, x1=b.x1, y0=b.y0, y1=b.y1,
                       staffLines=b.staff_lines, systemIndex=b.system_index) for b in boxes]
    measures = []
    for order, box in enumerate(boxes):
        payload = {
            "x0": box.x0, "x1": box.x1, "y0": box.y0, "y1": box.y1,
            "measureNumber": order, "systemIndex": box.system_index,
            "page": page_number, "staffLines": box.staff_lines,
            "staffClefs": {"upper": "treble", "lower": "bass"},
            "playableX0": box.playable_x0 if box.playable_x0 is not None else box.x0,
            "ledgerMarginNorm": 0.02,
        }
        if vector_source:
            noteheads, rests = vector_objects_for_measure(
                image.info.get("omrGlyphs", []), image_data, payload, page_boxes)
        else:
            noteheads = detect_filtered_noteheads(image_data, payload, adapter_module.INK_THRESHOLD)
            rests = detect_rests_in_measure(
                image_data, payload, adapter_module.INK_THRESHOLD,
                [{"cx": n.cx, "cy": n.cy} for n in noteheads])
        candidates = sorted(list(noteheads) + list(rests), key=lambda c: (c.cx, c.cy))
        measures.append({
            "index": order, "printedIndex": printed_base + order,
            "measureNumber": box.measure_number,
            "systemIndex": box.system_index, "x0": box.x0, "x1": box.x1,
            "y0": box.y0, "y1": box.y1, "staff_lines": box.staff_lines,
            "candidates": candidates,
        })
    return measures, content_bounds


def band_centers_for(measure):
    """Centre of every detected staff band, and how many lines produced it."""
    centers, lines = {}, {}
    for role, key in (("upper", "treble"), ("lower", "bass")):
        values = [float(v) for v in (measure["staff_lines"].get(key) or [])]
        if len(values) >= 2:
            centers[role] = (min(values) + max(values)) / 2.0
            lines[role] = len(values)
        else:
            centers[role] = None
            lines[role] = len(values)
    return centers, lines



def apply_label_gate(target, objects, centers, lines_by_role, gap):
    """Phase D2/D3: refuse geometrically inadmissible labels, never repair them.

    Every emitted PITCH_STAFF label is re-checked against the DETECTED STAFF
    ALONE, with no ground truth: the object it names must belong to the band it
    claims, and its staff step must lie inside the ledger envelope of a
    five-line staff. A label that fails is dropped and counted.

    The gate is a floor, not a target: a small corpus that is consistent beats
    a large corpus that is not, and nothing here widens a threshold to admit
    more records.
    """
    checks = check_measure(centers, lines_by_role, gap, objects)
    counts = {}
    families = target["families"]
    kept = []
    for label in families["PITCH_STAFF"]:
        value = label.get("value") or {}
        role = value.get("staffRole")
        indexes = label.get("objectIndexes") or []
        index = indexes[0] if indexes else -1
        ok, reasons = label_is_admissible(
            checks.get(role), role, index, objects, centers, gap)
        if ok:
            kept.append(label)
        else:
            for r in reasons:
                counts[r] = counts.get(r, 0) + 1
    families["PITCH_STAFF"] = kept
    # Lane/attack/chord/tie labels are keyed to the same object indexes; drop any
    # that referenced a refused pitch object so no label survives without its
    # geometry.
    surviving = {id(l) for l in kept}
    surviving_idx = {i for l in kept for i in (l.get("objectIndexes") or [])}
    for name in ("LANE", "ATTACK", "CHORD", "LANE_CONTINUATION", "TIE_SUSTAIN",
                 "CROSS_STAFF", "SHARED_HEAD", "TUPLET", "REST", "DURATION"):
        rows = families.get(name) or []
        kept_rows = [r for r in rows
                     if not (r.get("objectIndexes")
                             and not set(r["objectIndexes"]) <= surviving_idx)]
        if len(kept_rows) != len(rows):
            counts["dependent_label_dropped"] = counts.get(
                "dependent_label_dropped", 0) + (len(rows) - len(kept_rows))
        families[name] = kept_rows
    return target, counts


def build_score(entry, config, out_root, verbose):
    score_id = entry["id"]
    split = entry["split"]
    report = {
        "score_id": score_id, "split": split, "title": entry.get("title"),
        "pdf": entry["pdf"], "musicxml": entry["musicxml"],
        "engraving": entry.get("engraving"),
        "pages_rendered": 0, "pages_declared": entry.get("pages"),
        "measures_detected": 0, "measures_aligned": 0, "records_written": 0,
        "printed_measures_total": 0,
        "objects_total": 0, "objects_labelled_pitch": 0, "objects_labelled_rest": 0,
        "objects_labelled_duration": 0, "groups_accepted": 0,
        "group_reasons": {}, "pages_skipped": 0, "band_offsets": {},
        "label_gate": {},
        "measure_map": {}, "measure_map_size": 0,
        "true_printed_events": None, "true_printed_rests": None,
        "note_recall_of_detected": None, "rejected": [],
    }
    truth_report = score_report(entry["musicxml"])
    if not truth_report.get("ok"):
        report["rejected"] = truth_report.get("rejected", ["unknown"])
        report["status"] = "musicxml_rejected"
        return report, []
    truth = truth_report.pop("truth")
    report.update({
        "musicxml_measures": truth_report["measures"],
        "part_measure_counts": truth_report["part_measure_counts"],
        "trailing_measure_deficit": truth_report["trailing_measure_deficit"],
        "clef_change_elements": truth_report["clef_change_elements"],
        "true_printed_events": truth_report["printed_events"],
        "true_printed_rests": truth_report["printed_rests"],
        "lanes": truth_report["lanes"],
    })

    document = fitz.open(entry["pdf"])
    page_dir = out_root / "pages" / score_id
    page_dir.mkdir(parents=True, exist_ok=True)
    adapter = adapter_module.V25ScoreAdapter.__new__(adapter_module.V25ScoreAdapter)
    adapter.config = config

    records, printed_cursor, printed_base = [], 0, 0
    limit = min(len(document), MAX_PAGES_PER_SCORE)
    for page_index in range(limit):
        image, (width, height) = render_page(document, page_index)
        page_path = page_dir / f"page-{page_index + 1}.png"
        image.save(page_path, format="PNG", optimize=False)
        report["pages_rendered"] += 1
        measures, _bounds = detect_page(adapter, image, page_index + 1, printed_cursor,
                                         printed_base)
        printed_base = printed_cursor
        printed_cursor += len(measures)
        aspect = height / max(1, width)
        canonical, proposals = build_page_records(
            score_id=score_id, page_number=page_index + 1,
            measures=measures, aspect=aspect)

        # ---- per-page preparation -------------------------------------------
        # 1. band geometry per detected measure
        page_state = []
        for record_index, measure in enumerate(measures):
            centers, line_counts = band_centers_for(measure)
            gap = staff_space(measure["staff_lines"])
            objects = canonical[record_index]["input"]["modelInput"]["physicalObjects"]
            by_band = {"upper": [], "lower": []}
            for object_index, obj in enumerate(objects):
                band = "upper" if _closer(obj, centers, "upper") else "lower"
                by_band[band].append(object_index)
            page_state.append({
                "record_index": record_index, "measure": measure, "centers": centers,
                "line_counts": line_counts, "gap": gap, "objects": objects,
                "by_band": by_band,
            })

        # 2. per-measure analytic band offset, straight from the detected staff
        #    lines. A correctly detected five-line staff gives -1 for a G clef
        #    on line 2 and +1 for an F clef on line 4 whatever the
        #    rasterization; measured medians are -0.977 and +1.023 with a
        #    spread of 0.01, so the staff-line detection is sound and the label
        #    offset is KNOWN rather than fitted from the ground truth. Fitting
        #    it from the labels would be circular, and fitting it per measure
        #    from a handful of objects is what breaks polyphonic material.
        for state in page_state:
            state["analytic_delta"] = {
                band: analytic_band_delta(
                    [float(v) for v in (state["measure"]["staff_lines"].get(
                        "treble" if band == "upper" else "bass") or [])],
                    state["gap"], *CLEF_FOR_BAND[band])
                for band in ("upper", "lower")}

        # 3. page-level consensus of the analytic offsets, used only to score
        #    candidate measure pairings. This is a median of a purely geometric
        #    quantity, so it needs no alignment and cannot be circular.
        deltas, delta_support = {}, {}
        for band in ("upper", "lower"):
            values = [s["analytic_delta"][band] for s in page_state
                      if s["centers"].get(band) is not None
                      and s["line_counts"].get(band, 0) >= MIN_DETECTED_LINES_PER_BAND
                      and s["analytic_delta"][band] is not None]
            deltas[band] = float(np.median(values)) if values else None
            delta_support[band] = {
                "delta": deltas[band], "measures": len(values),
                "spread": (float(np.percentile(values, 75) - np.percentile(values, 25))
                           if len(values) > 1 else None),
            }
        report["band_offsets"] = delta_support

        # 4. monotone detected-measure -> MusicXML-measure map
        band_measured, band_lattice = {}, {}
        for d, state in enumerate(page_state):
            for band in ("upper", "lower"):
                if state["centers"].get(band) is None or \
                        state["line_counts"].get(band, 0) < MIN_DETECTED_LINES_PER_BAND:
                    continue
                members = state["by_band"][band]
                note_members = [i for i in members
                                if state["objects"][i].get("kind") == "notehead"]
                if note_members and state["gap"] and state["gap"] > 1e-9:
                    band_measured[(d, band)] = [
                        ((state["centers"][band] - float(state["objects"][i]["center"]["y"]))
                         / state["gap"]) for i in note_members]
        for x, truth_measure in enumerate(truth.measures):
            for band in ("upper", "lower"):
                lattice = [expected_measured_steps(e.diatonic, e.center_diatonic)
                           for e in truth_measure.events
                           if e.printed and e.band == band and not e.is_rest
                           and e.diatonic is not None and e.center_diatonic is not None]
                if lattice:
                    band_lattice[(x, band)] = lattice
        mapping, _scores = align_measure_sequence(
            page_state, len(truth.measures), band_measured, band_lattice, deltas)
        report["measure_map"] = {str(k): v for k, v in sorted(mapping.items())}
        report["measure_map_size"] = len(mapping)

        for record_index, record in enumerate(canonical):
            if not proposals[record_index]:
                report["pages_skipped"] += 1
                continue
            state = page_state[record_index]
            measure = state["measure"]
            printed_index = printed_base + record_index
            report["measures_detected"] += 1
            report["objects_total"] += len(measure["candidates"])
            xml_index = mapping.get(record_index)
            if xml_index is None:
                report["group_reasons"]["no_xml_measure_partner"] = \
                    report["group_reasons"].get("no_xml_measure_partner", 0) + 1
                continue
            truth_measure = truth.measures[xml_index]
            objects, centers, gap = state["objects"], state["centers"], state["gap"]
            alignments = {}
            for band in ("upper", "lower"):
                if centers.get(band) is None or \
                        state["line_counts"].get(band, 0) < MIN_DETECTED_LINES_PER_BAND:
                    skipped = align_band(band, [], [], None, None,
                                         delta=state["analytic_delta"].get(band))
                    skipped.reason = "unreliable_staff_lines"
                    alignments[band] = skipped
                    continue
                members = state["by_band"][band]
                events = [e for e in truth_measure.events
                          if e.printed and e.band == band]
                alignment = align_band(
                    band, [objects[i] for i in members], events,
                    centers[band], gap, delta=state["analytic_delta"].get(band))
                # INDEX-SPACE REMAP (Phase D2).
                # `align_band` reports object indices LOCAL to the subset it was
                # handed ([objects[i] for i in members]). `build_targets` and the
                # record's object order are in the FULL measure list. Without this
                # remap every label points at objects[local_index], which is a
                # different notehead whenever `members` does not start at 0 - i.e.
                # always, because by_band splits upper/lower. That is what put
                # ~50% of the corpus at |stepsFromBandCenter| > 4, a physically
                # impossible position on a five-line staff.
                alignment.object_index = [members[j] for j in alignment.object_index]
                alignments[band] = alignment
            for alignment in alignments.values():
                if alignment.accepted:
                    report["groups_accepted"] += 1
                else:
                    report["group_reasons"][alignment.reason] = \
                        report["group_reasons"].get(alignment.reason, 0) + 1
            if not any(a.accepted for a in alignments.values()):
                continue
            lines_by_role = {
                "upper": measure["staff_lines"].get("treble") or [],
                "lower": measure["staff_lines"].get("bass") or []}
            target = build_targets(record["exampleId"], truth, truth_measure, objects,
                                   alignments, centers, gap)
            target, gate_counts = apply_label_gate(
                target, objects, centers, lines_by_role, gap)
            for reason, n in gate_counts.items():
                report["label_gate"][reason] = report["label_gate"].get(reason, 0) + n
            if not target["families"]["PITCH_STAFF"] and \
                    not target["families"]["REST"] and \
                    not target["families"]["DURATION"]:
                report["group_reasons"]["label_gate_emptied_group"] = \
                    report["group_reasons"].get("label_gate_emptied_group", 0) + 1
                continue
            record = dict(record)
            record["split"] = RECORD_SPLIT[split]
            record["campaign_split"] = split
            record["provenance"] = {
                "runtimeTruthInputs": [],
                "assemblerVersion": ASSEMBLER_VERSION,
                "sourceCoordinateIdentity": True,
                "sourceTargetFirewall": "PASS",
                "renderDpi": adapter_module.RENDER_DPI,
                "renderPixels": [width, height],
                "pagePath": str(page_path.relative_to(out_root)),
                "sourcePdfSha256": sha256_file(entry["pdf"]),
                "sourceMusicXmlSha256": sha256_file(entry["musicxml"]),
            }
            record["target"] = target
            record["alignment"] = {
                "printed_measure_index": printed_index,
                "detected_measure_index": record_index,
                "xml_measure_index": truth_measure.xml_measure_index,
                "page_measure_index": measure["index"],
                "bands_accepted": sorted(b for b, a in alignments.items() if a.accepted),
            }
            records.append(record)
            report["measures_aligned"] += 1
            report["objects_labelled_pitch"] += len(target["families"]["PITCH_STAFF"])
            report["objects_labelled_rest"] += len(target["families"]["REST"])
            report["objects_labelled_duration"] += len(target["families"]["DURATION"])
        if printed_cursor > MAX_MEASURES_PER_SCORE:
            break
    document.close()
    report["printed_measures_total"] = printed_cursor

    if not records:
        report["status"] = "no_aligned_records"
        return report, []
    shard_name = f"{score_id}.jsonl.gz"
    shard_path = out_root / "shards" / shard_name
    shard_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(shard_path, "wt", compresslevel=6) as stream:
        for record in records:
            stream.write(json.dumps(record) + "\n")
    report["status"] = "ok"
    report["records_written"] = len(records)
    report["shard"] = shard_name
    report["shard_sha256"] = sha256_file(shard_path)
    report["page_paths"] = [str(p.relative_to(out_root)) for p in sorted(page_dir.glob("page-*.png"))]
    if verbose:
        print(f"  {score_id}: {len(records)} records, "
              f"{report['objects_labelled_pitch']} pitch labels, "
              f"groups={report['group_reasons']}", flush=True)
    return report, records


def measure_index_of(record) -> int:
    """Printed-measure ordinal carried by the canonical example id."""
    return int(record["exampleId"].rsplit("-x", 1)[1])


def _closer(obj, centers, role) -> bool:
    cy = float(obj["center"]["y"])
    upper, lower = centers.get("upper"), centers.get("lower")
    if upper is None:
        return False
    if lower is None:
        return True
    return abs(cy - upper) <= abs(cy - lower)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--split-config", default=str(Path(__file__).with_name("split_manifest.json")))
    parser.add_argument("--out", required=True)
    parser.add_argument("--config", default=None,
                        help="model config json; defaults to the qualified step-2100 contract")
    parser.add_argument("--contract", default=str(REPO / "tmp/campaign/piano-vision-phase214/"
                                                          "v25-windows-transfer-20260927/contract.json"))
    parser.add_argument("--splits", default="adaptation,validation,heldout-test,diagnostic")
    parser.add_argument("--min-pitch-labels", type=int, default=1500,
                        help="refuse to emit a manifest below this many adaptation pitch labels")
    parser.add_argument("--min-records", type=int, default=250,
                        help="refuse to emit a manifest below this many adaptation records")
    args = parser.parse_args()

    config_doc = json.loads(Path(args.config).read_text()) if args.config else \
        json.loads(Path(args.contract).read_text())["model_config"]
    config = config_from_dict(config_doc)

    split_doc = json.loads(Path(args.split_config).read_text())
    wanted = [s.strip() for s in args.splits.split(",") if s.strip()]
    selected = [e for e in split_doc["scores"] if e["split"] in wanted]

    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    started = time.time()
    coverage, index_scores = [], {}
    for entry in selected:
        print(f"[{entry['split']}] {entry['id']}", flush=True)
        report, records = build_score(entry, config, out_root, verbose=True)
        coverage.append(report)
        if records:
            index_scores[entry["id"]] = {
                "score_id": entry["id"], "split": entry["split"],
                "title": entry.get("title"), "engraving": entry.get("engraving"),
                "shards": [report["shard"]], "examples": len(records),
                "page_paths": report["page_paths"],
            }
    index = {
        "schemaVersion": 1,
        "assemblerVersion": ASSEMBLER_VERSION,
        "render_dpi": adapter_module.RENDER_DPI,
        "dataset_root": str(out_root),
        "scores": [index_scores[k] for k in sorted(index_scores)],
    }
    index["manifest_digest"] = hashlib.sha256(
        json.dumps(index["scores"], sort_keys=True).encode()).hexdigest()
    write_json(out_root / "index.json", index)
    write_json(out_root / "coverage.json", {
        "elapsed_s": round(time.time() - started, 1),
        "scores": coverage,
        "totals": {
            "scores_ok": sum(1 for c in coverage if c["status"] == "ok"),
            "scores_rejected": sum(1 for c in coverage if c["status"] != "ok"),
            "records": sum(c["records_written"] for c in coverage),
            "pitch_labels": sum(c["objects_labelled_pitch"] for c in coverage),
            "rest_labels": sum(c["objects_labelled_rest"] for c in coverage),
            "duration_labels": sum(c["objects_labelled_duration"] for c in coverage),
        },
    })
    totals = json.loads(json.dumps({
        "records": sum(c["records_written"] for c in coverage),
        "pitch": sum(c["objects_labelled_pitch"] for c in coverage),
        "adaptation_pitch": sum(c["objects_labelled_pitch"] for c in coverage
                                if c["split"] == "adaptation")}))
    print(json.dumps(totals), flush=True)
    adaptation_records = sum(c["records_written"] for c in coverage if c["split"] == "adaptation")
    if "adaptation" in wanted and (totals["adaptation_pitch"] < args.min_pitch_labels
                                   or adaptation_records < args.min_records):
        raise SystemExit(
            f"adaptation split has {adaptation_records} records / "
            f"{totals['adaptation_pitch']} aligned pitch labels; required "
            f"{args.min_records} / {args.min_pitch_labels}. Refusing to emit a "
            f"trainable manifest. See coverage.json for the per-score reasons.")


if __name__ == "__main__":
    main()

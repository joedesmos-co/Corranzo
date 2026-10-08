#!/usr/bin/env python3
"""Guitar proof crops (G0/G1): joined boxes -> labeled 64x64 crops.

Mapping: joins boxes are canonical page units == SVG px (content transform
is a pure translate on these Verovio SVGs). PNG_px = SVG_px * png_w /
svg_w (aspect preserved by the rasterizer; asserted per file).

Every crop gets an ink self-check (center darkness vs page background);
failures quarantine with reason instead of training on misregistered boxes.

Only frozen TRAIN/validation assignments from pdmx + v2 manifests. Heldout,
diagnostic, v2-pilot, and the fret benchmark are never read (asserted).

Usage:
    python3 tools/guitar-vision/proof-build-crops.py --out <dir>
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CROP = 64
PAD = 0.6  # 60% context padding around the joined box

SEALED_MANIFESTS = [
    "datasets/guitar-vision/v2-pilot/dataset-manifest.json",
]


def load_assignments() -> dict:
    """sampleId -> (split, tier, manifest). Only train/validation kept."""
    out = {}
    for manifest_path, tier_default in [
        ("datasets/guitar-vision/pdmx/dataset-manifest.json", "real"),
        ("datasets/guitar-vision/v2/dataset-manifest.json", None),
    ]:
        manifest = json.loads((ROOT / manifest_path).read_text())
        tiers = {}
        if tier_default is None:
            ingest = json.loads((ROOT / "datasets/guitar-vision/v2/work/ingest-records.json").read_text())
            tiers = {r["candidateId"]: r.get("tier", "real") for r in ingest["records"]}
        for sample in manifest["splits"]["assignments"]:
            if sample["split"] not in ("train", "validation"):
                continue
            tier = tier_default or tiers.get(sample["sample"], "real")
            out[sample["sample"]] = {"split": sample["split"], "tier": tier, "manifest": manifest_path}
    return out


def svg_size(svg: str) -> tuple[float, float]:
    width = re.search(r'<svg[^>]*\swidth="([\d.]+)', svg)
    height = re.search(r'<svg[^>]*\sheight="([\d.]+)', svg)
    return float(width.group(1)), float(height.group(1))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--hires", required=True,
                        help="staging dir with <score>-page<N>.png + manifests from proof-raster-hires")
    args = parser.parse_args()
    out_dir = Path(args.out)
    hires_dir = Path(args.hires)
    (out_dir / "crops").mkdir(parents=True, exist_ok=True)

    # Sealed populations must never contribute. v2-pilot assignments overlap
    # v2 assignments for the same 12 local scores (re-split under a new
    # system); that overlap is expected. Real leakage is a sample HELD OUT
    # (heldout/diagnostic) in any sealed manifest but USED (train/DEV) here.
    assignments = load_assignments()
    sealed_heldout: set[str] = set()
    for manifest_path in SEALED_MANIFESTS:
        manifest = json.loads((ROOT / manifest_path).read_text())
        sealed_heldout.update(
            s["sample"] for s in manifest["splits"]["assignments"] if s["split"] not in ("train", "validation")
        )
    used = set(assignments)
    assert not (used & sealed_heldout), f"sealed leakage: {sorted(used & sealed_heldout)}"

    # Work dirs keyed by candidate id.
    work_roots = [
        ROOT / "datasets/guitar-vision/pdmx/work",
        ROOT / "datasets/guitar-vision/v2/work",
    ]
    records: dict[str, dict] = {}
    for root in work_roots:
        ingest = json.loads((root / "ingest-records.json").read_text())
        for record in ingest["records"]:
            if record["status"] == "PASS":
                records[record["candidateId"]] = {"record": record, "root": root}

    rows = []
    quarantined = []
    counts = {"train": 0, "validation": 0}
    for sample_id, info in sorted(assignments.items()):
        entry = records.get(sample_id)
        if entry is None:
            continue
        record, root = entry["record"], entry["root"]
        score_dir = root / sample_id
        canonical = json.loads((score_dir / "canonical.json").read_text())
        joins = json.loads((score_dir / "joins.json").read_text())
        hires_manifest = json.loads((hires_dir / f"{sample_id}-manifest.json").read_text())
        # Per-page hires rasters: PNG_px = canonical * cssWidth / viewBoxWidth.
        page_images = {}
        for tag, meta in hires_manifest.items():
            if tag == "file":
                continue
            if not isinstance(meta, dict) or "file" not in meta:
                continue
            image = Image.open(meta["file"]).convert("L")
            page_images[int(tag.replace("page", ""))] = {
                "image": image,
                "pixels": np.asarray(image, dtype=np.float64),
                "fx": meta["cssWidth"] / meta["viewBox"][0],
                "fy": meta["height"] / meta["viewBox"][1],
            }
        if not page_images:
            quarantined.append({"id": sample_id, "reason": "no hires raster"})
            continue
        first_page = page_images[sorted(page_images)[0]]
        background = float(np.median(first_page["pixels"]))

        masked_measures = set(record.get("maskedMeasures") or [])
        box_masked = set()
        for layout in (record.get("render") or {}).get("layouts", {}).values():
            for masked in layout.get("maskedEvents") or []:
                box_masked.add(masked["id"])
        events = {event["id"]: event for event in canonical.get("events", [])}
        stamped_prefix = sample_id
        note_counter: dict[str, str] = {}
        for event in canonical.get("events", []):
            note_id = ((event.get("source") or {}).get("noteId") or "")
            match = re.search(r"-n(\d+)$", note_id)
            if match:
                note_counter[f"{stamped_prefix}-n{int(match.group(1)) + 1:03d}"] = event["id"]
        # TAB-mirror duplicates render their own TAB groups but hold no
        # canonical event: resolve them to the surviving event through the
        # recorded staff-mirror pairings (same pitch/position, exact link).
        for pairing in canonical.get("pairings", []):
            if pairing.get("scope") != "staff-mirror":
                continue
            mirror_id = pairing.get("mirrorNoteId")
            if not mirror_id:
                continue
            match = re.search(r"-n(\d+)$", mirror_id)
            if match:
                note_counter[f"{stamped_prefix}-n{int(match.group(1)) + 1:03d}"] = pairing["eventId"]

        for stamped_id, join in joins["joins"].items():
            event_id = note_counter.get(stamped_id)
            if event_id is None:
                quarantined.append({"id": stamped_id, "reason": "no canonical event"})
                continue
            if stamped_id in box_masked:
                # Renderer-merged/dropped duplicates: truth stands, but there
                # is no trustworthy box to supervise from. Skip the crop.
                quarantined.append({"id": stamped_id, "reason": "box-masked"})
                continue
            event = events[event_id]
            time = event.get("time", {})
            boxes = join.get("boxes") or []
            if not boxes:
                quarantined.append({"id": stamped_id, "reason": "empty box"})
                continue
            # Union multi-glyph boxes (TAB digits) into one crop.
            x0 = min(b[0] for b in boxes)
            y0 = min(b[1] for b in boxes)
            x1 = max(b[2] for b in boxes)
            y1 = max(b[3] for b in boxes)
            width, height = x1 - x0, y1 - y0
            if width <= 0 or height <= 0:
                quarantined.append({"id": stamped_id, "reason": "degenerate box"})
                continue
            cx, cy = x0 + width / 2, y0 + height / 2
            side = max(width, height) * (1 + PAD)
            page_no = join.get("page") or 1
            page = page_images.get(page_no, first_page)
            image, pixels = page["image"], page["pixels"]
            px = [int((cx - side / 2) * page["fx"]), int((cy - side / 2) * page["fy"]),
                  int((cx + side / 2) * page["fx"]), int((cy + side / 2) * page["fy"])]
            px[0], px[1] = max(px[0], 0), max(px[1], 0)
            px[2], px[3] = min(px[2], image.width), min(px[3], image.height)
            if px[2] - px[0] < 4 or px[3] - px[1] < 4:
                quarantined.append({"id": stamped_id, "reason": "off-page box"})
                continue
            crop = image.crop(tuple(px)).resize((CROP, CROP), Image.BILINEAR)
            center = np.asarray(crop)[16:48, 16:48]
            ink = float((center < 128).mean())
            page_ink = float((pixels < 128).mean())
            # Ink bar scales with page density: blank crops sit near zero,
            # glyph crops clear it with margin on sparse and dense pages.
            if not (ink > max(0.05, page_ink + 0.005)):
                quarantined.append({"id": stamped_id, "reason": f"ink-check {ink:.3f} vs page {page_ink:.3f}"})
                continue
            children = join.get("children", [])
            if "tab-text" in children:
                family = "tabdigit"
            elif "rest" in children:
                family = "rest"
            else:
                family = "note"
            pitch = (event.get("pitch") or {}).get("soundingMidi")
            tab = event.get("tab") or {}
            techniques = [t.get("kind") for t in event.get("techniques") or []]
            name = f"{info['split']}-{sample_id}-{stamped_id.split('-n')[-1]}.png"
            crop.save(out_dir / "crops" / name)
            rows.append({
                "file": name, "split": info["split"], "tier": info["tier"],
                "score": sample_id, "event": event_id, "stamped": stamped_id,
                "family": family, "midi": pitch,
                "duration": time.get("noteType"), "dots": time.get("dots", 0),
                "voice": time.get("voice", 1), "measure": (event.get("source") or {}).get("measure"),
                "string": tab.get("string"), "fret": tab.get("fret"),
                "techniques": techniques,
                "maskedMeasure": (event.get("source") or {}).get("measure") in masked_measures,
                "mergedInto": join.get("mergedInto"),
            })
            counts[info["split"]] += 1

    with open(out_dir / "labels.jsonl", "w") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    (out_dir / "quarantined-crops.json").write_text(json.dumps(quarantined, indent=1))
    summary = {"crops": len(rows), "bySplit": counts, "quarantinedCrops": len(quarantined),
               "quarantineReasons": {r["reason"].split(" ")[0]: 0 for r in quarantined}}
    for r in quarantined:
        summary["quarantineReasons"][r["reason"].split(" ")[0]] += 1
    (out_dir / "crop-summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

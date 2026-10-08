#!/usr/bin/env python3
"""G1 failure autopsy: why does six-line detection abstain? TRAIN ONLY.

For each undetected TRAIN digit, record diagnostic signals (peak counts at
multiple thresholds, best-run scores, digit-onto-line proximity under loose
tolerances, neighbor ink, barline proximity) and classify the failure.
DEV is not touched during design (G6).

Usage:
    python3 tools/guitar-vision/proof-geometry-autopsy.py --crops <dir> --hires <dir> --work ... --out <dir>
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

import importlib.util
import sys

def _load_crops_module():
    path = Path(__file__).resolve().parent / "proof-context-crops.py"
    spec = importlib.util.spec_from_file_location("proof_context_crops_mod", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["proof_context_crops_mod"] = module
    spec.loader.exec_module(module)
    return module

find_best_six = _load_crops_module().find_best_six

CATEGORIES = [
    "few-peaks",        # <6 peaks: faint/broken lines or empty strip
    "many-peaks",       # >12 peaks: clutter (neighbors, stems, slurs)
    "foreign-comb",     # a regular 6-run exists but digit not anchored
    "anchor-miss",      # best run found but digit sits between lines
    "edge-clip",        # strip clipped at image border
    "low-contrast",     # profile max below floor
]


def profile_of(pixels, cx, cy, img_w, img_h, half_y=130, side=(30, 130)):
    x0, x1 = max(int(cx - side[1]), 0), min(int(cx - side[0]), img_w)
    x2, x3 = max(int(cx + side[0]), 0), min(int(cx + side[1]), img_w)
    y0, y1 = max(int(cy - half_y), 0), min(int(cy + half_y), img_h)
    if x1 - x0 < 10 or x3 - x2 < 10 or y1 - y0 < 40:
        return None, "edge-clip"
    side_px = np.concatenate([pixels[y0:y1, x0:x1], pixels[y0:y1, x2:x3]], axis=1)
    return (side_px < 128).mean(axis=1), None


def count_peaks(profile, threshold):
    peaks = []
    above, start = False, 0
    for i, value in enumerate(profile):
        if value >= threshold and not above:
            above, start = True, i
        elif value < threshold and above:
            above = False
            if i - start >= 1:
                peaks.append((start + i - 1) / 2)
    if above and len(profile) - start >= 1:
        peaks.append((start + len(profile) - 1) / 2)
    return peaks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", required=True)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    crops_dir, hires_dir, out_dir = Path(args.crops), Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = [json.loads(line) for line in (crops_dir / "labels.jsonl").read_text().splitlines()]
    train_tabs = [r for r in rows if r["split"] == "train" and r["family"] == "tabdigit"]
    hires_manifests = {}
    for manifest_path in hires_dir.glob("*-manifest.json"):
        hires_manifests[manifest_path.name.replace("-manifest.json", "")] = json.loads(manifest_path.read_text())
    joins_cache = {}

    def joins_for(sample):
        if sample not in joins_cache:
            joins_cache[sample] = None
            for root in args.work:
                path = Path(root) / sample / "joins.json"
                if path.exists():
                    joins_cache[sample] = json.loads(path.read_text())
                    break
        return joins_cache[sample]

    page_cache = {}

    def page_image(sample, page_no):
        key = f"{sample}-p{page_no}"
        if key not in page_cache:
            meta = hires_manifests[sample][f"page{page_no}"]
            image = Image.open(meta["file"]).convert("L")
            page_cache[key] = {"image": image, "pixels": np.asarray(image, dtype=np.float64),
                               "fx": meta["cssWidth"] / meta["viewBox"][0],
                               "fy": meta["height"] / meta["viewBox"][1]}
        return page_cache[key]

    results = []
    for row in train_tabs:
        sample = row["score"]
        joins = joins_for(sample)
        if joins is None:
            continue
        join = joins["joins"].get(row["stamped"])
        if join is None or not join.get("boxes"):
            continue
        try:
            page = page_image(sample, join.get("page") or 1)
        except (KeyError, FileNotFoundError):
            continue
        boxes = join["boxes"]
        cx = (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2 * page["fx"]
        cy = (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2 * page["fy"]
        image, pixels = page["image"], page["pixels"]
        profile, edge = profile_of(pixels, cx, cy, image.width, image.height)
        if edge:
            results.append({"id": row["stamped"], "category": "edge-clip", "warped": bool(row.get("warped"))})
            continue
        n_low = len(count_peaks(profile, 0.08))
        n_mid = len(count_peaks(profile, 0.15))
        n_high = len(count_peaks(profile, 0.30))
        # Best 6-run score at the detector's operating point.
        run = find_best_six(profile)
        y0 = max(int(cy - 130), 0)
        if n_low < 6:
            category = "few-peaks"
        elif n_mid > 12:
            category = "many-peaks"
        elif run is None:
            category = "foreign-comb"
        else:
            mean_gap = (run[-1] - run[0]) / 5 if len(run) == 6 else 0
            anchor = min(abs(line - (cy - y0)) for line in run) / max(mean_gap, 1e-6) if mean_gap else 99
            category = "anchor-miss" if anchor > 0.4 else "foreign-comb"
        results.append({"id": row["stamped"], "category": category,
                        "n_low": n_low, "n_mid": n_mid, "n_high": n_high,
                        "warped": bool(row.get("warped")),
                        "contrast": round(float(profile.max()), 3)})
    summary = {"total": len(results), "byCategory": dict(Counter(r["category"] for r in results)),
               "warpedByCategory": {}}
    for category in CATEGORIES:
        sub = [r for r in results if r["category"] == category]
        summary["warpedByCategory"][category] = sum(1 for r in sub if r["warped"])
    (out_dir / "autopsy.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

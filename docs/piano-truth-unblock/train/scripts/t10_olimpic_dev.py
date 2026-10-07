#!/usr/bin/env python3
"""T10 — synthetic->real domain-gap measurement on OLiMPiC DEV only.

Reads ONLY samples.dev.txt (1,438 system crops) and their .lmx truth.
Never reads samples.test.txt or any test sample. No training, no predictions.

Compares dev-scan image statistics and LMX token statistics against the pilot
render domain (aggregates from the pilot quality manifests).
"""
from __future__ import annotations
import json
import statistics as st
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
OLI = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned"


def s(x):
    x = sorted(x)
    return {"n": len(x), "min": round(x[0], 3), "median": round(x[len(x) // 2], 3),
            "max": round(x[-1], 3)} if x else None


def main():
    dev_list = OLI / "samples.dev.txt"
    assert dev_list.is_file(), "missing dev list"
    rels = [l.strip() for l in dev_list.read_text().splitlines() if l.strip()]
    widths, heights, contrast, blur, ink, toklen = [], [], [], [], [], []
    missing = 0
    for rel in rels:
        png, lmx = OLI / (rel + ".png"), OLI / (rel + ".lmx")
        if not (png.is_file() and lmx.is_file()):
            missing += 1
            continue
        img = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE)
        if img is None:
            missing += 1
            continue
        h, w = img.shape
        widths.append(w)
        heights.append(h)
        small = cv2.resize(img, (max(1, w // 4), max(1, h // 4)), interpolation=cv2.INTER_AREA)
        contrast.append(float(small.std()))
        blur.append(float(cv2.Laplacian(small, cv2.CV_64F).var()))
        ink.append(float((small < 200).mean()))
        toklen.append(len(lmx.read_text().split()))
    out = {
        "schema": "piano-trainfit-olimpic-dev-gap/1",
        "dev_samples_listed": len(rels), "missing": missing,
        "test_touched": False,
        "image_width_px": s(widths), "image_height_px": s(heights),
        "contrast_std": s(contrast), "blur_laplacian_var": s(blur),
        "ink_fraction": s(ink), "lmx_tokens_per_system": s(toklen),
        "pilot_render_reference": {
            "page_width_px": 2480,
            "staff_gap_raster_px": 21.257,
            "contrast_std_median": 30.905,
            "blur_laplacian_var_median": 2066.494,
            "ink_fraction_median": 0.037,
        },
    }
    (TRAIN / "manifests" / "olimpic_dev_gap.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "pilot_render_reference"}, indent=1))


if __name__ == "__main__":
    main()

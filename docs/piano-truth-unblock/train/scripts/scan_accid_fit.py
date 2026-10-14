#!/usr/bin/env python3
"""M1 scan-side calibration: accidental ink features from TRAIN-side scans.

For each TRAIN-side OLiMPiC sample (disjoint from the 10 held-out
verification samples), for the first detected frame:
  - detect the clef (production path)
  - read staff-relative expected accidental positions from the aligned
    table (reports/keysig_positions.json)
  - measure the ORIGINAL-INK window ink at each expected sharp/flat
    position
Supervision: the sample's own MusicXML fifths (training only, never
inference). Writes reports/scan_accid_fit.json with per-position statistics
and threshold separation quality.
"""
from __future__ import annotations
import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
OLIMPIC = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned" / "samples"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import deskew, estimate_skew  # noqa: E402
from clef_detect import _load_templates2, detect_clef, frame_left_edge  # noqa: E402
from keysig_pos_detect import _win_ink  # noqa: E402

VERIFY_N = 10


def load_table():
    d = json.loads((TRAIN / "reports" / "keysig_positions.json").read_text())
    return {(r["key"][0], r["key"][1], r["key"][2]): (r["x_med"], r["y_med"])
            for r in d["positions"]}


def features(gray, dark, fr, gap, clef, table):
    fx0 = frame_left_edge(dark, fr)
    if fx0 is None:
        return None
    feats = {}
    for typ in ("sharp", "flat"):
        for i in range(0, 6):
            key = (clef[0], typ, i)
            if key not in table:
                continue
            xg, yh = table[key]
            feats[f"{typ[0]}{i}"] = _win_ink(
                gray, fx0 + xg * gap, fr[-1] - yh * gap / 2, gap)
    return feats


def main():
    table = load_table()
    clef_templates = _load_templates2()
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    train_dirs = dirs[VERIFY_N:VERIFY_N + 220]
    rows = []
    for d in train_dirs:
        pngs = sorted(d.glob("*.png"))
        mxs = sorted(d.glob("*.musicxml"))
        if not pngs or not mxs:
            continue
        gray = cv2.imread(str(pngs[0]), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        g = deskew(gray, estimate_skew(gray))
        lines, dark = staff_lines(g)
        frames = group_staves(lines, dark)
        if not frames:
            continue
        root = ET.parse(mxs[0]).getroot()
        tf = root.findtext(".//key/fifths")
        tv = int(tf) if tf is not None else None
        gap = (frames[0][-1] - frames[0][0]) / 4
        clef = detect_clef(g, dark, frames[0], gap, clef_templates)[0]
        if clef[0] not in ("G", "F"):
            continue
        f = features(g, dark, frames[0], gap, clef, table)
        if f is None:
            continue
        f["fifths"] = tv
        f["clef"] = clef[0]
        f["sample"] = d.name
        rows.append(f)
        if len(rows) % 50 == 0:
            print(f"[fit] {len(rows)} samples", flush=True)
    print(f"[fit] total TRAIN-side scan samples: {len(rows)}", flush=True)
    agg = defaultdict(list)
    for r in rows:
        tv = r["fifths"]
        if tv is None:
            continue
        typ = "sharp" if tv > 0 else "flat"
        n = abs(tv)
        for i in range(0, 6):
            k = f"{typ[0]}{i}"
            if k in r and i < n:
                agg[f"present_{typ[0]}{i}"].append(r[k])
            if k in r and i >= n:
                agg[f"absent_{typ[0]}{i}"].append(r[k])
    stats = {}
    for k, v in sorted(agg.items()):
        if len(v) >= 5:
            stats[k] = {"n": len(v), "med": round(float(np.median(v)), 4)}
    best = {}
    for typ in "sf":
        for i in (0, 1):
            p = agg.get(f"present_{typ}{i}", [])
            a = agg.get(f"absent_{typ}{i}", [])
            if len(p) < 5 or len(a) < 5:
                continue
            ths = np.quantile(np.array(a), np.linspace(0.5, 0.95, 10))
            best[f"{typ}{i}"] = [
                {"thr": round(float(t), 4),
                 "tpr": round(float(np.mean(np.array(p) >= t)), 3),
                 "fpr": round(float(np.mean(np.array(a) >= t)), 3)}
                for t in ths]
    out = {"n_samples": len([r for r in rows if r["fifths"] is not None]),
           "position_stats": stats,
           "thresholds": best,
           "scope": "TRAIN-side OLiMPiC scans, MEI-fifths supervision; "
                    "verification samples excluded"}
    (TRAIN / "reports" / "scan_accid_fit.json").write_text(
        json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items()
                      if k != "position_stats"}, indent=1)[:1500])


if __name__ == "__main__":
    main()

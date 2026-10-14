#!/usr/bin/env python3
"""M2 joint accidental recognition: vertical ink profiles + scan centroids.

Why: fixed-position windows fail on scans because the accidental glyphs are
vertically offset (median 0.42 gaps, p90 0.83) and ink separation at the
expected positions is poor (present_f0 0.156 vs absent_f0 0.171).

Method: 
  1. staff-relative y-profile of the key-signature x-band (fx0+2.9 ..
     fx0+6.6 gaps), 28 bins from 2.5 gaps above the top line to 3 gaps
     below it, measured on the ORIGINAL ink with the staff-line rows masked
     out (masking keeps ~90% of accidental strokes but removes the lines
     that dominate the raw profile);
  2. per-(clef, fifths) centroid profiles learned from TRAIN-side scans
     (supervision: each sample's own MusicXML key) — nearest-centroid
     classification with a margin-based abstention;
  3. evaluation on the held-out verification samples only.

No fixed pixel sizes (all in staff-gap units), no font templates, no
dataset identity, no known keys at inference. Writes
reports/scan_profile_keysig.json.
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

VERIFY_N = 10
NBINS = 28
Y_LO_GAPS = -2.5   # above the top staff line
Y_HI_GAPS = 3.0    # below it
X0_GAPS = 2.9
X1_GAPS = 6.6


def line_rows_mask(dark, lines, gap):
    """Mask of staff-line rows (to exclude from ink counts)."""
    m = np.zeros_like(dark)
    for y in lines:
        m[max(0, y - 1):y + 2, :] = 1
    return m


def profile(gray, dark, lines, fr, gap):
    fx0 = frame_left_edge(dark, fr)
    if fx0 is None:
        return None
    lmask = line_rows_mask(dark, lines, gap)
    x0 = int(round(fx0 + X0_GAPS * gap))
    x1 = int(round(fx0 + X1_GAPS * gap))
    x0, x1 = max(0, x0), min(gray.shape[1], x1)
    y_lo = int(round(fr[0] + Y_LO_GAPS * gap))
    y_hi = int(round(fr[0] + Y_HI_GAPS * gap))
    y_lo, y_hi = max(0, y_lo), min(gray.shape[0], y_hi)
    if x1 <= x0 or y_hi <= y_lo:
        return None
    ink = (gray[y_lo:y_hi, x0:x1] < 128).astype(np.float64)
    keep = (1 - lmask[y_lo:y_hi, x0:x1]).astype(np.float64)
    num = ink * keep
    # bin the y axis
    h = y_hi - y_lo
    edges = np.linspace(0, h, NBINS + 1).astype(int)
    prof = np.zeros(NBINS)
    for b in range(NBINS):
        seg = num[edges[b]:edges[b + 1]]
        w = keep[edges[b]:edges[b + 1]]
        prof[b] = seg.sum() / max(1.0, w.sum())
    return prof


def gather(dirs, clef_templates, limit):
    rows = []
    for d in dirs:
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
        fr = frames[0]
        gap = (fr[-1] - fr[0]) / 4
        clef = detect_clef(g, dark, fr, gap, clef_templates)[0]
        if clef[0] not in ("G", "F"):
            continue
        p = profile(g, dark, lines, fr, gap)
        if p is None:
            continue
        rows.append({"sample": d.name, "clef": clef[0], "fifths": tv,
                     "prof": p.tolist()})
        if len(rows) >= limit:
            break
    return rows


def main():
    clef_templates = _load_templates2()
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    train_dirs = dirs[VERIFY_N:VERIFY_N + 240]
    verify_dirs = dirs[:VERIFY_N]
    print("[prof] gathering TRAIN-side scan profiles...", flush=True)
    tr = gather(train_dirs, clef_templates, 240)
    print(f"[prof] TRAIN-side samples: {len(tr)}", flush=True)
    cents = {}
    by_cf = defaultdict(list)
    for r in tr:
        if r["fifths"] is None:
            continue
        by_cf[(r["clef"], r["fifths"])].append(np.array(r["prof"]))
    for k, v in by_cf.items():
        if len(v) >= 3:
            cents[k] = np.mean(v, axis=0)
    print(f"[prof] centroids: {sorted(cents)}", flush=True)
    # classify held-out samples
    okE = okAbs = wrong = abst = n = 0
    detail = []
    for r in gather(verify_dirs, clef_templates, VERIFY_N):
        if r["fifths"] is None:
            continue
        n += 1
        p = np.array(r["prof"])
        pn = p / max(1e-9, np.linalg.norm(p))
        scores = []
        for k, c in cents.items():
            cn = c / max(1e-9, np.linalg.norm(c))
            scores.append((float(pn @ cn), k))
        scores.sort(reverse=True)
        top, k2 = scores[0]
        second = scores[1][0] if len(scores) > 1 else 0.0
        margin = top - second
        if margin < 0.02:
            abst += 1
            detail.append([r["sample"], r["fifths"], None, round(margin, 4),
                           r["clef"]])
            continue
        if k2[1] == r["fifths"]:
            okE += 1
        elif k2[0] == r["clef"]:
            wrong += 1
            detail.append([r["sample"], r["fifths"], k2[1], round(margin, 4),
                           r["clef"]])
        else:
            wrong += 1
            detail.append([r["sample"], r["fifths"], k2[1], round(margin, 4),
                           r["clef"]])
    out = {
        "n_verify": n, "exact": okE, "wrong": wrong, "abstain": abst,
        "accuracy_decided": round(okE / max(1, okE + wrong), 4),
        "coverage": round((okE + wrong) / max(1, n), 4),
        "n_centroids": len(cents), "centroid_sizes": {f"{k[0]}{k[1]}": len(v)
                                                      for k, v in by_cf.items()},
        "detail": detail,
        "scope": "TRAIN-side OLiMPiC centroids; held-out verification only"}
    (TRAIN / "reports" / "scan_profile_keysig.json").write_text(
        json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "detail"},
                     indent=1))
    for d in detail:
        print("   ", d)


if __name__ == "__main__":
    main()

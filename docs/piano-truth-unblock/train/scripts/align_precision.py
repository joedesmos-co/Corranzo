#!/usr/bin/env python3
"""M4 confidence ledger: localization error of transferred symbol proposals.

For each transferred proposal, measure the distance from the proposal
center to the nearest actual accidental-sized ink blob in the scan
(independent of the render), in staff-gap units. This is the proposal's
localization error — the number that decides whether the labels are
trustworthy supervision. Also records count agreement vs the strip's own
key annotation. Writes reports/align_precision.json.
"""
from __future__ import annotations
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
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
from clefsym_data_lm4 import line_bands  # noqa: E402
from align_scan import (render_strip, render_frames, render_key_accids,
                        scan_line_models)

VERIFY_N = 10


def blobs(g, lines, bands, fr, gap):
    """Accidental-sized ink blobs in the key region (x profile peaks)."""
    fx0 = None
    # use the frame's left edge from line runs
    lo = int(fr[0])
    row = (g[lo:int(fr[-1]) + 1, :] < 128)
    cols = np.where(row.any(axis=0))[0]
    if len(cols) < 10:
        return []
    fx0 = int(cols[0])
    rx0 = int(fx0 + 2.6 * gap)
    rx1 = int(fx0 + 7.2 * gap)
    ry0 = max(0, int(fr[0] - 2.2 * gap))
    ry1 = min(g.shape[0], int(fr[-1] + 1.5 * gap))
    reg = g[ry0:ry1, rx0:rx1]
    if reg.size == 0:
        return []
    mask = np.zeros(reg.shape, bool)
    for a, b in bands:
        if b > 0 and a < reg.shape[0]:
            mask[max(0, a):min(reg.shape[0], b), :] = True
    ink = (reg < 150) & (~mask)
    if ink.sum() < 30:
        return []
    prof = ink.sum(axis=0).astype(float)
    thr = max(3.0, 0.35 * prof.max())
    cols = np.where(prof >= thr)[0]
    out = []
    if len(cols):
        s = p = int(cols[0])
        for x in cols[1:]:
            x = int(x)
            if x - p <= max(2, int(0.5 * gap)):
                p = x
                continue
            out.append((s + p) // 2)
            s = p = x
        out.append((s + p) // 2)
    res = []
    for x in out:
        sub = ink[:, max(0, x - int(0.5 * gap)):x + int(0.5 * gap)]
        ys = np.nonzero(sub.sum(axis=1) > 0)[0]
        if len(ys) == 0:
            continue
        res.append({"x": rx0 + x, "y": ry0 + float(ys.mean()),
                    "h": float(ys.max() - ys.min()) / gap})
    return res


def render_clef_x(svg):
    """x of the first clef in the rendered SVG (key signatures start right
    after it)."""
    m = re.search(r'<g id="[^"]+" class="clef">(.*?)</g>\s*</g>', svg, re.S)
    if not m:
        return None
    tr = re.search(r'transform="translate\(([-0-9.]+),', m.group(1))
    return float(tr.group(1)) if tr else None


def main():
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    errs = []
    counts = Counter()
    for d in dirs[VERIFY_N:VERIFY_N + 40]:
        png, mx = d / "p1-s1.png", d / "p1-s1.musicxml"
        if not (png.is_file() and mx.is_file()):
            continue
        svg = render_strip(mx, Path("/tmp/olympic_rendered") / d.name)
        if svg is None:
            continue
        rframes = render_frames(svg)
        raccs = render_key_accids(svg)
        gray = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        g = deskew(gray, estimate_skew(gray))
        lines, dark = staff_lines(g)
        sframes = group_staves(lines, dark)
        if not sframes:
            counts["no_scan_frame"] += 1
            continue
        models = scan_line_models(g, sframes)
        bands = line_bands(g, lines)
        # group render accidentals per staff
        by_rf = {}
        for a in raccs:
            for i, f in enumerate(rframes):
                fgap = (f["lines"][-1] - f["lines"][0]) / 4
                if f["lines"][0] - fgap <= a["y"] <= f["lines"][-1] + fgap:
                    by_rf.setdefault(i, []).append(a)
                    break
        counts["strips"] += 1
        for ri, accs in sorted(by_rf.items()):
            if ri >= len(models):
                counts["abstain_no_frame"] += len(accs)
                continue
            rf, sm = rframes[ri], models[ri]
            r_gap = (rf["lines"][-1] - rf["lines"][0]) / 4
            bl = blobs(g, lines, bands, sm["frame"], sm["gap"])
            counts["render_accids"] += len(accs)
            counts["scan_blobs"] += len(bl)
            if len(accs) != len(bl):
                counts["count_mismatch"] += 1
                continue
            counts["count_agree"] += 1
            # pair in order and measure the localization error
            clef_x = render_clef_x(svg)
            if clef_x is None:
                counts["no_clef_x"] += 1
                continue
            for a, b in zip(accs, bl):
                # accidental positions in GAP units relative to the clef:
                # scale- and crop-robust (render indent vs tight scan crop)
                d0 = (a["x"] - clef_x) / r_gap
                x_s = sm["x0"] + d0 * sm["gap"]
                v_half = (rf["lines"][-1] - a["y"]) / (r_gap / 2)
                xs = sm["xs"]
                xi = int(np.clip(np.searchsorted(xs, x_s), 1, len(xs) - 1))
                t = 0 if xs[xi] == xs[xi - 1] else (x_s - xs[xi - 1]) / (xs[xi] - xs[xi - 1])
                bottom = sm["model"][4][xi - 1] + t * (sm["model"][4][xi] - sm["model"][4][xi - 1])
                y_s = bottom - v_half * sm["gap"] / 2
                errs.append((abs(x_s - b["x"]) / sm["gap"],
                             abs(y_s - b["y"]) / sm["gap"], sid_of := d.name[:8]))
    if errs:
        ex = np.array([e[0] for e in errs])
        ey = np.array([e[1] for e in errs])
        out = {"pairs": len(errs),
               "dx_gap_med": round(float(np.median(ex)), 3),
               "dx_gap_p90": round(float(np.percentile(ex, 90)), 3),
               "dy_gap_med": round(float(np.median(ey)), 3),
               "dy_gap_p90": round(float(np.percentile(ey, 90)), 3),
               "within_0.5_gap": round(float(np.mean((ex < 0.5) & (ey < 0.5))), 3),
               "within_1.0_gap": round(float(np.mean((ex < 1.0) & (ey < 1.0))), 3),
               "counts": dict(counts)}
    else:
        out = {"pairs": 0, "counts": dict(counts)}
    (TRAIN / "reports" / "align_precision.json").write_text(
        json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

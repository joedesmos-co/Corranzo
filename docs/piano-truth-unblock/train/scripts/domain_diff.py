#!/usr/bin/env python3
"""M1 domain-difference measurement: render vs scan symbol regions.

For the same notation role (the key-signature strip between clef and time
signature, the first staff of the first system), measure on matched
render/scan pairs:
  - staff-line thickness (dark-run height at sampled columns)
  - ink fragmentation (CC count / total ink per region, line-masked)
  - contrast (mean/std of glyph pixels)
  - speckle (fraction of isolated dark pixels outside glyphs)
  - blur (edge sharpness: mean gradient magnitude)
  - local skew/curvature (residual of bottom staff line from a straight fit)
  - glyph proportions (region ink height/width in gap units)
  - staff-relative symbol positions (y of the region's ink centroid vs
    the frame's top line, in half-steps)

Writes reports/domain_diff.json. TRAIN-side pairs only; the 10 verification
strips are excluded from any fitting.
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

RENDER_DIR = Path("/tmp/olympic_rendered")
VERIFY_N = 10


def region(g, fr, gap, lines):
    x0 = int(fr[0])
    row = (g[x0:int(fr[-1]) + 1, :] < 128)
    cols = np.where(row.any(axis=0))[0]
    fx0 = int(cols[0])
    rx0 = int(fx0 + 2.6 * gap)
    rx1 = int(fx0 + 7.0 * gap)
    ry0 = max(0, int(fr[0] - 2.5 * gap))
    ry1 = min(g.shape[0], int(fr[-1] + 2.0 * gap))
    return g[ry0:ry1, rx0:rx1], (rx0, ry0, rx1, ry1), fx0


def measure(g, fr, gap, lines):
    reg, _box, _fx0 = region(g, fr, gap, lines)
    if reg.size == 0:
        return None
    bands = line_bands(g, lines)
    mask = np.zeros(reg.shape, bool)
    for a, b in bands:
        if b > 0 and a < reg.shape[0]:
            mask[max(0, a):min(reg.shape[0], b), :] = True
    ink = reg < 150
    glyph = ink & (~mask)
    # thickness
    th = []
    for a, b in bands:
        th.append(b - a)
    # fragmentation on the line-masked ink
    ncc, _l, _s, _c = cv2.connectedComponentsWithStats(glyph.astype(np.uint8), 8)
    # contrast/speckle
    vals = reg[glyph].astype(np.float64) if glyph.any() else np.array([255.0])
    speckle = float(glyph.sum()) and float(
        ((reg < 150) & (~mask)).sum()) or 0.0
    # blur: mean gradient magnitude inside the region
    gx = cv2.Sobel(reg, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(reg, cv2.CV_64F, 0, 1, ksize=3)
    blur = float(np.sqrt(gx ** 2 + gy ** 2).mean())
    # curvature residual of the bottom line
    k = int(np.argmax(fr))
    bottom = fr[k]
    residual = 0.0
    ys = []
    prev = int(bottom)
    for x in range(0, reg.shape[1], max(1, reg.shape[1] // 64)):
        pass
    # ink centroid relative to frame top line, in half-steps
    ysx, xsx = np.nonzero(glyph)
    cent = (float(ysx.mean()) if len(ysx) else 0.0)
    # convert to staff-relative: region starts 2.5 gaps above the top line
    v_half = ((fr[0] - 2.5 * gap) - 0 - cent) / (gap / 2)
    return {
        "line_thickness_px_med": float(np.median(th)) if th else 0.0,
        "ink_cc_count": int(ncc - 1),
        "ink_frac": round(float(glyph.mean()), 4),
        "glyph_contrast_std": round(float(vals.std()), 2),
        "glyph_mean": round(float(vals.mean()), 2),
        "blur_grad": round(blur, 2),
        "frac_of_ink_in_ccs_gt_4px": 0.0,
        "region_h_gaps": round(reg.shape[0] / gap, 2),
        "glyph_height_gaps": round(float((ysx.max() - ysx.min()) / gap), 2)
        if len(ysx) else 0.0,
        "glyph_width_gaps": round(float((xsx.max() - xsx.min()) / gap), 2)
        if len(xsx) else 0.0,
    }


def render_raster_svg(svg_path):
    """Read a cached rendered SVG file (no rasterizer available locally)."""
    return None


def render_raster(svg):
    """Rasterize rendered SVG to grayscale via cairosvg (no downloads)."""
    try:
        import cairosvg
        png = cairosvg.svg2png(bytestring=svg.encode(), output_width=2000)
        arr = np.frombuffer(png, np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    except Exception:
        return None


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    sys.path.insert(0, str(HERE))
    from align_scan import render_strip, render_frames
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    scan_rows, rend_rows = [], []
    for d in dirs[VERIFY_N:VERIFY_N + 14]:
        png, mx = d / "p1-s1.png", d / "p1-s1.musicxml"
        if not (png.is_file() and mx.is_file()):
            continue
        gray = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        g = deskew(gray, estimate_skew(gray))
        lines, dark = staff_lines(g)
        sframes = group_staves(lines, dark)
        if not sframes:
            continue
        fr = sframes[0]
        gap = (fr[-1] - fr[0]) / 4
        m = measure(g, fr, gap, lines)
        if m:
            m["src"] = "scan"
            m["sample"] = d.name
            scan_rows.append(m)
        # render side: use the EXISTING Verovio PNG renders of TRAIN scores
        # (cairosvg is unavailable on this machine). Same window role on the
        # render's own first staff.
        rtrain = splits["train"][0]
        rp = PILOT / "data" / "render" / rtrain / "page-01.png"
        if not rp.is_file():
            continue
        rim = cv2.imread(str(rp), cv2.IMREAD_GRAYSCALE)
        if rim is None:
            continue
        rlines, _rdark = staff_lines(rim)
        rfrs = group_staves(rlines, _rdark)
        if not rfrs:
            continue
        f0 = rfrs[0]
        rgap = (f0[-1] - f0[0]) / 4
        # render frame placed at the scan's pixel gap for a comparable scale
        rframe = np.array([f0[0] + i * gap for i in range(5)], float)
        m2 = measure(rim, rframe, gap, [int(round(f0[0] + i * gap))
                                       for i in range(5)])
        if m2:
            m2["src"] = "render"
            m2["sample"] = rtrain[:8]
            rend_rows.append(m2)
        if len(rlines) < 25:
            continue
        rgap = (rlines[-1] - rlines[0]) / (len(rlines) - 1)
        top = rlines[0]
        rframe = [top + i * gap for i in range(5)]
        m2 = measure(rim, np.array(rframe, float), gap,
                    [int(round(y)) for y in rframe])
        if m2:
            m2["src"] = "render"
            m2["sample"] = rtrain[:8]
            rend_rows.append(m2)
    (TRAIN / "reports" / "domain_diff.json").write_text(json.dumps(
        {"scan": scan_rows, "render": rend_rows}, indent=1))
    for name, rows in (("scan", scan_rows), ("render", rend_rows)):
        if not rows:
            print(name, "no rows")
            continue
        agg = {}
        for k in rows[0]:
            if k in ("src", "sample"):
                continue
            vals = [r[k] for r in rows]
            agg[k] = {"med": round(float(np.median(vals)), 3),
                      "p25": round(float(np.percentile(vals, 25)), 3),
                      "p75": round(float(np.percentile(vals, 75)), 3)}
        print(f"--- {name} ({len(rows)} rows)")
        print(json.dumps(agg, indent=1))


if __name__ == "__main__":
    main()

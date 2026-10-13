#!/usr/bin/env python3
"""Position-free structural clef classifier (experiment).

The render-tuned recipe assumes the clef glyph sits at fx0+2.2 gaps with
render font proportions; on independent scans the glyph sits further right
and the proportions differ (measured). Structural, position-free method:
  1. startup region [fx0, fx0+5 gaps] x [top-3 gaps, bottom+3 gaps], staff
     rows removed;
  2. find the CLEF GLYPH = the tallest CC cluster in 2.5..8 gaps tall and
     <=4 gaps wide (key signatures and time sigs are smaller, barlines
     wider);
  3. classify by structure:
     F: two small dot blobs (w,h <= 0.6 gap) within the glyph's x-range and
        its upper half, AND glyph height <= 4.6 gaps
     G: height > 4.6 gaps (spiral reaches above/below the staff)
     C: two vertical bars, height 3..4.6 gaps, no dots
     fallback: the existing NCC template argmax
Measured below on DEV renders (must stay 23/25) and OLiMPiC scans.
Writes reports/clef_structural.json.
"""
from __future__ import annotations
import gzip
import json
import re as _re
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
from clef_detect import detect_clef, frame_left_edge  # noqa: E402
from clef_map import load_templates  # noqa: E402
from staff_geometry import parse_page  # noqa: E402

GLYPH = {"E050": ("G", 2), "E062": ("F", 4), "E05C": ("C", 3),
         "E052": ("G", 2)}


def rowremoved(dark, lines):
    m = dark.copy()
    band = np.zeros_like(dark)
    for y in lines:
        band[max(0, y - 1):y + 2, :] = 1
    m[band.astype(bool)] = 0
    return m


def find_clef_glyph(mask, fx0, fr, gap):
    """Tallest plausible clef glyph in the startup region."""
    rx0 = max(0, int(fx0 - 0.2 * gap))
    rx1 = int(fx0 + 5.0 * gap)
    ry0 = max(0, int(fr[0] - 3.0 * gap))
    ry1 = min(mask.shape[0], int(fr[-1] + 3.5 * gap))
    reg = mask[ry0:ry1, rx0:rx1]
    n, _l, stats, _c = cv2.connectedComponentsWithStats(reg, 8)
    comps = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 8 or w < 2 or h < 2:
            continue
        comps.append([int(x), int(y), w, h, int(area)])
    # candidate: tall, not too wide
    cands = [c for c in comps if 2.4 * gap <= c[3] <= 8.0 * gap
             and c[2] <= 4.0 * gap]
    if not cands:
        return None, comps, (rx0, ry0)
    cands.sort(key=lambda c: -c[3])
    glyph = cands[0]
    # absorb nearby components (dot pairs, second halves) into the glyph box.
    # Bounded: 2 passes, and only components that are either tall (part of
    # the glyph body) or small (dots); this avoids runaway growth on noisy
    # scans where fragments cover the region.
    gx0, gy0, gx1, gy1 = glyph[0], glyph[1], glyph[0] + glyph[2], glyph[1] + glyph[3]
    for _pass in range(2):
        for c in comps:
            if not (c[3] >= 1.2 * gap or (c[2] <= 0.7 * gap and c[3] <= 0.7 * gap)):
                continue
            cx, cy = c[0] + c[2] / 2, c[1] + c[3] / 2
            if (gx0 - 0.4 * gap <= cx <= gx1 + 0.4 * gap
                    and gy0 - 0.6 * gap <= cy <= gy1 + 0.6 * gap):
                gx0 = min(gx0, c[0]); gy0 = min(gy0, c[1])
                gx1 = max(gx1, c[0] + c[2]); gy1 = max(gy1, c[1] + c[3])
    return [gx0, gy0, gx1 - gx0, gy1 - gy0], comps, (rx0, ry0)


def classify_structural(glyph, comps, reg_origin, fr, gap):
    """(shape, line, evidence) from glyph geometry + dot blobs."""
    if glyph is None:
        return None, "no_glyph"
    ox, oy = reg_origin
    gx, gy, gw, gh = glyph
    hg = gh / gap
    wg = gw / gap
    cy = oy + gy + gh / 2
    # relative to the frame's middle line
    rel = (cy - fr[2]) / gap
    # dots: small blobs inside/just right of the glyph x-range, above center
    dots = 0
    for c in comps:
        cx, cyy = ox + c[0] + c[2] / 2, oy + c[1] + c[3] / 2
        if not (gx - 0.3 * gap <= cx <= gx + gw + 0.9 * gap):
            continue
        if not (gy <= cyy <= gy + gh):
            continue
        if c[2] <= 0.62 * gap and c[3] <= 0.62 * gap and c[4] >= 6:
            dots += 1
    if dots >= 2 and hg <= 4.8:
        return ("F", 4), f"dots={dots} h={hg:.2f} rel={rel:.2f}"
    if hg > 4.8:
        return ("G", 2), f"tall h={hg:.2f} rel={rel:.2f}"
    # bars: two narrow tall components at the same x (C clef)
    bars = [c for c in comps if c[3] > 2.0 * gap and c[2] < 0.8 * gap]
    if len(bars) >= 2 and hg <= 4.8:
        return ("C", 3), f"bars={len(bars)} h={hg:.2f}"
    return ("G", 2), f"fallback h={hg:.2f} rel={rel:.2f} dots={dots}"


def main():
    templates = load_templates()
    res = Counter()
    detail = []
    # scans
    for d in sorted(OLIMPIC.iterdir())[:8]:
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
        tcl = {}
        root = ET.parse(mxs[0]).getroot()
        for attr in root.iter("attributes"):
            for c in attr.findall("clef"):
                num = c.get("number") or attr.findtext("staff") or "1"
                tcl[num] = (c.findtext("sign"), c.findtext("line"))
        staves = sorted(tcl)
        m = rowremoved(dark, lines)
        for fi, fr in enumerate(frames):
            if fi >= len(staves):
                break
            gap = (fr[-1] - fr[0]) / 4
            fx0 = frame_left_edge(dark, fr)
            if fx0 is None:
                continue
            glyph, comps, org = find_clef_glyph(m, fx0, fr, gap)
            cls, ev = classify_structural(glyph, comps, org, fr, gap)
            auto = detect_clef(g, dark, fr, gap, templates)[0]
            tv = tcl[staves[fi]]
            tv_t = (tv[0], int(tv[1]))
            if cls is not None:
                res["scan_n"] += 1
                res["scan_struct_ok" + ("1" if cls == tv_t else "0")] += 1
                res["scan_ncc_ok" + ("1" if auto == tv_t else "0")] += 1
                detail.append(["scan", d.name, fi, tv_t[0], cls[0], auto[0], ev])
    # renders
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    for sid in splits["dev"][:5]:
        gray = cv2.imread(str(PILOT / "data" / "render" / sid /
                              "page-01.png"), cv2.IMREAD_GRAYSCALE)
        svg = (PILOT / "data" / "render" / sid / "page-01.svg").read_text()
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        cis = {}
        for meas in parse_page(svg):
            for st in meas["staves"]:
                for c in meas["clefs"]:
                    if c["rank"] == st["rank"] and c["glyph"] in GLYPH:
                        cis[st["rank"]] = GLYPH[c["glyph"]]
        m = rowremoved(dark, lines)
        for fi, fr in enumerate(frames):
            if fi not in cis:
                continue
            gap = (fr[-1] - fr[0]) / 4
            fx0 = frame_left_edge(dark, fr)
            if fx0 is None:
                continue
            glyph, comps, org = find_clef_glyph(m, fx0, fr, gap)
            cls, ev = classify_structural(glyph, comps, org, fr, gap)
            auto = detect_clef(gray, dark, fr, gap, templates)[0]
            tv_t = cis[fi]
            if cls is not None:
                res["render_n"] += 1
                res["render_struct_ok" + ("1" if cls == tv_t else "0")] += 1
                res["render_ncc_ok" + ("1" if auto == tv_t else "0")] += 1
                detail.append(["render", sid[:6], fi, tv_t[0], cls[0],
                               auto[0], ev])
    out = {
        "scan_struct_acc": round(res["scan_struct_ok1"] / max(1, res["scan_n"]), 4),
        "scan_ncc_acc": round(res["scan_ncc_ok1"] / max(1, res["scan_n"]), 4),
        "scan_n": res["scan_n"],
        "render_struct_acc": round(res["render_struct_ok1"] / max(1, res["render_n"]), 4),
        "render_ncc_acc": round(res["render_ncc_ok1"] / max(1, res["render_n"]), 4),
        "render_n": res["render_n"],
        "detail": detail}
    (TRAIN / "reports" / "clef_structural.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "detail"}, indent=1))
    for r in detail:
        if r[0] == "scan":
            print(r)


if __name__ == "__main__":
    main()

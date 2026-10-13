#!/usr/bin/env python3
"""Line-stripped per-source clef templates (experiment).

Hypothesis: render-vs-scan template mismatch is driven by staff-line
thickness (renders: 1-2px near-black; scans: 2-4px with antialiasing).
Build the class templates from crops with the staff rows removed, on BOTH
sources, then score by the per-source max. Measure on DEV renders and the
held-out scan verification samples. Writes reports/clef_linestrip.json.
"""
from __future__ import annotations
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
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
from clef_detect import _sq, frame_left_edge  # noqa: E402
from clef_variants import collect_render, collect_scan  # noqa: E402
from staff_geometry import parse_page  # noqa: E402

SIZE = 32
GLYPH = {"E050": ("G", 2), "E062": ("F", 4), "E05C": ("C", 3),
         "E052": ("G", 2)}


def window_raw(gray, fr, gap, cls, fx0):
    """Unsigned uint8 patch (not normalized) for the class window."""
    if cls == "G":
        cen, half = (fx0 + 2.2 * gap, fr[2] + 0.15 * gap), 4.8 * gap
    elif cls == "F":
        cen, half = (fx0 + 2.2 * gap, fr[1] + 0.4 * gap), 2.0 * gap
    else:
        cen, half = (fx0 + 2.2 * gap, fr[2]), 2.0 * gap
    x0 = int(round(cen[0] - half))
    y0 = int(round(cen[1] - half))
    patch = np.full((2 * int(half), 2 * int(half)), 255, np.uint8)
    ix0, iy0 = max(0, x0), max(0, y0)
    ix1, iy1 = min(gray.shape[1], x0 + 2 * int(half)), min(gray.shape[0], y0 + 2 * int(half))
    if ix1 <= ix0 or iy1 <= iy0:
        return None, None
    patch[iy0 - y0:iy0 - y0 + (iy1 - iy0),
          ix0 - x0:ix0 - x0 + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
    return patch, (x0, y0)


def norm32(patch):
    v = cv2.resize(patch, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def stripped(patch, org, fr):
    x0, y0 = org
    p = patch.copy()
    for y in fr:
        yy = int(round(y)) - y0
        if 0 <= yy < p.shape[0]:
            p[max(0, yy - 1):yy + 2, :] = 255
    return p


def main():
    all_dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    verify_dirs = all_dirs[:10]
    train_dirs = all_dirs[10:]
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())

    # TRAIN crops (already-normalized) are used as-is for the baseline;
    # for the line-stripped variant we re-crop raw and re-normalize.
    scan_train = []
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
        tcl = {}
        root = ET.parse(mxs[0]).getroot()
        for attr in root.iter("attributes"):
            for c in attr.findall("clef"):
                num = c.get("number") or attr.findtext("staff") or "1"
                tcl[num] = c.findtext("sign")
        staves = sorted(tcl)
        for fi, fr in enumerate(frames):
            if fi >= len(staves):
                break
            cls = tcl[staves[fi]]
            if cls not in ("G", "F", "C"):
                continue
            fx0 = frame_left_edge(dark, fr)
            if fx0 is None:
                continue
            gap = (fr[-1] - fr[0]) / 4
            patch, org = window_raw(g, fr, gap, cls, fx0)
            if patch is None:
                continue
            scan_train.append((cls, norm32(stripped(patch, org, fr))))
    # render TRAIN crops from the render side: need frames; use the
    # collect_render crops (normalized, lines included) and additionally
    # build line-stripped render templates via the same window recipe on
    # renders with known clefs.
    render_train_nl = []
    from clef_vision import clef_instances
    from staff_geometry import notehead_map  # noqa: F401
    import re as _re
    MARG = _re.compile(r'<g class="page-margin" transform="translate\('
                       r'([-0-9.]+),\s*([-0-9.]+)\)')
    for sid in splits["train"][:30]:
        gray = cv2.imread(str(PILOT / "data" / "render" / sid /
                              "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        svg = (PILOT / "data" / "render" / sid / "page-01.svg").read_text()
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        cis = {}
        for meas in parse_page(svg):
            for st in meas["staves"]:
                for c in meas["clefs"]:
                    if c["rank"] == st["rank"] and c["glyph"] in GLYPH:
                        cis[st["rank"]] = GLYPH[c["glyph"]][0]
        for fi, fr in enumerate(frames):
            if fi not in cis:
                continue
            fx0 = frame_left_edge(dark, fr)
            if fx0 is None:
                continue
            gap = (fr[-1] - fr[0]) / 4
            cls = cis[fi]
            patch, org = window_raw(gray, fr, gap, cls, fx0)
            if patch is None:
                continue
            render_train_nl.append((cls, norm32(stripped(patch, org, fr))))
    print("[nl] render:", Counter(k for k, _ in render_train_nl),
          "scan:", Counter(k for k, _ in scan_train), flush=True)
    means = {}
    for src, rows in (("render", render_train_nl), ("scan", scan_train)):
        for cls in ("G", "F", "C"):
            xs = [c for k, c in rows if k == cls and c is not None]
            if xs:
                means[f"{src}_{cls}"] = np.mean(xs, axis=0)

    def score_frame(gray, dark, fr, gap):
        fx0 = frame_left_edge(dark, fr)
        if fx0 is None:
            return None
        best = (None, -9.0)
        for cls in ("G", "F", "C"):
            patch, org = window_raw(gray, fr, gap, cls, fx0)
            if patch is None:
                continue
            cr = norm32(stripped(patch, org, fr))
            if cr is None:
                continue
            v = -9.0
            for key, tmpl in means.items():
                if key.split("_")[-1] != cls:
                    continue
                v = max(v, float((cr * tmpl).sum()))
            if v > best[1]:
                best = (cls, v)
        return best[0]

    # eval renders
    Cr = Counter()
    for sid in splits["dev"]:
        gray = cv2.imread(str(PILOT / "data" / "render" / sid /
                              "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        svg = (PILOT / "data" / "render" / sid / "page-01.svg").read_text()
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        cis = {}
        for meas in parse_page(svg):
            for st in meas["staves"]:
                for c in meas["clefs"]:
                    if c["rank"] == st["rank"] and c["glyph"] in GLYPH:
                        cis[st["rank"]] = GLYPH[c["glyph"]]
        for fi, fr in enumerate(frames):
            if fi not in cis:
                continue
            gap = (fr[-1] - fr[0]) / 4
            pred = score_frame(gray, dark, fr, gap)
            line = 2 if pred == "G" else (4 if pred == "F" else 3)
            Cr["n"] += 1
            Cr["ok" if (pred, line) == cis[fi] else "bad"] += 1
    # eval scans
    Cs = Counter()
    for d in verify_dirs:
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
                tcl[num] = c.findtext("sign")
        staves = sorted(tcl)
        for fi, fr in enumerate(frames):
            if fi >= len(staves):
                break
            cls = tcl[staves[fi]]
            if cls not in ("G", "F", "C"):
                continue
            gap = (fr[-1] - fr[0]) / 4
            pred = score_frame(g, dark, fr, gap)
            Cs["n"] += 1
            Cs["ok" if pred == cls else "bad"] += 1
    out = {"render_acc": round(Cr["ok"] / max(1, Cr["n"]), 4), "render_n": Cr["n"],
           "scan_acc": round(Cs["ok"] / max(1, Cs["n"]), 4), "scan_n": Cs["n"]}
    (TRAIN / "reports" / "clef_linestrip.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

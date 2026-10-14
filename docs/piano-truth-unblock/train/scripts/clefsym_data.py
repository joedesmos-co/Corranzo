#!/usr/bin/env python3
"""M2 data builder v2: grid candidates for the clef-accidental detector.

Design (measured geometry): scan accidentals are horizontally well aligned
to the staff-relative x-columns (median |dx| = 0.02 gaps) but vertically
offset (median 0.42 gaps). So candidates are generated on a grid over the
4 key-signature x-columns (fx0+4.1/5.1/6.1/7.4 gaps) x 7 y-positions
spanning +-1.5 gaps around each table position, and the classifier decides.

TRAINING (symbol-level, renders):
  positives: keyAccid glyph boxes (SMuFL E262/E260) — exact labels
  negatives: grid crops in key-signature regions where the table says no
             accidental sits (all positions of unkeyed renders; positions
             beyond the key count in keyed renders)
VALIDATION (score-level only, scans):
  TRAIN-side OLiMPiC samples (180, disjoint from the 10 verification) and
  the 10 verification samples, labeled by the sample's key SIGN — weak
  labels, used only for validation/abstention measurement.

Crops: 2 gaps wide x 5 gaps tall centered on the candidate position,
resized to 32x64. All geometry staff-relative. Writes
/tmp/clefsym_data.npz. TEST untouched.
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
RENDER = PILOT / "data" / "render"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import deskew, estimate_skew  # noqa: E402
from clef_detect import _load_templates2, detect_clef, frame_left_edge  # noqa: E402
from keysig_pos_detect import load_table  # noqa: E402

CW, CH = 32, 64
GAP_W, GAP_H = 2.0, 5.0
VERIFY_N = 10
ACCID_GLYPH = {"E262": 0, "E260": 1}   # sharp, flat
MARGIN = re.compile(r'<g class="page-margin" transform="translate\(('
                    r'[-0-9.]+),\s*([-0-9.]+)\)')
KEYACCID = re.compile(r'<g id="[^"]+" class="keyAccid">(.*?)</g>', re.S)
USE = re.compile(r'xlink:href="#([A-Za-z0-9]+)-[^"]*"\s+'
                 r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)')


def cut(gray, cx, cy, gap):
    hw = int(round(GAP_W * gap / 2))
    hh = int(round(GAP_H * gap / 2))
    x0, y0 = int(round(cx - hw)), int(round(cy - hh))
    patch = np.full((2 * hh, 2 * hw), 255, np.uint8)
    ix0, iy0 = max(0, x0), max(0, y0)
    ix1, iy1 = min(gray.shape[1], x0 + 2 * hw), min(gray.shape[0], y0 + 2 * hh)
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    patch[iy0 - y0:iy0 - y0 + (iy1 - iy0),
          ix0 - x0:ix0 - x0 + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
    if patch.std() < 2:
        return None
    return cv2.resize(patch, (CW, CH), interpolation=cv2.INTER_AREA)


def max_index(table, clef, typ):
    return max((k[2] for k in table if k[0] == clef and k[1] == typ),
               default=-1)


def grid_positions(table, clef):
    """(x_gaps, y_halfsteps) candidate centers from the aligned table."""
    pos = []
    for typ in ("sharp", "flat"):
        for i in range(0, 5):
            key = (clef, typ, i)
            if key in table:
                pos.append(table[key])
    return pos


def render_bank(splits, limit=240):
    """Positives (glyph crops) and negatives (table-absent grid crops)."""
    table = load_table()
    Xp, yp, sp = [], [], []
    Xn, sn = [], []
    n_scores = 0
    for sid in splits["train"][:limit]:
        base = RENDER / sid
        if not (base / "page-01.svg").is_file():
            continue
        gray = cv2.imread(str(base / "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        meta = json.loads((base / "meta.json").read_text())
        t = (base / "page-01.svg").read_text()
        m = MARGIN.search(t)
        if not m:
            continue
        tx, ty = float(m.group(1)), float(m.group(2))
        pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == 1)
        sx = gray.shape[1] / pw
        gap = next(p["median_staff_gap_px"]
                   for p in meta["page_geometry"] if p["page"] == 1) * sx
        from keysig2 import truth_fifths_render
        fifths = truth_fifths_render(sid)
        typ_true = "sharp" if fifths > 0 else ("flat" if fifths < 0 else None)
        n_true = abs(fifths)
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        if not frames:
            continue
        fx0 = frame_left_edge(dark, frames[0])
        if fx0 is None:
            continue
        n_scores += 1
        # positives + in-position negatives
        for kg in KEYACCID.finditer(t):
            for gm in USE.finditer(kg.group(1)):
                g = gm.group(1)
                if g not in ACCID_GLYPH:
                    continue
                cx = (float(gm.group(2)) + tx) / 10 * sx
                cy = (float(gm.group(3)) + ty) / 10 * sx
                c = cut(gray, cx, cy, gap)
                if c is not None:
                    Xp.append(c)
                    yp.append(ACCID_GLYPH[g])
                    sp.append(sid)
        # negatives: table positions beyond the true count (for the true
        # type) and all positions of the other type / unkeyed renders
        for clef in ("G", "F"):
            for typ in ("sharp", "flat"):
                mi = max_index(table, clef, typ)
                for i in range(0, mi + 1):
                    if typ_true == typ and i < n_true:
                        continue
                    key = (clef, typ, i)
                    if key not in table:
                        continue
                    xg, yh = table[key]
                    if fx0 + xg * gap > gray.shape[1] - 10:
                        continue
                    c = cut(gray, fx0 + xg * gap,
                            frames[0][-1] - yh * gap / 2, gap)
                    if c is not None:
                        Xn.append(c)
                        sn.append(sid)
    print(f"[data] render: {len(Xp)} positives {Counter(yp)}, "
          f"{len(Xn)} negatives over {n_scores} scores", flush=True)
    return (np.array(Xp), np.array(yp), np.array(sp),
            np.array(Xn), np.array(sn))


def scan_grid(dirs, clef_templates, table):
    """Grid crops for scan samples; weak label = key sign."""
    X, Y, K, POS = [], [], [], []
    n_scored = 0
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
        try:
            root = ET.parse(mxs[0]).getroot()
            tv = root.findtext(".//key/fifths")
        except ET.ParseError:
            continue
        if tv is None:
            continue
        tv = int(tv)
        fr = frames[0]
        gap = (fr[-1] - fr[0]) / 4
        clef = detect_clef(g, dark, fr, gap, clef_templates)[0]
        if clef[0] not in ("G", "F"):
            continue
        fx0 = frame_left_edge(dark, fr)
        if fx0 is None:
            continue
        n_scored += 1
        sign = 0 if tv > 0 else (1 if tv < 0 else None)
        for (xg, yh) in grid_positions(table, clef[0]):
            for dy in (-1.0, -0.5, 0.0, 0.5, 1.0):
                px = fx0 + xg * gap
                py = fr[-1] - (yh / 2 + dy) * gap
                if px >= g.shape[1] - 10 or not (0 < py < g.shape[0]):
                    continue
                c = cut(g, px, py, gap)
                if c is None:
                    continue
                X.append(c)
                Y.append(sign)
                K.append(d.name)
                POS.append((round(xg, 2), round(yh, 1), dy))
    print(f"[data] scan grid: {len(X)} crops over {n_scored} samples "
          f"{Counter(Y)}", flush=True)
    return np.array(X), np.array(Y), np.array(K)


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    table = load_table()
    clef_templates = _load_templates2()
    Xp, yp, sp, Xn, sn = render_bank(splits, 240)
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    Xs, ys, ks = scan_grid(dirs[VERIFY_N:VERIFY_N + 180], clef_templates, table)
    Xv, yv, kv = scan_grid(dirs[:VERIFY_N], clef_templates, table)
    np.savez_compressed("/tmp/clefsym_data.npz", Xp=Xp, yp=yp, sp=sp,
                        Xn=Xn, sn=sn, Xs=Xs, ys=ys, ks=ks,
                        Xv=Xv, yv=yv, kv=kv)
    print("[data] saved /tmp/clefsym_data.npz", flush=True)


if __name__ == "__main__":
    main()

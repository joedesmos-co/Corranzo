#!/usr/bin/env python3
"""Notehead detection P/R across mask recipes (DEV, read-only).

Recipes (all on binarized gray):
  rowrem  : staff rows +-1 removed (current pipeline)
  morph   : long horizontal runs (>=6 gaps) + long vertical runs (>=3 gaps)
            removed by opening subtraction
  balloon : morph + 2x2 dilate
  morph4  : horizontal kernel 4 gaps (shorter), vertical 3 gaps
Detection = classify() size/shape window; truth = structural notehead
positions (containment then nearest-center within 1.2 gaps, one-to-one).
Writes reports/det_recipes.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from auto_locate import staff_lines, group_staves  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from staff_geometry import notehead_map  # noqa: E402


def recipe_rowrem(dark, lines, gap):
    m = dark.copy()
    band = np.zeros_like(dark)
    for y in lines:
        band[max(0, y - 1):y + 2, :] = 1
    m[band.astype(bool)] = 0
    return m


def recipe_morph(dark, lines, gap, hg=6.0, vg=3.0, dil=0):
    m = dark.copy()
    hker = cv2.getStructuringElement(cv2.MORPH_RECT,
                                     (max(3, int(round(hg * gap))), 1))
    m[cv2.morphologyEx(dark, cv2.MORPH_OPEN, hker).astype(bool)] = 0
    vker = cv2.getStructuringElement(cv2.MORPH_RECT,
                                     (1, max(3, int(round(vg * gap)))))
    m[cv2.morphologyEx(m, cv2.MORPH_OPEN, vker).astype(bool)] = 0
    if dil:
        m = cv2.dilate(m, np.ones((dil, dil), np.uint8))
    return m


def heads_from(m, gap, raw=None, dil_after=0):
    """Notehead candidates: horizontal opening (0.55 gap, as production
    components()) + CC + size/shape window (same as classify). If raw is
    given, each candidate must have ink density >= 0.45 on the RAW binary
    (dilation-inflated blobs fail this)."""
    kw = max(2, int(round(0.55 * gap)))
    mo = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
    if dil_after:
        mo = cv2.dilate(mo, np.ones((dil_after, dil_after), np.uint8))
    n, _l, stats, _c = cv2.connectedComponentsWithStats(mo, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 12 or w < 2 or h < 2:
            continue
        fill = area / max(1, w * h)
        if w > 3.0 * gap or h > 3.6 * gap:
            continue
        if not (0.55 * gap <= w <= 2.0 * gap and 0.55 * gap <= h <= 2.0 * gap
                and w / max(1, h) > 0.5 and fill > 0.45):
            continue
        if raw is not None:
            x0, y0 = max(0, x), max(0, y)
            x1 = min(raw.shape[1], x + w)
            y1 = min(raw.shape[0], y + h)
            if x1 <= x0 or y1 <= y0:
                continue
            dens = float(raw[y0:y1, x0:x1].mean())
            if dens < 0.40:
                continue
        out.append({"x": x, "y": y, "w": w, "h": h})
    return out


def score(heads, truth, gap):
    used = set()
    tp = 0
    near = 0
    for (px, py) in truth:
        hit = None
        for j, d in enumerate(heads):
            if j in used:
                continue
            if d["x"] <= px <= d["x"] + d["w"] and d["y"] <= py <= d["y"] + d["h"]:
                hit = j
                break
        if hit is None:
            best, bj = 10 ** 9, -1
            for j, d in enumerate(heads):
                if j in used:
                    continue
                v = (d["x"] + d["w"] / 2 - px) ** 2 + (d["y"] + d["h"] / 2 - py) ** 2
                if v < best:
                    best, bj = v, j
            if bj >= 0 and best <= (1.2 * gap) ** 2:
                hit = bj
                near += 1
        if hit is None:
            continue
        used.add(hit)
        tp += 1
    return {"tp": tp, "fp": len(heads) - len(used), "fn": len(truth) - tp,
            "p": round(tp / max(1, len(heads)), 4),
            "r": round(tp / max(1, len(truth)), 4)}


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    R = {}
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            nh = notehead_map(svg)
            truth = []
            for e in evs:
                if e["kind"] == "note" and (e.get("bbox") or {}).get("page") == pg:
                    pos = nh.get(e.get("id") or "") or nh.get(e.get("svg_id") or "")
                    if pos:
                        truth.append(((pos[0] + tx) / 10 * sx,
                                      (pos[1] + ty) / 10 * sx))
            rec = {
                "rowrem": score(heads_from(recipe_rowrem(dark, lines, gap), gap), truth, gap),
                "morph": score(heads_from(recipe_morph(dark, lines, gap), gap), truth, gap),
                "balloon": score(heads_from(recipe_morph(dark, lines, gap, dil=2), gap), truth, gap),
                "balloon_raw": score(heads_from(recipe_morph(dark, lines, gap, dil=2), gap, dark), truth, gap),
                "heal": score(heads_from(recipe_morph(dark, lines, gap), gap, None, dil_after=2), truth, gap),
                "heal3": score(heads_from(recipe_morph(dark, lines, gap), gap, None, dil_after=3), truth, gap),
            }
            for k, v in rec.items():
                if k not in R:
                    R[k] = Counter()
                for kk, vv in v.items():
                    R[k][kk] += vv
    out = {}
    for k, c in R.items():
        out[k] = dict(c)
        out[k]["p"] = round(c["tp"] / max(1, c["tp"] + c["fp"]), 4)
        out[k]["r"] = round(c["tp"] / max(1, c["tp"] + c["fn"]), 4)
    (TRAIN / "reports" / "det_recipes.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

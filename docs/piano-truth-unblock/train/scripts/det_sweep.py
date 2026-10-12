#!/usr/bin/env python3
"""Detector recipe sweep (DEV, read-only): heal variants around the
morph + open + dilate family, tuned for the preregistered gates
(P >= 0.90, R >= 0.75). Writes reports/det_sweep.json."""
from __future__ import annotations
import gzip
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from det_recipes import recipe_morph, score  # noqa: E402
from auto_locate import staff_lines  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from staff_geometry import notehead_map  # noqa: E402


def heads(m, gap, dil, dmin, dmax, raw=None, dens=0.0, fill=0.45):
    kw = max(2, int(round(0.55 * gap)))
    mo = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
    if dil:
        mo = cv2.dilate(mo, np.ones((dil, dil), np.uint8))
    n, _l, stats, _c = cv2.connectedComponentsWithStats(mo, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 12 or w < 2 or h < 2:
            continue
        f = area / max(1, w * h)
        if w > 3.0 * gap or h > 3.6 * gap:
            continue
        if not (dmin * gap <= w <= dmax * gap and dmin * gap <= h <= dmax * gap
                and w / max(1, h) > 0.5 and f > fill):
            continue
        if raw is not None and dens > 0:
            x0, y0 = max(0, x), max(0, y)
            x1 = min(raw.shape[1], x + w)
            y1 = min(raw.shape[0], y + h)
            if x1 <= x0 or y1 <= y0:
                continue
            if float(raw[y0:y1, x0:x1].mean()) < dens:
                continue
        out.append({"x": x, "y": y, "w": w, "h": h})
    return out


CFGS = {}
for dmin in (0.60, 0.65, 0.70):
    for dmax in (1.85, 1.9, 1.95):
        CFGS[f"h3_{dmin}_{dmax}"] = dict(dil=3, dmin=dmin, dmax=dmax)


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    R = {k: {"tp": 0, "fp": 0, "fn": 0} for k in CFGS}
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            mm = recipe_morph(dark, lines, gap)
            nh = notehead_map(svg)
            truth = []
            for e in evs:
                if e["kind"] == "note" and (e.get("bbox") or {}).get("page") == pg:
                    pos = nh.get(e.get("id") or "") or nh.get(e.get("svg_id") or "")
                    if pos:
                        truth.append(((pos[0] + tx) / 10 * sx,
                                      (pos[1] + ty) / 10 * sx))
            for k, c in CFGS.items():
                raw = dark if c.get("raw") else None
                hs = heads(mm, gap, c["dil"], c["dmin"], c["dmax"], raw,
                           c.get("dens", 0.0))
                s = score(hs, truth, gap)
                R[k]["tp"] += s["tp"]
                R[k]["fp"] += s["fp"]
                R[k]["fn"] += s["fn"]
    out = {}
    for k, c in R.items():
        out[k] = {"p": round(c["tp"] / max(1, c["tp"] + c["fp"]), 4),
                  "r": round(c["tp"] / max(1, c["tp"] + c["fn"]), 4),
                  "tp": c["tp"], "fp": c["fp"], "fn": c["fn"]}
    (TRAIN / "reports" / "det_sweep.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

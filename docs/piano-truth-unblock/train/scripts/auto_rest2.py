#!/usr/bin/env python3
"""Rest detection on the frozen detector mask (secondary objective).

The new notehead mask (detector.build_mask: staff/beam/stem long-run
removal) preserves rest glyphs better than the row-removed mask. Test:
templates + candidates both on the new mask, sweep the NCC threshold for
the best precision-preserving recall. Writes reports/auto_rest2.json.
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
from detector import build_mask, W_MIN, W_MAX  # noqa: E402
from auto_locate import staff_lines  # noqa: E402
from auto_rest import page_ctx, cc_norm, iou  # noqa: E402
from infer import load_models  # noqa: F401  (noqa: E402)

SIZE = 32


def rest_ccs2(gray, lines, gap):
    """Rest candidates on the new mask: size window + fill on the mask."""
    dark = (gray < 128).astype(np.uint8)
    m = build_mask(dark, gap)
    n, _l, stats, _c = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 10 or w < 2 or h < 2:
            continue
        fill = area / max(1, w * h)
        if w > 3.0 * gap or h > 3.6 * gap:
            continue
        if not (0.3 * gap <= w <= 2.4 * gap and 0.7 * gap <= h <= 3.4 * gap
                and fill > 0.2 and w / max(1, h) < 1.6):
            continue
        out.append((x, y, w, h))
    return out


def build_rest_templates(splits, n_train=200):
    acc, cnt = Counter(), Counter()
    for sid in splits["train"][:n_train]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        pages = sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")})
        ctx = {}
        for pg in pages:
            try:
                ctx[pg] = page_ctx(sid, pg)
            except OSError:
                continue
        for pg, (meta, gray, sx, gap, svg, tx, ty) in ctx.items():
            lines, _d = staff_lines(gray)
            boxes = rest_ccs2(gray, lines, gap)
            for e in evs:
                if (e.get("bbox") and int(e["bbox"]["page"]) == pg
                        and e["kind"] in ("rest", "mRest")):
                    b = e["bbox"]
                    tb = {"x": (b["x"] + tx) / 10 * sx, "y": (b["y"] + ty) / 10 * sx,
                          "w": b["w"] / 10 * sx, "h": b["h"] / 10 * sx}
                    best, bi = 0.15, -1
                    for j, bx in enumerate(boxes):
                        v = iou({"x": bx[0], "y": bx[1], "w": bx[2], "h": bx[3]}, tb)
                        if v > best:
                            best, bi = v, j
                    if bi < 0:
                        continue
                    cr = cc_norm(gray, boxes[bi])
                    if cr is None:
                        continue
                    key = str(e.get("dur")) if e.get("dur") is not None else "mRest"
                    acc[key] += cr
                    cnt[key] += 1
    return {k: acc[k] / cnt[k] for k in acc if cnt[k] >= 8}, cnt


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates, cnt = build_rest_templates(splits)
    print("[rest2] templates:", {k: cnt[k] for k in sorted(cnt)}, flush=True)
    for THR in (0.5, 0.55, 0.62, 0.7):
        C = Counter()
        for sid in splits["dev"][:5]:
            evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                      f"{sid}.events.json.gz", "rt"))["events"]
            for pg in sorted({int(e["bbox"]["page"]) for e in evs
                              if e.get("bbox")}):
                meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
                lines, _d = staff_lines(gray)
                det = []
                for bx in rest_ccs2(gray, lines, gap):
                    cr = cc_norm(gray, bx)
                    if cr is None:
                        continue
                    sc = {k: float((cr * t).sum()) for k, t in templates.items()}
                    best = max(sc, key=sc.get)
                    if sc[best] >= THR:
                        det.append({"x": bx[0], "y": bx[1], "w": bx[2],
                                    "h": bx[3], "cls": best})
                ob = []
                for e in evs:
                    if (e.get("bbox") and int(e["bbox"]["page"]) == pg
                            and e["kind"] in ("rest", "mRest")):
                        b = e["bbox"]
                        ob.append({"x": (b["x"] + tx) / 10 * sx,
                                   "y": (b["y"] + ty) / 10 * sx,
                                   "w": b["w"] / 10 * sx, "h": b["h"] / 10 * sx,
                                   "dur": str(e.get("dur")) if e.get("dur")
                                   is not None else "mRest"})
                used = set()
                for c in det:
                    best, bi = 0.3, -1
                    for j, o in enumerate(ob):
                        if j in used:
                            continue
                        v = iou(c, o)
                        if v > best:
                            best, bi = v, j
                    if bi >= 0:
                        used.add(bi)
                        C["tp"] += 1
                        C["cls_ok"] += (c["cls"] == ob[bi]["dur"])
                    else:
                        C["fp"] += 1
                for j, o in enumerate(ob):
                    if j not in used:
                        C["fn"] += 1
        out = {"thr": THR, "tp": C["tp"], "fp": C["fp"], "fn": C["fn"],
               "p": round(C["tp"] / max(1, C["tp"] + C["fp"]), 4),
               "r": round(C["tp"] / max(1, C["tp"] + C["fn"]), 4),
               "cls": round(C["cls_ok"] / max(1, C["tp"]), 4)}
        print(json.dumps(out), flush=True)
        (TRAIN / "reports" / "auto_rest2.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

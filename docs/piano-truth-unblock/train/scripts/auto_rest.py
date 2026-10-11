#!/usr/bin/env python3
"""P3 rest detection by TRAIN-supervised glyph templates, matchTemplate.

Templates: per-dur-class mean 32x32 of the TRAIN rest BBOX crops (bbox is
the glyph box; supervision = TRAIN rest events only). Detection:
cv2.matchTemplate (TM_CCOEFF_NORMED) per class over the page, peaks >=
threshold, greedy NMS, matched to truth rest bboxes by center distance.
Writes reports/auto_rest.json.
"""
from __future__ import annotations
import gzip
import json
import re as _re
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"

SIZE = 32
THRESH = 0.62


def page_ctx(sid, pg):
    meta = json.loads((RENDER / sid / "meta.json").read_text())
    gray = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                      cv2.IMREAD_GRAYSCALE)
    pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
    sx = gray.shape[1] / pw
    gap = next(p["median_staff_gap_px"] for p in meta["page_geometry"]
               if p["page"] == pg) * sx
    svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
    m = _re.search(r'<g class="page-margin" transform="translate\(([-0-9.]+),'
                   r'\s*([-0-9.]+)\)', svg)
    tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
    return meta, gray, sx, gap, svg, tx, ty


def norm32(patch):
    small = cv2.resize(patch, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    v = small.astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def cc_norm(gray, box):
    """Aspect-preserved normalized 32x32 of a CC's own bbox."""
    x, y, w, h = box
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(gray.shape[1], x + w), min(gray.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return None
    return norm32(gray[y0:y1, x0:x1])


def rest_ccs(gray, lines, frames, gap):
    """Rest-candidate CCs on the raw mask (no staff-row removal: a rest
    sitting ON a staff line would be split; no opening: it destroys thin
    rest strokes). Noteheads excluded; stems too thin, beams too wide."""
    from auto_locate import components, classify
    dark = (gray < 128).astype(np.uint8)
    comps = components(dark, lines, gap)
    heads, _r, _ = classify(comps, dark, frames, gap)
    for hd in heads:
        dark[max(0, hd["y"] - 1):hd["y"] + hd["h"] + 1,
             max(0, hd["x"] - 1):hd["x"] + hd["w"] + 1] = 0
    n, _lab, stats, _ = cv2.connectedComponentsWithStats(dark, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 10 or w < 2 or h < 2:
            continue
        fill = area / max(1, w * h)
        if w > 3.0 * gap or h > 3.6 * gap:
            continue
        if not (0.3 * gap <= w <= 2.2 * gap and 0.7 * gap <= h <= 3.4 * gap
                and fill > 0.2 and w / max(1, h) < 1.6):
            continue
        out.append((int(x), int(y), w, h))
    return out


def iou(a, b):
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    ix = max(0, min(ax2, bx2) - max(a["x"], b["x"]))
    iy = max(0, min(ay2, by2) - max(a["y"], b["y"]))
    inter = ix * iy
    return inter / max(1, a["w"] * a["h"] + b["w"] * b["h"] - inter)


def bbox_patch(gray, cx, cy, w, h):
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    x1, y1 = x0 + int(round(w)), y0 + int(round(h))
    ix0, iy0 = max(0, x0), max(0, y0)
    ix1, iy1 = min(gray.shape[1], x1), min(gray.shape[0], y1)
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    p = np.full((max(1, y1 - y0), max(1, x1 - x0)), 255, np.uint8)
    p[iy0 - y0:iy0 - y0 + (iy1 - iy0), ix0 - x0:ix0 - x0 + (ix1 - ix0)] = \
        gray[iy0:iy1, ix0:ix1]
    return norm32(p)


def build_templates(splits, n_train=200):
    acc, cnt = Counter(), Counter()
    sys.path.insert(0, str(HERE))
    from auto_locate import staff_lines, group_staves
    for sid in splits["train"][:n_train]:
        evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        pages = sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")})
        ctx = {}
        for pg in pages:
            try:
                ctx[pg] = page_ctx(sid, pg)
            except OSError:
                continue
        for pg, (_meta, gray, sx, gap, _svg, tx, ty) in ctx.items():
            lines, _dark = staff_lines(gray)
            frames = group_staves(lines)
            boxes = rest_ccs(gray, lines, frames, gap)
            if not boxes:
                continue
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
    templates, cnt = build_templates(splits)
    print("[rest] templates:", {k: cnt[k] for k in sorted(cnt)}, flush=True)
    C = Counter()
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        pages = sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")})
        for pg in pages:
            try:
                meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            except OSError:
                continue
            from auto_locate import staff_lines, group_staves
            lines, _dark = staff_lines(gray)
            frames = group_staves(lines)
            det = []
            for bx in rest_ccs(gray, lines, frames, gap):
                cr = cc_norm(gray, bx)
                if cr is None:
                    continue
                scores = {k: float((cr * t).sum()) for k, t in templates.items()}
                best = max(scores, key=scores.get)
                det.append({"x": bx[0], "y": bx[1], "w": bx[2], "h": bx[3],
                            "cls": best, "score": scores[best]})
            ob = []
            for e in evs:
                if (e.get("bbox") and int(e["bbox"]["page"]) == pg
                        and e["kind"] in ("rest", "mRest")):
                    b = e["bbox"]
                    ob.append({"x": (b["x"] + tx) / 10 * sx, "y": (b["y"] + ty) / 10 * sx,
                               "w": b["w"] / 10 * sx, "h": b["h"] / 10 * sx,
                               "dur": str(e.get("dur")) if e.get("dur") is not None
                               else "mRest"})
            det.sort(key=lambda d: -d["score"])
            kept = [d for d in det if d["score"] >= THRESH]
            used = set()
            for c in kept:
                cx, cy = c["x"] + c["w"] / 2, c["y"] + c["h"] / 2
                best, bi = 0.6 * gap, -1
                for j, o in enumerate(ob):
                    if j in used:
                        continue
                    d = ((o["x"] + o["w"] / 2 - cx) ** 2 + (o["y"] + o["h"] / 2 - cy) ** 2) ** 0.5
                    if d < best:
                        best, bi = d, j
                if bi >= 0:
                    used.add(bi)
                    C["tp"] += 1
                    C["cls_ok"] += (c["cls"] == ob[bi]["dur"])
                else:
                    C["fp"] += 1
            for j, o in enumerate(ob):
                if j not in used:
                    C["fn"] += 1
                    C["fn_" + o["dur"]] += 1
    out = {"tp": C["tp"], "fp": C["fp"], "fn": C["fn"],
           "p": round(C["tp"] / max(1, C["tp"] + C["fp"]), 4),
           "r": round(C["tp"] / max(1, C["tp"] + C["fn"]), 4),
           "class_acc_on_tp": round(C["cls_ok"] / max(1, C["tp"]), 4),
           "fn_by_class": {k[3:]: v for k, v in C.items() if k.startswith("fn_")},
           "scope": "5 DEV scores, TRAIN templates (32x32 mean NCC), NCC>=%.2f" % THRESH}
    (TRAIN / "reports" / "auto_rest.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

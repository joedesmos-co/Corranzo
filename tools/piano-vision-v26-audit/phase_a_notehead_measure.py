"""Phase A / P6: objective notehead / staff-line measurement, both domains.

Recomputes crop_view's exact affine so that page-normalized staff bands, the
object box and the sampled region are all expressed in the SAME 192x512 view
frame, then measures the rendered notehead per object:

  * staff space in view px, from the mapped band
  * the object box and the 3x-expanded region, in view px and in staff spaces
  * the notehead blob nearest the object centre, in view px and staff spaces
  * how many staff lines fall inside the sampled region  (pitch requires this)
  * antialiasing signature: intermediate-gray fraction
"""
from __future__ import annotations

import json
import math
import sys
from collections import deque
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, _bounds, _center  # noqa: E402

QW, QH = 512, 192


def crop_matrix(page, record):
    """Byte-equivalent of piano_vision.v2.data.crop_view's matrix."""
    b = record["input"]["modelInput"]["geometry"]["scopeBounds"]
    x0, y0, x1, y1 = float(b["x0"]), float(b["y0"]), float(b["x1"]), float(b["y1"])
    pw, ph = page.size
    px, py = max(.004, (x1 - x0) * .08), max(.004, (y1 - y0) * .08)
    bx0 = max(0, math.floor((x0 - px) * pw)); by0 = max(0, math.floor((y0 - py) * ph))
    bx1 = min(pw, math.ceil((x1 + px) * pw)); by1 = min(ph, math.ceil((y1 + py) * ph))
    cw, ch = bx1 - bx0, by1 - by0
    if min(cw, ch) <= 0:
        return None
    scale = min(QW / cw, QH / ch)
    rw, rh = max(1, round(cw * scale)), max(1, round(ch * scale))
    ox, oy = (QW - rw) // 2, (QH - rh) // 2
    return np.array([
        [pw * rw / cw / QW, 0, (ox - bx0 * rw / cw) / QW],
        [0, ph * rh / ch / QH, (oy - by0 * rh / ch) / QH],
        [0, 0, 1]], dtype=np.float64)


def map_y(matrix, y):
    """Page-normalized y -> view-normalized y (point (0, y, 1))."""
    p = np.array([[0.0, y, 1.0]]) @ matrix.T
    return float(p[0, 1] / p[0, 2])


def blob_near(mask, gy, gx, max_r=28):
    """Connected dark component whose centroid is closest to (gy,gx)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best = None
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            q = deque([(sy, sx)]); seen[sy, sx] = True
            pts = []
            while q:
                y, x = q.popleft(); pts.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
            ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
            cy, cx = sum(ys) / len(ys), sum(xs) / len(xs)
            d = math.hypot(cy - gy, cx - gx)
            r0, r1, c0, c1 = min(ys), max(ys), min(xs), max(xs)
            if d < max_r and (best is None or d < best["d"]):
                best = {"d": d, "area": len(pts), "h_px": r1 - r0 + 1,
                        "w_px": c1 - c0 + 1, "cy": cy, "cx": cx}
    return best


def line_rows(gray, y_lo, y_hi):
    a = gray[max(0, int(y_lo)):min(QH, int(y_hi) + 1)]
    if a.size == 0:
        return []
    return [i for i in np.where((a < 170).mean(1) > 0.5)[0]]


CURRENT = None


def measure(ordered, resolver, max_records=25, max_objects=400):
    out = []
    for rec in ordered[:max_records]:
        try:
            page = resolver.page(rec)
            M = crop_matrix(page, rec)
            sample, _, _, _, _ = build_inputs(rec, ordered, resolver, CURRENT)
        except Exception:
            continue
        views = sample["images"]
        gray_all = [(views[v][0].numpy() * 255).astype(np.uint8) for v in range(views.shape[0])]
        boxes = sample["object_boxes"].numpy()
        oview = sample["object_view"].numpy()
        rec_m = rec["input"]["modelInput"]
        bands = rec_m.get("geometry", {}).get("staffBands", {}).get("staffBands", [])
        objs = [o for o in rec_m.get("physicalObjects", []) if o.get("kind") == "notehead"]
        for k, obj in enumerate(objs):
            if k >= len(boxes) or len(out) >= max_objects:
                break
            v = int(oview[k])
            gray = gray_all[v]
            cy_page = _center(obj)[1]
            band = min(bands, key=lambda b: abs(cy_page - (float(b["y0"]) + float(b["y1"])) / 2)) if bands else None
            if band is None:
                continue
            by0, by1 = map_y(M, float(band["y0"])), map_y(M, float(band["y1"]))
            space_px = abs(by1 - by0) * QH / 4.0
            if space_px <= 0.5:
                continue
            x0, y0, x1, y1 = boxes[k]
            ow, oh = (x1 - x0) * QW, (y1 - y0) * QH
            gx, gy = (x0 + x1) / 2 * QW, (y0 + y1) / 2 * QH
            pad = 6
            px0, py0 = max(0, int(gx - ow / 2 - pad)), max(0, int(gy - oh / 2 - pad))
            px1, py1 = min(QW, int(gx + ow / 2 + pad) + 1), min(QH, int(gy + oh / 2 + pad) + 1)
            if px1 - px0 < 4 or py1 - py0 < 4:
                continue
            sub = gray[py0:py1, px0:px1]
            b = blob_near(sub < 128, gy - py0, gx - px0, max_r=max(6.0, space_px * 2))
            rows = line_rows(gray, min(by0, by1) * QH - oh, max(by0, by1) * QH + oh)
            out.append({
                "space_px": space_px,
                "obj_w_view_px": ow, "obj_h_view_px": oh,
                "obj_w_spaces": ow / space_px, "obj_h_spaces": oh / space_px,
                "region_w_spaces": ow * 3 / space_px, "region_h_spaces": oh * 3 / space_px,
                "blob_w_px": b["w_px"] if b else None,
                "blob_h_px": b["h_px"] if b else None,
                "blob_w_spaces": (b["w_px"] / space_px) if b else None,
                "blob_h_spaces": (b["h_px"] / space_px) if b else None,
                "blob_cy_off_px": (b["cy"] + py0 - gy) if b else None,
                "staff_lines_in_region": len(rows),
                "midgray_frac": float(((sub > 100) & (sub < 200)).mean()),
            })
    return out


def q(v):
    v = [float(x) for x in v if x is not None]
    if not v:
        return None
    s = sorted(v)
    return {f"p{int(p*100)}": round(s[min(len(s) - 1, int(p * len(s)))], 3)
            for p in (0.25, 0.5, 0.75)}


def main():
    global CURRENT
    runtime = H.load_runtime("cpu")
    CURRENT = runtime.config
    report = {}
    src_rows = []
    for e in H.source_scores(3, split="validation"):
        src_rows += measure(e, H.source_resolver())
    pr_rows = []
    for sid, ordered in H.realpdf_scores("validation"):
        pr_rows += measure(ordered, H.realpdf_resolver())
    keys = ["space_px", "obj_w_view_px", "obj_h_view_px", "obj_w_spaces", "obj_h_spaces",
            "region_w_spaces", "region_h_spaces", "blob_w_px", "blob_h_px",
            "blob_w_spaces", "blob_h_spaces", "blob_cy_off_px",
            "staff_lines_in_region", "midgray_frac"]
    for tag, rows in (("source", src_rows), ("production", pr_rows)):
        report[tag] = {"n": len(rows), **{k: q([r[k] for r in rows]) for k in keys}}
    report["ratio_production_over_source_p50"] = {
        k: (round(report["production"][k]["p50"] / report["source"][k]["p50"], 3)
            if report["source"].get(k) and report["production"].get(k) else None)
        for k in keys}
    path = H.write_json("phase_a_notehead_measure.json", report)
    print(json.dumps(report, indent=2, sort_keys=True))
    print("wrote", path)


if __name__ == "__main__":
    main()

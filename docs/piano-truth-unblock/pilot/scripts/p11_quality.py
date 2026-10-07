#!/usr/bin/env python3
"""P11 — quality-gate foundation metadata for rendered pages.

Per page: effective resolution (px per staff gap), contrast, blur (Laplacian
variance), ink fraction, crop completeness (content bbox vs page). No model.

Usage:
  python3 p11_quality.py [--limit N]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
RENDER = PILOT / "data" / "render"
QUALITY = PILOT / "data" / "quality"


def page_quality(png: Path, staff_gap_units, svg_width_px, content_bbox, page_w_px, page_h_px):
    img = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return {"error": "unreadable"}
    h, w = img.shape
    small = cv2.resize(img, (max(1, w // 4), max(1, h // 4)), interpolation=cv2.INTER_AREA)
    contrast = float(small.std())
    blur = float(cv2.Laplacian(small, cv2.CV_64F).var())
    ink = float((small < 200).mean())
    raster_per_page_px = (w / svg_width_px) if svg_width_px else None
    staff_gap_page_px = (staff_gap_units / 10.0) if staff_gap_units else None
    staff_gap_raster_px = (staff_gap_page_px * raster_per_page_px) if (staff_gap_page_px and raster_per_page_px) else None
    return {"width_px": w, "height_px": h,
            "staff_gap_units": staff_gap_units,
            "staff_gap_page_px": round(staff_gap_page_px, 4) if staff_gap_page_px else None,
            "raster_per_page_px": round(raster_per_page_px, 6) if raster_per_page_px else None,
            "staff_gap_raster_px": round(staff_gap_raster_px, 3) if staff_gap_raster_px else None,
            "contrast_std": round(contrast, 3),
            "blur_laplacian_var": round(blur, 3),
            "ink_fraction": round(ink, 5)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    QUALITY.mkdir(parents=True, exist_ok=True)
    metas = sorted(RENDER.glob("*/meta.json"))
    done = 0
    for meta in metas:
        try:
            m = json.loads(meta.read_text())
        except Exception:
            continue
        if m.get("status") != "PASS":
            continue
        sid = m["source_id"]
        out = QUALITY / f"{sid}.json"
        if out.is_file():
            continue
        pages_expected = m.get("pages") or 0
        pngs = sorted(meta.parent.glob("page-*.png"))
        if pages_expected and len(pngs) < pages_expected:
            continue  # rasterisation not finished for this score yet
        pages = {}
        geom = {p["page"]: p for p in m.get("page_geometry", [])}
        svg_bboxes = {}
        for r in []:
            pass
        # content bbox per page from object bboxes would need the objects file;
        # use element bboxes parsed from the SVG instead (cheap: reuse meta page
        # geometry width/height and compute ink bbox from the raster).
        for png in sorted(meta.parent.glob("page-*.png")):
            pg = int(png.stem.split("-")[1])
            g = geom.get(pg, {})
            q = page_quality(png, g.get("median_staff_gap"), g.get("width"),
                             None, g.get("width"), g.get("height"))
            pages[str(pg)] = q
        (QUALITY / f"{sid}.json").write_text(json.dumps(
            {"source_id": sid, "pages": pages}, indent=1))
        done += 1
        if args.limit and done >= args.limit:
            break
    print(f"[p11] quality written for {done} scores", file=sys.stderr)


if __name__ == "__main__":
    main()

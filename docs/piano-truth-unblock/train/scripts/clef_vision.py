#!/usr/bin/env python3
"""Visual clef recognition from pixels (TRAIN supervision, DEV evaluation).

Clef glyph crops from page PNGs (via SVG clef bboxes) -> shape {G,F,C} by
nearest-template NCC. Templates = per-class mean 32x32 crops from TRAIN.
Supervision (glyph->shape) comes from SMuFL code points in TRAIN SVGs only.
Deterministic; no learned weights; no DEV tuning. TEST sealed.
"""
from __future__ import annotations
import gzip
import json
import re
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"

CLEF_G = re.compile(r'<g id="([^"]+)" class="clef">(.*?)</g>\s*</g>', re.S)
USE_HREF = re.compile(r'<use xlink:href="#([A-Za-z0-9]+)-[^"]*"')
BBOX_RECT = re.compile(
    r'<g id="bbox-[^"]*"[^>]*>\s*<rect x="([\d.]+)" y="([\d.]+)" height="([\d.]+)" width="([\d.]+)"')
MARGIN = re.compile(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)')
MEASURE_G = re.compile(r'<g id="([^"]+)" class="measure">(.*?)</g>\s*</g>', re.S)

GLYPH_SHAPE = {"E050": "G", "E05C": "C", "E062": "F"}


def clef_instances(svg_text):
    """SVG clef groups -> [{svg_id, bbox, glyph, shape_or_None}]."""
    out = []
    for m in CLEF_G.finditer(svg_text):
        gid, body = m.group(1), m.group(2)
        u = USE_HREF.search(body)
        b = BBOX_RECT.search(body)
        glyph = u.group(1) if u else None
        bb = None
        if b:
            bb = {"x": float(b.group(1)), "y": float(b.group(2)),
                  "h": float(b.group(3)), "w": float(b.group(4))}
        out.append({"svg_id": gid, "bbox": bb, "glyph": glyph,
                    "shape": GLYPH_SHAPE.get(glyph) if glyph else None})
    return out


def measure_spans(svg_text):
    """measure SVG id -> (x0, x1) content bbox in SVG units."""
    out = {}
    for m in MEASURE_G.finditer(svg_text):
        b = BBOX_RECT.search(m.group(2))
        if b:
            x, w = float(b.group(1)), float(b.group(4))
            out[m.group(1)] = (x, x + w)
    return out


def page_img(sid, pg, cache):
    key = (sid, pg)
    if key not in cache:
        cache[key] = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                                cv2.IMREAD_GRAYSCALE)
    return cache[key]


def page_tx(sid, pg, meta_cache, svg_text=None):
    if sid not in meta_cache:
        meta_cache[sid] = json.loads((RENDER / sid / "meta.json").read_text())
    meta = meta_cache[sid]
    pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
    return meta, pw


def crop_clef_at(img, pw, tx, ty, bbox, size=32):
    sx = img.shape[1] / pw
    cx = (bbox["x"] + bbox["w"] / 2 + tx) / 10 * sx
    cy = (bbox["y"] + bbox["h"] / 2 + ty) / 10 * sx
    half = max(bbox["w"], bbox["h"]) / 10 * sx * 0.65
    half = max(4, int(round(half)))
    x0, y0 = int(round(cx - half)), int(round(cy - half))
    patch = np.full((2 * half, 2 * half), 255.0, np.float32)
    ix0, iy0 = max(0, x0), max(0, y0)
    ix1, iy1 = min(img.shape[1], x0 + 2 * half), min(img.shape[0], y0 + 2 * half)
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    patch[iy0 - y0:iy0 - y0 + (iy1 - iy0), ix0 - x0:ix0 - x0 + (ix1 - ix0)] = \
        img[iy0:iy1, ix0:ix1].astype(np.float32)
    small = cv2.resize(patch, (size, size), interpolation=cv2.INTER_AREA)
    v = small - small.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def build_templates(sids, cache=None):
    """Per-shape mean normalized crop over TRAIN clef instances."""
    cache = cache or {}
    meta_cache = {}
    acc, cnt = {}, Counter()
    for sid in sids:
        metas = json.loads((RENDER / sid / "meta.json").read_text())
        meta_cache[sid] = metas
        npages = len(metas["page_geometry"])
        for pg in range(1, npages + 1):
            svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
            m = MARGIN.search(svg)
            tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
            pw = next(p["width"] for p in metas["page_geometry"] if p["page"] == pg)
            img = page_img(sid, pg, cache)
            if img is None:
                continue
            for c in clef_instances(svg):
                if not c["shape"] or not c["bbox"]:
                    continue
                cr = crop_clef_at(img, pw, tx, ty, c["bbox"])
                if cr is None:
                    continue
                acc[c["shape"]] = acc.get(c["shape"], 0) + cr
                cnt[c["shape"]] += 1
    tmpl = {}
    for k, v in acc.items():
        m = v / cnt[k]
        n = np.sqrt((m ** 2).sum())
        tmpl[k] = m / n if n > 1e-9 else m
    return tmpl, dict(cnt)


def classify(crop, templates):
    best, bs = None, -1e18
    for k, t in templates.items():
        s = float((crop * t).sum())
        if s > bs:
            bs, best = s, k
    return best, bs

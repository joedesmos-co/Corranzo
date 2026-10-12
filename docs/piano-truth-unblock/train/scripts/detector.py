#!/usr/bin/env python3
"""Frozen notehead detector recipe (measured, DEV gates P>=0.90 R>=0.75).

Evidence chain (reports/det_mask_diag.json, det_recipes.json, det_sweep.json):
  - staff-row removal (+-1 row) destroys 41% of notehead pixels: it cuts a
    horizontal slit through any notehead sitting ON a staff line.
  - long-run opening subtraction (>=6 gaps horizontal: staff lines/beams;
    >=3 gaps vertical: stems) preserves on-line noteheads.
  - a 3x3 dilation AFTER the 0.55-gap horizontal opening heals the
    remaining slits (order matters: dilating before the opening re-splits
    them, because the opening deletes the 2px bridges).
  - window [0.70, 1.90] gaps on the healed mask is the measured operating
    point: DEV 5 scores P 0.930 / R 0.815 (vs the row-removal baseline
    P 0.893 / R 0.573).

Usage: detect_noteheads(gray, lines, gap) -> [{x,y,w,h}] pixel boxes.
"""
from __future__ import annotations
import cv2
import numpy as np

H_KERNEL_GAPS = 6.0   # horizontal runs at least this long = staff lines/beams
V_KERNEL_GAPS = 3.0   # vertical runs at least this long = stems
OPEN_KERNEL_GAPS = 0.55
DILATE = 3
W_MIN, W_MAX = 0.70, 1.90   # notehead size window in gaps (measured optimum)


def build_mask(dark, gap):
    """Staff/beam/stem-removing mask (noteheads survive)."""
    hker = cv2.getStructuringElement(
        cv2.MORPH_RECT, (max(3, int(round(H_KERNEL_GAPS * gap))), 1))
    vker = cv2.getStructuringElement(
        cv2.MORPH_RECT, (1, max(3, int(round(V_KERNEL_GAPS * gap)))))
    m = dark.copy()
    m[cv2.morphologyEx(dark, cv2.MORPH_OPEN, hker).astype(bool)] = 0
    m[cv2.morphologyEx(m, cv2.MORPH_OPEN, vker).astype(bool)] = 0
    return m


def detect_noteheads(gray, lines, gap):
    """Pixel boxes of notehead candidates. gray: uint8 page; lines:
    detected staff-line y positions; gap: staff gap in pixels."""
    dark = (gray < 128).astype(np.uint8)
    m = build_mask(dark, gap)
    kw = max(2, int(round(OPEN_KERNEL_GAPS * gap)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                         cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
    m = cv2.dilate(m, np.ones((DILATE, DILATE), np.uint8))
    n, _l, stats, _c = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 12 or w < 2 or h < 2:
            continue
        fill = area / max(1, w * h)
        if not (W_MIN * gap <= w <= W_MAX * gap
                and W_MIN * gap <= h <= W_MAX * gap
                and w / max(1, h) > 0.5 and fill > 0.45):
            continue
        out.append({"x": x, "y": y, "w": w, "h": h})
    return out

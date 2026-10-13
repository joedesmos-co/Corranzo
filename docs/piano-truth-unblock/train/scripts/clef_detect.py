#!/usr/bin/env python3
"""Automatic clef detection for a detected staff frame (frozen recipe).

Method (measured on DEV 5 pages, reports/clef_*.json):
  - the frame's own left edge is the longest dark run on its top staff line
    (the PAGE-global leftmost dark column is wrong: page-border artifacts
    and per-system indents mean it is not any system's left edge);
  - the clef glyph starts just right of that edge and spans ~0.5-3.5 gaps;
    class-conditional windows in GAP units (scale-adaptive, no fixed
    pixels) reproduce the training crop convention (square of
    half = 0.65 x glyph max dimension, centered on the glyph):
        G: center (fx0+2.2 gaps, middle line +0.15 gap), half 4.4 gaps
        F: center (fx0+2.2 gaps, 2nd line +0.4 gap),      half 2.2 gaps
        C: center (fx0+2.2 gaps, middle line),           half 2.2 gaps
  - each window is NCC-scored against its own class template; argmax wins.

Measured: 23/25 frames correct (was 19/25 with the old global-x0 centroid
crop). With the correct clef, page pitch accuracy rises to ~0.97
(oracle-geometry ceiling); the old recipe gave ~0.78.
"""
from __future__ import annotations
import cv2
import numpy as np

SIZE = 32
G_HALF_GAPS = 4.8
FC_HALF_GAPS = 2.0
XCENTER_GAPS = 2.2


def frame_left_edge(dark, fr):
    """Left endpoint of the frame's own staff line (longest dark run on
    the top or middle staff line). Page-global leftmost darkness is NOT
    used: it can be a border artifact and differs per system indent."""
    for y in (int(round(fr[0])), int(round(fr[2]))):
        if not (0 <= y < dark.shape[0]):
            continue
        row = dark[y]
        if not row.any():
            continue
        d = np.diff(np.concatenate(([0], row, [0])))
        st = np.where(d == 1)[0]
        en = np.where(d == -1)[0]
        if len(st):
            i = int((en - st).argmax())
            return int(st[i])
    return None


def _norm_patch(patch):
    v = cv2.resize(patch, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def _sq(gray, cx, cy, half):
    x0c, y0c = int(round(cx - half)), int(round(cy - half))
    patch = np.full((2 * half, 2 * half), 255, np.uint8)
    ix0, iy0 = max(0, x0c), max(0, y0c)
    ix1, iy1 = min(gray.shape[1], x0c + 2 * half), min(gray.shape[0], y0c + 2 * half)
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    patch[iy0 - y0c:iy0 - y0c + (iy1 - iy0),
          ix0 - x0c:ix0 - x0c + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
    return _norm_patch(patch)


def detect_clef(gray, dark, fr, gap, templates):
    """(shape, line) for one frame; falls back to ('G', 2) only when no
    window can be cropped at all."""
    fx0 = frame_left_edge(dark, fr)
    if fx0 is None:
        return ("G", 2), 0.0
    cands = {
        "G": ((fx0 + XCENTER_GAPS * gap, fr[2] + 0.15 * gap), G_HALF_GAPS * gap),
        "F": ((fx0 + XCENTER_GAPS * gap, fr[1] + 0.4 * gap), FC_HALF_GAPS * gap),
        "C": ((fx0 + XCENTER_GAPS * gap, fr[2]), FC_HALF_GAPS * gap),
    }
    best = (None, -9.0)
    for cls, (cen, half) in cands.items():
        cr = _sq(gray, cen[0], cen[1], int(round(half)))
        if cr is None:
            continue
        v = float((cr * templates[cls]).sum())
        if v > best[1]:
            best = (cls, v)
    if best[0] is None:
        return ("G", 2), 0.0
    sh = best[0]
    line = 2 if sh == "G" else (4 if sh == "F" else 3)
    return (sh, line), best[1]

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


def _run_len(dark, y, cx, half_w):
    """Longest dark run on row y within +-half_w of cx (0 if none)."""
    if y < 0 or y >= dark.shape[0]:
        return 0
    x0 = max(0, int(cx - half_w))
    x1 = min(dark.shape[1], int(cx + half_w))
    row = dark[y, x0:x1]
    if not row.any():
        return 0
    d = np.diff(np.concatenate(([0], row, [0])))
    st = np.where(d == 1)[0]
    en = np.where(d == -1)[0]
    return int((en - st).max()) if len(st) else 0


# chord-scan hyperparameters (measured on DEV 5 pages; see chord_scan.py and
# reports/chord_scan.json). delta 0.35 requires the notehead-sized run at the
# center row AND +-0.35 gaps (a beam is ~0.3 gaps tall and fails; a stem is
# far narrower than the run requirement and fails).
SCAN_DELTA = 0.35
SCAN_DENSITY = 0.45
SCAN_RUN_GAPS = 0.8
SCAN_MAX_BLOB = 6.0   # skip blobs wider/taller than this (system-level)


def detect_chord_tones(gray, lines, frames, gap, mask, heads):
    """Recover noteheads inside components rejected by the size window
    (fused chords/beams). Chord tones share the stem x (= blob center x)
    and sit on staff-legal half-gap y positions; a position is a notehead
    iff the notehead-wide dark run holds at the center row and +-0.35 gaps
    with box ink density >= 0.45. Deterministic; no training.
    Measured: DEV P 0.930 -> 0.932, R 0.815 -> 0.965 (fn 167 -> 32)."""
    import cv2
    n, _l, stats, _c = cv2.connectedComponentsWithStats(mask, 8)
    dark = (gray < 128).astype(np.uint8)
    win_w, win_h = 1.1 * gap, 1.0 * gap
    need = SCAN_RUN_GAPS * gap
    out = []
    for i in range(1, n):
        x, y, w, h, _a = stats[i]
        w, h = int(w), int(h)
        if (W_MIN * gap <= w <= W_MAX * gap
                and W_MIN * gap <= h <= W_MAX * gap):
            continue  # in-window: already detected
        if w > SCAN_MAX_BLOB * gap or h > SCAN_MAX_BLOB * gap:
            continue
        cx = x + w / 2
        cy = y + h / 2
        fi = min(range(len(frames)),
                 key=lambda k: min(abs(cy - l) for l in frames[k]))
        fr = frames[fi]
        top = fr[0] - 1.5 * gap
        bot = min(fr[-1] + 1.5 * gap, y + h)
        yv = top
        while yv <= bot:
            if y <= yv <= y + h:
                rc = _run_len(dark, int(round(yv)), cx, win_w)
                ru = _run_len(dark, int(round(yv - SCAN_DELTA * gap)), cx, win_w)
                rd = _run_len(dark, int(round(yv + SCAN_DELTA * gap)), cx, win_w)
                if rc >= need and ru >= need and rd >= need:
                    bx0 = int(round(cx - win_w / 2))
                    by0 = int(round(yv - win_h / 2))
                    bx1 = int(round(cx + win_w / 2))
                    by1 = int(round(yv + win_h / 2))
                    ix0, iy0 = max(0, bx0), max(0, by0)
                    ix1, iy1 = min(dark.shape[1], bx1), min(dark.shape[0], by1)
                    if ix1 > ix0 and iy1 > iy0:
                        if float(dark[iy0:iy1, ix0:ix1].mean()) >= SCAN_DENSITY:
                            out.append({"x": ix0, "y": iy0,
                                        "w": ix1 - ix0, "h": iy1 - iy0})
            yv += gap / 2
    have = [(h["x"], h["y"]) for h in heads]
    for d in out:
        if all(((d["x"] - hx) ** 2 + (d["y"] - hy) ** 2) > (0.9 * gap) ** 2
               for hx, hy in have):
            heads.append(d)
            have.append((d["x"], d["y"]))
    return heads


def detect_noteheads(gray, lines, gap):
    dark = (gray < 128).astype(np.uint8)
    m = build_mask(dark, gap)
    kw = max(2, int(round(OPEN_KERNEL_GAPS * gap)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                         cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
    m = cv2.dilate(m, np.ones((DILATE, DILATE), np.uint8))
    n, _l, stats, _c = cv2.connectedComponentsWithStats(m, 8)
    heads = []
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
        heads.append({"x": x, "y": y, "w": w, "h": h})
    return heads


def detect_noteheads_full(gray, lines, frames, gap):
    """Base detection + chord-tone recovery inside fused components."""
    import cv2
    dark = (gray < 128).astype(np.uint8)
    m = build_mask(dark, gap)
    kw = max(2, int(round(OPEN_KERNEL_GAPS * gap)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                         cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
    m = cv2.dilate(m, np.ones((DILATE, DILATE), np.uint8))
    n, _l, stats, _c = cv2.connectedComponentsWithStats(m, 8)
    heads = []
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
        heads.append({"x": x, "y": y, "w": w, "h": h})
    return detect_chord_tones(gray, lines, frames, gap, m, heads)
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

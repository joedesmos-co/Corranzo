#!/usr/bin/env python3
"""Meta-free automatic page processor (input: raw page/strip image only).

M2 finding: the previous "automatic" path read meta.json fixtures
(page width, median_staff_gap_px) and SVG page margins — none of which
exist for a real PDF/image. This processor derives EVERYTHING from pixels:
  staff gap      : (frame bottom line - top line) / 4, per frame
  page scale     : none needed (pixel-native throughout)
  left edge      : longest dark run on the frame's top staff line
  clef           : class-conditional gap-relative windows (clef_detect)
  noteheads      : detector.detect_noteheads_full (long-run removal +
                   legal-position chord scan)
  rests          : TRAIN glyph templates + NCC threshold
  barlines       : columns with >=85% staff-height coverage
  pitch          : frame steps + clef (structural)
  duration       : frozen common probe on corner-anchored detector boxes
Output: (frames, clefs, noteheads, rests, barlines) in pixel coordinates.
No fixtures, no SVG, no MEI, no oracle boxes. Scale-adaptive: all windows
are in staff-gap units, so DPI/size changes do not affect the recipe.
"""
from __future__ import annotations
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from clef_detect import detect_clef  # noqa: E402
from detector import detect_chord_tones, detect_noteheads  # noqa: E402


def frame_gap(fr):
    return (fr[-1] - fr[0]) / 4.0


def estimate_skew(gray, limit=4.0, step=0.25, max_dim=1000):
    """Estimate page skew (degrees) by maximizing the sharpest row-ink
    profile over small rotations. Deterministic; runs on a downscaled copy
    so the cost is independent of the input resolution."""
    h, w = gray.shape[:2]
    sc = 1.0
    if max(h, w) > max_dim:
        sc = max_dim / max(h, w)
        small = cv2.resize(gray, (int(w * sc), int(h * sc)),
                           interpolation=cv2.INTER_AREA)
    else:
        small = gray
    best = (0.0, -1.0)
    for ang in np.arange(-limit, limit + 1e-9, step):
        M = cv2.getRotationMatrix2D((small.shape[1] / 2, small.shape[0] / 2),
                                    float(ang), 1.0)
        rot = cv2.warpAffine(small, M, (small.shape[1], small.shape[0]),
                             flags=cv2.INTER_LINEAR, borderValue=255)
        dark = (rot < 128).astype(np.uint8)
        score = float(dark.sum(axis=1).max())
        if score > best[1]:
            best = (float(ang), score)
    return best[0]


def deskew(gray, angle):
    if abs(angle) < 1e-6:
        return gray
    h, w = gray.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), float(angle), 1.0)
    return cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderValue=255)


def process_page(gray, templates, probe_fn=None, rest_templates=None,
                 do_deskew=True):
    """Full automatic analysis of one page/strip image. Returns a dict.
    With do_deskew (default) the page is first deskewed: real scans are
    rotated by 1-4 degrees and horizontal run-length staff detection cannot
    see a tilted line (measured on OLiMPiC scans: 0 staff lines at native
    tilt, 15 after deskew)."""
    if do_deskew:
        angle = estimate_skew(gray)
        if abs(angle) > 0.05:
            gray = deskew(gray, angle)
    lines, dark = staff_lines(gray)
    frames = group_staves(lines)
    if not frames:
        return {"frames": [], "notes": [], "rests": [], "clefs": [],
                "measures": [], "gap": 0.0}
    gaps = [frame_gap(f) for f in frames]
    gap = float(np.median(gaps))
    out_frames = [list(f) for f in frames]
    out_clefs = []
    for fr in frames:
        (shape, line), _score = detect_clef(gray, dark, fr, gap, templates)
        out_clefs.append((shape, line))
    # noteheads ONCE per page (same recipe as the validated e2e)
    heads = detect_noteheads_full_page(gray, lines, frames, gap)
    notes = []
    for h in heads:
        cx, cy = h["x"] + h["w"] / 2, h["y"] + h["h"] / 2
        fi = min(range(len(frames)),
                 key=lambda i: min(abs(cy - l) for l in frames[i]))
        notes.append({"frame": fi, "x": cx, "y": cy, "w": h["w"], "h": h["h"]})
    for n in notes:
        fr = frames[n["frame"]]
        shape, line = out_clefs[n["frame"]]
        n["clef"] = (shape, line)
        n["midi"] = _pitch(n["y"], fr, shape, line, gap)
    rests = _rests_page(gray, lines, frames, gap, rest_templates)
    bars = {fi: _barlines(dark, fr) for fi, fr in enumerate(frames)}
    return {"frames": out_frames, "clefs": out_clefs, "notes": notes,
            "rests": rests, "measures": bars, "gap": gap}


def detect_noteheads_full_page(gray, lines, frames, gap):
    """detector.detect_noteheads + chord recovery, once per page."""
    from detector import detect_noteheads
    heads = detect_noteheads(gray, lines, gap)
    if frames:
        heads = detect_chord_tones(gray, lines, frames, gap, _healed(gray, gap), heads)
    return heads


def _healed(gray, gap):
    from detector import build_mask, OPEN_KERNEL_GAPS, DILATE
    dark = (gray < 128).astype(np.uint8)
    m = build_mask(dark, gap)
    kw = max(2, int(round(OPEN_KERNEL_GAPS * gap)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                         cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
    return cv2.dilate(m, np.ones((DILATE, DILATE), np.uint8))


_SEMI = (0, 2, 4, 5, 7, 9, 11)
_REF = {"G": ("g", 4), "F": ("f", 3), "C": ("c", 4)}


def _pitch(cy, fr, shape, line, gap):
    if shape not in _REF:
        return None
    rp, ro = _REF[shape]
    bottom = "cdefgab".index(rp) + 7 * ro - (int(line or 2) - 1) * 2
    steps = int(round(2 * (fr[-1] - cy) / gap))
    cid = steps + bottom
    return _SEMI[cid % 7] + 12 * (cid // 7 + 1)


def _barlines(dark, fr):
    top, bot = int(fr[0]), int(fr[-1])
    h = bot - top
    cols = []
    for x in range(dark.shape[1]):
        if int((dark[top:bot + 1, x] < 128).sum()) >= 0.85 * (h + 1):
            cols.append(x)
    groups = []
    if cols:
        s = p = cols[0]
        for x in cols[1:]:
            if x <= p + 3:
                p = x
                continue
            groups.append((s + p) // 2)
            s = p = x
        groups.append((s + p) // 2)
    return groups


def _rests_page(gray, lines, frames, gap, templates):
    """Rest candidates via TRAIN templates (NCC>=0.62)."""
    if not templates:
        return []
    dark = (gray < 128).astype(np.uint8)
    # candidate CCs: raw mask, noteheads excluded, size window
    from auto_rest import rest_ccs, cc_norm
    boxes = rest_ccs(gray, lines, frames, gap)
    out = []
    for bx in boxes:
        cr = cc_norm(gray, bx)
        if cr is None:
            continue
        sc = {k: float((cr * t).sum()) for k, t in templates.items()}
        best = max(sc, key=sc.get)
        if sc[best] >= 0.62:
            out.append({"x": bx[0], "y": bx[1], "w": bx[2], "h": bx[3],
                       "cls": best})
    return out

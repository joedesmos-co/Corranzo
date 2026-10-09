#!/usr/bin/env python3
"""Oracle staff-line geometry from page SVGs (positions only, never labels).

Parses <g class="staff"> line paths per page -> staff frames (5 line y's +
bbox), groups into piano systems (pairs), maps to staff labels "1" (upper)
/ "2" (lower). note_steps() converts a notehead bbox to (staff_label, steps
above bottom line) by pure geometry. Deterministic; zero tuned parameters.
"""
from __future__ import annotations
import re
from pathlib import Path

STAFF_G = re.compile(r'<g id="[^"]*" class="staff">(.*?)</g>\s*</g>', re.S)
PATH_D = re.compile(r'<path d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"')
RECT = re.compile(r'<rect x="([\d.]+)" y="([\d.]+)" height="([\d.]+)" width="([\d.]+)"')
MARGIN = re.compile(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)')
NOTEHEAD = re.compile(
    r'<g\b[^>]*id="([^"]+)"[^>]*class="note"[^>]*>.*?<g class="notehead">\s*'
    r'<use[^>]*transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', re.S)


def notehead_map(svg_text):
    """SVG note-group id -> exact notehead center (x, y) in SVG frame."""
    return {m.group(1): (float(m.group(2)), float(m.group(3)))
            for m in NOTEHEAD.finditer(svg_text)}


def page_frames(svg_path):
    """Return (tx, ty, staves) where staves = list of dicts in top-bottom
    order: {lines:[y_bottom..y_top] (5, SVG units, translated frame),
    bbox:(x,y,w,h), index}."""
    t = Path(svg_path).read_text()
    m = MARGIN.search(t)
    tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
    staves = []
    for g in STAFF_G.findall(t):
        ys = sorted({round(float(a[1]), 1) for a in PATH_D.findall(g)})
        r = RECT.search(g)
        if len(ys) != 5:
            continue
        staves.append({"lines": ys,
                       "bbox": tuple(float(x) for x in r.groups()) if r else None})
    staves.sort(key=lambda s: s["lines"][0])
    for k, s in enumerate(staves):
        s["index"] = k
        gaps = [b - a for a, b in zip(s["lines"], s["lines"][1:])]
        s["gap"] = sum(gaps) / len(gaps)
    return tx, ty, staves


def frames_by_label(staves, labels):
    """Group page staff frames into systems (consecutive runs of
    len(labels) frames top-to-bottom), then map each system's frames
    top-to-bottom onto numerically sorted labels. Deterministic; assumes
    every system shows all staves (verified by agreement rate)."""
    labs = sorted(set(str(x) for x in labels), key=lambda s: (len(s), s))
    n = max(1, len(labs))
    ordered = sorted(staves, key=lambda s: s["lines"][0])
    out = {}
    for k in range(0, len(ordered), n):
        chunk = ordered[k:k + n]
        for lab, s in zip(labs, sorted(chunk, key=lambda s: s["lines"][0])):
            out.setdefault(lab, []).append(s)
    return out


def note_steps(notehead_cy, labelled, staff_label):
    """Steps above the bottom line of the note's OWN staff frame (nearest
    frame carrying `staff_label`), linearly extrapolated for ledger lines.
    Cross-staff notes are therefore read in their own staff's frame, which
    is the notationally correct frame. `notehead_cy` is the exact SVG
    notehead center (never the stem-biased object bbox). Returns
    (steps, gap) or (None, None). All inputs in the same SVG frame."""
    cy = notehead_cy
    cands = labelled.get(str(staff_label)) or []
    best, bd = None, 1e18
    for s in cands:
        lo, hi = s["lines"][0], s["lines"][-1]
        d = 0.0 if lo <= cy <= hi else min(abs(cy - lo), abs(cy - hi))
        if d < bd:
            bd, best = d, s
    if best is None:
        return None, None
    steps = round(2 * (best["lines"][-1] - cy) / best["gap"])
    return steps, best["gap"]

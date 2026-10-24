#!/usr/bin/env python3
"""Bounded digital-PDF structural extractor for piano notation.

Reads vector staff lines, barlines, stems and music-font glyphs from a PDF
page (PyMuPDF, research evaluation only - see licensing note), classifies
noteheads/rests/clefs by bbox geometry relative to the staff gap, and maps
noteheads to written pitch using the clef. No reference notation is read
during extraction.

Outputs JSON events: {notes:[{midi,x,y,staff,measure,clef,kind}], rests:[...]}
plus a staff/measure summary. Duration is NOT claimed here (stem/beam
decoding remains a separate component).
"""
from __future__ import annotations
import json
import sys
from collections import Counter
from pathlib import Path

import pymupdf

STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"]
STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# bottom staff line pitch (letter, octave) for treble/bass clefs
BOTTOM = {"treble": ("E", 4), "bass": ("G", 2)}


def _group_lines(ys, tol=2.0):
    ys = sorted(ys)
    groups = []
    cur = []
    for y in ys:
        if not cur or y - cur[-1] <= tol:
            cur.append(y)
        else:
            groups.append(cur)
            cur = [y]
    if cur:
        groups.append(cur)
    return groups


def extract(pdf_path, page_no=0):
    doc = pymupdf.open(pdf_path)
    page = doc[page_no]
    W, H = page.rect.width, page.rect.height
    drawings = page.get_drawings()

    # staff lines: long horizontal strokes
    hlines = []
    vlines = []
    for it in drawings:
        r = it["rect"]
        if r.width > 0.4 * W and r.height < 1.5:
            hlines.append(round(r.y0, 1))
        elif r.width < 1.5 and r.height > 0.01 * H:
            vlines.append((round(r.x0, 1), round(r.y0, 1), round(r.y1, 1)))

    staff_ys = [g[0] for g in _group_lines(hlines, tol=1.0)]
    # systems: consecutive groups with near-equal gap (5 lines per staff)
    staves = []
    i = 0
    while i + 4 < len(staff_ys):
        g = staff_ys[i:i + 5]
        gaps = [g[k + 1] - g[k] for k in range(4)]
        if max(gaps) - min(gaps) <= 2.0 and 3 <= sum(gaps) / 4 <= 40:
            staves.append(g)
            i += 5
        else:
            i += 1
    if not staves:
        return {"error": "no staff systems", "page": page_no}

    # pair staves into grand-staff systems by vertical proximity
    systems = []
    for g in staves:
        gap = (g[-1] - g[0]) / 4
        systems.append({"lines": g, "gap": gap, "top": g[0],
                        "bottom": g[-1]})

    # music glyphs (embedded notation font only)
    glyphs = []
    for t in page.get_texttrace():
        if "Corranzo" not in t["font"] and "Feta" not in t["font"] \
                and "Bravura" not in t["font"]:
            continue
        for uni, gid, origin, bbox in t["chars"]:
            glyphs.append({"uni": uni, "gid": gid, "x": origin[0],
                           "y": origin[1], "bbox": tuple(round(v, 1)
                                                         for v in bbox)})

    # barlines: vertical strokes spanning the full staff height (stems are
    # ~3 gaps, barlines ~4 gaps; use 0.88 of the staff height)
    notes, rests = [], []
    clef_info = {}
    for si, sysd in enumerate(systems):
        g = sysd["lines"]
        gap = sysd["gap"]
        sh = g[-1] - g[0]
        bars = sorted({v[0] for v in vlines
                       if v[1] <= g[0] + 0.05 * sh
                       and v[2] >= g[-1] - 0.05 * sh})
        stems = [(v[0], v[1], v[2]) for v in vlines
                 if 1.8 * gap <= (v[2] - v[1]) <= 6.5 * gap
                 and g[0] - gap <= (v[1] + v[2]) / 2 <= g[-1] + gap]
        # clef: large glyph near the left edge, vertically in this staff
        clefs = [gl for gl in glyphs
                 if gl["bbox"][3] - gl["bbox"][1] >= 2.0 * gap
                 and gl["bbox"][2] - gl["bbox"][0] >= 1.3 * gap
                 and g[0] - 4 * gap <= (gl["bbox"][1] + gl["bbox"][3]) / 2
                 <= g[-1] + 4 * gap
                 and gl["bbox"][0] <= min(bars or [gl["bbox"][0]]) + 3 * gap]
        clef = "treble"
        if clefs:
            cb = min(clefs, key=lambda c: c["bbox"][0])["bbox"]
            clef = "treble" if (cb[3] - g[-1]) > 0.6 * gap else "bass"
        clef_info[si] = clef
        bottom = BOTTOM[clef]
        bottom_idx = STEP_NAMES.index(bottom[0]) + 7 * bottom[1]

        def measure_of(x):
            if not bars:
                return 0
            return sum(1 for b in bars if b < x) - 1

        def has_stem(bb):
            cy = (bb[1] + bb[3]) / 2
            for sx, sy0, sy1 in stems:
                if bb[0] - gap <= sx <= bb[2] + gap \
                        and sy0 <= cy + 0.6 * gap and sy1 >= cy - 0.6 * gap:
                    return True
            return False

        for gl in glyphs:
            bb = gl["bbox"]
            w = bb[2] - bb[0]
            h = bb[3] - bb[1]
            cy = (bb[1] + bb[3]) / 2
            if not (g[0] - 3.5 * gap <= cy <= g[-1] + 3.5 * gap):
                continue
            # notehead: compact oval with an attached stem
            if 1.6 * gap <= h <= 2.2 * gap and 1.0 * gap <= w <= 1.6 * gap \
                    and has_stem(bb):
                steps = int(round(2 * (g[-1] - cy) / gap))
                cidx = bottom_idx + steps
                midi = STEP_SEMI[STEP_NAMES[cidx % 7]] + 12 * (cidx // 7 + 1)
                notes.append({"midi": midi, "x": round(gl["x"], 1),
                              "y": round(cy, 1), "staff": si,
                              "measure": measure_of(gl["x"]),
                              "clef": clef, "kind": "note",
                              "confidence": 0.9})
            # rest: compact glyph with no stem, not a clef/time glyph
            elif 1.4 * gap <= h <= 2.0 * gap and 0.9 * gap <= w <= 1.4 * gap \
                    and not has_stem(bb):
                rests.append({"x": round(gl["x"], 1), "y": round(cy, 1),
                              "staff": si, "measure": measure_of(gl["x"]),
                              "kind": "rest", "confidence": 0.5})
    doc.close()
    route = "vector" if notes else "image"
    return {"page": page_no, "size": [W, H], "staves": len(staves),
            "clefs": clef_info, "notes": notes, "rests": rests,
            "note_count": len(notes), "rest_count": len(rests),
            "route": route,
            "schema": "corranzo-notation-ir/1"}


if __name__ == "__main__":
    out = extract(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0)
    print(json.dumps(out, indent=1))

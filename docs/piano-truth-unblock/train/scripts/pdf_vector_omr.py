#!/usr/bin/env python3
"""Bounded digital-PDF structural OMR for piano notation.

Extends the pitch-only prototype with rhythm evidence from PDF primitives:
staff lines, barlines, stems, beam segments, augmentation dots and rest
glyphs. Duration is derived ONLY from structural evidence:
  filled notehead + stem + 0/1/2/3 beams -> quarter/8th/16th/32nd
  hollow notehead + stem                 -> half
  hollow notehead, no stem               -> whole
  + augmentation dot                     -> x1.5
Rests are detected but their duration is NOT inferred from the glyph (the
benchmark font reuses one glyph for several rest values); they are emitted
as unresolved and listed in the MusicXML credit, never fabricated.

PyMuPDF is used for research evaluation only (AGPL-3.0). Production must use
the browser PDF.js vector pipeline (Apache-2.0) or a permissive parser.

Output: shared IR dict (corranzo-notation-ir/1) with notes/rests/measures,
confidence and provenance, plus an optional MusicXML serializer.
"""
from __future__ import annotations
import json
import sys
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

import pymupdf

STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"]
STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
BOTTOM = {"treble": ("E", 4), "bass": ("G", 2)}
TYPE_Q = {"whole": Fraction(4), "half": Fraction(2), "quarter": Fraction(1),
          "eighth": Fraction(1, 2), "16th": Fraction(1, 4),
          "32nd": Fraction(1, 8)}
TYPE_OF_BEAMS = {0: "quarter", 1: "eighth", 2: "16th", 3: "32nd"}


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


def _hollow(page_pix, scale, bbox):
    """True if the glyph centre is light (hollow notehead)."""
    if page_pix is None:
        return None
    x = int(round((bbox[0] + bbox[2]) / 2 * scale))
    y = int(round((bbox[1] + bbox[3]) / 2 * scale))
    if not (0 <= y < page_pix.shape[0] and 0 <= x < page_pix.shape[1]):
        return None
    # sample a small window; filled heads are dark at the centre
    win = page_pix[max(0, y - 1):y + 2, max(0, x - 1):x + 2]
    return float(win.mean()) > 160


def extract(pdf_path, page_no=0):
    doc = pymupdf.open(pdf_path)
    page = doc[page_no]
    W, H = page.rect.width, page.rect.height
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), colorspace=pymupdf.csGRAY)
    import numpy as np
    page_pix = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    scale = 2.0

    drawings = page.get_drawings()
    hlines, vlines, vbar, beams, dots = [], [], [], [], []
    for it in drawings:
        r = it["rect"]
        w, h = r.width, r.height
        if w > 0.4 * W and h < 1.5:
            hlines.append(round(r.y0, 1))
        elif w < 1.5 and h > 0.01 * H:
            vlines.append((round(r.x0, 1), round(r.y0, 1), round(r.y1, 1)))
            vbar.append((round(r.x0, 1), round(r.y0, 1), round(r.y1, 1),
                         float(it.get("width") or 0.0)))
        elif 4 <= w <= 12 and 3 <= h <= 8 and it.get("fill") is None:
            # beam segment: short thick diagonal stroke
            beams.append((round(r.x0, 1), round(r.x1, 1),
                          round((r.y0 + r.y1) / 2, 1)))
        elif w <= 4 and h <= 4 and it.get("fill") is not None:
            dots.append((round((r.x0 + r.x1) / 2, 1),
                         round((r.y0 + r.y1) / 2, 1)))

    staff_ys = [g[0] for g in _group_lines(hlines, tol=1.0)]
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
        return {"error": "no staff systems", "page": page_no, "route": "image"}

    systems = [{"lines": g, "gap": (g[-1] - g[0]) / 4, "system": si}
               for si, g in enumerate(staves)]

    glyphs = []
    for t in page.get_texttrace():
        if "Corranzo" not in t["font"] and "Feta" not in t["font"] \
                and "Bravura" not in t["font"]:
            continue
        for uni, gid, origin, bbox in t["chars"]:
            glyphs.append({"uni": uni, "gid": gid, "x": origin[0],
                           "y": origin[1],
                           "bbox": tuple(round(v, 1) for v in bbox)})

    notes, rests, unresolved = [], [], []
    clef_info = {}
    system_measures = []
    global_measure = 0
    for si, sysd in enumerate(systems):
        g = sysd["lines"]
        gap = sysd["gap"]
        sh = g[-1] - g[0]
        _bars = sorted({v[0] for v in vbar
                        if v[3] >= 0.95 and v[1] <= g[0] + 0.05 * sh
                        and v[2] >= g[-1] - 0.05 * sh})
        bars = []
        for _b in _bars:
            if not bars or _b - bars[-1] > 1.0 * gap:
                bars.append(_b)
        stems = [(v[0], v[1], v[2]) for v in vlines
                 if 1.8 * gap <= (v[2] - v[1]) <= 6.5 * gap
                 and g[0] - gap <= (v[1] + v[2]) / 2 <= g[-1] + gap]
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
        # global measure offset: measures before this system
        sys_measures = max(0, len(bars) - 1)
        base_measure = global_measure
        global_measure += sys_measures
        system_measures.append({"system": si, "base": base_measure,
                                "count": sys_measures, "clef": clef})

        def measure_of(x):
            if not bars:
                return base_measure
            return base_measure + max(0, sum(1 for b in bars if b < x) - 1)

        def stem_of(bb):
            cy = (bb[1] + bb[3]) / 2
            best = None
            for sx, sy0, sy1 in stems:
                if bb[0] - gap <= sx <= bb[2] + gap \
                        and sy0 <= cy + 0.9 * gap and sy1 >= cy - 0.9 * gap:
                    d = min(abs(sx - bb[0]), abs(sx - bb[2]))
                    if best is None or d < best[0]:
                        best = (d, sx, sy0, sy1)
            return best

        def beam_count(sx):
            # only beams belonging to THIS staff system (y range), then count
            # levels from the segments meeting the stem on either side.
            _bl = [(x0, x1, y) for x0, x1, y in beams
                   if g[0] - 4 * gap <= y <= g[-1] + 4 * gap]
            left = [y for x0, x1, y in _bl if abs(x1 - sx) <= 1.5]
            right = [y for x0, x1, y in _bl if abs(x0 - sx) <= 1.5]
            return max(len(left), len(right))

        _sys_glyphs = [gl for gl in glyphs
                       if g[0] - 3.5 * gap <= (gl["bbox"][1] + gl["bbox"][3]) / 2
                       <= g[-1] + 3.5 * gap]
        # chord clusters: noteheads sharing the same x (chords share a stem)
        # SMuFL notehead range 0xE0A0-0xE0FF; other fonts fall back to size.
        _heads = [gl for gl in _sys_glyphs
                  if (0xE0A0 <= gl["uni"] <= 0xE0FF
                      or not (0xE000 <= gl["uni"] <= 0xF8FF))
                  and 1.6 * gap <= gl["bbox"][3] - gl["bbox"][1] <= 2.2 * gap
                  and 1.0 * gap <= gl["bbox"][2] - gl["bbox"][0] <= 1.6 * gap]
        _clusters = []
        for _j, _h in enumerate(_heads):
            _cx = (_h["bbox"][0] + _h["bbox"][2]) / 2
            placed = False
            for _c in _clusters:
                if abs(_c["cx"] - _cx) <= 1.5:
                    _c["idx"].append(_j)
                    _c["cx"] = (_c["cx"] * (len(_c["idx"]) - 1) + _cx) / len(_c["idx"])
                    placed = True
                    break
            if not placed:
                _clusters.append({"cx": _cx, "idx": [_j]})
        _assign = {}
        for _c in _clusters:
            _best = None
            for _sx, _sy0, _sy1 in sorted(stems):
                _ys = [(_heads[_j]["bbox"][1] + _heads[_j]["bbox"][3]) / 2
                       for _j in _c["idx"]]
                if not all(_sy0 <= _y + 0.9 * gap and _sy1 >= _y - 0.9 * gap
                           for _y in _ys):
                    continue
                _d = abs(_sx - _c["cx"])
                if _d <= 1.4 * gap and (_best is None or _d < _best[0]):
                    _best = (_d, _sx)
            if _best is not None:
                for _j in _c["idx"]:
                    _assign[_j] = _best[1]
        for _j, gl in enumerate(_heads):
            bb = gl["bbox"]
            w = bb[2] - bb[0]
            h = bb[3] - bb[1]
            cy = (bb[1] + bb[3]) / 2
            is_note_glyph = 0xE0A0 <= gl["uni"] <= 0xE0FF
            is_rest_glyph = 0xE4E0 <= gl["uni"] <= 0xE4FF
            sx = _assign.get(_j)
            if sx is None:
                hollow = _hollow(page_pix, scale, bb)
                if hollow and is_note_glyph:
                    dtype, dots_n = "whole", 0
                elif is_rest_glyph:
                    rests.append({"x": round(gl["x"], 1), "y": round(cy, 1),
                                  "staff": si, "measure": measure_of(gl["x"]),
                                  "kind": "rest", "type": None, "dots": None,
                                  "dur_q": None, "confidence": 0.4,
                                  "unresolved": "rest-duration",
                                  "provenance": "pdf-vector"})
                    continue
                else:
                    unresolved.append({"kind": "note", "x": gl["x"],
                                       "y": cy, "staff": si,
                                       "reason": "no-stem"})
                    continue
            else:
                bc = beam_count(sx)
                if gl["uni"] == 0xE0A2:
                    dtype = "whole"
                elif gl["uni"] == 0xE0A3:
                    dtype = "half"
                elif gl["uni"] == 0xE0A4:
                    dtype = TYPE_OF_BEAMS.get(min(bc, 3), "32nd")
                else:
                    hollow = _hollow(page_pix, scale, bb)
                    dtype = "half" if hollow else TYPE_OF_BEAMS.get(min(bc, 3), "32nd")
                # augmentation dot to the right of the notehead
                dots_n = sum(1 for dx, dy in dots
                             if bb[2] - 1 <= dx <= bb[2] + 2.0 * gap
                             and abs(dy - cy) <= 0.6 * gap)
                # chord grouping by shared stem x (or same x)
                step = int(round(2 * (g[-1] - cy) / gap))
                cidx = bottom_idx + step
                midi = STEP_SEMI[STEP_NAMES[cidx % 7]] + 12 * (cidx // 7 + 1)
                keysig = 0  # not inferred
                notes.append({"midi": midi, "x": round(gl["x"], 1),
                              "y": round(cy, 1), "staff": si,
                              "measure": measure_of(gl["x"]),
                              "clef": clef, "kind": "note",
                              "type": dtype, "dots": int(dots_n),
                              "dur_q": str(TYPE_Q[dtype] *
                                           (2 - Fraction(1, 2 ** dots_n))
                                           if dots_n else TYPE_Q[dtype]),
                              "stem_x": round(sx, 1) if sx is not None else None,
                              "beam_count": int(bc) if sx is not None else None,
                              "confidence": 0.9 if sx is not None else 0.7,
                              "provenance": "pdf-vector"})

    # rests: SMuFL rest codepoints (0xE4E3..0xE4E7) map to durations
    REST_TYPE = {0xE4E3: "whole", 0xE4E4: "half", 0xE4E5: "quarter",
                 0xE4E6: "eighth", 0xE4E7: "16th", 0xE4E8: "32nd"}
    for si, sysd in enumerate(systems):
        g = sysd["lines"]
        gap = sysd["gap"]
        base = system_measures[si]["base"]
        bars = []
        for v in vbar:
            if v[3] >= 0.95 and v[1] <= g[0] + 0.05 * (g[-1] - g[0]) and v[2] >= g[-1] - 0.05 * (g[-1] - g[0]):
                if not bars or v[0] - bars[-1] > 1.0 * gap:
                    bars.append(v[0])
        def m_of(x):
            return base + max(0, sum(1 for b in bars if b < x) - 1)
        for gl in glyphs:
            if not (0xE4E0 <= gl["uni"] <= 0xE4FF):
                continue
            bb = gl["bbox"]
            cy = (bb[1] + bb[3]) / 2
            if not (g[0] - 3.5 * gap <= cy <= g[-1] + 3.5 * gap):
                continue
            rtype = REST_TYPE.get(gl["uni"])
            dots_n = sum(1 for dx, dy in dots
                         if bb[2] - 1 <= dx <= bb[2] + 2.0 * gap
                         and abs(dy - cy) <= 0.6 * gap)
            if rtype is None:
                rests.append({"x": round(gl["x"], 1), "y": round(cy, 1),
                              "staff": si, "measure": m_of(gl["x"]),
                              "kind": "rest", "type": None, "dots": None,
                              "dur_q": None, "confidence": 0.4,
                              "unresolved": "rest-glyph",
                              "provenance": "pdf-vector"})
            else:
                q = TYPE_Q[rtype] * (2 - Fraction(1, 2 ** dots_n)) if dots_n else TYPE_Q[rtype]
                rests.append({"x": round(gl["x"], 1), "y": round(cy, 1),
                              "staff": si, "measure": m_of(gl["x"]),
                              "kind": "rest", "type": rtype,
                              "dots": int(dots_n), "dur_q": str(q),
                              "confidence": 0.8, "provenance": "pdf-vector"})

    # chord grouping: notes in the same measure/staff sharing a stem x
    by_x = defaultdict(list)
    for n in notes:
        key = (n["measure"], n["staff"], round(n["x"] / 2.0))
        by_x[key].append(n)
    for key, grp in by_x.items():
        if len(grp) > 1:
            grp.sort(key=lambda n: n["midi"])
            for j, n in enumerate(grp):
                n["chord_id"] = f"c:{key[0]}:{key[1]}:{key[2]}"
                n["chord_root"] = (j == 0)
                n["chord_size"] = len(grp)
    for n in notes:
        n.setdefault("chord_id", None)
        n.setdefault("chord_root", True)
        n.setdefault("chord_size", 1)

    # measure-duration validation (only where a meter is known)
    by_measure = defaultdict(list)
    for n in notes:
        by_measure[n["measure"]].append(n)
    measure_sums = {}
    for m, evs in by_measure.items():
        root = [e for e in evs if e.get("chord_root", True)]
        measure_sums[m] = str(sum(Fraction(e["dur_q"]) for e in root))
    doc.close()
    route = "vector" if notes else "image"
    return {"page": page_no, "size": [W, H], "staves": len(staves),
            "clefs": clef_info, "notes": notes, "rests": rests,
            "unresolved": unresolved, "systems": system_measures,
            "measure_sums": measure_sums,
            "note_count": len(notes), "rest_count": len(rests),
            "route": route, "schema": "corranzo-notation-ir/1",
            "meter": None, "key": None,
            "credits": [
                "Meter not decoded; verify time signature.",
                "Key signature not decoded; accidentals are explicit only.",
                "Rest durations unresolved and omitted; review rests manually.",
            ]}


def to_musicxml(ir, divisions=480):
    """Serialize the vector IR to score-partwise MusicXML (single part)."""
    root = ET.Element("score-partwise", version="4.0")
    misc = ET.SubElement(root, "miscellaneous")
    mf = ET.SubElement(misc, "miscellaneous-field",
                       name="corranzo_notation_ir")
    mf.text = "corranzo-notation-ir/1"
    for c in ir.get("credits", []):
        cr = ET.SubElement(root, "credit")
        ET.SubElement(cr, "credit-words").text = c
    pl = ET.SubElement(root, "part-list")
    sp = ET.SubElement(pl, "score-part", id="P1")
    ET.SubElement(sp, "part-name").text = "Piano"
    part = ET.SubElement(root, "part", id="P1")
    by_measure = defaultdict(list)
    for e in ir["notes"] + ir["rests"]:
        by_measure[e["measure"]].append(e)
    staves = sorted({e["staff"] for e in ir["notes"] + ir["rests"]}) or [0]
    for mi in sorted(by_measure):
        m_el = ET.SubElement(part, "measure", number=str(mi + 1))
        attrs = ET.SubElement(m_el, "attributes")
        ET.SubElement(attrs, "divisions").text = str(divisions)
        # no <key>/<time>: unresolved, never silently C major / 4/4
        for st in staves:
            clef = ir["clefs"].get(str(st)) or ir["clefs"].get(st) or "treble"
            cl = ET.SubElement(attrs, "clef", number=str(st + 1))
            ET.SubElement(cl, "sign").text = "G" if clef == "treble" else "F"
            ET.SubElement(cl, "line").text = "2" if clef == "treble" else "4"
        # group by staff/voice, emit chords with the root first
        for st in staves:
            evs = [e for e in by_measure[mi] if e["staff"] == st]
            evs.sort(key=lambda e: (e["x"], e.get("midi") or 0))
            last_chord = None
            for e in evs:
                if e["kind"] == "rest":
                    if e.get("type") is None or e.get("dur_q") is None:
                        # unresolved rest duration: omit, never invent
                        continue
                    n_el = ET.SubElement(m_el, "note")
                    ET.SubElement(n_el, "rest")
                    q = Fraction(e["dur_q"]) * divisions
                    ET.SubElement(n_el, "duration").text = str(int(q))
                    ET.SubElement(n_el, "type").text = e["type"]
                    for _ in range(int(e.get("dots") or 0)):
                        ET.SubElement(n_el, "dot")
                    ET.SubElement(n_el, "voice").text = str(st + 1)
                    if len(staves) > 1:
                        ET.SubElement(n_el, "staff").text = str(st + 1)
                    continue
                n_el = ET.SubElement(m_el, "note")
                if e.get("chord_id") and not e.get("chord_root"):
                    ET.SubElement(n_el, "chord")
                p = ET.SubElement(n_el, "pitch")
                ET.SubElement(p, "step").text = STEP_NAMES[
                    _diatonic(e["midi"]) % 7]
                ET.SubElement(p, "octave").text = str(
                    _diatonic(e["midi"]) // 7)
                q = Fraction(e["dur_q"]) * divisions
                ET.SubElement(n_el, "duration").text = str(int(q))
                ET.SubElement(n_el, "type").text = e["type"]
                for _ in range(int(e.get("dots") or 0)):
                    ET.SubElement(n_el, "dot")
                ET.SubElement(n_el, "voice").text = str(st + 1)
                if len(staves) > 1:
                    ET.SubElement(n_el, "staff").text = str(st + 1)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            + ET.tostring(root, encoding="unicode"))


def _diatonic(midi):
    """MIDI -> diatonic index (C0=0) via nearest natural spelling."""
    names = [0, 2, 4, 5, 7, 9, 11]
    pc = midi % 12
    if pc in names:
        return names.index(pc) + 7 * (midi // 12 - 1)
    # nearest natural below
    for k in range(1, 3):
        if (midi - k) % 12 in names:
            return names.index((midi - k) % 12) + 7 * ((midi - k) // 12 - 1)
    return 0


if __name__ == "__main__":
    out = extract(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0)
    if len(sys.argv) > 3:
        Path(sys.argv[3]).write_text(json.dumps(out, indent=1))
    else:
        print(json.dumps(out, indent=1))

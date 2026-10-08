#!/usr/bin/env python3
"""MusicXML serialization of decoded PianoEvents + music21 validation.

Oracle structure (explicit): measure order, per-measure clef/key/meter per
staff, barline forms, staff count, divisions choice. Predicted content:
pitches, durations, voices, ties (paired), beams (grouped), chords, grace,
rests. Deliberately omitted (flagged, counted): tuplet elements (ratio
unknown), slurs (endpoints unknown), octave direction, artic/ornament/fingering
types, dynamics/hairpins/tempo/text, navigation/repeats-endings expansion,
breath/caesura, mNum/reh/harm content, cue sizing, fermata shape.
"""
from __future__ import annotations
import gzip
import json
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"

BARSTYLE = {"single": "light-light", "dbl": "light-light", "end": "light-heavy",
            "rptend": "light-heavy", "dotted": "dotted", "invis": "none",
            None: "light-light"}
CLEF_SIGN = {"G": "G", "F": "F", "C": "C"}
ACCIDENTAL_NAME = {1: "sharp", -1: "flat", 0: "natural", 2: "double-sharp",
                   -2: "double-flat"}


def parse_sig(sig):
    import re
    s = (sig or "0").strip()
    if s in ("0", ""):
        return 0
    m = re.match(r"(\d+)\s*([sf])", s)
    if not m:
        return 0
    return int(m.group(1)) * (1 if m.group(2) == "s" else -1)


def build_structure(sid):
    """Oracle page/measure/staff/clef/key/meter/barline constants + gap."""
    rec = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))
    meta = json.loads((RENDER / sid / "meta.json").read_text())
    measures, seen = [], set()
    for e in rec["events"]:
        mid = e.get("measure")
        if mid is not None and mid not in seen:
            seen.add(mid)
            measures.append({"id": mid, "index": e.get("measure_index", len(measures))})
    measures.sort(key=lambda m: (m["index"] if m["index"] is not None else 10 ** 9))
    staves = sorted({str(e.get("staff")) for e in rec["events"] if e.get("staff")},
                    key=lambda s: (len(s), s))
    state = {}
    for e in rec["events"]:
        key = (e.get("measure"), str(e.get("staff")))
        if key not in state and isinstance(e.get("clef"), dict):
            state[key] = {"clef": e.get("clef") or {}, "key": e.get("key") or {},
                          "meter": e.get("meter") or {}}
    barforms = {}
    for b in rec.get("barlines", []):
        barforms[b["measure"]] = b.get("form") or "single"
    gaps = [p["median_staff_gap_px"] for p in meta["page_geometry"] if p.get("median_staff_gap_px")]
    p0 = meta["page_geometry"][0]
    sx = 2480 / p0["width"] if p0.get("width") else 1.18
    gap_svg = (sum(gaps) / len(gaps)) / sx * 10 if gaps else 180.0
    return {"sid": sid, "measures": measures, "staves": staves, "state": state,
            "barforms": barforms, "gap_svg": gap_svg, "meta": meta}


def _sub(parent, tag, text=None, attrib=None):
    el = ET.SubElement(parent, tag, attrib or {})
    if text is not None:
        el.text = str(text)
    return el


def state_for(structure, mid, staff):
    st = structure["state"].get((mid, str(staff)), {})
    if not st and structure["staves"]:
        st = structure["state"].get((mid, structure["staves"][0]), {})
    return {"clef": st.get("clef") or {"shape": "G", "line": "2"},
            "key": st.get("key") or {"mode": "major", "sig": "0"},
            "meter": st.get("meter") or {"count": "4", "unit": "4"}}


def serialize(decoded, structure, divisions=480):
    """decoded: output of decode_score (notes/rests with quarter onsets)."""
    flags = {"measures": 0, "notes_written": 0, "rests_written": 0,
             "measure_rests": 0, "clef_changes": 0}
    root = ET.Element("score-partwise", {"version": "4.0"})
    pl = _sub(root, "part-list")
    sp = _sub(pl, "score-part", {"id": "P1"})
    _sub(sp, "part-name", "Piano")
    part = _sub(root, "part", {"id": "P1"})
    staves = structure["staves"]
    nstaves = len(staves)
    by_measure = {}
    for n in decoded["notes"] + decoded["rests"]:
        by_measure.setdefault(n["measure_index"], []).append(n)
    prev_clef = {}
    for mi in sorted(by_measure):
        m_el = _sub(part, "measure", {"number": str(mi + 1)})
        flags["measures"] += 1
        mid = by_measure[mi][0]["measure"]
        st0 = state_for(structure, mid, staves[0])
        attrs = _sub(m_el, "attributes")
        _sub(attrs, "divisions", divisions)
        k_el = _sub(attrs, "key")
        _sub(k_el, "fifths", parse_sig(st0["key"].get("sig")))
        _sub(k_el, "mode", st0["key"].get("mode") or "major")
        t_el = _sub(attrs, "time")
        _sub(t_el, "beats", st0["meter"].get("count") or "4")
        _sub(t_el, "beat-type", st0["meter"].get("unit") or "4")
        _sub(attrs, "staves", nstaves)
        for s in staves:
            cl = state_for(structure, mid, s)["clef"]
            if prev_clef.get(s) != (cl.get("shape"), cl.get("line")) or mi == 0:
                c_el = _sub(attrs, "clef", attrib={"number": str(staves.index(s) + 1)})
                _sub(c_el, "sign", CLEF_SIGN.get(cl.get("shape", "G"), "G"))
                _sub(c_el, "line", cl.get("line", "2"))
                prev_clef[s] = (cl.get("shape"), cl.get("line"))
                if mi > 0:
                    flags["clef_changes"] += 1
        voices = []
        for e in sorted(by_measure[mi], key=lambda e: (e.get("source_order", 0))):
            v = (e["staff"], e["voice"])
            if v not in voices:
                voices.append(v)
        mlen = Fraction(int(st0["meter"].get("count") or 4) * 4,
                        int(st0["meter"].get("unit") or 4))
        first_voice = True
        for (s, v) in voices:
            if not first_voice:
                bk = _sub(m_el, "backup")
                _sub(bk, "duration", int(mlen * divisions))
            first_voice = False
            slot = sorted([e for e in by_measure[mi] if (e["staff"], e["voice"]) == (s, v)],
                          key=lambda e: (e["onset_q"], e.get("source_order", 0)))
            for e in slot:
                write_event(m_el, e, s, nstaves, staves, divisions, flags)
        form = structure["barforms"].get(mid, "single")
        if form and form != "single":
            bl = _sub(m_el, "barline", {"location": "right"})
            _sub(bl, "bar-style", BARSTYLE.get(form, "light-light"))
            if form == "rptend":
                _sub(bl, "repeat", attrib={"direction": "backward"})
    return ('<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")), flags


def write_event(m_el, e, staff_id, nstaves, staves, divisions, flags):
    is_rest = e.get("midi") is None
    if e.get("grace"):
        n_el = _sub(m_el, "note")
        _sub(n_el, "grace", attrib={"slash": "yes"})
        p_el = _sub(n_el, "pitch")
        _sub(p_el, "step", e["pname"])
        _sub(p_el, "octave", e["oct"])
        if e.get("type") in ("64th", "32nd", "16th", "eighth", "quarter",
                             "half", "whole", "breve", "long"):
            _sub(n_el, "type", e["type"])
        _sub(n_el, "voice", e["voice"])
        if nstaves > 1:
            _sub(n_el, "staff", staves.index(staff_id) + 1)
        return
    if is_rest:
        n_el = _sub(m_el, "note")
        r_el = _sub(n_el, "rest")
        if e.get("measure_rest"):
            r_el.set("measure", "yes")
            flags["measure_rests"] += 1
        _sub(n_el, "duration", int(e["dur_q"] * divisions))
        _sub(n_el, "voice", e["voice"])
        if nstaves > 1:
            _sub(n_el, "staff", staves.index(staff_id) + 1)
        if e.get("type") in ("64th", "32nd", "16th", "eighth", "quarter",
                             "half", "whole", "breve", "long") and not e.get("measure_rest"):
            _sub(n_el, "type", e["type"])
            for _ in range(e.get("dots", 0)):
                _sub(n_el, "dot")
        flags["rests_written"] += 1
        return
    n_el = _sub(m_el, "note")
    if e.get("chord_id") and not e.get("chord_root"):
        _sub(n_el, "chord")
    p_el = _sub(n_el, "pitch")
    _sub(p_el, "step", e["pname"])
    if e.get("alter"):
        _sub(p_el, "alter", e["alter"])
    _sub(p_el, "octave", e["oct"])
    _sub(n_el, "duration", int(e["dur_q"] * divisions))
    if e.get("tie_to"):
        _sub(n_el, "tie", attrib={"type": "start"})
    if e.get("tie_from"):
        _sub(n_el, "tie", attrib={"type": "stop"})
    _sub(n_el, "voice", e["voice"])
    if e.get("type") in ("64th", "32nd", "16th", "eighth", "quarter",
                         "half", "whole", "breve", "long"):
        _sub(n_el, "type", e["type"])
    for _ in range(e.get("dots", 0)):
        _sub(n_el, "dot")
    if (e.get("acc_cls") or "none") != "none":
        _sub(n_el, "accidental", ACCIDENTAL_NAME.get(e.get("alter"), "natural"))
    if nstaves > 1:
        _sub(n_el, "staff", staves.index(staff_id) + 1)
    if e.get("beam_group"):
        _sub(n_el, "beam", e["beam_group"][1], attrib={"number": "1"})
    nots = _sub(n_el, "notations")
    wrote = False
    if e.get("tie_to"):
        _sub(nots, "tied", attrib={"type": "start"})
        wrote = True
    if e.get("tie_from"):
        _sub(nots, "tied", attrib={"type": "stop"})
        wrote = True
    if e.get("pedal_start"):
        _pedal(m_el, staff_id, nstaves, staves, "start")
    if e.get("pedal_end"):
        _pedal(m_el, staff_id, nstaves, staves, "stop")
    if not wrote and len(nots) == 0:
        n_el.remove(nots)
    flags["notes_written"] += 1


def _pedal(m_el, staff_id, nstaves, staves, kind):
    d_el = _sub(m_el, "direction", {"placement": "below"})
    dt = _sub(d_el, "direction-type")
    _sub(dt, "pedal", attrib={"type": kind, "line": "yes"})
    if nstaves > 1:
        _sub(d_el, "staff", staves.index(staff_id) + 1)
    _sub(d_el, "offset", 0)


DURCLASS_TYPE = {"64th": "64th", "32nd": "32nd", "16th": "16th",
                 "eighth": "eighth", "quarter": "quarter", "half": "half",
                 "whole": "whole", "breve": "breve", "long": "long"}

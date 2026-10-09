#!/usr/bin/env python3
"""P2 structured decoder: model predictions + oracle structure -> PianoEvents.

Deterministic assembly. Oracle structure inputs (explicit parameters):
measure map/order, staff systems, clef/key/meter per measure+staff, divisions
choice, barline forms, notehead_x. NEVER consumes truth labels (pitches,
durations, identities, onsets, relationships, accidentals, voices, text).

Stages: A = verified truth (canonical events), B = this decoder on model
predictions + oracle boxes, C = detected boxes (UNAVAILABLE: no detector was
trained — stated, not silently skipped), D = decoded playable score
(MusicXML + validation).
"""
from __future__ import annotations
import json
from collections import defaultdict
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent

DIVISIONS = 480
TYPE_Q = {"64th": Fraction(1, 16), "32nd": Fraction(1, 8), "16th": Fraction(1, 4),
          "eighth": Fraction(1, 2), "quarter": Fraction(1, 1), "half": Fraction(2, 1),
          "whole": Fraction(4, 1), "breve": Fraction(8, 1), "long": Fraction(16, 1)}
DURCLASS_TYPE = {"64": "64th", "32": "32nd", "16": "16th", "8": "eighth",
                 "4": "quarter", "2": "half", "1": "whole",
                 "breve": "breve", "long": "long"}
STEP_BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"]
CLEF_REF = {"G": ("G", 4), "F": ("F", 3), "C": ("C", 4)}
_FRM_CACHE = {}
ALTER_OF_ACC = {"none": 0, "n": 0, "s": 1, "f": -1, "ss": 2, "ff": -2}
CLEF_SIGN = {"G": "G", "F": "F", "C": "C"}


def spell(midi, acc_cls):
    """Deterministic MIDI+accidental-class -> (pname, oct, alter, fallback_flag).
    No key-signature inference: the acc head predicts the printed accidental."""
    alter = ALTER_OF_ACC.get(acc_cls, 0)
    base = midi - alter
    if base % 12 in (0, 2, 4, 5, 7, 9, 11) and 0 <= base <= 127:
        step = STEP_NAMES[[0, 2, 4, 5, 7, 9, 11].index(base % 12)]
        return step, base // 12 - 1, alter, False
    # fallback: nearest natural spelling (measured, flagged)
    best = min(range(0, 128, 12), key=lambda b: 0 if b % 12 in (0, 2, 4, 5, 7, 9, 11) else 10 ** 9)
    cands = [(s, o) for o in range(9) for s in STEP_NAMES
             if 12 * (o + 1) + STEP_BASE[s] >= 0]
    bn, bo, bd = None, None, 10 ** 9
    for s, o in cands:
        b = 12 * (o + 1) + STEP_BASE[s]
        d = abs(b - base)
        if d < bd:
            bn, bo, bd = s, o, d
    return bn, bo, midi - (12 * (bo + 1) + STEP_BASE[bn]), True


def _diatonic_idx(pname, octv):
    return STEP_NAMES.index(pname) + 7 * octv


def _clef_bottom_idx(shape, line):
    """Diatonic index of a staff's bottom line in the oracle clef frame."""
    if shape not in CLEF_REF:
        return None
    rp, ro = CLEF_REF[shape]
    return _diatonic_idx(rp, ro) - (int(line or 2) - 1) * 2


def _struct_index(sid, pages):
    """Cached structural note index: mei_id -> dict(canon_measure, rank,
    pos, lines, gap). Pure SVG structure + box ids; no labels."""
    import sys as _sys
    key = (sid, tuple(sorted(pages)))
    if key not in _FRM_CACHE:
        if str(HERE) not in _sys.path:
            _sys.path.insert(0, str(HERE))
        from staff_geometry import parse_page
        pilot = TRAIN.parent / "pilot"
        idx = {}
        for pg in pages:
            try:
                svg = (pilot / "data" / "render" / sid
                       / f"page-{int(pg):02d}.svg").read_text()
            except OSError:
                continue
            for m in parse_page(svg):
                for rk, s in enumerate(m["staves"]):
                    s["rank"] = rk
                for nid, nd in m["notes"].items():
                    if nd["pos"] is None or nd["rank"] is None:
                        continue
                    fr = m["staves"][nd["rank"]] \
                        if nd["rank"] < len(m["staves"]) else None
                    if fr is None or len(fr["lines"]) != 5:
                        continue
                    gaps = [b - a for a, b in
                            zip(fr["lines"], fr["lines"][1:])]
                    idx[nid] = {"pos": nd["pos"], "rank": nd["rank"],
                                "rank_label": str(nd["rank"] + 1),
                                "lines": fr["lines"],
                                "gap": sum(gaps) / len(gaps),
                                "svg_measure": m["svg_id"]}
        _FRM_CACHE[key] = idx
    return _FRM_CACHE[key]


def _visual_clef_lookup(sid):
    """Cached visual governing-clef map for a score (pixels + structure)."""
    import sys as _sys
    if "_TMPL" not in _FRM_CACHE:
        if str(HERE) not in _sys.path:
            _sys.path.insert(0, str(HERE))
        from clef_map import load_templates
        _FRM_CACHE["_TMPL"] = load_templates()
    key = ("clefmap", sid)
    if key not in _FRM_CACHE:
        if str(HERE) not in _sys.path:
            _sys.path.insert(0, str(HERE))
        from clef_map import build_visual_clef_map
        full, _det, _diag = build_visual_clef_map(sid, _FRM_CACHE["_TMPL"])
        _FRM_CACHE[key] = full
    return _FRM_CACHE[key]


def _canon_measure_of(sid, svg_measure, by_mei_measure):
    return by_mei_measure.get(svg_measure)


def clef_repair_note(e, it, p, structure, flags, struct_idx, vclef_map,
                     by_mei_measure, clef_source="visual"):
    """Override a clef-contradicted argmax pitch with the top-ranked probe
    candidate consistent with the notehead's structural staff steps in the
    governing clef frame. Evidence: SVG notehead position + staff membership
    (render structure), clef (visual pixels by default; oracle only when
    clef_source='oracle' for A/B attribution), probe top-5 (visual).
    Never invents: keeps argmax when structure/clef is missing, when argmax
    already agrees, or when no top-5 candidate matches."""
    if e.get("midi") is None:
        return
    acc = e.get("acc_cls")
    if acc is None:
        return
    stinfo = struct_idx.get(it.get("mei_id") or "")
    if stinfo is None:
        return
    if clef_source == "visual":
        cm = by_mei_measure.get(stinfo["svg_measure"])
        clef = (vclef_map or {}).get((cm, stinfo["rank_label"])) if cm else None
        if clef is None:
            flags["clef_unmapped"] = flags.get("clef_unmapped", 0) + 1
            return
        shape, line = clef["shape"], clef["line"]
    else:
        import sys as _sys
        if str(HERE) not in _sys.path:
            _sys.path.insert(0, str(HERE))
        from to_musicxml import state_for
        staff = e.get("staff")
        if staff is None:
            return
        st = state_for(structure, e.get("measure"), staff)["clef"]
        shape, line = st.get("shape", "G"), st.get("line", 2)
    bottom = _clef_bottom_idx(shape, line)
    if bottom is None:
        return
    import sys as _sys
    if str(HERE) not in _sys.path:
        _sys.path.insert(0, str(HERE))
    from staff_geometry import steps_in_frame
    steps = steps_in_frame(stinfo["pos"][1], stinfo["lines"], stinfo["gap"])
    alter = ALTER_OF_ACC.get(acc, 0)
    arg_steps = _diatonic_idx(e["pname"], e["oct"]) - bottom
    if arg_steps == steps:
        return
    for cand in (p.get("pitch_top5") or [p.get("pitch", -1)]):
        if cand is None or cand < 0:
            continue
        cm = 21 + int(cand)
        nat = cm - alter
        if nat < 0 or nat > 127:
            continue
        _SEMI2STEP = {0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6}
        if nat % 12 not in _SEMI2STEP:
            continue
        cidx = _SEMI2STEP[nat % 12] + 7 * (nat // 12 - 1)
        if cidx - bottom == steps:
            if cm != e["midi"]:
                e["pitch_argmax"] = e["midi"]
                e["midi"] = cm
                pn, po, pa, fb = spell(cm, acc)
                e["pname"], e["oct"], e["alter"] = pn, po, pa
                if fb:
                    flags["spelling_fallback"] += 1
                flags["clef_repair"] = flags.get("clef_repair", 0) + 1
            return
    flags["clef_repair_missed"] = flags.get("clef_repair_missed", 0) + 1
    flags["clef_repair_missed"] = flags.get("clef_repair_missed", 0) + 1


def parse_sig(sig):
    s = (sig or "0").strip()
    if s == "0" or s == "":
        return 0
    import re
    m = re.match(r"(\d+)\s*([sf])", s)
    if not m:
        return 0
    return int(m.group(1)) * (1 if m.group(2) == "s" else -1)


def decode_score(sid, items, pred, structure, voice_source="context",
                 clef_source="visual"):
    """Assemble predicted PianoEvents. `structure` carries oracle geometry/
    measure/clef/key/meter/divisions constants. Returns (events, flags)."""
    flags = {"spelling_fallback": 0, "unpaired_tie_start": 0,
             "unpaired_tie_end": 0, "tuplet_unresolved": 0,
             "octave_dir_unknown": 0, "slur_omitted": 0,
             "artic_untyped": 0, "ornament_untyped": 0, "fingering_untyped": 0,
             "cue_unserialized": 0, "pedal_spans": 0, "dynamics_omitted": 0}
    # join canonical geometry/order fields (positions only, never labels).
    # Pilot objects carry source_order for notes but not for rests; fall back
    # to canonical file rank (== document order) so rests interleave correctly
    # in lane sorting. File rank is used uniformly as the lane sort key.
    import gzip
    _evlist = json.load(gzip.open(
        TRAIN / "data" / "events" / f"{sid}.events.json.gz", "rt"))["events"]
    _evs = {e["id"]: e for e in _evlist}
    _rank = {e["id"]: pos for pos, e in enumerate(_evlist) if e.get("id")}
    for it in items:
        _e = _evs.get(it["mei_id"], {})
        it["notehead_x"] = _e.get("notehead_x")
        it["source_order"] = _rank.get(it["mei_id"], 0)
    # measure lengths from oracle meter (for full-measure rest detection)
    _mlen = {}
    for _e in _evs.values():
        _m = _e.get("meter") or {}
        if not _m or _e.get("measure") in _mlen:
            continue
        try:
            _mlen[_e.get("measure")] = Fraction(int(_m.get("count") or 4) * 4,
                                                int(_m.get("unit") or 4))
        except (TypeError, ValueError, ZeroDivisionError):
            pass
    notes, rests = [], []
    for i, it in enumerate(items):
        p = pred[i]
        is_note = bool(p["kind"] == 1)
        dur_sym = p["dur_sym"]
        if dur_sym is None and is_note:
            # model emitted no usable duration class: drop loudly, never invent
            flags["pred_oov_note_dropped"] = \
                flags.get("pred_oov_note_dropped", 0) + 1
            continue
        if dur_sym is None and not is_note:
            # dur-less rest whose meter length has no single-symbol form
            # (e.g. 15/16): full-measure rest with true quarter length,
            # serialized measure-style
            _mq = _mlen.get(it["measure"])
            if _mq is None:
                flags["rest_dur_unknown"] = flags.get("rest_dur_unknown", 0) + 1
                continue
            rests.append({"item": i, "mei_id": it["mei_id"], "measure": it["measure"],
                          "measure_index": it["measure_index"], "staff": p["staff_id"],
                          "voice": p["voice_id"] if voice_source == "context"
                          else p["voice_id_common"],
                          "dur_q": _mq, "type": None, "dots": 0,
                          "page": it["page"], "source_order": it.get("source_order", 0),
                          "measure_rest": True})
            continue
        m = __import__("re").match(r"(.+)d(\d+)$", dur_sym)
        prefix, ndots = (m.group(1), int(m.group(2))) if m else (None, 0)
        mtype = DURCLASS_TYPE.get(prefix)
        if mtype not in TYPE_Q:
            flags["pred_oov_note_dropped" if is_note else "pred_oov_rest_dropped"] = \
                flags.get("pred_oov_note_dropped" if is_note else "pred_oov_rest_dropped", 0) + 1
            continue
        q = TYPE_Q[mtype] * (2 - Fraction(1, 2 ** ndots)) if ndots else TYPE_Q[mtype]
        voice = p["voice_id"] if voice_source == "context" else p["voice_id_common"]
        if not is_note:
            rests.append({"item": i, "mei_id": it["mei_id"], "measure": it["measure"],
                          "measure_index": it["measure_index"], "staff": p["staff_id"],
                          "voice": voice, "dur_q": q, "type": mtype, "dots": ndots,
                          "page": it["page"], "source_order": it.get("source_order", 0),
                          "measure_rest": q == _mlen.get(it["measure"])})
            continue
        pname, octv, alter, fb = spell(p["pitch_midi"], p["acc_cls"])
        if fb:
            flags["spelling_fallback"] += 1
        notes.append({"item": i, "mei_id": it["mei_id"], "measure": it["measure"],
                      "measure_index": it["measure_index"], "staff": p["staff_id"],
                      "voice": voice,
                      "dur_q": q, "type": mtype, "dots": ndots,
                      "midi": p["pitch_midi"], "pname": pname, "oct": octv, "alter": alter,
                      "acc_cls": p["acc_cls"],
                      "grace": bool(p["grace"]), "cue": bool(p["cue"]),
                      "tie_start": bool(p["tie_start"]), "tie_end": bool(p["tie_end"]),
                      "in_beam": bool(p["in_beam"]), "tuplet_member": bool(p["tuplet_member"]),
                      "slur_member": bool(p["slur_member"]),
                      "has_artic": bool(p["has_artic"]), "has_ornament": bool(p["has_ornament"]),
                      "has_fingering": bool(p["has_fingering"]),
                      "arpeg_member": bool(p["arpeg_member"]), "gliss_member": bool(p["gliss_member"]),
                      "pedal_active": bool(p["pedal_active"]),
                      "octave_shifted": bool(p["octave_shifted"]),
                      "hairpin_member": bool(p["hairpin_member"]),
                      "chord_tone": bool(p["chord_tone"]),
                      "notehead_x": it.get("notehead_x"), "page": it["page"],
                      "source_order": it.get("source_order", 0)})
    # clef-consistent pitch repair (stage A oracle pitches never contradict
    # geometry, so this is a no-op there). Must precede onset accumulation
    # and chord detection, which both consume midi. clef_source='visual'
    # (pixels + structure) is the production path; 'oracle' exists only for
    # A/B attribution of the clef information itself.
    _pages = sorted({it.get("page", 1) for it in items if it.get("page")})
    _sidx = _struct_index(sid, _pages)
    _vmap = _visual_clef_lookup(sid) if clef_source == "visual" else None
    _svg_votes = {}
    for _mei, _st in _sidx.items():
        _ce = _evs.get(_mei, {})
        if _ce.get("measure") is not None:
            _svg_votes.setdefault(_st["svg_measure"], []).append(_ce["measure"])
    from collections import Counter as _C
    _svg2canon = {k: _C(v).most_common(1)[0][0] for k, v in _svg_votes.items() if v}
    for n in notes:
        _p = pred.get(n["item"], {})
        _it = items[n["item"]] if 0 <= n["item"] < len(items) else {}
        clef_repair_note(n, _it, _p, structure, flags, _sidx, _vmap,
                         _svg2canon, clef_source=clef_source)
    # onset accumulation per (measure, staff, voice); grace = zero width.
    # Chord tones (same x, same dur, different pitch as the running note)
    # share the root onset and do not advance time. Grace notes attach at
    # current time without advancing and never disturb chord chaining.
    by_msv = {}
    for n in notes + rests:
        by_msv.setdefault((n["measure_index"], n["staff"], n["voice"]), []).append(n)
    for key, lst in by_msv.items():
        lst.sort(key=lambda e: (e.get("source_order", 0)))
        t = Fraction(0)
        prev = None
        prev_lane, prev_rank = None, None
        gid = 0
        for e in lst:
            _rank = e.get("source_order", 0)
            if e.get("grace"):
                e["onset_q"] = t
                prev_lane, prev_rank = e, _rank
                continue
            if (prev_lane is not None and e.get("midi") is None
                    and prev_lane.get("midi") is None
                    and _rank == prev_rank + 1):
                # file-adjacent same-lane rests are parallel-layer duplicates
                # (854/854 in TRAIN): coincide, consume no time
                e["onset_q"] = prev_lane["onset_q"]
                e["chord_id"] = None
                e["duplicate_rest"] = True
                flags["duplicate_rest_collapsed"] = \
                    flags.get("duplicate_rest_collapsed", 0) + 1
                prev_lane, prev_rank = e, _rank
                continue
            if (prev is not None and e.get("midi") is not None and prev.get("midi") is not None
                    and e["midi"] != prev["midi"]
                    and e.get("notehead_x") is not None and prev.get("notehead_x") is not None
                    and abs(e["notehead_x"] - prev["notehead_x"]) <= 0.5 * structure["gap_svg"]):
                # Chord by visual x-coincidence. Members share the root onset
                # even when predicted durations differ (dur-split chords: the
                # audit shows 2042 missed truth pairs split by dur/onset with
                # coincident heads). Each member keeps its own duration for
                # advancement of subsequent onsets; only the onset is snapped.
                # Same-duration fast path is subsumed (no separate condition).
                e["onset_q"] = prev["onset_q"]
                if e["dur_q"] != prev["dur_q"]:
                    flags["chord_dur_mismatch"] = \
                        flags.get("chord_dur_mismatch", 0) + 1
                e["onset_q"] = prev["onset_q"]
                if prev.get("chord_id") is None:
                    gid += 1
                    prev["chord_id"] = f"ch:{key[0]}:{key[1]}:{key[2]}:{gid}"
                    prev["chord_root"] = True
                    prev["chord_size"] = 2
                e["chord_id"] = prev["chord_id"]
                e["chord_root"] = False
                prev["chord_size"] = prev.get("chord_size", 1) + 1
                e["chord_size"] = prev["chord_size"]
                prev_lane, prev_rank = e, _rank
                continue
            e["onset_q"] = t
            e["chord_id"] = None
            e["chord_root"] = True
            e["chord_size"] = 1
            if not e.get("grace"):
                t += e["dur_q"]
            prev = e if e.get("midi") is not None else None
            prev_lane, prev_rank = e, _rank
    # fix up chord sizes (join path increments predecessor only)
    _cgroups = {}
    for n in notes:
        if n.get("chord_id"):
            _cgroups.setdefault(n["chord_id"], []).append(n)
    for _cid, _members in _cgroups.items():
        for _m in _members:
            _m["chord_size"] = len(_members)
    # duplicate simultaneous rests in one lane (parallel-layer doubles):
    # a voice holds one rest per position; keep the first, flag the rest
    _seen_rest = set()
    _kept_rests = []
    for r in rests:
        _rk = (r["measure_index"], r["staff"], r["voice"], r["onset_q"],
               r["dur_q"])
        if _rk in _seen_rest:
            flags["duplicate_rest_collapsed"] = \
                flags.get("duplicate_rest_collapsed", 0) + 1
            continue
        _seen_rest.add(_rk)
        _kept_rests.append(r)
    rests = _kept_rests
    # ties: chain start->next end of same pitch within (staff, voice),
    # ACROSS measure boundaries (truth ties routinely span barlines; chaining
    # per-measure broke all of them). Ordered by (measure_index, onset).
    # Pairing still requires both visual flags (tie_end + an open tie_start
    # of the same pitch), so no tie is fabricated from pitch repetition alone.
    _sv = defaultdict(list)
    for key, lst in by_msv.items():
        for e in lst:
            if e.get("midi") is not None:
                _sv[(key[1], key[2])].append(e)
    for key, lst in _sv.items():
        seq = sorted(lst, key=lambda e: (e["measure_index"]
                                         if e["measure_index"] is not None else 10 ** 9,
                                         e["onset_q"], e["midi"]))
        open_tie = {}
        for e in seq:
            if e.get("tie_end") and e["midi"] in open_tie:
                s = open_tie.pop(e["midi"])
                s.setdefault("tie_to", []).append(e["mei_id"])
                e.setdefault("tie_from", []).append(s["mei_id"])
                if s["measure_index"] != e["measure_index"]:
                    flags["tie_cross_measure"] = \
                        flags.get("tie_cross_measure", 0) + 1
            elif e.get("tie_end"):
                flags["unpaired_tie_end"] += 1
            if e.get("tie_start"):
                open_tie[e["midi"]] = e
        flags["unpaired_tie_start"] += len(open_tie)
    # beams: consecutive in_beam runs in x/source order per (measure, voice)
    for key, lst in by_msv.items():
        seq = sorted([x for x in lst if x.get("midi") is not None],
                     key=lambda e: (e["onset_q"], e.get("notehead_x") or 0))
        run, gid = [], 0
        for e in seq + [None]:
            if e is not None and e.get("in_beam"):
                run.append(e)
            else:
                if len(run) >= 2:
                    gid += 1
                    bid = f"bm:{key[0]}:{key[1]}:{key[2]}:{gid}"
                    for pos, g in enumerate(run):
                        g["beam_group"] = (bid, "begin" if pos == 0 else
                                           ("end" if pos == len(run) - 1 else "continue"))
                elif len(run) == 1:
                    run[0]["beam_group"] = None
                run = []
    # tuplets: consecutive runs (ratio unknown -> flagged, no element emitted)
    for key, lst in by_msv.items():
        seq = sorted([x for x in lst if x.get("midi") is not None],
                     key=lambda e: (e["onset_q"], e.get("notehead_x") or 0))
        run = []
        for e in seq + [None]:
            if e is not None and e.get("tuplet_member"):
                run.append(e)
            else:
                if run:
                    flags["tuplet_unresolved"] += 1
                    for g in run:
                        g["tuplet_group"] = True
                run = []
    # pedal / octave runs (span boundaries deterministic; octave direction unknown)
    for key, lst in by_msv.items():
        seq = sorted([x for x in lst if x.get("midi") is not None], key=lambda e: e["onset_q"])
        for flag, startk, endk in (("pedal_active", "pedal_start", "pedal_end"),
                                   ("octave_shifted", "octave_start", "octave_end")):
            run = []
            for e in seq + [None]:
                if e is not None and e.get(flag):
                    run.append(e)
                else:
                    if run:
                        run[0][startk] = True
                        run[-1][endk] = True
                        if flag == "pedal_active":
                            flags["pedal_spans"] += 1
                        else:
                            flags["octave_dir_unknown"] += 1
                    run = []
    # slurs/articulations/ornaments/fingerings/cue: counted, not serialized
    for e in notes:
        if e.get("slur_member"):
            flags["slur_omitted"] += 1
        if e.get("has_artic"):
            flags["artic_untyped"] += 1
        if e.get("has_ornament"):
            flags["ornament_untyped"] += 1
        if e.get("has_fingering"):
            flags["fingering_untyped"] += 1
        if e.get("cue"):
            flags["cue_unserialized"] += 1
    return {"sid": sid, "notes": notes, "rests": rests, "flags": flags,
            "structure": {"measures": structure["measures"], "staves": structure["staves"]}}

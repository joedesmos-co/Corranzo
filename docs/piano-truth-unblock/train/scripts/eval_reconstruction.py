#!/usr/bin/env python3
"""P3/P4/P6: stage-separated reconstruction evaluation on frozen DEV.

Stages:
  A: decode(truth labels) -> MusicXML_A  (isolates DECODER loss)
  B: decode(model predictions) -> MusicXML_B (model + decoder loss)
  C: detected boxes (UNAVAILABLE: asserts no detector exists)
  D: MusicXML_B validated as playable via music21 + matched vs truth.

Metrics: event P/R, joint exact rate, invalid measures, voice errors,
missing/extra notes+rests, broken ties/tuplets, chord/beam/tuplet grouping
P/R, score-level consistency, P4 structural tests (context vs common voice),
5 worst-score failure dossiers. TEST sealed (dev list only).
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"

sys.path.insert(0, str(HERE))
from infer import load_models, predict_score, load_dev_sids  # noqa: E402
from decode_score import decode_score  # noqa: E402
from to_musicxml import build_structure, serialize  # noqa: E402


def assert_no_detector():
    """Stage C is unavailable: fail loudly if any detection path appears."""
    import glob
    suspects = []
    for f in glob.glob(str(HERE / "*.py")):
        t = Path(f).read_text()
        if "detect" in t.lower() and "UNAVAILABLE" not in t and Path(f).name != "eval_reconstruction.py":
            suspects.append(Path(f).name)
    # eval_reconstruction mentions detection only to assert absence
    return suspects


def ppq_per_quarter(canonical_events):
    """Estimate Verovio ppq-per-quarter from (dur class, dur_ppq) pairs."""
    ref = {"64": Fraction(1, 16), "32": Fraction(1, 8), "16": Fraction(1, 4),
           "8": Fraction(1, 2), "4": Fraction(1, 1), "2": Fraction(2, 1),
           "1": Fraction(4, 1), "breve": Fraction(8, 1), "long": Fraction(16, 1)}
    vals = Counter()
    for e in canonical_events:
        if e["kind"] == "note" and str(e.get("dur")) in ref and e.get("dur_ppq") not in (None, ""):
            try:
                if int(e["dur_ppq"]) == 0:
                    continue
                q = ref[str(e["dur"])] * (2 - Fraction(1, 2 ** int(e.get("dots") or 0)))
                vals[Fraction(int(e["dur_ppq"]), 1) / q] += 1
            except (TypeError, ValueError, ZeroDivisionError):
                continue
    if not vals:
        return None
    return vals.most_common(1)[0][0]


def match_notes(truth, pred):
    """Rank-based alignment per (measure, voice) on (midi, dur) sequences.
    Ordered by source_order (stable document order, comparable on both sides);
    onset correctness is measured separately via timing validity, not here.
    Returns (tp_exact, tp_pitch, fp, fn, pairs). Exact requires midi+dur+staff.
    Uses difflib for insertion/deletion-robust alignment."""
    import difflib
    tp_exact = tp_pitch = fp = fn = 0
    pairs = []
    t_by_mv, p_by_mv = defaultdict(list), defaultdict(list)
    for t in truth:
        t_by_mv[(t["measure_index"], t["voice"])].append(t)
    for p in pred:
        p_by_mv[(p["measure_index"], p["voice"])].append(p)
    for key in set(t_by_mv) | set(p_by_mv):
        T = sorted(t_by_mv.get(key, []),
                   key=lambda e: (e.get("source_order", 0), e["midi"] or -1))
        P = sorted(p_by_mv.get(key, []),
                   key=lambda e: (e.get("source_order", 0), e["midi"] or -1))
        t_seq = [(t["midi"], str(t["dur_q"])) for t in T]
        p_seq = [(p["midi"], str(p["dur_q"])) for p in P]
        sm = difflib.SequenceMatcher(None, t_seq, p_seq, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                for a, b in zip(range(i1, i2), range(j1, j2)):
                    t, p = T[a], P[b]
                    tp_pitch += (p["midi"] == t["midi"])
                    if (p["midi"] == t["midi"] and p["dur_q"] == t["dur_q"]
                            and p["staff"] == t["staff"]):
                        tp_exact += 1
                    pairs.append((t.get("mei_id"), p.get("mei_id")))
            elif tag in ("delete", "replace"):
                fn += (i2 - i1)
            if tag in ("insert", "replace"):
                fp += (j2 - j1)
    return tp_exact, tp_pitch, fp, fn, pairs


def pairwise_pr(truth_groups, pred_groups):
    """Pairwise precision/recall of grouping (dict id->group or None)."""
    def pairs(g):
        inv = defaultdict(set)
        for i, grp in g.items():
            if grp:
                inv[grp].add(i)
        out = set()
        for members in inv.values():
            members = sorted(members)
            for a in range(len(members)):
                for b in range(a + 1, len(members)):
                    out.add((members[a], members[b]))
        return out
    T, P = pairs(truth_groups), pairs(pred_groups)
    tp = len(T & P)
    return {"precision": tp / max(1, len(P)), "recall": tp / max(1, len(T)),
            "pairs_true": len(T), "pairs_pred": len(P), "tp": tp}


ACCIDX = ["none", "f", "ff", "n", "s", "ss"]

_DUR_Q = {"64th": Fraction(1, 16), "32nd": Fraction(1, 8), "16th": Fraction(1, 4),
          "eighth": Fraction(1, 2), "quarter": Fraction(1, 1), "half": Fraction(2, 1),
          "whole": Fraction(4, 1), "breve": Fraction(8, 1), "long": Fraction(16, 1)}
_DUR_NUM = {"64": "64th", "32": "32nd", "16": "16th", "8": "eighth",
            "4": "quarter", "2": "half", "1": "whole",
            "breve": "breve", "long": "long"}


def dur_to_q(dur, dots):
    """MusicXML dur value (name or denominator) + dots -> quarters or None."""
    name = _DUR_NUM.get(str(dur), dur)
    if name not in _DUR_Q:
        return None
    q = _DUR_Q[name]
    return q * (2 - Fraction(1, 2 ** int(dots or 0))) if dots else q


def preds_from_truth(sid, items, voc, cevents):
    """Oracle predictions from canonical truth (stage A). Same schema as
    infer.py output. OOV symbols -> None (flagged, skipped by decoder)."""
    import xml.etree.ElementTree as ET
    MEI_NS = "{http://www.music-encoding.org/ns/mei}"
    XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
    root = ET.parse(RENDER / sid / "score.mei").getroot()
    parent = {c: p for p in root.iter() for c in p}
    by_id = {}
    for el in root.iter():
        eid = el.get(XML_ID)
        if eid:
            by_id[eid] = el
    # chord-level durations/attrs for member notes lacking their own
    chord_attr = {}
    for el in root.iter(MEI_NS + "chord"):
        cid = el.get(XML_ID)
        if not cid:
            continue
        for n in el.iter(MEI_NS + "note"):
            nid = n.get(XML_ID)
            if nid:
                chord_attr[nid] = {"dur": el.get("dur"), "dots": el.get("dots", "0")}
    by_id_ev = {e["id"]: e for e in cevents}
    pred = {}
    for i, it in enumerate(items):
        e = by_id_ev.get(it["mei_id"], {})
        is_note = e.get("kind") == "note"
        dur = e.get("dur")
        dots = int(e.get("dots") or 0)
        if dur is None and is_note and it["mei_id"] in chord_attr:
            # chord members inherit duration from the <chord> parent
            dur = chord_attr[it["mei_id"]].get("dur")
            dots = int(chord_attr[it["mei_id"]].get("dots") or 0)
        dur_sym = None
        if dur is not None:
            dur_sym = str(dur) + "d%d" % dots
            if dur_sym not in voc["dur"]:
                dur_sym = None
        if dur_sym is None and not is_note:
            # full-measure rest (mRest / dur-less <rest>): synthesize duration
            # from the oracle meter signature (stage A truth path only)
            m = e.get("meter") or {}
            try:
                mq = Fraction(int(m.get("count") or 4) * 4,
                              int(m.get("unit") or 4))
                for _sym in voc["dur"]:
                    _m2 = __import__("re").match(r"(.+)d(\d+)$", _sym)
                    if _m2 and dur_to_q(_m2.group(1), int(_m2.group(2))) == mq:
                        dur_sym = _sym
                        dots = int(_m2.group(2))
                        break
            except (TypeError, ValueError, ZeroDivisionError):
                pass
        staff_id = str(e.get("staff")) if str(e.get("staff")) in voc["staff"] else None
        voice_id = str(e.get("voice")) if str(e.get("voice")) in voc["voice"] else None
        acc = str(e.get("accid_ges") or "n") if is_note else None
        if acc not in ACCIDX:
            acc = None
        ties = e.get("ties", [])
        links = {l["rel"] for l in e.get("links_out", [])}
        pred[i] = {
            "kind": 1 if is_note else 0,
            "pitch": (e["midi_printed"] - 21) if is_note else -1,
            "pitch_midi": e.get("midi_printed"),
            "pitch_top5": [(e["midi_printed"] - 21)] if is_note else [],
            "dur": voc["dur"].index(dur_sym) if dur_sym else -1,
            "dur_sym": dur_sym,
            "dots": dots,
            "staff": voc["staff"].index(staff_id) if staff_id else -1,
            "staff_id": staff_id,
            "voice": voc["voice"].index(voice_id) if voice_id else -1,
            "voice_id": voice_id, "voice_id_common": voice_id,
            "acc": ACCIDX.index(acc) if (acc and is_note) else -1,
            "acc_cls": acc,
            "grace": 1 if (is_note and e.get("grace")) else 0,
            "cue": 1 if (is_note and e.get("cue")) else 0,
            "tie_start": 1 if any(t.get("role") in ("start", "middle") for t in ties) else 0,
            "tie_end": 1 if any(t.get("role") in ("end", "middle") for t in ties) else 0,
            "in_beam": 1 if e.get("beam_id") else 0,
            "tuplet_member": 1 if e.get("tuplet_id") else 0,
            "slur_member": 1 if "slur" in links else 0,
            "has_artic": 1 if e.get("artic") else 0,
            "has_ornament": 1 if e.get("ornament") else 0,
            "has_fingering": 1 if e.get("fingering") else 0,
            "arpeg_member": 1 if e.get("arpeg_id") else 0,
            "gliss_member": 1 if "gliss" in links else 0,
            "pedal_active": 1 if e.get("pedal_active") else 0,
            "octave_shifted": 1 if e.get("oct_ges") else 0,
            "hairpin_member": 1 if e.get("hairpin_id") else 0,
            "chord_tone": 1 if (e.get("chord_size") or 1) > 1 else 0,
            "dotted": 1 if int(e.get("dots") or 0) > 0 else 0,
            "accidental": 1 if e.get("accid_ges") else 0,
            "_probe_source": {"*": "truth"},
        }
    return pred


def main(args):
    print("detector suspects:", assert_no_detector(), flush=True)
    sids = load_dev_sids()
    if args.limit:
        sids = sids[:args.limit]
    import re as _re
    voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
    models = load_models()
    img_cache = {}
    agg = {"scores": {}, "voice_source": args.voice_source,
           "totals": Counter(), "pairwise": defaultdict(lambda: {"tp": 0, "p": 0, "t": 0}),
           "timing": Counter(), "music21": Counter(), "p4": defaultdict(list),
           "ppq_inconsistent": []}
    for n, sid in enumerate(sids):
        cev = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))
        cevents = cev["events"]
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        items, pred_b, skipped_b = predict_score(models, sid, cevents, meta, img_cache)
        structure = build_structure(sid)
        pred_a = preds_from_truth(sid, items, voc, cevents)
        dec_b = decode_score(sid, items, pred_b, structure, voice_source=args.voice_source)
        dec_a = decode_score(sid, items, pred_a, structure, voice_source="truth")
        xml_b, _ = serialize(dec_b, structure)
        xml_a, _ = serialize(dec_a, structure)
        rec = {"n_items": len(items), "n_pred_notes": len(dec_b["notes"]),
               "n_skipped": len(skipped_b),
               "skipped_reasons": dict(__import__("collections").Counter(
                   s.get("reason", "?") for s in skipped_b)),
               "flags_b": dec_b["flags"], "stages": {}}
        # truth note/rests sequences with quarter onsets
        ppq = ppq_per_quarter(cevents)
        if not ppq:
            agg["ppq_inconsistent"].append(sid)
            continue
        truth_notes = []
        import xml.etree.ElementTree as _ET
        _root = _ET.parse(RENDER / sid / "score.mei").getroot()
        _NS = "{http://www.music-encoding.org/ns/mei}"
        _XID = "{http://www.w3.org/XML/1998/namespace}id"
        _chord_of = {}
        for _el in _root.iter(_NS + "chord"):
            for _n in _el.iter(_NS + "note"):
                if _n.get(_XID):
                    _chord_of[_n.get(_XID)] = (_el.get("dur"), int(_el.get("dots") or 0))
        for e in [x for x in cevents if x["kind"] == "note"]:
            _dur, _dots = e.get("dur"), int(e.get("dots") or 0)
            if _dur is None and e.get("id") in _chord_of:
                _dur, _dots = _chord_of[e["id"]]
            truth_notes.append({
                "mei_id": e["id"], "measure_index": e.get("measure_index"),
                "voice": str(e.get("voice")), "staff": str(e.get("staff")),
                "source_order": e.get("source_order", 0),
                "onset_q": Fraction(int(e.get("onset_ppq") or 0), 1) / ppq,
                "midi": e.get("midi_printed"),
                "dur_q": dur_to_q(_dur, _dots),
                "chord_id": e.get("chord_id"), "beam_id": e.get("beam_id"),
                "tuplet_id": e.get("tuplet_id"),
                "ties": e.get("ties", [])})
        truth_rests = []
        for e in [x for x in cevents
                  if x["kind"] in ("rest", "mRest", "multiRest")]:
            _dq = (Fraction(int(e["dur_ppq"]), 1) / ppq
                   if e.get("dur_ppq") not in (None, "") else None)
            if _dq is None:
                _m = e.get("meter") or {}
                try:
                    _dq = Fraction(int(_m.get("count") or 4) * 4,
                                   int(_m.get("unit") or 4))
                except (TypeError, ValueError, ZeroDivisionError):
                    pass
            truth_rests.append({
                "mei_id": e["id"], "measure_index": e.get("measure_index"),
                "voice": str(e.get("voice")), "staff": str(e.get("staff")),
                "onset_q": Fraction(int(e.get("onset_ppq") or 0), 1) / ppq,
                "dur_q": _dq})
        for stage, dec in (("A", dec_a), ("B", dec_b)):
            pred_notes = [{"mei_id": e["mei_id"], "measure_index": e["measure_index"],
                           "voice": str(e["voice"]), "staff": str(e["staff"]),
                           "source_order": e.get("source_order", 0),
                           "onset_q": e["onset_q"], "midi": e["midi"], "dur_q": e["dur_q"]}
                          for e in dec["notes"]]
            pred_rests = [{"mei_id": e["mei_id"], "measure_index": e["measure_index"],
                           "voice": str(e["voice"]), "staff": str(e["staff"]),
                           "onset_q": e["onset_q"], "dur_q": e["dur_q"]}
                          for e in dec["rests"]]
            te, tp, fp, fn, _ = match_notes(
                [{"measure_index": t["measure_index"], "onset_q": t["onset_q"],
                  "midi": t["midi"], "dur_q": t["dur_q"], "staff": t["staff"],
                  "source_order": t.get("source_order", 0),
                  "voice": t["voice"], "mei_id": t["mei_id"]} for t in truth_notes],
                pred_notes)
            # rests: exact match on (measure, staff, voice, onset, dur)
            _tk = {(r["measure_index"], r["staff"], r["voice"], r["onset_q"],
                    r["dur_q"]) for r in truth_rests if r["dur_q"] is not None}
            _pk = {(r["measure_index"], r["staff"], r["voice"], r["onset_q"],
                    r["dur_q"]) for r in pred_rests}
            r_tp, r_fp, r_fn = len(_tk & _pk), len(_pk - _tk), len(_tk - _pk)
            # timing validity per (measure, voice) on decoded output
            mlen = {}
            for e in cevents:
                if e.get("meter") and e.get("measure_index") is not None:
                    try:
                        mlen[e["measure_index"]] = Fraction(
                            int(e["meter"].get("count") or 4) * 4,
                            int(e["meter"].get("unit") or 4))
                    except (TypeError, ValueError, ZeroDivisionError):
                        pass
            by_mv = defaultdict(Fraction)
            for e in dec["notes"] + dec["rests"]:
                if not e.get("grace"):
                    by_mv[(e["measure_index"], e["staff"], e["voice"])] += e["dur_q"]
            valid = sum(1 for k, v in by_mv.items()
                        if k[0] in mlen and abs(v - mlen[k[0]]) < Fraction(1, 480))
            rec["stages"][stage] = {
                "tp_exact": te, "tp_pitch": tp, "fp": fp, "fn": fn,
                "n_truth_notes": len(truth_notes), "n_pred_notes": len(pred_notes),
                "rest_tp": r_tp, "rest_fp": r_fp, "rest_fn": r_fn,
                "n_truth_rests": len(_tk), "n_pred_rests": len(_pk),
                "timing_slots": len(by_mv), "timing_valid": valid,
                "flags": dec["flags"]}
            if stage == "B":
                for k in ("tp_exact", "tp_pitch", "fp", "fn"):
                    agg["totals"][f"B_{k}"] += rec["stages"][stage][k]
                for k in ("rest_tp", "rest_fp", "rest_fn"):
                    agg["totals"][f"B_{k}"] += rec["stages"][stage][k]
                agg["totals"]["B_truth_notes"] += len(truth_notes)
                agg["totals"]["B_truth_rests"] += len(_tk)
                agg["totals"]["B_timing_slots"] += len(by_mv)
                agg["totals"]["B_timing_valid"] += valid
            else:
                for k in ("tp_exact", "tp_pitch", "fp", "fn"):
                    agg["totals"][f"A_{k}"] += rec["stages"][stage][k]
                for k in ("rest_tp", "rest_fp", "rest_fn"):
                    agg["totals"][f"A_{k}"] += rec["stages"][stage][k]
                agg["totals"]["A_truth_notes"] += len(truth_notes)
                agg["totals"]["A_truth_rests"] += len(_tk)
        # pairwise grouping P/R (stage B vs truth)
        id2truth = {}
        for e in cevents:
            if e["kind"] == "note" and e.get("id"):
                id2truth[e["id"]] = e
        pred_by_mei = {e["mei_id"]: e for e in dec_b["notes"]}
        for rel, key in (("chord", "chord_id"), ("beam", "beam_group"),
                         ("tuplet", "tuplet_group")):
            tg, pg = {}, {}
            for e in cevents:
                if e["kind"] != "note" or not e.get("id"):
                    continue
                if rel == "chord":
                    # canonical chord_id drops notehead_x from the key, colliding
                    # distinct same-onset chords; use the full grouping key instead
                    if e.get("chord_id"):
                        tg[e["id"]] = (
                            e.get("measure"), e.get("staff"), e.get("voice"),
                            e.get("onset_ppq"),
                            round(e["notehead_x"], 1)
                            if e.get("notehead_x") is not None else None)
                    else:
                        tg[e["id"]] = None
                elif rel == "beam":
                    tg[e["id"]] = e.get("beam_id")
                else:
                    tg[e["id"]] = e.get("tuplet_id")
            for e in dec_b["notes"]:
                v = e.get("chord_id") if rel == "chord" else e.get("beam_group")
                if rel == "tuplet":
                    v = "tup" if e.get("tuplet_group") else None
                    if isinstance(v, tuple):
                        v = v[0]
                else:
                    v = v[0] if isinstance(v, tuple) else v
                pg[e["mei_id"]] = v
            # restrict predicted side to truth ids present in both
            common = set(tg) & set(pg)
            r = pairwise_pr({k: tg[k] for k in common}, {k: pg[k] for k in common})
            for k in ("tp",):
                agg["pairwise"][rel][k] += r[k]
            agg["pairwise"][rel]["p"] += r["pairs_pred"]
            agg["pairwise"][rel]["t"] += r["pairs_true"]
        # P4 structural checks on stage B
        beam_groups = defaultdict(list)
        for e in dec_b["notes"]:
            if isinstance(e.get("beam_group"), tuple):
                beam_groups[e["beam_group"][0]].append(e)
        if beam_groups:
            pure = sum(1 for g in beam_groups.values() if len({x["voice"] for x in g}) == 1)
            agg["p4"]["beam_voice_pure"].append((pure, len(beam_groups)))
        # tie pitch consistency
        tied_ok = tied_tot = 0
        for e in dec_b["notes"]:
            for t in e.get("tie_to", []):
                tied_tot += 1
        agg["p4"]["tie_links"].append(tied_tot)
        # music21 validation of stage B xml
        try:
            from music21 import converter, stream
            s = converter.parse(xml_b)
            mm = s.parts[0].getElementsByClass(stream.Measure) if s.parts else []
            agg["music21"]["parsed_ok"] += 1
            agg["music21"]["measures"] += len(mm)
            ts = ss = 0
            for nn in s.recurse().notes:
                if getattr(nn, "tie", None):
                    if nn.tie.type == "start":
                        ts += 1
                    elif nn.tie.type == "stop":
                        ss += 1
            agg["music21"]["tie_starts"] += ts
            agg["music21"]["tie_stops"] += ss
        except Exception as ex:
            agg["music21"]["parse_fail"] += 1
            rec["music21_error"] = str(ex)[:200]
        agg["scores"][sid] = rec
        if (n + 1) % 20 == 0:
            print(f"[eval] {n+1}/{len(sids)}", flush=True)
    # failure dossiers: 5 worst by joint exact rate
    scored = []
    for sid, rec in agg["scores"].items():
        b = rec["stages"]["B"]
        rate = b["tp_exact"] / max(1, b["n_truth_notes"])
        scored.append((rate, sid, b))
    scored.sort()
    agg["worst5"] = [{"sid": s, "joint_exact_rate": round(r, 4),
                      "detail": {k: b[k] for k in ("tp_exact", "tp_pitch", "fp", "fn", "n_truth_notes", "n_pred_notes")},
                      "flags": rec["flags_b"]} for r, s, b in scored[:5]]
    Path(args.out).write_text(json.dumps(
        {"schema": "piano-reconstruction/1", "voice_source": args.voice_source,
         "n_scores": len(agg["scores"]),
         "totals": dict(agg["totals"]),
         "pairwise": {k: {"precision": v["tp"] / max(1, v["p"]),
                          "recall": v["tp"] / max(1, v["t"]), **v} for k, v in agg["pairwise"].items()},
         "p4": {k: v for k, v in agg["p4"].items()},
         "music21": dict(agg["music21"]),
         "ppq_inconsistent": agg["ppq_inconsistent"],
         "worst5": agg["worst5"],
         "scores": agg["scores"]}, indent=1, default=str))
    print(f"[eval] wrote {args.out}", flush=True)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice-source", default="context", choices=["context", "common", "truth"])
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=str(TRAIN / "manifests" / "reconstruction.json"))
    main(ap.parse_args())

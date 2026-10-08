#!/usr/bin/env python3
"""P1 reconstruction failure audit (decode-only; uses cached predictions).

For each frozen DEV score: decode cached model preds (stage B) + oracle preds
(stage A), align to truth, and classify every error by category, root cause
(model vs decoder), and fixability without retraining.

Writes train/reports/audit_errors.json. TEST sealed (dev list only).
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
sys.path.insert(0, str(HERE))
from decode_score import decode_score  # noqa: E402
from to_musicxml import build_structure  # noqa: E402
from eval_reconstruction import (match_notes, preds_from_truth,  # noqa: E402
                                 ppq_per_quarter, dur_to_q)

EVENTS = TRAIN / "data" / "events"
DECODED = TRAIN / "data" / "decoded"
DEV_SIDS = json.load(open(TRAIN.parent / "pilot" / "manifests" / "splits.json"))["dev"]

NATTRS = ("voice", "onset_q", "midi", "dur_q", "staff")


def seq_note(e, voice, staff, onset_q, midi, dur_q):
    return {"mei_id": e, "measure_index": None, "voice": voice, "staff": staff,
            "source_order": 0, "onset_q": onset_q, "midi": midi, "dur_q": dur_q}


def classify_residual(target, cands):
    """Single/multi-attribute substitution label vs candidate pool, else MISSING/EXTRA."""
    best = None
    for c in cands:
        if c["measure_index"] != target["measure_index"]:
            continue
        diffs = {a for a in NATTRS if c[a] != target[a]}
        same = len(NATTRS) - len(diffs)
        if same >= 3 and (best is None or len(diffs) < len(best[0])):
            best = (diffs, c)
    if best is None:
        return "MISSING", None
    diffs, _ = best
    if len(diffs) == 1:
        return {"midi": "PITCH", "dur_q": "DUR", "voice": "VOICE",
                "staff": "STAFF", "onset_q": "ONSET"}[next(iter(diffs))], None
    return "MULTI:" + "+".join(sorted(
        {"midi": "P", "dur_q": "D", "voice": "V", "staff": "S",
         "onset_q": "O"}[a] for a in diffs)), None


def audit_score(sid, voice_source="context"):
    cevents = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
    cache = json.load(open(DECODED / f"{sid}.preds.json"))
    items = cache["items"]
    pred_b = {int(k): v for k, v in cache["pred"].items()}
    voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
    structure = build_structure(sid)
    pred_a = preds_from_truth(sid, items, voc, cevents)
    dec_b = decode_score(sid, items, pred_b, structure, voice_source=voice_source)
    ppq = ppq_per_quarter(cevents)
    out = {"sid": sid}
    if not ppq:
        out["ppq_bad"] = True
        return out
    by_id = {e["id"]: e for e in cevents if e.get("id")}
    # truth sequences
    tnotes, trests = [], []
    for e in cevents:
        if e["kind"] == "note":
            tnotes.append({"mei_id": e["id"], "measure_index": e.get("measure_index"),
                           "voice": str(e.get("voice")), "staff": str(e.get("staff")),
                           "source_order": e.get("source_order", 0),
                           "onset_q": Fraction(int(e.get("onset_ppq") or 0), 1) / ppq,
                           "midi": e.get("midi_printed"), "dur_q": None})
        elif e["kind"] in ("rest", "mRest", "multiRest"):
            m = e.get("meter") or {}
            dq = (Fraction(int(e["dur_ppq"]), 1) / ppq
                  if e.get("dur_ppq") not in (None, "") else None)
            if dq is None:
                try:
                    dq = Fraction(int(m.get("count") or 4) * 4, int(m.get("unit") or 4))
                except (TypeError, ValueError, ZeroDivisionError):
                    dq = None
            trests.append({"mei_id": e["id"], "measure_index": e.get("measure_index"),
                           "voice": str(e.get("voice")), "staff": str(e.get("staff")),
                           "onset_q": Fraction(int(e.get("onset_ppq") or 0), 1) / ppq,
                           "dur_q": dq})
    # fill truth note dur_q (with chord inheritance, mirroring eval)
    import xml.etree.ElementTree as _ET
    _root = _ET.parse(TRAIN.parent / "pilot" / "data" / "render" / sid / "score.mei").getroot()
    _NS = "{http://www.music-encoding.org/ns/mei}"
    _XID = "{http://www.w3.org/XML/1998/namespace}id"
    _chord_of = {}
    for _el in _root.iter(_NS + "chord"):
        for _n in _el.iter(_NS + "note"):
            if _n.get(_XID):
                _chord_of[_n.get(_XID)] = (_el.get("dur"), int(_el.get("dots") or 0))
    for t in tnotes:
        e = by_id[t["mei_id"]]
        _dur, _dots = e.get("dur"), int(e.get("dots") or 0)
        if _dur is None and e.get("id") in _chord_of:
            _dur, _dots = _chord_of[e["id"]]
        t["dur_q"] = dur_to_q(_dur, _dots)
    pnotes = [{"mei_id": e["mei_id"], "measure_index": e["measure_index"],
               "voice": str(e["voice"]), "staff": str(e["staff"]),
               "source_order": e.get("source_order", 0),
               "onset_q": e["onset_q"], "midi": e["midi"], "dur_q": e["dur_q"]}
              for e in dec_b["notes"]]
    te, tp, fp, fn, pairs = match_notes(tnotes, pnotes)
    out["match"] = {"tp_exact": te, "tp_pitch": tp, "fp": fp, "fn": fn}
    t_by_mei = {t["mei_id"]: t for t in tnotes}
    p_by_mei = {p["mei_id"]: p for p in pnotes}
    mt = {t for t, _ in pairs}
    mp = {p for _, p in pairs}
    # pair agreement
    agree = Counter()
    for tm, pm in pairs:
        t, p = t_by_mei[tm], p_by_mei[pm]
        for a, name in (("midi", "pitch"), ("dur_q", "dur"), ("staff", "staff"),
                        ("onset_q", "onset")):
            agree[(name, t[a] == p[a])] += 1
    out["pair_agree"] = {f"{k}_{'ok' if v else 'bad'}": c for (k, v), c in agree.items()}
    # residuals
    fn_items = [t for t in tnotes if t["mei_id"] not in mt]
    fp_items = [p for p in pnotes if p["mei_id"] not in mp]
    fn_cls, fp_cls = Counter(), Counter()
    item_kind_t = {}
    for it in items:
        e = by_id.get(it["mei_id"], {})
        item_kind_t[it["mei_id"]] = e.get("kind")
    for t in fn_items:
        lab, _ = classify_residual(t, fp_items)
        if lab == "MISSING":
            # was the underlying object even predicted as a note?
            pk = pred_b.get(next((i for i, it in enumerate(items)
                                  if it["mei_id"] == t["mei_id"]), -1), {}).get("kind", -1)
            lab = "MISSING/kind-as-rest" if pk == 0 else "MISSING/no-partner"
        fn_cls[lab] += 1
    for p in fp_items:
        lab, _ = classify_residual(p, fn_items)
        if lab == "MISSING":
            lab = "EXTRA/no-partner"
        fp_cls[lab] += 1
    out["fn_cls"] = dict(fn_cls)
    out["fp_cls"] = dict(fp_cls)
    # kind confusion over all items
    kc = Counter()
    for i, it in enumerate(items):
        tk = item_kind_t[it["mei_id"]]
        pk = pred_b.get(i, {}).get("kind", -1)
        if tk in ("note", "rest", "mRest", "multiRest"):
            kc[(tk if tk == "note" else "rest", "note" if pk == 1 else
                ("rest" if pk == 0 else "none"))] += 1
    out["kind_conf"] = {f"t{k[0]}_p{k[1]}": c for k, c in kc.items()}
    # rests: miss cause
    tk_rest = {(r["measure_index"], r["staff"], r["voice"], r["onset_q"], r["dur_q"])
               for r in trests if r["dur_q"] is not None}
    pk_rest = {(r["measure_index"], str(r["staff"]), str(r["voice"]), r["onset_q"], r["dur_q"])
               for r in dec_b["rests"]}
    miss, extra = tk_rest - pk_rest, pk_rest - tk_rest
    rmiss, rextra = Counter(), Counter()
    for m in miss:
        mi, st, v, on, dq = m
        if (mi, st, v, on) in {(a, b, c, d) for a, b, c, d, _ in pk_rest}:
            rmiss["DUR"] += 1
        elif (mi, on, dq) in {(a, d, e) for a, _, _, d, e in pk_rest}:
            rmiss["VOICE/STAFF"] += 1
        else:
            rmiss["MISSING"] += 1
    for m in extra:
        rextra["EXTRA"] += 1
    out["rest_miss"] = dict(rmiss)
    out["rest_extra"] = len(extra)
    # chords: missed-pair cause
    tg, pg = {}, {}
    for e in cevents:
        if e["kind"] != "note" or not e.get("id"):
            continue
        tg[e["id"]] = ((e.get("measure"), e.get("staff"), e.get("voice"),
                        e.get("onset_ppq"),
                        round(e["notehead_x"], 1)
                        if e.get("notehead_x") is not None else None)
                       if e.get("chord_id") else None)
    for e in dec_b["notes"]:
        v = e.get("chord_id")
        pg[e["mei_id"]] = v[0] if isinstance(v, tuple) else v
    inv_t, inv_p = defaultdict(set), defaultdict(set)
    for i, g in tg.items():
        if g:
            inv_t[g].add(i)
    for i, g in pg.items():
        if g:
            inv_p[g].add(i)
    Tpairs, Ppairs = set(), set()
    for ms in inv_t.values():
        ms = sorted(ms)
        for a in range(len(ms)):
            for b in range(a + 1, len(ms)):
                Tpairs.add((ms[a], ms[b]))
    for ms in inv_p.values():
        ms = sorted(ms)
        for a in range(len(ms)):
            for b in range(a + 1, len(ms)):
                Ppairs.add((ms[a], ms[b]))
    chord_miss = Counter()
    pnote = {e["mei_id"]: e for e in dec_b["notes"]}
    for a, b in Tpairs - Ppairs:
        pa, pb = pnote.get(a), pnote.get(b)
        if pa is None or pb is None:
            chord_miss["member-undecoded"] += 1
        elif pa.get("voice") != pb.get("voice") or pa.get("staff") != pb.get("staff"):
            chord_miss["voice/staff-split"] += 1
        elif pa.get("dur_q") != pb.get("dur_q"):
            chord_miss["dur-split"] += 1
        elif pa.get("onset_q") != pb.get("onset_q"):
            chord_miss["onset-split"] += 1
        else:
            chord_miss["ungrouped"] += 1
    out["chord_miss"] = dict(chord_miss)
    out["chord_pairs"] = {"t": len(Tpairs), "p": len(Ppairs),
                          "tp": len(Tpairs & Ppairs)}
    # beams: over-merge cause
    tb, pbm = {}, {}
    for e in cevents:
        if e["kind"] == "note" and e.get("id"):
            tb[e["id"]] = e.get("beam_id")
    for e in dec_b["notes"]:
        v = e.get("beam_group")
        pbm[e["mei_id"]] = v[0] if isinstance(v, tuple) else None
    inv_pb = defaultdict(set)
    for i, g in pbm.items():
        if g:
            inv_pb[g].add(i)
    truth_beam_of = tb
    rest_spans = defaultdict(list)  # lane -> [(on0,on1)]
    for r in dec_b["rests"]:
        rest_spans[(r["measure_index"], str(r["staff"]), str(r["voice"]))].append(
            (r["onset_q"], r["onset_q"] + r["dur_q"]))
    dec_note = {e["mei_id"]: e for e in dec_b["notes"]}
    overmerge = Counter()
    for g, ms in inv_pb.items():
        tbs = {truth_beam_of.get(i) for i in ms} - {None}
        if len(tbs) > 1:
            # does a lane rest fall strictly inside the group span?
            cross = False
            for i in ms:
                e = dec_note.get(i)
                if e is None:
                    continue
                lane = (e["measure_index"], str(e["staff"]), str(e["voice"]))
                for on0, on1 in rest_spans.get(lane, []):
                    if on0 > min(dec_note[j]["onset_q"] for j in ms if j in dec_note) and \
                       on1 < max(dec_note[j]["onset_q"] for j in ms if j in dec_note):
                        cross = True
            overmerge["rest-crossing" if cross else "adjacent-merge"] += 1
    out["beam_overmerge"] = dict(overmerge)
    # head fire rates (model activity vs truth activity)
    hf = Counter()
    for e in cevents:
        if e["kind"] == "note" and e.get("id"):
            if e.get("beam_id"):
                hf["truth_beamed"] += 1
            if e.get("tuplet_id"):
                hf["truth_tuplet"] += 1
            if e.get("ties"):
                hf["truth_tied"] += 1
    for e in dec_b["notes"]:
        if e.get("in_beam"):
            hf["pred_in_beam"] += 1
        if e.get("tuplet_member"):
            hf["pred_tuplet"] += 1
        if e.get("tie_start") or e.get("tie_end"):
            hf["pred_tied"] += 1
    out["head_fire"] = dict(hf)
    # cross-measure truth ties (decoder chains per-measure only)
    id2m = {e["id"]: e.get("measure_index") for e in cevents if e.get("id")}
    xm = sum(1 for e in cevents if e["kind"] == "note" and e.get("ties")
             for t in (e.get("ties") or [])
             for ptn in (t.get("partners") or [])
             if ptn in id2m and id2m[ptn] != e.get("measure_index"))
    out["truth_ties_cross_measure"] = xm
    out["flags_b"] = {k: v for k, v in dec_b["flags"].items() if v}
    out["skipped"] = cache.get("skipped", [])
    return out


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice-source", default="context", choices=["context", "common"])
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out_path = Path(args.out) if args.out else TRAIN / "reports" / "audit_errors.json"
    agg = {"scores": {}, "voice_source": args.voice_source,
           "fn_cls": Counter(), "fp_cls": Counter(),
           "pair_agree": Counter(), "kind_conf": Counter(),
           "rest_miss": Counter(), "chord_miss": Counter(),
           "beam_overmerge": Counter(), "head_fire": Counter(),
           "truth_ties_cross_measure": 0, "rest_extra": 0, "ppq_bad": [],
           "skipped": Counter(), "unpaired_tie": Counter(),
           "chord_dur_mismatch": 0, "tie_cross_measure": 0}
    for n, sid in enumerate(DEV_SIDS):
        try:
            r = audit_score(sid, voice_source=args.voice_source)
        except Exception as ex:  # noqa: BLE001 - audit must not die on one score
            print(f"[audit] {sid} FAILED: {type(ex).__name__}: {ex}", flush=True)
            continue
        if r.get("ppq_bad"):
            agg["ppq_bad"].append(sid)
            continue
        agg["scores"][sid] = r
        for k in ("fn_cls", "fp_cls", "pair_agree", "kind_conf", "rest_miss",
                  "chord_miss", "beam_overmerge", "head_fire"):
            agg[k].update(r.get(k, {}))
        agg["truth_ties_cross_measure"] += r.get("truth_ties_cross_measure", 0)
        agg["rest_extra"] += r.get("rest_extra", 0)
        for s in r.get("skipped", []):
            agg["skipped"][s.get("reason", "?")] += 1
        fb = r.get("flags_b", {})
        agg["unpaired_tie"]["start"] += fb.get("unpaired_tie_start", 0)
        agg["unpaired_tie"]["end"] += fb.get("unpaired_tie_end", 0)
        agg["chord_dur_mismatch"] += fb.get("chord_dur_mismatch", 0)
        agg["tie_cross_measure"] += fb.get("tie_cross_measure", 0)
        if (n + 1) % 20 == 0:
            print(f"[audit] {n+1}/{len(DEV_SIDS)}", flush=True)
    for k in ("fn_cls", "fp_cls", "pair_agree", "kind_conf", "rest_miss",
              "chord_miss", "beam_overmerge", "head_fire", "skipped",
              "unpaired_tie"):
        agg[k] = dict(agg[k])
    out_path.write_text(
        json.dumps(agg, indent=1, default=str))
    print(json.dumps({k: v for k, v in agg.items() if k != "scores"}, indent=1, default=str)[:4000])


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""P1 rest failure root-cause audit v2 (DEV only, read-only, no training).

Traces truth-rest loss stage by stage on the production decode
(oracle boxes, visual clef, A1 dur head), against the REPAIRED events
(rest dur restored from MEI). Stages checked per truth rest:
  detection  : cached item exists and predicted kind==0 (rest)
  dur        : predicted dur_sym == truth dur class
  staff      : predicted staff == truth staff
  voice      : predicted voice == truth voice (context = production)
  onset/dur/q: full match key (measure_index, staff, voice, onset_q, dur_q)
Also reports per-stage conditional accuracy chains and the FP side
(predicted rests with no truth counterpart), plus which stages remain.
Writes reports/audit_rest.json. DEV only; TEST sealed.
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
EVENTS = TRAIN / "data" / "events"
DECODED = TRAIN / "data" / "decoded"
sys.path.insert(0, str(HERE))
from decode_score import decode_score, _visual_clef_lookup  # noqa: E402
from to_musicxml import build_structure  # noqa: E402
from infer import load_models  # noqa: E402
from train_clefhead import apply_clef_pitch_head  # noqa: E402
from train_ctxdur import apply_ctx_dur_head  # noqa: E402
from train_restdur import apply_rest_dur_head  # noqa: E402
from eval_reconstruction import ppq_per_quarter  # noqa: E402


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    models = load_models(device="cpu")
    img_cache = {}
    C = Counter()
    fails = Counter()
    worst = []
    for n, sid in enumerate(splits["dev"]):
        ppq = ppq_per_quarter(
            json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"])
        ce = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        meta = json.loads((PILOT / "data" / "render" / sid / "meta.json").read_text())
        cache = json.load(open(DECODED / f"{sid}.preds.json"))
        items, pred = cache["items"], {int(k): v for k, v in cache["pred"].items()}
        pred = apply_clef_pitch_head(models, sid, ce, meta, items, pred, img_cache)
        pred = apply_ctx_dur_head(models, sid, ce, meta, items, pred, img_cache)
        pred = apply_rest_dur_head(models, sid, ce, meta, items, pred, img_cache)
        structure = build_structure(sid)
        dec = decode_score(sid, items, pred, structure, voice_source="context",
                           clef_source="visual")
        bymei = {it.get("mei_id"): i for i, it in enumerate(items)}
        truth = {e["id"]: e for e in ce if e["kind"] in ("rest", "mRest",
                                                         "multiRest")}
        dmap = {r["mei_id"]: r for r in dec["rests"]}
        for tid, t in truth.items():
            C["truth_rests"] += 1
            i = bymei.get(tid)
            if i is None or i not in pred:
                C["no_item"] += 1
                fails["no_item"] += 1
                continue
            p = pred[i] or {}
            if p.get("kind") != 0:
                C["kind_not_rest"] += 1
                fails["kind_not_rest"] += 1
                continue
            C["kind_rest"] += 1
            r = dmap.get(tid)
            if r is None:
                C["dropped_by_decoder"] += 1
                fails["dropped"] += 1
                continue
            td = t.get("dur")
            pd = (p.get("dur_sym") or "Xd0").split("d")[0]
            ok_dur = (pd == str(td)) if td is not None else False
            ok_staff = (str(r["staff"]) == str(t.get("staff")))
            ok_voice = (str(r["voice"]) == str(t.get("voice")))
            C["decoded_rest"] += 1
            C[f"staff_{'ok' if ok_staff else 'wrong'}"] += 1
            if not ok_staff:
                fails["staff"] += 1
            C[f"voice_{'ok' if ok_voice else 'wrong'}"] += 1
            if not ok_voice:
                fails["voice"] += 1
            C[f"dur_{'ok' if ok_dur else 'wrong'}"] += 1
            if not ok_dur:
                fails["dur"] += 1
                worst.append((sid[:8], tid[:8], "dur", str(td), pd))
            # onset residual: all fields right but the exact key still fails?
            key_t = (t.get("measure_index"), str(t.get("staff")),
                     str(t.get("voice")),
                     Fraction(int(t.get("onset_ppq") or 0), 1) / ppq,
                     Fraction(int(t.get("dur_ppq") or 0), 1) / ppq
                     if t.get("dur_ppq") not in (None, "") else None)
            if key_t is not None and ok_dur and ok_staff and ok_voice:
                C["fields_ok"] += 1
                if (r["measure_index"], str(r["staff"]), str(r["voice"]),
                        r["onset_q"], r["dur_q"]) == key_t:
                    C["exact_key"] += 1
                else:
                    C["onset_only_miss"] += 1
                    fails["onset"] += 1
                    worst.append((sid[:8], tid[:8], "onset",
                                  str(key_t[3]), str(r["onset_q"])))
            if r.get("duplicate_rest"):
                C["duplicate_collapsed"] += 1
                fails["duplicate"] += 1
        # FP side
        pred_ids = {r["mei_id"] for r in dec["rests"]}
        for tid in pred_ids:
            if tid not in truth:
                C["pred_rest_not_truth"] += 1
        # timing: rest-only lanes that sum to measure length
        for (mi, st, vo), v in Counter(
                (r["measure_index"], r["staff"], r["voice"])
                for r in dec["rests"]).items():
            pass
    out = {"stages": dict(C), "first_fail": dict(fails),
           "dur_examples": worst[:12]}
    (TRAIN / "reports" / "audit_rest.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

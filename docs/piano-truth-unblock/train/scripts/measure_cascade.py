#!/usr/bin/env python3
"""Duration->onset cascade measurement (DEV only, cached predictions).

Per (measure, voice) lane with equal truth/pred counts and complete truth
durations, rank-align by source order and classify lanes: clean /
single-dur-error (+onset consequences) / multi-dur / onset-error-despite-
correct-durs. Reports where onset errors live.
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
from eval_reconstruction import ppq_per_quarter  # noqa: E402

DEV_SIDS = json.loads((TRAIN.parent / "pilot" / "manifests" / "splits.json").read_text())["dev"]


def main():
    lane_cls = Counter()
    err_notes = Counter()
    for sid in DEV_SIDS:
        ce = json.load(gzip.open(TRAIN / "data" / "events" / f"{sid}.events.json.gz", "rt"))["events"]
        cache = json.load(open(TRAIN / "data" / "decoded" / f"{sid}.preds.json"))
        items = cache["items"]
        pred = {int(k): v for k, v in cache["pred"].items()}
        ppq = ppq_per_quarter(ce)
        if not ppq:
            continue
        dec = decode_score(sid, items, pred, build_structure(sid), voice_source="context")
        T, P = defaultdict(list), defaultdict(list)
        for e in ce:
            if e["kind"] == "note":
                T[(e.get("measure_index"), str(e.get("voice")))].append(e)
        for e in dec["notes"]:
            P[(e["measure_index"], str(e["voice"]))].append(e)
        for key in set(T) | set(P):
            t = sorted(T.get(key, []), key=lambda e: e.get("source_order", 0))
            p = sorted(P.get(key, []), key=lambda e: e.get("source_order", 0))
            if len(t) != len(p) or not t:
                lane_cls["count_mismatch"] += 1
                continue
            if any(e.get("dur_ppq") in (None, "") for e in t):
                lane_cls["truth_dur_incomplete"] += 1
                continue
            lane_cls["lanes_equal_complete"] += 1
            ndur = non = 0
            for te, pe in zip(t, p):
                if pe["dur_q"] != Fraction(int(te["dur_ppq"]), 1) / ppq:
                    ndur += 1
                if pe["onset_q"] != Fraction(int(te.get("onset_ppq") or 0), 1) / ppq:
                    non += 1
                    err_notes["onset_err"] += 1
            if ndur == 0 and non == 0:
                lane_cls["clean"] += 1
            elif ndur == 1:
                lane_cls["single_dur"] += 1
                err_notes["onset_err_in_single_dur_lane"] += non
            elif ndur > 1:
                lane_cls["multi_dur"] += 1
                err_notes["onset_err_in_multi_dur_lane"] += non
            else:
                lane_cls["onset_only"] += 1
                err_notes["onset_err_despite_clean_durs"] += non
    print({"lanes": dict(lane_cls), "err_notes": dict(err_notes)})


if __name__ == "__main__":
    main()

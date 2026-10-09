#!/usr/bin/env python3
"""Clef-shift hypothesis test (DEV only, cached predictions).

For every F-clef pitch error: is the prediction exactly the G-clef reading
of the same staff steps? Quantifies the clef-context failure precisely.
"""
from __future__ import annotations
import gzip
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
DEV_SIDS = json.loads((PILOT / "manifests" / "splits.json").read_text())["dev"]

STEP_IDX = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}


def step_index(pname, octv):
    return STEP_IDX[pname] + 7 * octv


def midi_of_steps(steps, ref_pname, ref_oct, ref_line=2):
    # staff steps Nx where N = steps above the bottom line of a clef whose
    # reference pitch sits `ref_line-1` steps above that line... invert:
    # bottom-line pitch = ref pitch - (ref_line-1)*2 steps
    base = step_index(ref_pname, ref_oct) - (ref_line - 1) * 2
    target = base + steps
    o, s = divmod(target, 7)
    names = ["C", "D", "E", "F", "G", "A", "B"]
    alter = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}[s]
    semis = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[names[s]]
    return 12 * (o + 1) + semis + alter


def main():
    f_diff = Counter()
    f_gmatch = f_other = 0
    c_diff = Counter()
    c_cmatch = c_other = 0
    chord_err_by_clef = Counter()
    for sid in DEV_SIDS:
        cevents = json.load(gzip.open(TRAIN / "data" / "events" / f"{sid}.events.json.gz", "rt"))["events"]
        cache = json.load(open(TRAIN / "data" / "decoded" / f"{sid}.preds.json"))
        by_id = {e["id"]: e for e in cevents if e.get("id")}
        for i, it in enumerate(cache["items"]):
            e = by_id.get(it["mei_id"])
            if e is None or e.get("kind") != "note":
                continue
            p = cache["pred"][str(i)]
            if p.get("kind") != 1:
                continue
            tm, pm = e.get("midi_printed"), p.get("pitch_midi")
            if tm is None or pm is None or pm == tm:
                continue
            cl = (e.get("clef") or {}).get("shape", "?")
            sp = e.get("staff_pos_steps")
            if cl == "F" and isinstance(sp, int):
                f_diff[pm - tm] += 1
                if pm == midi_of_steps(sp, "G", 4):
                    f_gmatch += 1
                else:
                    f_other += 1
            if cl == "C" and isinstance(sp, int):
                c_diff[pm - tm] += 1
                if pm == midi_of_steps(sp, "G", 4):
                    c_cmatch += 1
                else:
                    c_other += 1
    print("F-clef errors:", sum(f_diff.values()), "G-reading:", f_gmatch, "other:", f_other)
    print("F diff hist:", dict(sorted(f_diff.items())))
    print("C-clef errors:", sum(c_diff.values()), "G-reading:", c_cmatch, "other:", c_other)
    print("C diff hist:", dict(sorted(c_diff.items())))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Pitch failure root-cause analysis (DEV only, cached predictions, no inference).

Joins per-item predicted pitch with canonical truth + attributes to answer:
octave vs step vs chromatic errors; correlates with accidentals, chords,
staff position extremes, clef, register. TEST sealed (dev list only).
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


def main():
    tot = ok = 0
    mag = Counter()
    acc_err = Counter()      # error magnitude | semitone split by truth accidental?
    ctx = Counter()          # (condition, correct?)
    octave_sub = Counter()   # predicted pitch class within octave
    reg = Counter()
    chord = Counter()
    ledger = Counter()
    clef = Counter()
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
            tm = e.get("midi_printed")
            pm = p.get("pitch_midi")
            if tm is None or pm is None:
                continue
            tot += 1
            good = (pm == tm)
            ok += good
            d = pm - tm
            mag[d if abs(d) <= 24 else ("<-24" if d < 0 else ">24")] += 1
            has_acc = bool(e.get("accid_ges"))
            acc_err[(has_acc, good)] += 1
            cs = e.get("chord_size") or 1
            chord[(cs > 1, good)] += 1
            sp = e.get("staff_pos_steps")
            led = (abs(sp) > 8) if isinstance(sp, int) else None
            ledger[(led, good)] += 1
            cl = (e.get("clef") or {}).get("shape", "?")
            clef[(cl, good)] += 1
            o = e.get("oct")
            reg[(o, good)] += 1
            # within-octave pitch-class confusion for errors
            if not good and abs(d) < 12:
                octave_sub[(tm % 12, pm % 12)] += 1
    def rate(c, key):
        g = c.get((key, True), 0)
        b = c.get((key, False), 0)
        return round(g / max(1, g + b), 4), g + b
    out = {
        "n": tot, "acc": round(ok / max(1, tot), 4),
        "semitone_diff_hist": {str(k): v for k, v in sorted(mag.items(), key=str)},
        "acc_split": {"no_acc": rate(acc_err, False), "acc": rate(acc_err, True)},
        "chord_split": {"single": rate(chord, False), "chord_tone": rate(chord, True)},
        "ledger_split": {"normal": rate(ledger, False), "extreme": rate(ledger, True),
                         "unknown": rate(ledger, None)},
        "clef_split": {str(k): rate(clef, k) for k in {k for k, _ in clef}},
        "register_acc": {str(k): rate(reg, k) for k in sorted({k for k, _ in reg if k is not None}, key=str)},
        "top_in_octave_confusions": [[list(k), v] for k, v in octave_sub.most_common(15)],
    }
    Path(TRAIN / "reports" / "pitch_analysis.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1)[:3500])


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Score an OMR engine on the vendored CC0 benchmark fixtures.

Truth and prediction are both MusicXML; compare multiset events
(midi, quarter-length, dots) and rests. No SVG/reference is passed to the
engine; truth is used only here for scoring.
"""
from __future__ import annotations
import json
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
ROOT = HERE.parents[3]  # repo root
FIX = ROOT / "benchmarks" / "omr-fixtures"
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def xml_events(path):
    root = ET.parse(path).getroot()
    notes, rests = Counter(), Counter()
    divisions = 1
    for meas in root.iter("measure"):
        for att in meas.findall("attributes"):
            d = att.findtext("divisions")
            if d:
                divisions = max(1, int(d))
        for n in meas.iter("note"):
            if n.find("grace") is not None:
                continue
            dur = n.findtext("duration")
            if not dur:
                continue
            q = Fraction(int(dur), divisions)
            dots = len(n.findall("dot"))
            if n.find("rest") is not None:
                rests[(str(q), dots)] += 1
                continue
            p = n.find("pitch")
            if p is None:
                continue
            step = p.findtext("step")
            octv = int(p.findtext("octave") or 4)
            alter = int(p.findtext("alter") or 0)
            midi = 12 * (octv + 1) + STEP.get(step, 0) + alter
            notes[(midi, str(q), dots)] += 1
    return notes, rests


def mscores(t, p, key=lambda k: k):
    t = Counter({key(k): v for k, v in t.items()})
    p = Counter({key(k): v for k, v in p.items()})
    tp = sum(min(t[k], p[k]) for k in set(t) | set(p))
    return {"truth": sum(t.values()), "pred": sum(p.values()), "tp": tp,
            "fp": sum(p.values()) - tp, "fn": sum(t.values()) - tp,
            "precision": round(tp / max(1, sum(p.values())), 4),
            "recall": round(tp / max(1, sum(t.values())), 4)}


def measure_validity(path):
    root = ET.parse(path).getroot()
    div = 1
    total = bad = 0
    for m in root.iter("measure"):
        for a in m.findall("attributes"):
            d = a.findtext("divisions")
            if d:
                div = max(1, int(d))
        sums = {}
        for n in m.iter("note"):
            if n.find("grace") is not None:
                continue
            dur = n.findtext("duration")
            if not dur:
                continue
            v = n.findtext("voice") or "1"
            sums[v] = sums.get(v, 0) + int(dur)
        total += 1
        for s in sums.values():
            if s <= 0 or s > 8 * div:
                bad += 1
    return {"measures": total, "bad": bad}


def main():
    mapping = json.loads(Path(sys.argv[1]).read_text())  # {fixture: pred xml}
    res = {}
    for name, pred in mapping.items():
        tdir = FIX / name
        truth = next(tdir.glob("*.musicxml"), None)
        if truth is None or not Path(pred).is_file():
            res[name] = {"error": "missing truth or pred"}
            continue
        tn, tr = xml_events(truth)
        pn, pr = xml_events(pred)
        res[name] = {
            "truth_notes": sum(tn.values()), "pred_notes": sum(pn.values()),
            "complete": mscores(tn, pn),
            "pitch": mscores(tn, pn, key=lambda k: k[0]),
            "duration": mscores(tn, pn, key=lambda k: (k[1], k[2])),
            "rests": mscores(tr, pr),
            "measure_validity": measure_validity(pred),
        }
    (TRAIN / "reports" / "fixture_omr_compare.json").write_text(
        json.dumps(res, indent=1))
    agg = {k: Counter() for k in ("complete", "pitch", "duration", "rests")}
    for r in res.values():
        if "complete" not in r:
            continue
        for k in agg:
            for m in ("tp", "fp", "fn", "truth", "pred"):
                agg[k][m] += r[k][m]
    out = {}
    for k, c in agg.items():
        out[k] = {"tp": c["tp"], "fp": c["fp"], "fn": c["fn"],
                  "truth": c["truth"], "pred": c["pred"],
                  "precision": round(c["tp"] / max(1, c["pred"]), 4),
                  "recall": round(c["tp"] / max(1, c["truth"]), 4)}
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

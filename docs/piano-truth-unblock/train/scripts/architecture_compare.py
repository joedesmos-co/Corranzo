#!/usr/bin/env python3
"""Score generated MusicXML against canonical truth events on identical pages.

Compares the existing automatic pipeline (data/auto_out/<sid>.musicxml) and
any pretrained OMR output (paths passed in) to the page-1 truth events.
Uses multiset event matching on (midi, duration-class, dots) so measure
numbering/voice layout differences do not distort the comparison.
Writes reports/architecture_compare.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
EVENTS = TRAIN / "data" / "events"
AUTO_OUT = TRAIN / "data" / "auto_out"

TYPE_Q = {"64th": Fraction(1, 16), "32nd": Fraction(1, 8), "16th": Fraction(1, 4),
          "eighth": Fraction(1, 2), "quarter": Fraction(1, 1), "half": Fraction(2, 1),
          "whole": Fraction(4, 1), "breve": Fraction(8, 1), "long": Fraction(16, 1)}
SYM_Q = {"64": Fraction(1, 16), "32": Fraction(1, 8), "16": Fraction(1, 4),
         "8": Fraction(1, 2), "4": Fraction(1, 1), "2": Fraction(2, 1),
         "1": Fraction(4, 1), "breve": Fraction(8, 1), "long": Fraction(16, 1)}
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def truth_page(sid, page=1):
    evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
    # chord members inherit duration/dots from the MEI <chord> parent
    chord_of = {}
    try:
        NS = "{http://www.music-encoding.org/ns/mei}"
        XID = "{http://www.w3.org/XML/1998/namespace}id"
        root = ET.parse(PILOT / "data" / "render" / sid / "score.mei").getroot()
        for el in root.iter(NS + "chord"):
            for n in el.iter(NS + "note"):
                if n.get(XID):
                    chord_of[n.get(XID)] = (el.get("dur"),
                                            int(el.get("dots") or 0))
    except (OSError, ET.ParseError):
        pass
    notes, rests = Counter(), Counter()
    for e in evs:
        if not e.get("bbox") or int(e["bbox"].get("page", 0)) != page:
            continue
        if e.get("kind") == "note":
            midi = e.get("midi_printed")
            if midi is None:
                continue
            d = e.get("dur")
            dots = int(e.get("dots") or 0)
            if d is None and e.get("id") in chord_of:
                d, dots = chord_of[e["id"]]
            d = str(d)
            q = SYM_Q.get(d)
            if q is None:
                continue
            q = q * (2 - Fraction(1, 2 ** dots)) if dots else q
            notes[(int(midi), str(q), dots)] += 1
        elif e.get("kind") in ("rest", "mRest", "multiRest"):
            d = e.get("dur")
            dots = int(e.get("dots") or 0)
            if d is None:
                continue
            d = str(d)
            q = SYM_Q.get(d)
            if q is None:
                continue
            q = q * (2 - Fraction(1, 2 ** dots)) if dots else q
            rests[(str(q), dots)] += 1
    return notes, rests


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
            is_rest = n.find("rest") is not None
            if is_rest:
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


def multiset_scores(truth, pred, keyfn=lambda k: k):
    t = Counter({keyfn(k): v for k, v in truth.items()})
    p = Counter({keyfn(k): v for k, v in pred.items()})
    tp = sum(min(t[k], p[k]) for k in set(t) | set(p))
    return {"truth": sum(t.values()), "pred": sum(p.values()), "tp": tp,
            "fp": sum(p.values()) - tp, "fn": sum(t.values()) - tp,
            "precision": round(tp / max(1, sum(p.values())), 4),
            "recall": round(tp / max(1, sum(t.values())), 4)}


def score(truth_notes, truth_rests, path):
    pn, pr = xml_events(path)
    return {
        "notes_complete": multiset_scores(truth_notes, pn),
        "notes_pitch": multiset_scores(truth_notes, pn, keyfn=lambda k: k[0]),
        "notes_dur": multiset_scores(truth_notes, pn, keyfn=lambda k: (k[1], k[2])),
        "rests": multiset_scores(truth_rests, pr),
    }


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    outs = json.loads(Path(sys.argv[1]).read_text())  # {sid: {"homr": path}}
    res = {}
    for sid in splits["dev"][:5]:
        tn, tr = truth_page(sid, 1)
        row = {"truth_notes": sum(tn.values()), "truth_rests": sum(tr.values())}
        auto = AUTO_OUT / f"{sid}.musicxml"
        if auto.is_file():
            row["auto_e2e"] = score(tn, tr, auto)
        for name, p in outs.get(sid, {}).items():
            if Path(p).is_file():
                row[name] = score(tn, tr, p)
        res[sid] = row
    (TRAIN / "reports" / "architecture_compare.json").write_text(
        json.dumps(res, indent=1))
    # aggregate over every engine that appears (n may differ; report counts)
    names = set()
    for row in res.values():
        names.update(k for k in row if isinstance(row[k], dict)
                     and "notes_complete" in row[k])
    def agg(name):
        keys = ("notes_complete", "notes_pitch", "notes_dur", "rests")
        a = {k: Counter() for k in keys}
        for row in res.values():
            if name not in row:
                continue
            for k in keys:
                for m in ("tp", "fp", "fn", "truth", "pred"):
                    a[k][m] += row[name][k][m]
        out = {}
        for k in keys:
            out[k] = {
                "tp": a[k]["tp"], "fp": a[k]["fp"], "fn": a[k]["fn"],
                "truth": a[k]["truth"], "pred": a[k]["pred"],
                "precision": round(a[k]["tp"] / max(1, a[k]["pred"]), 4),
                "recall": round(a[k]["tp"] / max(1, a[k]["truth"]), 4)}
        return out
    summary = {"per_score": res,
               "aggregate": {n: agg(n) for n in sorted(names)}}
    (TRAIN / "reports" / "architecture_compare.json").write_text(
        json.dumps(summary, indent=1))
    print(json.dumps(summary["aggregate"], indent=1))


if __name__ == "__main__":
    main()

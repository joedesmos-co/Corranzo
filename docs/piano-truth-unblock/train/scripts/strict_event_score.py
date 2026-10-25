#!/usr/bin/env python3
"""Strict reference scorer: exact MIDI + measure + written duration + dots.

Matches note events per MusicXML measure as multisets, so measure placement
is part of the match (the conservative metric used by the integration audit).
Rests are scored separately with the same measure-keyed rule.
"""
from __future__ import annotations
import json
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def events(path):
    """{measure_number: {'notes': Counter((midi,q,dots)), 'rests': Counter((q,dots))}}"""
    root = ET.parse(path).getroot()
    out = {}
    divisions = 1
    for mi, meas in enumerate(root.iter("measure"), start=1):
        number = meas.get("number") or str(mi)
        for att in meas.findall("attributes"):
            d = att.findtext("divisions")
            if d:
                divisions = max(1, int(d))
        notes, rests = Counter(), Counter()
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
            midi = 12 * (int(p.findtext("octave") or 4) + 1) + \
                STEP.get(p.findtext("step"), 0) + int(p.findtext("alter") or 0)
            notes[(midi, str(q), dots)] += 1
        out.setdefault(number, {"notes": Counter(), "rests": Counter()})
        out[number]["notes"].update(notes)
        out[number]["rests"].update(rests)
    return out


def score(truth_path, pred_path):
    t, p = events(truth_path), events(pred_path)
    tp = fp = fn = 0
    for m in set(t) | set(p):
        tc = t.get(m, {}).get("notes", Counter())
        pc = p.get(m, {}).get("notes", Counter())
        for k in set(tc) | set(pc):
            tp += min(tc[k], pc[k])
            fp += max(0, pc[k] - tc[k])
            fn += max(0, tc[k] - pc[k])
    rtp = rfp = rfn = 0
    for m in set(t) | set(p):
        tc = t.get(m, {}).get("rests", Counter())
        pc = p.get(m, {}).get("rests", Counter())
        for k in set(tc) | set(pc):
            rtp += min(tc[k], pc[k])
            rfp += max(0, pc[k] - tc[k])
            rfn += max(0, tc[k] - pc[k])
    return {"notes_tp": tp, "notes_fp": fp, "notes_fn": fn,
            "notes_truth": tp + fn, "notes_pred": tp + fp,
            "notes_precision": round(tp / max(1, tp + fp), 4),
            "notes_recall": round(tp / max(1, tp + fn), 4),
            "rests_tp": rtp, "rests_fp": rfp, "rests_fn": rfn,
            "rests_truth": rtp + rfn,
            "rests_precision": round(rtp / max(1, rtp + rfp), 4),
            "rests_recall": round(rtp / max(1, rtp + rfn), 4)}


if __name__ == "__main__":
    pairs = json.loads(Path(sys.argv[1]).read_text())  # [{name,truth,pred}]
    out, tot = {}, Counter()
    for row in pairs:
        r = score(row["truth"], row["pred"])
        out[row["name"]] = r
        for k in ("notes_tp", "notes_fp", "notes_fn", "notes_truth",
                  "rests_tp", "rests_fp", "rests_fn", "rests_truth"):
            tot[k] += r[k]
    tot["notes_precision"] = round(tot["notes_tp"] / max(1, tot["notes_tp"] + tot["notes_fp"]), 4)
    tot["notes_recall"] = round(tot["notes_tp"] / max(1, tot["notes_tp"] + tot["notes_fn"]), 4)
    tot["rests_precision"] = round(tot["rests_tp"] / max(1, tot["rests_tp"] + tot["rests_fp"]), 4)
    tot["rests_recall"] = round(tot["rests_tp"] / max(1, tot["rests_tp"] + tot["rests_fn"]), 4)
    print(json.dumps({"per_fixture": out, "total": dict(tot)}, indent=1))

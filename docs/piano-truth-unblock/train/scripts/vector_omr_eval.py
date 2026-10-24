#!/usr/bin/env python3
"""Evaluate the vector-PDF OMR prototype on the CC0 fixture corpus.

Extracts each PDF, serializes MusicXML, and scores complete events against
the paired reference MusicXML using multiset matching on
(midi, quarter-duration, dots) plus rests and measure counts.
Writes reports/vector_omr_complete.json.
"""
from __future__ import annotations
import json
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
ROOT = HERE.parents[3]
FIX = ROOT / "benchmarks" / "omr-fixtures"
sys.path.insert(0, str(HERE))
import pdf_vector_omr as pv  # noqa: E402
from fixture_omr_compare import xml_events, measure_validity  # noqa: E402


def mscores(t, p, key=lambda k: k):
    t = Counter({key(k): v for k, v in t.items()})
    p = Counter({key(k): v for k, v in p.items()})
    tp = sum(min(t[k], p[k]) for k in set(t) | set(p))
    return {"truth": sum(t.values()), "pred": sum(p.values()), "tp": tp,
            "fp": sum(p.values()) - tp, "fn": sum(t.values()) - tp,
            "precision": round(tp / max(1, sum(p.values())), 4),
            "recall": round(tp / max(1, sum(t.values())), 4)}


def main():
    out = {}
    for d in sorted(FIX.glob("piano-*")):
        pdf = next(d.glob("*.pdf"), None)
        truth = next(d.glob("*.musicxml"), None)
        if not pdf or not truth:
            continue
        try:
            ir = pv.extract(pdf, 0)
            if "notes" not in ir:
                out[d.name] = {"route": ir.get("route", "image"),
                               "note": "no vector notation glyphs; use image OMR",
                               "error": ir.get("error")}
                continue
            xml = pv.to_musicxml(ir)
            pred_path = TRAIN / "data" / "vector_out" / f"{d.name}.musicxml"
            pred_path.parent.mkdir(parents=True, exist_ok=True)
            pred_path.write_text(xml)
            tn, tr = xml_events(truth)
            pn, pr = xml_events(pred_path)
            out[d.name] = {
                "route": ir.get("route"),
                "truth_notes": sum(tn.values()),
                "pred_notes": sum(pn.values()),
                "complete": mscores(tn, pn),
                "pitch": mscores(tn, pn, key=lambda k: k[0]),
                "duration": mscores(tn, pn, key=lambda k: (k[1], k[2])),
                "rests": mscores(tr, pr),
                "measure_validity": measure_validity(pred_path),
                "unresolved": len(ir.get("unresolved", [])) +
                              sum(1 for r in ir.get("rests", [])
                                  if r.get("type") is None),
            }
        except Exception as exc:  # noqa: BLE001
            out[d.name] = {"error": f"{type(exc).__name__}: {exc}"}
    (TRAIN / "reports" / "vector_omr_complete.json").write_text(
        json.dumps(out, indent=1))
    agg = {k: Counter() for k in ("complete", "pitch", "duration", "rests")}
    for r in out.values():
        if "complete" not in r:
            continue
        for k in agg:
            for m in ("tp", "fp", "fn", "truth", "pred"):
                agg[k][m] += r[k][m]
    summary = {}
    for k, c in agg.items():
        summary[k] = {"tp": c["tp"], "fp": c["fp"], "fn": c["fn"],
                      "truth": c["truth"], "pred": c["pred"],
                      "precision": round(c["tp"] / max(1, c["pred"]), 4),
                      "recall": round(c["tp"] / max(1, c["truth"]), 4)}
    print(json.dumps(summary, indent=1))
    (TRAIN / "reports" / "vector_omr_complete_summary.json").write_text(
        json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()

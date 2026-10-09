#!/usr/bin/env python3
"""Verify deterministic SVG staff mapping (DEV only, no inference).

Geometric steps from exact SVG notehead centers (own staff frame,
ledger-extrapolated) vs truth staff_pos_steps converted out of the clef
frame. A mapping check with zero parameters, not tuning.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from staff_geometry import page_frames, frames_by_label, note_steps, notehead_map  # noqa: E402

DEV_SIDS = json.loads((PILOT / "manifests" / "splits.json").read_text())["dev"]
RENDER = PILOT / "data" / "render"


# truth staff_pos_steps zero-point vs clef bottom-line zero-point:
# v1 refs (E4/C3/C4) minus true clef refs (G4/F3/C4), in diatonic steps
VOFF = {"G": -2, "F": -3, "C": 0}


def main(limit=0):
    sids = DEV_SIDS[:limit] if limit else DEV_SIDS
    agree = tot = nonh = 0
    bad = Counter()
    page_labels = {}
    for sid in sids:
        ce = json.load(gzip.open(TRAIN / "data" / "events" / f"{sid}.events.json.gz", "rt"))["events"]
        frames, nhmaps = {}, {}
        for e in ce:
            if e["kind"] != "note" or not e.get("bbox"):
                continue
            pg = e["bbox"]["page"]
            if pg not in frames:
                svg_path = RENDER / sid / f"page-{pg:02d}.svg"
                svg = svg_path.read_text()
                _tx, _ty, staves = page_frames(svg_path)
                labs = {x.get("staff") for x in ce
                        if (x.get("bbox") or {}).get("page") == pg and x.get("staff")}
                frames[pg] = frames_by_label(staves, labs)
                nhmaps[pg] = notehead_map(svg)
            nh = nhmaps[pg].get(e.get("id") or "") or nhmaps[pg].get(e.get("svg_id") or "")
            if nh is None:
                nonh += 1
                continue
            steps, _gap = note_steps(nh[1], frames[pg], e.get("staff"))
            if steps is None:
                bad["no_frame"] += 1
                continue
            cl = e.get("clef") or {}
            shape = cl.get("shape", "G")
            if not isinstance(e.get("staff_pos_steps"), int):
                continue
            tot += 1
            if steps == e["staff_pos_steps"] + VOFF.get(shape, 0):
                agree += 1
            else:
                bad[f"off_{steps - (e['staff_pos_steps'] + VOFF.get(shape, 0))}"] += 1
    print({"agree": agree, "tot": tot, "rate": round(agree / max(1, tot), 4),
           "no_notehead": nonh, "bad": dict(bad.most_common(12))})


if __name__ == "__main__":
    main()

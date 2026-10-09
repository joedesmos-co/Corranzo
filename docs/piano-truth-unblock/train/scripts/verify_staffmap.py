#!/usr/bin/env python3
"""Verify structural SVG staff mapping (DEV only, no inference).

Note -> (measure group, staff rank) -> frame lines -> steps, vs truth
staff_pos_steps converted out of the clef frame. Plus rank<->staff-label
agreement. Zero parameters, not tuning.
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
from staff_geometry import parse_page, steps_in_frame  # noqa: E402

DEV_SIDS = json.loads((PILOT / "manifests" / "splits.json").read_text())["dev"]
RENDER = PILOT / "data" / "render"
VOFF = {"G": -2, "F": -3, "C": 0}


def main(limit=0):
    sids = DEV_SIDS[:limit] if limit else DEV_SIDS
    agree = tot = rankok = ranktot = nonh = 0
    bad = Counter()
    for sid in sids:
        ce = json.load(gzip.open(TRAIN / "data" / "events" / f"{sid}.events.json.gz", "rt"))["events"]
        by_id = {e["id"]: e for e in ce if e.get("id")}
        pages = {}
        for mid, e in by_id.items():
            if e["kind"] != "note" or not e.get("bbox"):
                continue
            pg = e["bbox"]["page"]
            if pg not in pages:
                pages[pg] = parse_page(
                    (RENDER / sid / f"page-{pg:02d}.svg").read_text())
            hit = None
            for m in pages[pg]:
                if mid in m["notes"]:
                    hit = (m, m["notes"][mid])
                    break
            if hit is None:
                nonh += 1
                continue
            m, nd = hit
            if nd["pos"] is None or nd["rank"] is None:
                bad["no_pos_or_rank"] += 1
                continue
            ranktot += 1
            rankok += (str(nd["rank"] + 1) == str(e.get("staff")))
            frame = m["staves"][nd["rank"]] if nd["rank"] < len(m["staves"]) else None
            if frame is None or len(frame["lines"]) != 5:
                bad["no_frame"] += 1
                continue
            gaps = [b - a for a, b in zip(frame["lines"], frame["lines"][1:])]
            gap = sum(gaps) / len(gaps)
            steps = steps_in_frame(nd["pos"][1], frame["lines"], gap)
            cl = e.get("clef") or {}
            if not isinstance(e.get("staff_pos_steps"), int):
                continue
            tot += 1
            if steps == e["staff_pos_steps"] + VOFF.get(cl.get("shape", "G"), 0):
                agree += 1
            else:
                bad[f"off_{steps - (e['staff_pos_steps'] + VOFF.get(cl.get('shape', 'G'), 0))}"] += 1
    print({"agree": agree, "tot": tot, "rate": round(agree / max(1, tot), 4),
           "rank_agree": rankok, "rank_tot": ranktot,
           "rank_rate": round(rankok / max(1, ranktot), 4),
           "no_struct": nonh, "bad": dict(bad.most_common(10))})


if __name__ == "__main__":
    main()

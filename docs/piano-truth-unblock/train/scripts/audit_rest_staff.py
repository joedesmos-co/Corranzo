#!/usr/bin/env python3
"""P1 deterministic staff-ownership check (DEV rests, read-only).

Rests carry notehead_cy in cached items and staff frames are structural
(SVG parse_page). Question: does the staff frame containing the rest's
(notehead_x-ish cx, notehead_cy) match the truth staff better than the
frozen context-staff probe (29.8% wrong)? If yes, wire as a deterministic
override in decode_score for RESTS only (notes already use a validated
path). Writes reports/rest_staff_check.json. DEV only.
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
EVENTS = TRAIN / "data" / "events"
DECODED = TRAIN / "data" / "decoded"
sys.path.insert(0, str(HERE))
from staff_geometry import parse_page  # noqa: E402


def frames_of(sid, pg):
    svg = (PILOT / "data" / "render" / sid / f"page-{pg:02d}.svg").read_text()
    out = []
    for meas in parse_page(svg):
        for st in meas["staves"]:
            out.append((st["lines"], meas["notes"]))
    return out


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    C = Counter()
    import re as _re
    for sid in splits["dev"]:
        cache = json.load(open(DECODED / f"{sid}.preds.json"))
        items = cache["items"]
        pred = {int(k): v for k, v in cache["pred"].items()}
        ce = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        truth = {e["id"]: e for e in ce if e["kind"] in ("rest", "mRest",
                                                         "multiRest")}
        svg_by_pg = {}
        frames = {}
        for pg in {it.get("page") for it in items}:
            svg_t = (PILOT / "data" / "render" / sid /
                     f"page-{pg:02d}.svg").read_text()
            svg_by_pg[pg] = svg_t
            m = _re.search(r'<g class="page-margin" transform="translate\('
                           r'([-0-9.]+),\s*([-0-9.]+)\)', svg_t)
            ty = float(m.group(2)) if m else 0.0
            frames[pg] = (ty, [st["lines"] for meas in parse_page(svg_t)
                               for st in meas["staves"]])
        for j, it in enumerate(items):
            t = truth.get(it.get("mei_id"))
            if t is None:
                continue
            e = t
            b = e.get("bbox") or {}
            if not b:
                C["no_bbox"] += 1
                continue
            cy = b["y"] + b["h"] / 2 + frames[it["page"]][0]
            frm = frames[it["page"]][1]
            best, bestd = None, 1e18
            for lines in frm:
                d = min(abs(cy - l) for l in lines)
                if d < bestd:
                    bestd, best = d, lines
            if best is None:
                C["no_frame"] += 1
                continue
            idx = frm.index(best)
            span = best[-1] - best[0]
            inside = bestd <= span / 4 + 1
            truth_staff = str(t.get("staff"))
            struct_staff = str(idx + 1)
            probe = str((pred.get(j, {}) or {}).get("staff_id"))
            C["n"] += 1
            if not inside:
                C["struct_outside_frame"] += 1
                continue
            C["struct_" + ("ok" if struct_staff == truth_staff
                           else "wrong")] += 1
            C["probe_" + ("ok" if probe == truth_staff else "wrong")] += 1
    (TRAIN / "reports" / "rest_staff_check.json").write_text(json.dumps(C, indent=1))
    print(json.dumps(C, indent=1))


if __name__ == "__main__":
    main()

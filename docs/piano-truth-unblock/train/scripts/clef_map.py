#!/usr/bin/env python3
"""Visual governing-clef map (structural SVG membership + pixel shape).

Per score: parse_page gives clefs with (measure-svg-id, staff rank, glyph,
bbox) and notes with ids. Shape from the template classifier on PNG crops
(pixels); association purely structural (no y-guessing, no note proximity).
SVG measure -> canonical measure by majority contained-note measure
(oracle boxes carry ids only, no labels). Forward-fill per staff rank over
canonical measure order. Line: corpus constants G2/F4 (zero exceptions in
130k TRAIN notes); C line from glyph-cy vs frame lines.
Returns {(canon_measure, rank_label): {'shape','line','src'}} + diagnostics.
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
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"
sys.path.insert(0, str(HERE))
from clef_vision import (page_img, classify, crop_clef_at,  # noqa: E402
                         MARGIN)
from staff_geometry import parse_page  # noqa: E402


def load_templates():
    d = json.loads((TRAIN / "reports" / "clef_templates.json").read_text())
    import numpy as np
    return {k: np.array(v, dtype=np.float64) for k, v in d["templates"].items()}


def build_visual_clef_map(sid, templates, cache=None):
    cache = cache if cache is not None else {}
    meta = json.loads((RENDER / sid / "meta.json").read_text())
    cevents = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
    by_mei = {e["id"]: e for e in cevents if e.get("id")}
    morder, seen = [], set()
    for e in cevents:
        if e.get("measure") is not None and e["measure"] not in seen:
            seen.add(e["measure"])
            morder.append(e["measure"])
    midx = {m: k for k, m in enumerate(morder)}
    det = []
    diag = Counter({"pages": 0, "clef_groups": 0, "no_bbox": 0, "no_crop": 0,
                    "unmapped_measure": 0, "c_line_est": 0})
    for pg in range(1, len(meta["page_geometry"]) + 1):
        diag["pages"] += 1
        svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
        import re
        m = MARGIN.search(svg)
        tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
        pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
        img = page_img(sid, pg, cache)
        if img is None:
            continue
        for meas in parse_page(svg):
            # canonical measure by majority contained-note measure
            votes = Counter()
            for nid in meas["notes"]:
                e = by_mei.get(nid)
                if e is not None and e.get("measure") is not None:
                    votes[e["measure"]] += 1
            canon = votes.most_common(1)[0][0] if votes else None
            for c in meas["clefs"]:
                diag["clef_groups"] += 1
                if not c["bbox"]:
                    diag["no_bbox"] += 1
                    continue
                cr = crop_clef_at(img, pw, tx, ty, c["bbox"])
                if cr is None:
                    diag["no_crop"] += 1
                    continue
                shape, _s = classify(cr, templates)
                if canon is None:
                    diag["unmapped_measure"] += 1
                    continue
                line = {"G": 2, "F": 4}.get(shape)
                if shape == "C":
                    fr = meas["staves"][c["rank"]] if c["rank"] is not None and \
                        c["rank"] < len(meas["staves"]) else None
                    if fr is not None and len(fr["lines"]) == 5:
                        lo, hi = fr["lines"][0], fr["lines"][-1]
                        gap = (hi - lo) / 4
                        cy = c["bbox"]["y"] + c["bbox"]["h"] / 2
                        line = max(1, min(5, int(round((hi - cy) / (gap / 2))) + 1))
                        diag["c_line_est"] += 1
                    else:
                        line = 3
                det.append({"page": pg, "x": c["bbox"]["x"], "shape": shape,
                            "line": line, "rank": c["rank"],
                            "measure": canon, "midx": midx.get(canon, 10 ** 9)})
    det.sort(key=lambda d: (d["page"], d["midx"], d["x"]))
    cmap, ranks_seen = {}, set()
    for d in det:
        if d["rank"] is None:
            continue
        lab = str(d["rank"] + 1)
        ranks_seen.add(lab)
        cmap[(d["measure"], lab)] = {"shape": d["shape"], "line": d["line"],
                                     "src": "visual"}
    full = {}
    last = {}
    for msm in morder:
        for st in ranks_seen or {"1", "2"}:
            if (msm, st) in cmap:
                last[st] = cmap[(msm, st)]
            if st in last:
                full[(msm, st)] = last[st]
    return full, det, dict(diag)

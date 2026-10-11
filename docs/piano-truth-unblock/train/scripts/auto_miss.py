#!/usr/bin/env python3
"""P2 notehead miss diagnosis (DEV, read-only).

For missed truth noteheads, join with truth fields to categorize WHY the
geometry-based detector missed them: merged into a wide (beam) blob,
merged into another CC (chord/overlap), size out of window, dark/staff
overlap, or no CC at all. Also reports detection-box size distribution
vs truth to find scale/anchor mismatch (the Guitar-Vision half-cell
failure mode). Writes reports/auto_miss.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
sys.path.insert(0, str(HERE))
from auto_locate import (staff_lines, group_staves, components, classify,  # noqa: E402
                         detect_stems, with_stem_boxes, scale_meta, iou)

import re as _re


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    C = Counter()
    sizerr = []
    for sid in splits["dev"][:5]:
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            gray = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                              cv2.IMREAD_GRAYSCALE)
            if gray is None:
                continue
            sx, gap = scale_meta(meta, pg, gray)
            lines, dark = staff_lines(gray)
            staves = group_staves(lines)
            comps = components(dark, lines, gap)
            heads, _r, _ = classify(comps, dark, staves, gap)
            det = heads
            svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
            m = _re.search(r'<g class="page-margin" transform="translate\('
                           r'([-0-9.]+),\s*([-0-9.]+)\)', svg)
            tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
            ob = []
            for e in evs:
                if e.get("bbox") and int(e["bbox"]["page"]) == pg and e["kind"] == "note":
                    b = e["bbox"]
                    ob.append({"x": (b["x"] + tx) / 10 * sx, "y": (b["y"] + ty) / 10 * sx,
                               "w": b["w"] / 10 * sx, "h": b["h"] / 10 * sx,
                               "chord": e.get("chord_id") is not None,
                               "beam": bool(e.get("beam_id")),
                               "dur": e.get("dur"), "mei_id": e["id"]})
            # truth = NOTEHEAD positions (structural), not bbox centers
            from staff_geometry import notehead_map
            nh = notehead_map(svg)
            tp_ = []
            for e in evs:
                if e["kind"] != "note" or (e.get("bbox") or {}).get("page") != pg:
                    continue
                pos = nh.get(e.get("id") or "") or nh.get(e.get("svg_id") or "")
                if pos is None:
                    continue
                tp_.append(((pos[0] + tx) / 10 * sx, (pos[1] + ty) / 10 * sx, e))
            used = set()
            for (px, py, e) in tp_:
                hit = None
                for j, d in enumerate(det):
                    if j in used:
                        continue
                    if d["x"] <= px <= d["x"] + d["w"] and d["y"] <= py <= d["y"] + d["h"]:
                        hit = j
                        break
                if hit is None:
                    best, bj = 10 ** 9, -1
                    for j, d in enumerate(det):
                        if j in used:
                            continue
                        v = (d["x"] + d["w"] / 2 - px) ** 2 + (d["y"] + d["h"] / 2 - py) ** 2
                        if v < best:
                            best, bj = v, j
                    if bj >= 0 and best <= (1.2 * gap) ** 2:
                        hit = bj
                        C["hit_near"] += 1
                if hit is None:
                    C["missed"] += 1
                    key = ("chord" if e.get("chord_id") else "single",
                           "beam" if e.get("beam_id") else "nobeam")
                    C["miss_" + "_".join(key)] += 1
                    # what covers the notehead pixel?
                    cov = None
                    for c in comps:
                        if c["x"] <= px <= c["x"] + c["w"] and c["y"] <= py <= c["y"] + c["h"]:
                            cov = c
                            break
                    if cov is None:
                        C["miss_no_cc_at_head"] += 1
                    elif cov["w"] > 3.0 * gap:
                        C["miss_in_wide_blob"] += 1
                    elif cov["h"] > 3.2 * gap or cov["w"] < 0.3 * gap:
                        C["miss_size_window"] += 1
                    elif cov["fill"] <= 0.45:
                        C["miss_low_fill"] += 1
                    else:
                        C["miss_other"] += 1
                else:
                    used.add(hit)
                    C["hit"] += 1
            for j, d in enumerate(det):
                if j not in used:
                    C["fp"] += 1
    if sizerr:
        wr = [a for a, _ in sizerr]
        hr = [b for _, b in sizerr]
        wr.sort()
        hr.sort()
        out = {"missed": C["missed"],
               "miss_chord_beam": C["miss_chord_beam"],
               "miss_chord_nobeam": C["miss_chord_nobeam"],
               "miss_single_beam": C["miss_single_beam"],
               "miss_single_nobeam": C["miss_single_nobeam"],
               "miss_no_cc": C["miss_no_cc"], "miss_wide_beam_blob": C["miss_wide_beam_blob"],
               "miss_size_window": C["miss_size_window"], "miss_low_fill": C["miss_low_fill"],
               "miss_other": C["miss_other"],
               "matched_w_ratio_med": round(wr[len(wr) // 2], 3),
               "matched_w_ratio_p10": round(wr[len(wr) // 10], 3),
               "matched_w_ratio_p90": round(wr[len(wr) * 9 // 10], 3),
               "matched_h_ratio_med": round(hr[len(hr) // 2], 3),
               "matched_h_ratio_p10": round(hr[len(hr) // 10], 3),
               "matched_h_ratio_p90": round(hr[len(hr) * 9 // 10], 3)}
    else:
        out = dict(C)
    (TRAIN / "reports" / "auto_miss.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

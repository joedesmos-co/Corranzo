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
            used = set()
            for d in det:
                best, bi = 0.3, -1
                for j, o in enumerate(ob):
                    if j in used:
                        continue
                    v = iou(d, o)
                    if v > best:
                        best, bi = v, j
                if bi >= 0:
                    used.add(bi)
                    o = ob[bi]
                    if len(sizerr) < 400:
                        sizerr.append((d["w"] / o["w"], d["h"] / o["h"]))
            for j, o in enumerate(ob):
                if j in used:
                    continue
                C["missed"] += 1
                key = ("chord" if o["chord"] else "single",
                       "beam" if o["beam"] else "nobeam")
                C["miss_" + "_".join(key)] += 1
                # locate which CC covers this truth box
                cov = None
                for c in comps:
                    if (c["x"] <= o["x"] + o["w"] / 2 <= c["x"] + c["w"]
                            and c["y"] <= o["y"] + o["h"] / 2 <= c["y"] + c["h"]):
                        cov = c
                        break
                if cov is None:
                    C["miss_no_cc"] += 1
                elif cov["w"] > 3.0 * gap:
                    C["miss_wide_beam_blob"] += 1
                elif not (0.55 * gap <= cov["w"] <= 2.0 * gap):
                    C["miss_size_window"] += 1
                elif cov["fill"] <= 0.45:
                    C["miss_low_fill"] += 1
                else:
                    C["miss_other"] += 1
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

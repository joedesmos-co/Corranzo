#!/usr/bin/env python3
"""P2 definitive notehead detection metric (DEV, read-only).

Truth notehead positions come from the SVG notehead map (structural,
pixel coords) — NOT the oracle bbox center (bbox spans notehead+stem, so
its center is empty space; that artifact caused the earlier bogus
"no_cc" misses). A detection HIT = detected head box contains the truth
notehead center. Reports P/R, misses by truth context (chord/beam), and
detection box size vs true notehead size. Writes reports/auto_detect.json.
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
                         scale_meta, iou)
from staff_geometry import notehead_map  # noqa: E402


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    C = Counter()
    sizes = []
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
            svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
            nhmap = notehead_map(svg)
            import re as _re2
            _m = _re2.search(r'<g class="page-margin" transform="translate\('
                            r'([-0-9.]+),\s*([-0-9.]+)\)', svg)
            _tx, _ty = (float(_m.group(1)), float(_m.group(2))) if _m else (0.0, 0.0)
            notes = [e for e in evs if e["kind"] == "note"
                     and (e["bbox"] or {}).get("page") == pg]
            used = set()
            truth_px = []
            for e in notes:
                pos = nhmap.get(e.get("id") or "") or nhmap.get(e.get("svg_id") or "")
                if pos is not None:
                    truth_px.append(((pos[0] + _tx) / 10 * sx,
                                     (pos[1] + _ty) / 10 * sx))
            for e in notes:
                pos = nhmap.get(e.get("id") or "") or nhmap.get(e.get("svg_id") or "")
                if pos is None:
                    C["truth_no_head"] += 1
                    continue
                # notehead map is in SVG page units (same space as bboxes) ->
                # pixel transform, exactly as infer.build_inputs does
                hx = (pos[0] + _tx) / 10 * sx
                hy = (pos[1] + _ty) / 10 * sx
                hit = None
                for j, d in enumerate(heads):
                    if j in used:
                        continue
                    if d["x"] <= hx <= d["x"] + d["w"] and d["y"] <= hy <= d["y"] + d["h"]:
                        hit = j
                        break
                if hit is None:
                    # containment failed: try nearest-center within 1 gap
                    best, bj = 10 ** 9, -1
                    for j, d in enumerate(heads):
                        if j in used:
                            continue
                        dcx, dcy = d["x"] + d["w"] / 2, d["y"] + d["h"] / 2
                        v = (dcx - hx) ** 2 + (dcy - hy) ** 2
                        if v < best:
                            best, bj = v, j
                    if bj >= 0 and best <= (1.2 * gap) ** 2:
                        hit = bj
                        C["hit_near_miss"] += 1
                if hit is None:
                    C["miss"] += 1
                    C["miss_beam" if e.get("beam_id") else "miss_nobeam"] += 1
                    C["miss_chord" if e.get("chord_id") else "miss_single"] += 1
                    continue
                used.add(hit)
                C["hit"] += 1
                d = heads[hit]
                sizes.append((d["w"], d["h"], hx, hy))
            # FP: detections with no truth notehead nearby (<=0.8 gap)
            for j, d in enumerate(heads):
                if j in used:
                    continue
                dcx, dcy = d["x"] + d["w"] / 2, d["y"] + d["h"] / 2
                if any((dcx - px) ** 2 + (dcy - py) ** 2 <= (0.8 * gap) ** 2
                       for px, py in truth_px):
                    continue
                C["fp"] += 1
    tp, fp = C["hit"], C["fp"]
    n_truth = tp + C["miss"]
    out = {"tp": tp, "fp": fp, "fn": C["miss"], "truth_notes": n_truth,
           "p": round(tp / max(1, tp + fp), 4), "r": round(tp / max(1, n_truth), 4),
           "hit_near_miss": C["hit_near_miss"],
           "miss_beam": C["miss_beam"], "miss_nobeam": C["miss_nobeam"],
           "miss_chord": C["miss_chord"], "miss_single": C["miss_single"],
           "truth_no_head": C["truth_no_head"]}
    if sizes:
        ws = sorted(s[0] for s in sizes)
        hs = sorted(s[1] for s in sizes)
        out["det_head_w_med"] = round(ws[len(ws) // 2], 1)
        out["det_head_h_med"] = round(hs[len(hs) // 2], 1)
        out["gap_px"] = round(gap, 1)
    (TRAIN / "reports" / "auto_detect.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

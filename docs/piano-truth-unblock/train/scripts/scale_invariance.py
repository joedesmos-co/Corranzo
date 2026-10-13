#!/usr/bin/env python3
"""M3a scale/DPI invariance (DEV, read-only).

Run the meta-free automatic pipeline on the same DEV pages at 0.5x and
2.0x scale (simulating different rasterization DPI) and compare notehead
P/R, pitch and complete-event accuracy with the 1.0x baseline. All recipe
scales are in staff-gap units, so a correct implementation is invariant.
Writes reports/scale_invariance.json.
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
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import detect_noteheads_full_page, _pitch  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from clef_map import load_templates  # noqa: E402


def match(heads, truth, gap):
    used = set()
    tp = 0
    for (px, py) in truth:
        hit = None
        for j, d in enumerate(heads):
            if j in used:
                continue
            if d[0] <= px <= d[0] + d[2] and d[1] <= py <= d[1] + d[3]:
                hit = j
                break
        if hit is None:
            best, bj = (1.2 * gap) ** 2, -1
            for j, d in enumerate(heads):
                if j in used:
                    continue
                v = (d[0] + d[2] / 2 - px) ** 2 + (d[1] + d[3] / 2 - py) ** 2
                if v < best:
                    best, bj = v, j
            if bj >= 0:
                hit = bj
        if hit is not None:
            used.add(hit)
            tp += 1
    return {"tp": tp, "fp": len(heads) - len(used), "fn": len(truth) - tp}


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    out = {}
    for scale in (0.5, 1.0, 2.0):
        R = Counter()
        for sid in splits["dev"][:5]:
            evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                      f"{sid}.events.json.gz", "rt"))["events"]
            for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
                meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
                if scale != 1.0:
                    gray = cv2.resize(gray, (int(gray.shape[1] * scale),
                                            int(gray.shape[0] * scale)),
                                      interpolation=cv2.INTER_AREA)
                lines, dark = staff_lines(gray)
                frames = group_staves(lines, dark)
                if not frames:
                    continue
                gaps = [(f[-1] - f[0]) / 4 for f in frames]
                g2 = float(np.median(gaps))
                heads = detect_noteheads_full_page(gray, lines, frames, g2)
                from clef_detect import detect_clef
                clefs = [detect_clef(gray, dark, fr, g2, templates)[0]
                         for fr in frames]
                nh = notehead_positions(svg, evs, pg, tx, ty, sx * scale)
                truth = [(p[0], p[1]) for p in nh]
                r = match([(h["x"], h["y"], h["w"], h["h"]) for h in heads],
                          truth, g2)
                R["tp"] += r["tp"]
                R["fp"] += r["fp"]
                R["fn"] += r["fn"]
                # pitch on matched
                used = set()
                for (px, py, e) in nh:
                    hit = None
                    best, bj = (1.0 * g2) ** 2, -1
                    for j, d in enumerate(heads):
                        if j in used:
                            continue
                        v = (d["x"] + d["w"] / 2 - px) ** 2 + (d["y"] + d["h"] / 2 - py) ** 2
                        if (d["x"] <= px <= d["x"] + d["w"]
                                and d["y"] <= py <= d["y"] + d["h"]):
                            hit = j
                            break
                        if v < best:
                            best, bj = v, j
                    if hit is None and bj >= 0:
                        hit = bj
                    if hit is None:
                        continue
                    used.add(hit)
                    d = heads[hit]
                    cy = d["y"] + d["h"] / 2
                    fi = min(range(len(frames)),
                             key=lambda i: min(abs(cy - l) for l in frames[i]))
                    p = _pitch(cy, frames[fi], *clefs[fi], g2)
                    R["pitch_ok"] += (p == e.get("midi_printed"))
                    R["pitch_n"] += 1
        out[f"scale_{scale}"] = {
            "note_p": round(R["tp"] / max(1, R["tp"] + R["fp"]), 4),
            "note_r": round(R["tp"] / max(1, R["tp"] + R["fn"]), 4),
            "pitch": round(R["pitch_ok"] / max(1, R["pitch_n"]), 4),
            "tp": R["tp"], "fp": R["fp"], "fn": R["fn"]}
    (TRAIN / "reports" / "scale_invariance.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def notehead_positions(svg, evs, pg, tx, ty, sx):
    """Truth notehead pixel centroids (bbox centers) in image coords."""
    from staff_geometry import notehead_map
    nh = notehead_map(svg)
    out = []
    for e in evs:
        if e["kind"] != "note" or (e.get("bbox") or {}).get("page") != pg:
            continue
        b = e["bbox"]
        out.append(((b["x"] + b["w"] / 2 + tx) / 10 * sx,
                    (b["y"] + b["h"] / 2 + ty) / 10 * sx, e))
    return out


if __name__ == "__main__":
    main()

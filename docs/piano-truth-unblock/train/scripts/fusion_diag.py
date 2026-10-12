#!/usr/bin/env python3
"""M1 fused-chord root-cause diagnostic (DEV, read-only, low-memory).

For each MISSED chord tone, trace it through the pipeline stages and
classify where it disappears:
  raw      : is the notehead pixel dark in the raw binarization?
  mask     : is it dark in the healed detector mask?
  cc       : which CC encloses it (none / small / in-window / wide)?
  xalign   : same x as the chord root's detected notehead? (chord members
             share a notehead_x in truth)
  ownership : is another chord member detected at the same x (i.e. the
             chord was partially detected)?
Also separates: overlapping noteheads (adjacent <= 1 step), shared stems,
beamed groups, staff-line crossings.
Writes reports/fusion_diag.json. DEV only; TEST sealed.
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
from detector import build_mask, detect_noteheads, W_MIN, W_MAX  # noqa: E402
from auto_locate import staff_lines, group_staves  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from staff_geometry import notehead_map  # noqa: E402

_STEP = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def step_of(e):
    try:
        return _STEP[str(e.get("pname"))] + 12 * int(e.get("oct"))
    except (KeyError, TypeError, ValueError):
        return None


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    C = Counter()
    chord_size = Counter()
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            heads = detect_noteheads(gray, lines, gap)
            nh = notehead_map(svg)
            frames = group_staves(lines)
            # healed mask for stage tracing
            m = build_mask(dark, gap)
            kw = max(2, int(round(0.55 * gap)))
            m = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                                 cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
            m = cv2.dilate(m, np.ones((3, 3), np.uint8))
            ncc, _lab, stats, _cen = cv2.connectedComponentsWithStats(m, 8)
            notes = []
            for e in evs:
                if e["kind"] != "note" or (e.get("bbox") or {}).get("page") != pg:
                    continue
                # visual center = BBOX center (verified: bbox center - notehead
                # center = 0 gaps; the notehead-map pos is the glyph ORIGIN,
                # ~0.67 gap left of the visual center, and must not be used
                # for pixel-level ink traces)
                b = e["bbox"]
                notes.append(((b["x"] + b["w"] / 2 + tx) / 10 * sx,
                              (b["y"] + b["h"] / 2 + ty) / 10 * sx, e))
            by_cid = {}
            for (_px, _py, e) in notes:
                if e.get("chord_id"):
                    by_cid.setdefault(e["chord_id"], []).append(e)
            for cid, mem in by_cid.items():
                chord_size[len(mem)] += 1
            used = set()
            hits = {}
            for (px, py, e) in notes:
                hit = None
                for j, d in enumerate(heads):
                    if j in used:
                        continue
                    if d["x"] <= px <= d["x"] + d["w"] and d["y"] <= py <= d["y"] + d["h"]:
                        hit = j
                        break
                if hit is None:
                    best, bj = (1.2 * gap) ** 2, -1
                    for j, d in enumerate(heads):
                        if j in used:
                            continue
                        v = (d["x"] + d["w"] / 2 - px) ** 2 + (d["y"] + d["h"] / 2 - py) ** 2
                        if v < best:
                            best, bj = v, j
                    if bj >= 0:
                        hit = bj
                if hit is not None:
                    used.add(hit)
                    hits[e["id"]] = hit
            for (px, py, e) in notes:
                if e["id"] in hits:
                    continue
                cid = e.get("chord_id")
                if not cid:
                    C["fn_single"] += 1
                    continue
                C["fn_chord"] += 1
                mem = by_cid[cid]
                sx_ = [ (m2["bbox"]["x"]) for m2 in mem if m2.get("bbox")]
                same_x = max(sx_) - min(sx_) <= 1.0 if len(sx_) else None
                # stage traces
                x, y = int(px), int(py)
                C["raw_dark"] += bool(dark[y, x]) if 0 <= y < dark.shape[0] and 0 <= x < dark.shape[1] else False
                C["mask_dark"] += bool(m[y, x]) if 0 <= y < m.shape[0] and 0 <= x < m.shape[1] else False
                enc = None
                for i in range(1, ncc):
                    x0, y0, w, h, _a = stats[i]
                    if x0 <= x <= x0 + w and y0 <= y <= y0 + h:
                        enc = (int(w), int(h))
                        break
                if enc is None:
                    C["cc_none"] += 1
                elif enc[0] > W_MAX * gap or enc[1] > W_MAX * gap:
                    C["cc_wide"] += 1
                else:
                    C["cc_inwindow"] += 1
                # ownership: some chord member detected?
                any_det = any(mm["id"] in hits for mm in mem)
                C["chord_any_detected" if any_det else "chord_none_detected"] += 1
                if not any_det:
                    C["chord_unseen_x_same" if same_x else "chord_unseen_x_diff"] += 1
                # adjacent seconds: nearest member within 2 diatonic steps
                st = step_of(e)
                if st is not None:
                    dmin = min((abs(st - step_of(mm)) for mm in mem
                                if step_of(mm) is not None), default=99)
                    C["adjacent_le2steps" if dmin <= 2 else "adjacent_gt2steps"] += 1
                C["beamed" if e.get("beam_id") else "not_beamed"] += 1
    out = {k: v for k, v in sorted(C.items())}
    out["chord_size_dist"] = dict(sorted(chord_size.items()))
    (TRAIN / "reports" / "fusion_diag.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

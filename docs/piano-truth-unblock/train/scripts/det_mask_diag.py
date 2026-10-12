#!/usr/bin/env python3
"""Notehead-detection preprocessing diagnostic (DEV, read-only).

For each truth notehead (structural notehead position), check whether a
connected component covering the notehead pixel exists under each mask:
  raw        : binarized gray, no staff handling
  rowrem     : staff rows +-1 removed (current pipeline)
  morph      : long horizontal runs (>=6 gaps: staff lines, beams) and
               long vertical runs (>=3 gaps: stems) removed by opening
               subtraction (noteheads ~1.2 gaps survive)
  balloon     : morph + 2x2 dilation (heals 1px slits)
Also reports, for the misses under rowrem, whether morph recovers them,
and the mask/CC cost. Writes reports/det_mask_diag.json.
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
from auto_locate import staff_lines, group_staves, scale_meta  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from staff_geometry import notehead_map  # noqa: E402


def masks_for(gray, lines, gap):
    dark = (gray < 128).astype(np.uint8)
    # rowrem (current pipeline)
    band = np.zeros_like(dark)
    for y in lines:
        band[max(0, y - 1):y + 2, :] = 1
    rowrem = dark.copy()
    rowrem[band.astype(bool)] = 0
    # morph: subtract long horizontal and long vertical runs
    kw = max(3, int(round(6.0 * gap)))
    vh = max(3, int(round(3.0 * gap)))
    hker = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1))
    vker = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vh))
    m = dark.copy()
    m[cv2.morphologyEx(dark, cv2.MORPH_OPEN, hker).astype(bool)] = 0
    m[cv2.morphologyEx(m, cv2.MORPH_OPEN, vker).astype(bool)] = 0
    morph = m
    balloon = cv2.dilate(morph, np.ones((2, 2), np.uint8))
    return {"raw": dark, "rowrem": rowrem, "morph": morph, "balloon": balloon}


def main():
    import re as _re
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    C = Counter()
    rec_examples = []
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            ms = masks_for(gray, lines, gap)
            nh = notehead_map(svg)
            ccs = {}
            for k, m in ms.items():
                n, _l, _s, _c = cv2.connectedComponentsWithStats(m, 8)
                ccs[k] = n
            heads = []
            for e in evs:
                if e["kind"] == "note" and (e.get("bbox") or {}).get("page") == pg:
                    pos = nh.get(e.get("id") or "") or nh.get(e.get("svg_id") or "")
                    if pos is None:
                        continue
                    heads.append(((pos[0] + tx) / 10 * sx, (pos[1] + ty) / 10 * sx, e))
            for (px, py, e) in heads:
                C["truth"] += 1
                res = {}
                for k, m in ms.items():
                    x, y = int(round(px)), int(round(py))
                    if not (0 <= x < m.shape[1] and 0 <= y < m.shape[0]):
                        res[k] = False
                        continue
                    res[k] = bool(m[y, x])
                for k in ms:
                    C[f"dark_{k}"] += res[k]
                if not res["rowrem"]:
                    C["miss_rowrem"] += 1
                    for k in ("morph", "balloon", "raw"):
                        C[f"recovered_by_{k}"] += res[k]
                    if not res["morph"] and len(rec_examples) < 8:
                        rec_examples.append((sid[:8], e["id"][:8],
                                             bool(e.get("beam_id")),
                                             bool(e.get("chord_id"))))
    out = {"truth": C["truth"], "dark_at_head": {k: C[f"dark_{k}"] for k in
                                                 ("raw", "rowrem", "morph", "balloon")},
           "miss_rowrem": C["miss_rowrem"],
           "recovered_by": {"morph": C["recovered_by_morph"],
                            "balloon": C["recovered_by_balloon"],
                            "raw": C["recovered_by_raw"]},
           "still_dark_in_morph_examples": rec_examples}
    (TRAIN / "reports" / "det_mask_diag.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

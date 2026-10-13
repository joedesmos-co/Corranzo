#!/usr/bin/env python3
"""Clef crop-strategy experiment (DEV, read-only).

For each detected frame, compare clef classification under crop strategies:
  centroid : current (dark centroid of the startup region, half=2 gaps)
  middle   : box centered at (x0+1.1 gaps, middle line), half=2 gaps
  wide     : box centered at (x0+1.4 gaps, frame center), half=2.5 gaps
  glyph    : oracle SVG clef bbox (diagnostic ceiling, NOT usable at
             inference without detection)
Reports per-strategy accuracy and the disagreement cases.
Writes reports/clef_crop_strategy.json.
"""
from __future__ import annotations
import gzip
import json
import re as _re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from clef_map import load_templates  # noqa: E402
from clef_vision import classify as clef_classify, clef_instances  # noqa: E402

SIZE = 32


def norm_patch(patch):
    small = cv2.resize(patch, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    v = small.astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def cut(gray, cx, cy, half):
    x0c, y0c = int(round(cx - half)), int(round(cy - half))
    patch = np.full((2 * half, 2 * half), 255, np.uint8)
    ix0, iy0 = max(0, x0c), max(0, y0c)
    ix1, iy1 = min(gray.shape[1], x0c + 2 * half), min(gray.shape[0], y0c + 2 * half)
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    patch[iy0 - y0c:iy0 - y0c + (iy1 - iy0),
          ix0 - x0c:ix0 - x0c + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
    return norm_patch(patch)


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    C = Counter()
    rows = []
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            frames = group_staves(lines)
            darkm = (gray < 128).astype(np.uint8)
            col_on = (darkm > 0)[lines[0]:lines[-1] + 1, :].any(axis=0)
            xs = np.where(col_on)[0]
            x0 = int(xs[0]) if len(xs) else 0
            votes = defaultdict(Counter)
            for e in evs:
                if e["kind"] != "note" or (e.get("bbox") or {}).get("page") != pg:
                    continue
                cl = e.get("clef") or {}
                if not cl.get("shape"):
                    continue
                b = e["bbox"]
                cy = (b["y"] + b["h"] / 2 + ty) / 10 * sx
                fi = min(range(len(frames)),
                         key=lambda i: min(abs(cy - l) for l in frames[i]))
                votes[fi][cl["shape"]] += 1
            cis = clef_instances(svg)
            for fi, fr in enumerate(frames):
                if not votes[fi]:
                    continue
                tv = votes[fi].most_common(1)[0][0]
                C["n"] += 1
                res = {}
                # centroid strategy (current)
                rx0, rx1 = x0, int(x0 + 3.0 * gap)
                ry0 = max(0, int(fr[0] - 3.0 * gap))
                ry1 = min(gray.shape[0], int(fr[-1] + 3.0 * gap))
                reg = gray[ry0:ry1, rx0:rx1]
                ys, xs2 = np.where(reg < 128)
                if len(xs2) < 20:
                    res["centroid"] = None
                else:
                    cr = cut(gray, rx0 + float(xs2.mean()),
                             ry0 + float(ys.mean()), int(round(2.0 * gap)))
                    res["centroid"] = clef_classify(cr, templates)[0] if cr is not None else None
                for name, (cxmul, cymode, half) in {
                        "middle": (1.1, "mid", 2.0), "wide": (1.4, "mid", 2.5),
                        "tight": (1.1, "mid", 1.8)}.items():
                    cx = x0 + cxmul * gap
                    cy = (fr[0] + fr[-1]) / 2 if cymode == "mid" else fr[2]
                    cr = cut(gray, cx, cy, int(round(half * gap)))
                    res[name] = clef_classify(cr, templates)[0] if cr is not None else None
                # oracle-glyph diagnostic ceiling
                best = None
                for c in cis:
                    bb = c["bbox"]
                    if not bb:
                        continue
                    cyy = (bb["y"] + bb["h"] / 2 + ty) / 10 * sx
                    if not (fr[0] - 3.5 * gap <= cyy <= fr[-1] + 3.5 * gap):
                        continue
                    cxx = (bb["x"] + tx) / 10 * sx
                    if not (x0 - 0.5 * gap <= cxx <= x0 + 4 * gap):
                        continue
                    best = c["glyph"]
                res["glyph"] = {"E050": "G", "E062": "F", "E05C": "C",
                                "E052": "G"}.get(best)
                for k, v in res.items():
                    C[k + ("_ok" if v == tv else "_wrong")] += 1
                if len(rows) < 24:
                    rows.append([sid[:6], pg, fi, tv, res])
    out = {"frames": C["n"]}
    for k in ("centroid", "middle", "wide", "tight", "glyph"):
        out[k + "_acc"] = round(C[k + "_ok"] / max(1, C["n"]), 4)
    out["rows"] = rows
    (TRAIN / "reports" / "clef_crop_strategy.json").write_text(
        json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}, indent=1))
    for r in rows:
        print(r)


if __name__ == "__main__":
    main()

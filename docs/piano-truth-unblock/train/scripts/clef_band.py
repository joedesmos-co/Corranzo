#!/usr/bin/env python3
"""Clef crop band experiment (DEV, read-only).

The old crop region extended 3 gaps above/below the frame, so for a BASS
staff the dark centroid landed on the TREBLE clef of the staff above
(measured: F read as G -> +12-step octave errors). Test staff-local bands.
Writes reports/clef_band.json.
"""
from __future__ import annotations
import gzip
import json
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
from clef_vision import classify as clef_classify  # noqa: E402

SIZE = 32


def norm_patch(patch):
    v = cv2.resize(patch, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    C = Counter()
    bad = []
    CFG = {"old": (3.0, 3.0, 2.0),
           "tight1": (2.6, 1.0, 2.0),
           "tight0.5": (2.4, 0.5, 2.0),
           "tight2": (2.8, 2.0, 2.2)}
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
            for fi, fr in enumerate(frames):
                if not votes[fi]:
                    continue
                tv = votes[fi].most_common(1)[0][0]
                C["n"] += 1
                for tag, (xw, vband, half) in CFG.items():
                    rx0, rx1 = x0, int(x0 + xw * gap)
                    ry0 = max(0, int(fr[0] - vband * gap))
                    ry1 = min(gray.shape[0], int(fr[-1] + vband * gap))
                    reg = gray[ry0:ry1, rx0:rx1]
                    ys, xs2 = np.where(reg < 128)
                    if len(xs2) < 20:
                        C[tag + "_none"] += 1
                        continue
                    cx = rx0 + float(xs2.mean())
                    cy = ry0 + float(ys.mean())
                    hh = int(round(half * gap))
                    x0c, y0c = int(round(cx - hh)), int(round(cy - hh))
                    patch = np.full((2 * hh, 2 * hh), 255, np.uint8)
                    ix0, iy0 = max(0, x0c), max(0, y0c)
                    ix1, iy1 = (min(gray.shape[1], x0c + 2 * hh),
                                min(gray.shape[0], y0c + 2 * hh))
                    if ix1 > ix0 and iy1 > iy0:
                        patch[iy0 - y0c:iy0 - y0c + (iy1 - iy0),
                              ix0 - x0c:ix0 - x0c + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
                    cr = norm_patch(patch)
                    if cr is None:
                        C[tag + "_none"] += 1
                        continue
                    sh = clef_classify(cr, templates)[0]
                    C[tag + ("_ok" if sh == tv else "_wrong")] += 1
                    if sh != tv and tag == "tight1" and len(bad) < 8:
                        bad.append([sid[:6], pg, fi, sh, tv])
    out = {"frames": C["n"]}
    for tag in CFG:
        out[tag + "_acc"] = round(C[tag + "_ok"] / max(1, C["n"]), 4)
        out[tag + "_none"] = C[tag + "_none"]
    out["bad_tight1"] = bad
    (TRAIN / "reports" / "clef_band.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

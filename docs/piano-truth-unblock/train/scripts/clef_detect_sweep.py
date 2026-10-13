#!/usr/bin/env python3
"""clef_detect parameter sweep (DEV, read-only)."""
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
from clef_detect import frame_left_edge  # noqa: E402
from clef_map import load_templates  # noqa: E402

SIZE = 32


def norm_patch(p):
    v = cv2.resize(p, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def sq(gray, cx, cy, half):
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
    pages = []
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            frames = group_staves(lines)
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
            pages.append((gray, dark, frames, gap, votes))
    print("[sweep] pages:", len(pages), flush=True)
    for xm in (2.0, 2.1, 2.2, 2.3):
        for fh in (1.8, 2.0, 2.2, 2.4):
            for gh in (4.0, 4.4, 4.8):
                ok = w = 0
                for (gray, dark, frames, gap, votes) in pages:
                    for fi, fr in enumerate(frames):
                        if not votes[fi]:
                            continue
                        tv = votes[fi].most_common(1)[0][0]
                        fx0 = frame_left_edge(dark, fr)
                        if fx0 is None:
                            continue
                        best = (None, -9.0)
                        for cls, cyf, half in (
                                ("G", fr[2] + 0.15 * gap, gh * gap),
                                ("F", fr[1] + 0.4 * gap, fh * gap),
                                ("C", fr[2], fh * gap)):
                            cr = sq(gray, fx0 + xm * gap, cyf, int(round(half)))
                            if cr is None:
                                continue
                            v = float((cr * templates[cls]).sum())
                            if v > best[1]:
                                best = (cls, v)
                        ok += (best[0] == tv)
                        w += (best[0] != tv)
                print("xm %.1f fh %.1f gh %.1f: ok %d wrong %d acc %.4f"
                      % (xm, fh, gh, ok, w, ok / max(1, ok + w)), flush=True)


if __name__ == "__main__":
    main()

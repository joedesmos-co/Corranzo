#!/usr/bin/env python3
"""Per-frame left-edge clef crop (DEV, read-only).

Root cause of most pitch errors: the clef crop was anchored at the
PAGE-GLOBAL leftmost dark column, which is not the system's left edge
(page border artifacts, braces). Fix: derive the frame's own left edge
from the longest dark run on its top staff line, then take the startup
region from there. Writes reports/clef_frame_x0.json.
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


def norm_patch(p):
    v = cv2.resize(p, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def frame_x0(dark, fr):
    """Left endpoint of the frame's own staff line (longest dark run)."""
    for y in (int(round(fr[0])), int(round(fr[2]))):
        if not (0 <= y < dark.shape[0]):
            continue
        row = dark[y]
        if not row.any():
            continue
        d = np.diff(np.concatenate(([0], row, [0])))
        st = np.where(d == 1)[0]
        en = np.where(d == -1)[0]
        if len(st):
            i = int((en - st).argmax())
            return int(st[i])
    return None


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    C = Counter()
    bad = []
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
            for fi, fr in enumerate(frames):
                if not votes[fi]:
                    continue
                tv = votes[fi].most_common(1)[0][0]
                C["n"] += 1
                fx0 = frame_x0(dark, fr)
                if fx0 is None:
                    C["no_x0"] += 1
                    continue
                rx0, rx1 = fx0, int(fx0 + 2.6 * gap)
                ry0 = max(0, int(fr[0] - 3.0 * gap))
                ry1 = min(gray.shape[0], int(fr[-1] + 3.0 * gap))
                reg = gray[ry0:ry1, rx0:rx1]
                ys, xs2 = np.where(reg < 128)
                if len(xs2) < 20:
                    C["empty"] += 1
                    continue
                cx = rx0 + float(xs2.mean())
                cy = ry0 + float(ys.mean())
                hh = int(round(2.0 * gap))
                x0c, y0c = int(round(cx - hh)), int(round(cy - hh))
                patch = np.full((2 * hh, 2 * hh), 255, np.uint8)
                ix0, iy0 = max(0, x0c), max(0, y0c)
                ix1, iy1 = (min(gray.shape[1], x0c + 2 * hh),
                            min(gray.shape[0], y0c + 2 * hh))
                if ix1 > ix0 and iy1 > iy0:
                    patch[iy0 - y0c:iy0 - y0c + (iy1 - iy0),
                          ix0 - x0c:ix0 - x0c + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
                cr = norm_patch(patch)
                sh = clef_classify(cr, templates)[0] if cr is not None else None
                C["ok" if sh == tv else "wrong"] += 1
                if sh != tv and len(bad) < 10:
                    bad.append([sid[:6], pg, fi, sh, tv, fx0])
    out = {"frames": C["n"], "ok": C["ok"], "wrong": C["wrong"],
           "acc": round(C["ok"] / max(1, C["n"]), 4),
           "empty": C["empty"], "no_x0": C["no_x0"], "bad": bad}
    (TRAIN / "reports" / "clef_frame_x0.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

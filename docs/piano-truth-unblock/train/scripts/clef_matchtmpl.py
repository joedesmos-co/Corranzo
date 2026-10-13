#!/usr/bin/env python3
"""Clef detection by template matching (DEV, measurable).

For each detected frame, slide each clef-class template over the frame's
startup region with matchTemplate (TM_CCOEFF_NORMED) and take the
best (class, position). Templates are the TRAIN-supervised per-class
means (clef_map.load_templates), rescaled to the frame's staff size, so
the method is scale-adaptive by construction (no fixed pixel sizes).
Writes reports/clef_matchtmpl.json.
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


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    print("[clef] templates:", sorted(templates), flush=True)
    C = Counter()
    bad = []
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
                # search region: startup of the frame, generously tall
                rx0 = max(0, int(x0 - 0.5 * gap))
                rx1 = min(gray.shape[1], int(x0 + 5.0 * gap))
                ry0 = max(0, int(fr[0] - 1.0 * gap))
                ry1 = min(gray.shape[0], int(fr[-1] + 1.0 * gap))
                region = gray[ry0:ry1, rx0:rx1]
                if region.size == 0:
                    C["no_region"] += 1
                    continue
                best = (None, -2.0)
                for cls, t in templates.items():
                    tmpl = cv2.resize((t * 127 + 128).astype(np.uint8),
                                      (max(8, int(round(2.3 * gap))),
                                       max(8, int(round(2.3 * gap)))),
                                      interpolation=cv2.INTER_AREA)
                    if tmpl.shape[0] > region.shape[0] or tmpl.shape[1] > region.shape[1]:
                        continue
                    res = cv2.matchTemplate(region, tmpl, cv2.TM_CCOEFF_NORMED)
                    v = float(res.max())
                    if v > best[1]:
                        best = (cls, v)
                C["ok" if best[0] == tv else "wrong"] += 1
                if best[0] != tv and len(bad) < 10:
                    bad.append([sid[:6], pg, fi, best[0], tv, round(best[1], 3)])
    out = {"frames": C["n"], "ok": C["ok"], "wrong": C["wrong"],
           "acc": round(C["ok"] / max(1, C["n"]), 4), "bad": bad}
    (TRAIN / "reports" / "clef_matchtmpl.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

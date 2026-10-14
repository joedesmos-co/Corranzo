#!/usr/bin/env python3
"""Aligned overlays: staff identity + crop coordinates (evaluation-side).

Draws, for the first N DEV pages:
  - detected frames (green) with frame index
  - the matched reference staff (measure scope, MEI staff number, clef) and
    the pixel distance of the match (red text)
  - the clef crop box and the key-signature search window (blue)
  - the expected key-accidental positions from the aligned table (yellow),
    when the reference key is known
Writes PNGs to reports/overlays/. EVALUATION-ONLY (uses reference geometry;
inference must never import this).
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from clef_detect import frame_left_edge  # noqa: E402
from keysig2 import truth_fifths_render  # noqa: E402
from ref_staff import match_frame, ref_staves_px  # noqa: E402

OUT = TRAIN / "reports" / "overlays"
XCENTER_GAPS = 2.2


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    pos = json.loads((TRAIN / "reports" / "keysig_positions.json").read_text())
    table = {}
    for row in pos["positions"]:
        table[(row["key"][0], row["key"][1], row["key"][2])] = (row["x_med"], row["y_med"])
    for sid in splits["dev"][:4]:
        gray = cv2.imread(str(RENDER / sid / "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        canvas = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        refs = ref_staves_px(sid, 1, gray.shape)
        fifths = truth_fifths_render(sid)
        for fi, fr in enumerate(frames):
            r, d = match_frame(fr, refs)
            y0, y1 = int(fr[0]), int(fr[-1])
            fx0 = frame_left_edge(dark, fr)
            gap = (fr[-1] - fr[0]) / 4
            cv2.rectangle(canvas, (0, y0), (canvas.shape[1], y1),
                          (0, 200, 0), 2)
            label = f"F{fi}"
            if r is not None:
                label += f" -> ref {r['measure']} rk={r['rank']} clef={r['clef']} d={d:.1f}px"
            cv2.putText(canvas, label, (10, y0 - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 220), 2)
            if fx0 is None:
                continue
            # clef crop box
            cl = r["clef"] if r else ("G", 2)
            half = (4.8 if cl[0] == "G" else 2.0) * gap
            cyv = (fr[2] + 0.15 * gap) if cl[0] == "G" else \
                (fr[1] + 0.4 * gap if cl[0] == "F" else fr[2])
            if cl[0] == "C":
                cyv = fr[2]
            cxv = fx0 + XCENTER_GAPS * gap
            cv2.rectangle(canvas, (int(cxv - half), int(cyv - half)),
                          (int(cxv + half), int(cyv + half)), (255, 0, 0), 2)
            # key-signature search window
            kgx0 = int(fx0 + 1.2 * gap)
            kgx1 = int(fx0 + 6.5 * gap)
            kgy0 = max(0, int(fr[0] - 2.6 * gap))
            kgy1 = min(gray.shape[0], int(fr[0] + 3.0 * gap))
            cv2.rectangle(canvas, (kgx0, kgy0), (kgx1, kgy1),
                          (255, 120, 0), 1)
            # expected accidental positions (reference key known)
            if r is not None and fifths:
                typ = "sharp" if fifths > 0 else "flat"
                for i in range(abs(fifths)):
                    key = (cl[0], typ, i)
                    if key not in table:
                        continue
                    xg, yh = table[key]
                    px = int(fx0 + xg * gap)
                    py = int(fr[-1] - yh * gap / 2)
                    cv2.circle(canvas, (px, py), 6, (0, 255, 255), 2)
        out = OUT / f"{sid[:8]}_staff_overlay.png"
        cv2.imwrite(str(out), canvas)
        print("[overlay]", out, "frames:", len(frames), "refs:", len(refs),
              "fifths:", fifths)


if __name__ == "__main__":
    main()

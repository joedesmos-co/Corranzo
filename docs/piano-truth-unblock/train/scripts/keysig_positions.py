#!/usr/bin/env python3
"""Key-signature accidental position table (evaluation-side, TRAIN renders).

For each TRAIN render frame, match the detected frame to the reference
staff in PIXEL space (ref_staff.match_frame), then record every
key-signature accidental's position relative to that staff:
  x: gaps to the right of the staff's left edge (frame_left_edge)
  y: half-steps above the staff's BOTTOM line
Both are staff-relative, so they should be consistent across scores and
DPI. Writes reports/keysig_positions.json. EVALUATION-ONLY geometry.
"""
from __future__ import annotations
import json
import re
import sys
from collections import Counter, defaultdict
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
from keysig2 import ACCID_GLYPH, truth_fifths_render  # noqa: E402
from ref_staff import MARGIN, match_frame, ref_staves_px  # noqa: E402


TRAIN_LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 792
SCAN_LIMIT = 10


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    rows = []
    for sid in splits["train"][:TRAIN_LIMIT]:
        gray = cv2.imread(str(RENDER / sid / "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        svg = (RENDER / sid / "page-01.svg").read_text()
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == 1)
        sx = gray.shape[1] / pw
        m = MARGIN.search(svg)
        tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        refs = ref_staves_px(sid, 1, gray.shape)
        fifths = truth_fifths_render(sid)
        if fifths == 0:
            continue
        typ = "sharp" if fifths > 0 else "flat"
        for fi, fr in enumerate(frames):
            r, d = match_frame(fr, refs)
            if r is None or r["clef"] is None:
                continue
            if r["clef"][0] not in ("G", "F"):
                continue
            gap = (fr[-1] - fr[0]) / 4
            fx0 = frame_left_edge(dark, fr)
            if fx0 is None:
                continue
            # key-signature accidentals belonging to THIS frame's system
            # (key signatures live in the first measure of each system)
            accs = []
            y_lo = fr[0] - 4.0 * gap
            y_hi = fr[-1] + 4.0 * gap
            for gm in re.finditer(
                    r'xlink:href="#([A-Za-z0-9]+)-[^"]*"\s+'
                    r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', svg):
                g, gx, gy = gm.group(1), float(gm.group(2)), float(gm.group(3))
                if g not in ACCID_GLYPH or ACCID_GLYPH[g] != typ:
                    continue
                cx, cy = (gx + tx) / 10 * sx, (gy + ty) / 10 * sx
                if not (y_lo <= cy <= y_hi):
                    continue  # belongs to another system
                relx = (cx - fx0) / gap
                rely = (fr[-1] - cy) / (gap / 2)
                if -1 <= relx <= 8 and -16 <= rely <= 16:
                    accs.append((relx, rely))
            accs.sort()
            if len(accs) != abs(fifths):
                continue
            rows.append({
                "sid": sid[:8], "frame": fi, "clef": r["clef"][0],
                "fifths": fifths, "dist_px": round(d, 2),
                "pos": [[round(a, 2), round(b, 1)] for a, b in accs]})
    # ---- per-frame coverage report (frozen membership) ----
    per = {}
    for r in rows:
        k = r["sid"]
        d = per.setdefault(k, {"frames": 0, "fifths": r["fifths"], "clefs": Counter()})
        d["frames"] += 1
        d["clefs"][r["clef"]] += 1
    cov = {k: v["frames"] for k, v in per.items()}
    by = defaultdict(list)
    for r in rows:
        typ = "sharp" if r["fifths"] > 0 else "flat"
        for i, (rx, ry) in enumerate(r["pos"]):
            by[(r["clef"], typ, i)].append((rx, ry))
    out_rows = []
    for k in sorted(by):
        v = by[k]
        xs = [a for a, _ in v]
        ys = [b for _, b in v]
        out_rows.append({"key": list(k), "n": len(v),
                         "x_med": round(float(np.median(xs)), 2),
                         "x_sd": round(float(np.std(xs)), 2),
                         "y_med": round(float(np.median(ys)), 2),
                         "y_sd": round(float(np.std(ys)), 2)})
    out = {"frames_used": len(rows), "positions": out_rows,
           "score_coverage": {k: v["frames"] for k, v in per.items()},
           "scope": "TRAIN renders, pixel-matched reference staves"}
    (TRAIN / "reports" / "keysig_positions.json").write_text(json.dumps(out, indent=1))
    for r in out_rows:
        print(r)


if __name__ == "__main__":
    main()

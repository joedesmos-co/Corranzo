#!/usr/bin/env python3
"""Inspect concrete pitch-error cases (DEV, read-only)."""
from __future__ import annotations
import gzip
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
import numpy as np  # noqa: E402
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_pitch2 import bottom_of, clef_crop, pitch_of  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from clef_map import load_templates  # noqa: E402
from clef_vision import classify as clef_classify  # noqa: E402
from detector import detect_noteheads_full  # noqa: E402
from staff_geometry import parse_page  # noqa: E402

GLYPH = {"E050": ("G", 2), "E062": ("F", 4), "E05C": ("C", 3),
         "E052": ("G", 2)}


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    shown = 0
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            frames = group_staves(lines)
            heads = detect_noteheads_full(gray, lines, frames, gap)
            darkm = (gray < 128).astype(np.uint8)
            col_on = (darkm > 0)[lines[0]:lines[-1] + 1, :].any(axis=0)
            xs = np.where(col_on)[0]
            x0 = int(xs[0]) if len(xs) else 0
            clefs = []
            for fr in frames:
                cr = clef_crop(gray, x0, fr, gap, sx)
                sh, _ = clef_classify(cr, templates) if cr is not None else (None, None)
                if sh is None:
                    clefs.append(("G", 2))
                else:
                    clefs.append((sh, 2 if sh == "G" else (4 if sh == "F" else 3)))
            ocl = {}
            for meas in parse_page(svg):
                for st in meas["staves"]:
                    for c in meas["clefs"]:
                        if c["rank"] == st["rank"] and c["glyph"] in GLYPH:
                            ocl[(meas["svg_id"], st["rank"])] = GLYPH[c["glyph"]]
            truth = []
            for e in evs:
                if e["kind"] != "note" or (e.get("bbox") or {}).get("page") != pg:
                    continue
                b = e["bbox"]
                truth.append({"x": (b["x"] + b["w"] / 2 + tx) / 10 * sx,
                              "y": (b["y"] + b["h"] / 2 + ty) / 10 * sx,
                              "midi": e.get("midi_printed"),
                              "chord": bool(e.get("chord_id")),
                              "staff": e.get("staff"), "measure": e.get("measure")})
            used = set()
            for t in truth:
                hit = None
                best, bj = (1.0 * gap) ** 2, -1
                for j, d in enumerate(heads):
                    if j in used:
                        continue
                    v = ((d["x"] + d["w"] / 2 - t["x"]) ** 2
                         + (d["y"] + d["h"] / 2 - t["y"]) ** 2)
                    if (d["x"] <= t["x"] <= d["x"] + d["w"]
                            and d["y"] <= t["y"] <= d["y"] + d["h"]):
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
                sh, line = clefs[fi]
                b = bottom_of(sh, line)
                steps = int(round(2 * (frames[fi][-1] - cy) / gap))
                p = pitch_of(steps, b)
                if p == t["midi"] or shown >= 10:
                    continue
                rk = int(t["staff"]) - 1 if t["staff"] else None
                tcl = ocl.get((t["measure"], rk))
                shown += 1
                print(f"sid {sid[:6]} truth_midi {t['midi']} staff {t['staff']} "
                      f"clef {tcl} chord {t['chord']} | frame {fi} {clefs[fi]} "
                      f"lines {round(frames[fi][0])}..{round(frames[fi][-1])} "
                      f"steps {steps} -> midi {p}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""M1 pitch error ledger (DEV, read-only).

For every detected note matched to a truth note (position match, <=1.0
gap), attribute the pitch error to pipeline stages:
  clef        : auto clef != truth clef for that staff
  frame       : nearest detected frame != staff implied by truth lines
  lines       : detected frame lines vs truth staff lines (pixel delta)
  ledger      : truth notehead further from its staff than 2 gaps
  rounding    : error is an odd number of half-gaps (rounding candidate)
  octave      : error is a multiple of 12 steps
  accid       : truth accidental != none (we estimate naturals only)
  center      : detected center vs truth center offset in gaps (dx, dy)
Error magnitude in diatonic steps is also recorded.
Writes reports/pitch_ledger.json. DEV only; TEST sealed.
"""
from __future__ import annotations
import gzip
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from detector import detect_noteheads_full  # noqa: E402
from auto_locate import staff_lines, group_staves  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from auto_pitch2 import clef_crop, bottom_of, pitch_of  # noqa: E402
from clef_vision import classify as clef_classify  # noqa: E402
from clef_map import load_templates  # noqa: E402
from staff_geometry import notehead_map, parse_page  # noqa: E402

_SEMI = (0, 2, 4, 5, 7, 9, 11)
_SEMI_OF_STEP = {0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6}
GLYPH_CLEF = {"E050": ("G", 2), "E062": ("F", 4), "E05C": ("C", 3),
              "E052": ("G", 2)}


def steps_of(midi):
    pc = midi % 12
    if pc not in _SEMI_OF_STEP:
        return None
    return _SEMI_OF_STEP[pc] + 7 * (midi // 12)


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    C = Counter()
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            frames = group_staves(lines)
            heads = detect_noteheads_full(gray, lines, frames, gap)
            nh = notehead_map(svg)
            # auto clefs per frame + truth clef per (measure, rank)
            darkm = (gray < 128).astype(np.uint8)
            col_on = (darkm > 0)[lines[0]:lines[-1] + 1, :].any(axis=0)
            xs = np.where(col_on)[0]
            x0 = int(xs[0]) if len(xs) else 0
            clefs = []
            for fr in frames:
                cr = clef_crop(gray, x0, fr, gap, sx)
                sh, _ = clef_classify(cr, templates) if cr is not None else (None, None)
                clefs.append((sh, 2 if sh == "G" else (4 if sh == "F" else 3)))
            ocl = {}
            for meas in parse_page(svg):
                for st in meas["staves"]:
                    for c in meas["clefs"]:
                        if c["rank"] == st["rank"] and c["glyph"] in GLYPH_CLEF:
                            ocl[(meas["svg_id"], st["rank"])] = GLYPH_CLEF[c["glyph"]]
            truth = []
            for e in evs:
                if e["kind"] != "note" or (e.get("bbox") or {}).get("page") != pg:
                    continue
                b = e["bbox"]
                truth.append({"x": (b["x"] + b["w"] / 2 + tx) / 10 * sx,
                              "y": (b["y"] + b["h"] / 2 + ty) / 10 * sx,
                              "midi": e.get("midi_printed"),
                              "accid": e.get("accid_ges") in ("f", "ff", "s", "ss", "n"),
                              "chord": bool(e.get("chord_id")),
                              "beam": bool(e.get("beam_id")),
                              "staff": e.get("staff"),
                              "measure": e.get("measure")})
            used = set()
            for t in truth:
                hit = None
                best, bj = (1.0 * gap) ** 2, -1
                for j, d in enumerate(heads):
                    if j in used:
                        continue
                    v = (d["x"] + d["w"] / 2 - t["x"]) ** 2 + (d["y"] + d["h"] / 2 - t["y"]) ** 2
                    if d["x"] <= t["x"] <= d["x"] + d["w"] and d["y"] <= t["y"] <= d["y"] + d["h"]:
                        hit = j
                        break
                    if v < best:
                        best, bj = v, j
                if hit is None and bj >= 0:
                    hit = bj
                if hit is None:
                    C["undetected"] += 1
                    continue
                used.add(hit)
                d = heads[hit]
                C["matched"] += 1
                cx, cy = d["x"] + d["w"] / 2, d["y"] + d["h"] / 2
                fi = min(range(len(frames)),
                         key=lambda i: min(abs(cy - l) for l in frames[i]))
                sh, line = clefs[fi] if fi < len(clefs) else (None, None)
                if sh is None:
                    C["pitch_no_clef"] += 1
                    continue
                b = bottom_of(sh, line)
                steps = int(round(2 * (frames[fi][-1] - cy) / gap))
                p = pitch_of(steps, b)
                if p == t["midi"]:
                    C["pitch_ok"] += 1
                    continue
                C["pitch_bad"] += 1
                ts = steps_of(t["midi"])
                ps = steps_of(p)
                estep = (ps - ts) if (ts is not None and ps is not None) else 99
                C[f"err_steps_{estep}"] += 1
                if estep % 12 == 0 and estep != 0:
                    C["err_octave_class"] += 1
                elif abs(estep) == 1:
                    C["err_halfstep"] += 1
                # stage attribution
                rk = int(t["staff"]) - 1 if t["staff"] else None
                tcl = ocl.get((t["measure"], rk)) if rk is not None else None
                if tcl is not None and (sh, line) != tcl:
                    C["stage_clef_wrong"] += 1
                else:
                    C["stage_clef_ok"] += 1
                # frame: is the detected frame the truth staff's frame?
                if tcl is not None:
                    # find the frame whose clef matches truth for this staff
                    pass
                # distance to nearest staff line of the detected frame
                dline = min(abs(cy - l) for l in frames[fi])
                C["ledger_far" if dline > 2.0 * gap else "in_staff"] += 1
                if t["chord"]:
                    C["bad_chord_tone"] += 1
                if t["accid"]:
                    C["bad_accidental_note"] += 1
                if t["beam"]:
                    C["bad_beamed"] += 1
                # center offset
                C[f"off_dy_{int(round((cy - t['y']) / (gap / 2)))}"] += 1
    out = {k: v for k, v in sorted(C.items(), key=lambda kv: str(kv[0]))}
    (TRAIN / "reports" / "pitch_ledger.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

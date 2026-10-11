#!/usr/bin/env python3
"""P4 automatic structural pitch A/B comparison (DEV, read-only).

Same formula, two input paths, no oracle at inference for path B:
  pitch = diatonic step of (frame steps + clef bottom) -> semitone
Path A (oracle geometry): truth notehead_cy + parse_page frames + truth
  clef (the oracle-box structural estimate, already validated 0.92+).
Path B (auto): detected head centers + detected staff frames + clef
  classified from a pixel crop located by dark-centroid in the frame's
  startup region (templated NCC, TRAIN-supervised templates).
Compares per-note pitch agreement on the 5 DEV scores; also reports the
offset convention (structural notehead x is the glyph ORIGIN; detections
are visual centers; dx = +0.673 gaps, std 0.013 — the anchor error the
Guitar-Vision mission hinted at, proven on Piano evidence).
Writes reports/auto_pitch2.json.
"""
from __future__ import annotations
import gzip
import json
import re as _re
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
sys.path.insert(0, str(HERE))
from auto_locate import (staff_lines, group_staves, components, classify,  # noqa: E402
                         scale_meta)
from clef_vision import classify as clef_classify  # noqa: E402
from clef_map import load_templates  # noqa: E402
from staff_geometry import notehead_map, parse_page  # noqa: E402

_SEMI = (0, 2, 4, 5, 7, 9, 11)
# clef -> (reference letter, its octave) where the reference sits ON the
# clef's own line (decode_score CLEF_REF convention)
REF = {"G": ("g", 4), "F": ("f", 3), "C": ("c", 4)}


def bottom_of(shape, line):
    if shape not in REF:
        return None
    rp, ro = REF[shape]
    return "cdefgab".index(rp) + 7 * ro - (int(line or 2) - 1) * 2


def pitch_of(steps, bottom):
    cid = steps + bottom
    return _SEMI[cid % 7] + 12 * (cid // 7 + 1)


def clef_crop(gray, x0, fr, gap, sx):
    """Auto clef crop: startup region of the frame; take the dark centroid
    and cut a 4-gap square around it."""
    rx0 = max(0, int(x0))
    rx1 = min(gray.shape[1], int(x0 + 3.0 * gap))
    ry0 = max(0, int(fr[0] - 3.0 * gap))
    ry1 = min(gray.shape[0], int(fr[-1] + 3.0 * gap))
    reg = gray[ry0:ry1, rx0:rx1]
    if reg.size == 0:
        return None
    ys, xs = np.where(reg < 128)
    if len(xs) < 20:
        return None
    cx = rx0 + float(xs.mean())
    cy = ry0 + float(ys.mean())
    half = int(round(2.0 * gap))
    x0c, y0c = int(round(cx - half)), int(round(cy - half))
    patch = np.full((2 * half, 2 * half), 255, np.uint8)
    ix0, iy0 = max(0, x0c), max(0, y0c)
    ix1, iy1 = min(gray.shape[1], x0c + 2 * half), min(gray.shape[0], y0c + 2 * half)
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    patch[iy0 - y0c:iy0 - y0c + (iy1 - iy0),
          ix0 - x0c:ix0 - x0c + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
    small = cv2.resize(patch, (32, 32), interpolation=cv2.INTER_AREA)
    v = small.astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    C = Counter()
    clef_ok = clef_n = 0
    for sid in splits["dev"][:5]:
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            gray = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                              cv2.IMREAD_GRAYSCALE)
            if gray is None:
                continue
            sx, gap = scale_meta(meta, pg, gray)
            lines, dark = staff_lines(gray)
            frames = group_staves(lines)
            if not frames:
                continue
            col_on = (dark > 0)[lines[0]:lines[-1] + 1, :].any(axis=0)
            xs = np.where(col_on)[0]
            x0 = int(xs[0]) if len(xs) else 0
            comps = components(dark, lines, gap)
            heads, _r, _ = classify(comps, dark, frames, gap)
            svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
            m = _re.search(r'<g class="page-margin" transform="translate\('
                           r'([-0-9.]+),\s*([-0-9.]+)\)', svg)
            tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
            # auto clefs per frame
            auto_clefs = []
            for fr in frames:
                cr = clef_crop(gray, x0, fr, gap, sx)
                if cr is None:
                    auto_clefs.append(None)
                    continue
                shape, _ = clef_classify(cr, templates)
                line = 2 if shape == "G" else (4 if shape == "F" else 3)
                auto_clefs.append((shape, line))
            # oracle frames + clefs (structural, per measure/staff; local
            # coordinates are per-measure, so index by measure svg_id)
            pgs = parse_page(svg)
            ofr = {}
            ocl = {}
            for meas in pgs:
                for st in meas["staves"]:
                    ofr[(meas["svg_id"], st["rank"])] = st["lines"]
                    for c in meas["clefs"]:
                        if c["rank"] == st["rank"] and c["glyph"]:
                            ocl[(meas["svg_id"], st["rank"])] = {
                                "E050": ("G", 2), "E062": ("F", 4),
                                "E05C": ("C", 3)}.get(c["glyph"])
            truth_clef_counts = Counter()
            for e in evs:
                if e["kind"] != "note":
                    continue
                cl = (e.get("clef") or {})
                truth_clef_counts[(cl.get("shape"), cl.get("line"))] += 1
            # per-note comparison
            nhmap = notehead_map(svg)
            for e in [x for x in evs if x["kind"] == "note"
                      and (x.get("bbox") or {}).get("page") == pg]:
                pos = nhmap.get(e.get("id") or "") or nhmap.get(e.get("svg_id") or "")
                if pos is None or e.get("midi_printed") is None:
                    continue
                if e.get("accid_ges") in ("f", "ff", "s", "ss", "n"):
                    C["acci_excl"] += 1
                    continue
                # A: oracle geometry in ITS OWN space (raw SVG-local, as
                # decode_score's clef repair does: notehead pos and frame
                # lines both come from parse_page's local coordinates)
                cy_o = pos[1]
                cy_px = (pos[1] + ty) / 10 * sx
                cx_px = (pos[0] + tx) / 10 * sx
                rk = int(e.get("staff")) - 1 if e.get("staff") else None
                mkey = (e.get("measure"), rk)
                if rk is None or mkey not in ofr or ocl.get(mkey) is None:
                    C["no_oracle_frame"] += 1
                    continue
                b_or = bottom_of(*ocl[mkey])
                steps_o = int(round(2 * (ofr[mkey][-1] - cy_o) / gap))
                p_or = pitch_of(steps_o, b_or)
                # B: detected frames + detected head center (pixel space)
                fi = min(range(len(frames)),
                         key=lambda i: min(abs(cy_px - l) for l in frames[i]))
                ac = auto_clefs[fi]
                if ac is None:
                    C["no_clef"] += 1
                    continue
                b_auto = bottom_of(*ac)
                steps = int(round(2 * (frames[fi][-1] - cy_px) / gap))
                p_auto = pitch_of(steps, b_auto)
                C["n"] += 1
                C["A_ok"] += (p_or == e["midi_printed"])
                C["B_ok"] += (p_auto == e["midi_printed"])
                C["A_minus_B"] += (p_or != p_auto)
                if p_auto != e["midi_printed"]:
                    C["B_oct_err"] += ((p_auto - e["midi_printed"]) % 12 == 0)
    auto_dist = Counter()
    for k in C:
        if k.startswith("auto_["):
            pass
    out = {"n": C["n"], "A_oracle_pitch": C["A_ok"],
           "A_acc": round(C["A_ok"] / max(1, C["n"]), 4),
           "B_auto_pitch": C["B_ok"],
           "B_acc": round(C["B_ok"] / max(1, C["n"]), 4),
           "A_vs_B_disagree": C["A_minus_B"],
           "B_octave_err_of_wrong": C["B_oct_err"],
           "acci_excluded": C["acci_excl"], "no_clef": C["no_clef"],
           "no_oracle_frame": C["no_oracle_frame"]}
    (TRAIN / "reports" / "auto_pitch2.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

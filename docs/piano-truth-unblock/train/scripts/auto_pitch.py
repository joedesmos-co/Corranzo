#!/usr/bin/env python3
"""P2 stage-C pitch path: fully automatic structural pitch from detections.

No oracle boxes, no probe pitch: for each auto-detected staff frame,
classify the clef glyph with the validated template-NCC classifier
(clef_vision), then compute each detected notehead's pitch from the frame
steps (2*(bottom_line - cy)/gap) in that clef frame. Natural spellings only
(accidentals need the probe; reported separately as the accuracy ceiling).
DEV renders; TEST sealed. Writes reports/auto_pitch.json.
"""
from __future__ import annotations
import json
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
                         detect_stems, with_stem_boxes, scale_meta, iou)
from clef_vision import classify as clef_classify, crop_clef_at  # noqa: E402
from clef_map import load_templates  # noqa: E402

_SEMI = (0, 2, 4, 5, 7, 9, 11)


def clef_bottom(shape, line):
    ref = {"G": ("e", 4), "F": ("c", 3), "C": ("c", 4)}.get(shape)
    if ref is None:
        return None
    steps = "cdefgab".index(ref[0]) + 7 * ref[1] - (int(line or 2) - 1) * 2
    return steps


def main():
    import gzip
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    C = Counter()
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
            staves = group_staves(lines)
            if not staves:
                continue
            # frame x-extent from line spans
            dark_bin = (dark > 0)
            col_on = dark_bin[lines[0]:lines[-1] + 1, :].any(axis=0)
            xs = np.where(col_on)[0]
            x0, x1 = (int(xs[0]), int(xs[-1])) if len(xs) else (0, gray.shape[1])
            comps = components(dark, lines, gap)
            heads, _rests, _ = classify(comps, dark, staves, gap)
            boxes = with_stem_boxes(heads, detect_stems(dark, lines, gap), gap)
            # keep head centroids (notehead position) for frame steps
            head_cy = [h["y"] + h["h"] / 2 for h in heads]
            pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
            import re as _re
            svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
            m = _re.search(r'<g class="page-margin" transform="translate\('
                           r'([-0-9.]+),\s*([-0-9.]+)\)', svg)
            tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
            # clef per frame (crop at frame start)
            clefs = []
            for fr in staves:
                # clef glyph sits at the frame start; bbox in SVG UNITS
                # (crop_clef_at applies the page margin itself)
                cx_px = x0 + 1.0 * gap
                cy_px = (fr[0] + fr[-1]) / 2
                bb = {"x": cx_px * 10 / sx - tx,
                      "y": (fr[0] - 0.8 * gap) * 10 / sx - ty,
                      "w": 2.0 * gap * 10 / sx,
                      "h": 4.0 * gap * 10 / sx}
                cr = crop_clef_at(gray, pw, tx, ty, bb)
                if cr is None:
                    clefs.append(None)
                    continue
                shape, _ = clef_classify(cr, templates)
                line = 2 if shape == "G" else (4 if shape == "F" else 3)
                clefs.append((shape, line))
            # truth boxes
            ob = []
            for e in evs:
                if e.get("bbox") and int(e["bbox"]["page"]) == pg and e["kind"] == "note":
                    b = e["bbox"]
                    ob.append({"x": (b["x"] + tx) / 10 * sx, "y": (b["y"] + ty) / 10 * sx,
                               "w": b["w"] / 10 * sx, "h": b["h"] / 10 * sx,
                               "midi": e.get("midi_printed"),
                               "accid": e.get("accid_ges")})
            used = set()
            for bi_d, d in enumerate(boxes):
                best, bi = 0.3, -1
                for j, o in enumerate(ob):
                    if j in used:
                        continue
                    v = iou(d, o)
                    if v > best:
                        best, bi = v, j
                if bi < 0:
                    continue
                used.add(bi)
                o = ob[bi]
                cy = head_cy[bi_d] if bi_d < len(head_cy) else d["y"] + d["h"] / 2
                # nearest frame
                fr_i = min(range(len(staves)),
                           key=lambda i: min(abs(cy - l) for l in staves[i]))
                fr = staves[fr_i]
                cl = clefs[fr_i]
                if cl is None:
                    C["no_clef"] += 1
                    continue
                bottom = clef_bottom(*cl)
                if bottom is None:
                    C["bad_clef"] += 1
                    continue
                steps = int(round(2 * (fr[-1] - cy) / gap))
                cid = steps + bottom
                midi = _SEMI[cid % 7] + 12 * (cid // 7 + 1)
                if o["accid"] in ("f", "ff", "s", "ss"):
                    C["accidental_note"] += 1
                    continue  # natural-frame estimate excludes alterations
                C["n"] += 1
                C["ok"] += (midi == o["midi"])
                if midi != o["midi"]:
                    C["oct_err"] += ((midi - o["midi"]) % 12 == 0)
                    C["bad_clef_" + cl[0]] += 1
    out = {"n": C["n"], "pitch_ok": C["ok"],
           "acc_natural_only": round(C["ok"] / max(1, C["n"]), 4),
           "octave_err_of_wrong": C["oct_err"],
           "accidental_notes_excluded": C["accidental_note"],
           "bad_by_clef": {k[9:]: v for k, v in C.items()
                           if k.startswith("bad_clef_")},
           "scope": "5 DEV scores, auto-detected frames/noteheads, template clefs"}
    (TRAIN / "reports" / "auto_pitch.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

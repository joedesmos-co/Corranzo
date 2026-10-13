#!/usr/bin/env python3
"""M3b cross-engraver evaluation on OLiMPiC SCANNED piano strips.

Per-staff truth (MusicXML): clefs by clef@number, notes in document order.
Per detected frame: assign the truth staff by vertical order (single-system
2-staff strips: frame 0 = staff 1, frame 1 = staff 2) and score:
  note recall : detections vs truth note count (frame level)
  pitch       : multiset overlap of detected pitches vs truth pitches
Writes reports/olimpic_eval2.json. Used ONCE (no tuning on this set).
"""
from __future__ import annotations
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
OLIMPIC = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned" / "samples"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import (deskew, detect_noteheads_full_page, estimate_skew,  # noqa: E402
                       _pitch)
from auto_rest import build_templates  # noqa: E402
from clef_detect import detect_clef  # noqa: E402
from clef_detect import _load_templates2  # noqa: E402
from clef_map import load_templates  # noqa: E402

STEP_TO_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def truth(mx):
    root = ET.parse(mx).getroot()
    clefs = {}
    for attr in root.iter("attributes"):
        for c in attr.findall("clef"):
            num = c.get("number") or attr.findtext("staff") or "1"
            clefs[num] = (c.findtext("sign"), c.findtext("line"))
    by_staff = {}
    for n in root.findall(".//note"):
        st = n.findtext("staff") or "1"
        p = n.find("pitch")
        if p is None:
            continue
        pc = STEP_TO_PC.get(p.findtext("step"), 0) + int(p.findtext("alter") or 0)
        by_staff.setdefault(st, []).append(pc + 12 * (int(p.findtext("octave")) + 1))
    return by_staff, clefs


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = _load_templates2() or load_templates()
    rest_templates, _rc = build_templates(splits, n_train=40)
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    C = Counter()
    rows = []
    for d in dirs[:10]:
        pngs = sorted(d.glob("*.png"))
        mxs = sorted(d.glob("*.musicxml"))
        if not pngs or not mxs:
            continue
        gray = cv2.imread(str(pngs[0]), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        ang = estimate_skew(gray)
        g = deskew(gray, ang) if abs(ang) > 0.05 else gray
        lines, dark = staff_lines(g)
        frames = group_staves(lines, dark)
        t_by_staff, t_clefs = truth(mxs[0])
        staves_sorted = sorted(t_by_staff)
        gaps = [(f[-1] - f[0]) / 4 for f in frames]
        g2 = float(np.median(gaps)) if gaps else 0.0
        heads = detect_noteheads_full_page(g, lines, frames, g2) if frames else []
        by_frame = {}
        for h in heads:
            cy = h["y"] + h["h"] / 2
            fi = min(range(len(frames)),
                     key=lambda i: min(abs(cy - l) for l in frames[i]))
            by_frame.setdefault(fi, []).append(h)
        row = {"sample": d.name, "skew": ang, "frames": len(frames),
               "det": len(heads), "truth": sum(len(v) for v in t_by_staff.values()),
               "frame_rows": []}
        C["samples"] += 1
        C["truth"] += row["truth"]
        C["det"] += len(heads)
        for fi, fr in enumerate(frames):
            shape, line = detect_clef(g, dark, fr, g2, templates)[0]
            dets = by_frame.get(fi, [])
            pseq = [_pitch(h["y"] + h["h"] / 2, fr, shape, line, g2) for h in dets]
            st = staves_sorted[fi] if fi < len(staves_sorted) else None
            tseq = t_by_staff.get(st, [])
            ok = sum((Counter(pseq) & Counter(tseq)).values())
            C["pitch_ok"] += ok
            C["pitch_truth"] += len(tseq)
            C["frames"] += 1
            C["frames_with_det"] += (1 if dets else 0)
            C["clef_correct"] += (1 if t_clefs.get(st) == (shape, line) else 0)
            row["frame_rows"].append({"fi": fi, "staff": st,
                                      "auto_clef": [shape, line],
                                      "truth_clef": list(t_clefs.get(st) or (None, None)),
                                      "det": len(dets), "truth": len(tseq),
                                      "pitch_overlap": ok})
        rows.append(row)
    out = {"samples": C["samples"], "truth_notes": C["truth"],
           "detections": C["det"], "frames": C["frames"],
           "frames_with_detections": C["frames_with_det"],
           "note_recall": round(C["det"] / max(1, C["truth"]), 4),
           "pitch_multiset": round(C["pitch_ok"] / max(1, C["pitch_truth"]), 4),
           "clef_accuracy": round(C["clef_correct"] / max(1, C["frames"]), 4),
           "rows": rows}
    (TRAIN / "reports" / "olimpic_eval2.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}, indent=1))
    for r in rows:
        print(r["sample"], "frames", r["frames"], "det", r["det"], "/", r["truth"],
              [(f["staff"], f["auto_clef"], f["truth_clef"], f["det"], f["pitch_overlap"])
               for f in r["frame_rows"]])


if __name__ == "__main__":
    main()

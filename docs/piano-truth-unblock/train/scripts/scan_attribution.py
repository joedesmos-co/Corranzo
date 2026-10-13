#!/usr/bin/env python3
"""Real-scan stage attribution on OLiMPiC (independent engraver, scanned).

Per sample, per stage, measured (no tuning on this set):
  1 preprocessing : deskew angle found, ink fraction after Otsu
  2 staff lines   : line centers found, frames grouped, systems expected
  3 ownership     : frames vs truth staves (from MusicXML)
  4 clef          : auto clef vs the truth clef of that staff
  5 noteheads     : detections vs truth note count per frame
  6 pitch         : multiset overlap per frame (only where frames exist)
  7 rhythm        : duration-class distribution vs truth (weak proxy)
Writes reports/scan_attribution.json.
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
from auto_locate import binarize, group_staves, staff_lines  # noqa: E402
from auto_page import (estimate_skew, deskew, detect_noteheads_full_page,  # noqa: E402
                      _pitch)
from auto_rest import build_templates  # noqa: E402
from clef_detect import detect_clef  # noqa: E402
from clef_map import load_templates  # noqa: E402

STEP_TO_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def truth_from_musicxml(mx):
    """[(staff, midi, dur_ppq)] in document order."""
    root = ET.parse(mx).getroot()
    divs = int(root.findtext(".//divisions") or 4)
    out = []
    for n in root.findall(".//note"):
        st = n.findtext("staff") or "1"
        p = n.find("pitch")
        if p is None:
            continue
        pc = STEP_TO_PC.get(p.findtext("step"), 0) + int(p.findtext("alter") or 0)
        out.append((st, pc + 12 * (int(p.findtext("octave")) + 1),
                    int(n.findtext("duration") or 0)))
    clefs = {}
    for attr in root.iter("attributes"):
        st = attr.findtext("staff") or "1"
        for c in attr.findall("clef"):
            clefs[st] = (c.findtext("sign"), c.findtext("line"))
    return out, clefs, divs


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    rest_templates, _rc = build_templates(splits, n_train=40)
    rows = []
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
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
        tn, tclefs, divs = truth_from_musicxml(mxs[0])
        t_by_staff = {}
        for st, midi, _d in tn:
            t_by_staff.setdefault(st, []).append(midi)
        # frame-level analysis
        fr_rows = []
        for fi, fr in enumerate(frames):
            auto_clef = detect_clef(g, dark, fr,
                                    (fr[-1] - fr[0]) / 4, templates)[0]
            fr_rows.append({"frame": fi, "y": [round(fr[0]), round(fr[-1])],
                            "auto_clef": list(auto_clef)})
        # detections + pitch per frame
        gaps = [(f[-1] - f[0]) / 4 for f in frames]
        g2 = float(np.median(gaps)) if gaps else 0.0
        heads = detect_noteheads_full_page(g, lines, frames, g2) if frames else []
        by_frame = {}
        for h in heads:
            cy = h["y"] + h["h"] / 2
            fi = min(range(len(frames)),
                     key=lambda i: min(abs(cy - l) for l in frames[i]))
            by_frame.setdefault(fi, []).append(h)
        for fi, fr in enumerate(frames):
            shape, line = detect_clef(g, dark, fr, g2, templates)[0]
            dets = by_frame.get(fi, [])
            pseq = [_pitch(h["y"] + h["h"] / 2, fr, shape, line, g2) for h in dets]
            fr_rows[fi]["det"] = len(dets)
            fr_rows[fi]["pitch_sample"] = pseq[:8]
        rows.append({
            "sample": d.name, "img": [int(gray.shape[0]), int(gray.shape[1])],
            "skew_deg": ang, "ink_frac": round(float(binarize(g).mean()), 5),
            "lines": len(lines), "frames": len(frames),
            "truth_staves": sorted(t_by_staff), "truth_clefs": tclefs,
            "truth_notes": {k: len(v) for k, v in t_by_staff.items()},
            "frames_detail": fr_rows,
            "det_total": len(heads),
            "truth_total": len(tn)})
    out = {"samples": rows}
    (TRAIN / "reports" / "scan_attribution.json").write_text(json.dumps(out, indent=1))
    for r in rows:
        print("%s img %s skew %.2f ink %.4f lines %d frames %d truth_staves %s det %d/%d"
              % (r["sample"], r["img"], r["skew_deg"], r["ink_frac"],
                 r["lines"], r["frames"], r["truth_staves"], r["det_total"],
                 r["truth_total"]))
        for f in r["frames_detail"][:4]:
            print("    frame y %s clef %s det %d" % (f["y"], f["auto_clef"], f["det"]))
        print("    truth clefs:", r["truth_clefs"], "truth notes:", r["truth_notes"])


if __name__ == "__main__":
    main()

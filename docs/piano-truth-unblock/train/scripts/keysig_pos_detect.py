#!/usr/bin/env python3
"""Position-table key-signature detector (no CCs, no glyph templates).

Method: from the aligned position table (reports/keysig_positions.json,
clef-dependent), test ink presence at each expected accidental position in
a small staff-relative window, on either
  source='ink'  : the original page (accidentals ON staff lines keep their
                  middle; staff lines contribute ~10% window ink)
  source='bare' : the line-free mask (fragmented accidentals; no line ink)
For each hypothesis (type, count) the score is the mean window ink over
the expected positions; the key is the (type, count) with the best support,
requiring a minimum ink to count as present. Abstains (fifths=None) when
support is ambiguous. Calibrated on TRAIN renders; evaluated on held-out
scans. Writes reports/keysig_pos_detect.json.
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
OLIMPIC = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned" / "samples"
RENDER = PILOT / "data" / "render"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import deskew, estimate_skew  # noqa: E402
from clef_detect import _load_templates2, detect_clef, frame_left_edge  # noqa: E402
from keysig2 import truth_fifths_render  # noqa: E402
from ref_staff import match_frame, ref_staves_px  # noqa: E402

TABLE_PATH = TRAIN / "reports" / "keysig_positions.json"
INK_THRESH = 0.15      # absolute floor (accidental ink is well above this)
REL_THRESH = 2.5       # ink(pos) / control-background ink
MIN_ABS_DIFF = 0.10    # sharp vs flat support gap to decide (else abstain)
XTOL = 0.5             # window half-width in gaps
YTOL = 0.8             # window half-height in gaps


def _win_ink(img, px, py, gap):
    x0 = max(0, int(round(px - XTOL * gap)))
    x1 = min(img.shape[1], int(round(px + XTOL * gap)))
    y0 = max(0, int(round(py - YTOL * gap)))
    y1 = min(img.shape[0], int(round(py + YTOL * gap)))
    if x1 <= x0 or y1 <= y0:
        return None
    return float((img[y0:y1, x0:x1] < 128).mean())


def _background(img, fx0, fr, gap, table, clef):
    """Background ink: same x positions as the tested accidentals, but in
    an empty band well above the staff (key accidentals live within/near
    the staff, so this band is notation-free in every engraving style)."""
    vals = []
    for typ in ("sharp", "flat"):
        for i in range(0, 8):
            key = (clef[0], typ, i)
            if key not in table:
                continue
            xg, _yh = table[key]
            v = _win_ink(img, fx0 + xg * gap, fr[0] - 3.5 * gap, gap)
            if v is not None:
                vals.append(v)
    return float(np.median(vals)) if vals else 0.05


def _max_index(table, clef, typ):
    return max((k[2] for k in table if k[0] == clef and k[1] == typ),
               default=-1)


def detect(gray, dark, fr, gap, clef, table, source="ink"):
    """-> (fifths or None, info). Abstains when the accidental count would
    exceed the measured table coverage or both types are supported."""
    fx0 = frame_left_edge(dark, fr)
    if fx0 is None:
        return None, {"why": "no_fx0"}
    img = dark if source == "bare" else gray
    raw = {}
    for typ in ("sharp", "flat"):
        for i in range(0, 8):
            key = (clef[0], typ, i)
            if key not in table:
                continue
            xg, yh = table[key]
            raw[(typ, i)] = _win_ink(img, fx0 + xg * gap,
                                     fr[-1] - yh * gap / 2, gap)
    vals = [v for v in raw.values() if v is not None]
    if not vals:
        return None, {"why": "no_positions"}
    base = _background(img, fx0, fr, gap, table, clef)
    counts, support = {}, {}
    for typ in ("sharp", "flat"):
        present = []
        for i in range(0, 8):
            v = raw.get((typ, i))
            if v is None:
                present.append(None)  # beyond measured table coverage
                continue
            present.append(bool(
                v >= INK_THRESH and (base <= 1e-6 or v / base >= REL_THRESH)))
        n = 0
        for v in present:
            if v is not True:
                break
            n += 1
        covered = _max_index(table, clef, typ)
        cut = (covered >= 0 and n > covered)
        counts[typ] = n
        n_known = len([v for v in present if v is not None])
        support[typ] = (sum(1 for v in present if v is True) / max(1, n_known))
        if cut:
            return None, {"why": "count_beyond_table", "type": typ, "count": n}
    ns, nf = counts["sharp"], counts["flat"]
    if ns == 0 and nf == 0:
        return 0, {"sharp": ns, "flat": nf}
    if ns > 0 and nf > 0:
        win = "sharp" if support["sharp"] >= support["flat"] else "flat"
        if abs(support["sharp"] - support["flat"]) < MIN_ABS_DIFF:
            return None, {"why": "both_support", "sharp": ns, "flat": nf}
        return (ns if win == "sharp" else -nf), {"sharp": ns, "flat": nf}
    if ns > 0:
        return ns, {"sharp": ns, "flat": 0}
    return -nf, {"sharp": 0, "flat": nf}


def line_free(dark, gap):
    hker = cv2.getStructuringElement(cv2.MORPH_RECT,
                                     (max(3, int(round(6.0 * gap))), 1))
    m = dark.copy()
    m[cv2.morphologyEx(dark, cv2.MORPH_OPEN, hker).astype(bool)] = 0
    return m


def load_table():
    d = json.loads(TABLE_PATH.read_text())
    t = {}
    for row in d["positions"]:
        t[(row["key"][0], row["key"][1], row["key"][2])] = (row["x_med"], row["y_med"])
    return t




def main():
    table = load_table()
    clef_templates = _load_templates2()
    # ---- TRAIN renders (development)
    for source in ("ink", "bare"):
        C = Counter()
        for sid in json.loads((PILOT / "manifests" / "splits.json").read_text())["train"][:40]:
            gray = cv2.imread(str(RENDER / sid / "page-01.png"), cv2.IMREAD_GRAYSCALE)
            if gray is None:
                continue
            lines, dark = staff_lines(gray)
            frames = group_staves(lines, dark)
            refs = ref_staves_px(sid, 1, gray.shape)
            tv = truth_fifths_render(sid)
            if tv == 0:
                continue
            fr = frames[0]
            r, _d = match_frame(fr, refs)
            if r is None or r["clef"] is None:
                continue
            gap = (fr[-1] - fr[0]) / 4
            clef = detect_clef(gray, dark, fr, gap, clef_templates)[0]
            fifths, info = detect(gray, dark, fr, gap, clef, table, source)
            C["n"] += 1
            C["ok" + ("1" if fifths == tv else "0")] += 1
            C["abstain" if fifths is None else "decided"] += 1
            if fifths != tv and len(C) < 400:
                pass
        print(f"[detect] TRAIN source={source}: {C['ok1']}/{C['n']} "
              f"({C['ok1']/max(1,C['n']):.3f}) abstain={C['abstain']}",
              flush=True)
    # ---- held-out scans (verification)
    for source in ("ink", "bare"):
        C = Counter()
        detail = []
        for d in sorted(OLIMPIC.iterdir())[:10]:
            pngs = sorted(d.glob("*.png"))
            mxs = sorted(d.glob("*.musicxml"))
            if not pngs or not mxs:
                continue
            gray = cv2.imread(str(pngs[0]), cv2.IMREAD_GRAYSCALE)
            if gray is None:
                continue
            g = deskew(gray, estimate_skew(gray))
            lines, dark = staff_lines(g)
            frames = group_staves(lines, dark)
            if not frames:
                continue
            root = ET.parse(mxs[0]).getroot()
            tf = root.findtext(".//key/fifths")
            tv = int(tf) if tf is not None else 0
            gaps = [(f[-1] - f[0]) / 4 for f in frames]
            g2 = float(np.median(gaps))
            fr = frames[0]
            clef = detect_clef(g, dark, fr, g2, clef_templates)[0]
            fifths, info = detect(g, dark, fr, g2, clef, table, source)
            C["n"] += 1
            C["ok" + ("1" if fifths == tv else "0")] += 1
            C["abstain" if fifths is None else "decided"] += 1
            detail.append([d.name, tv, fifths, clef[0], info])
        print(f"[detect] SCAN source={source}: {C['ok1']}/{C['n']} "
              f"({C['ok1']/max(1,C['n']):.3f}) abstain={C['abstain']}",
              flush=True)
        for r in detail:
            print("   ", r)
        if source == "ink":
            (TRAIN / "reports" / "keysig_pos_detect.json").write_text(
                json.dumps({"scan_detail": detail}, indent=1))


if __name__ == "__main__":
    main()

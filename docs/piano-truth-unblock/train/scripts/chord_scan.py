#!/usr/bin/env python3
"""M2 chord-aware recovery: legal-position notehead scan inside wide CCs.

Evidence (reports/fusion_diag.json): of 151 missed chord tones, 146/151
are dark in the RAW ink, 145/151 survive preprocessing, and 141/151 sit
inside a WIDE connected component (fused by stems/beams/second-clusters)
that the notehead size window rejects. 82% belong to chords that were
partially detected -> the fused tones are recoverable, not absent.

Method (deterministic, no training): for every CC rejected by the window,
assume its center x is the chord's stem x (chord tones share it) and scan
STAFF-LEGAL y positions (half-gap grid from the enclosing frame's lines).
A position is a notehead iff the horizontal dark run around the center x
is >= 0.8 gaps at the center row AND at least one of +/-0.45 gaps (a beam
is only ~0.3 gaps tall and fails; a stem is <0.2 gaps wide and fails), and
the ink density in a notehead-sized box is >= 0.45. Candidates are then
NMS-deduplicated against existing detections (>=0.9 gap apart).
Writes reports/chord_scan.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from detector import build_mask, detect_noteheads, W_MIN, W_MAX  # noqa: E402
from auto_locate import staff_lines, group_staves  # noqa: E402
from auto_rest import page_ctx  # noqa: E402


def healed_mask(gray, lines, gap):
    dark = (gray < 128).astype(np.uint8)
    m = build_mask(dark, gap)
    kw = max(2, int(round(0.55 * gap)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                         cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
    return cv2.dilate(m, np.ones((3, 3), np.uint8))


def run_len(dark, y, cx, half_w):
    """Longest dark run containing/around cx on row y."""
    if y < 0 or y >= dark.shape[0]:
        return 0
    x0 = max(0, int(cx - half_w))
    x1 = min(dark.shape[1], int(cx + half_w))
    row = dark[y, x0:x1]
    if not row.any():
        return 0
    d = np.diff(np.concatenate(([0], row, [0])))
    st = np.where(d == 1)[0]
    en = np.where(d == -1)[0]
    return int((en - st).max()) if len(st) else 0


def scan_wide(gray, dark, lines, frames, gap, m, both=False, dens_th=0.45,
              need_run_g=0.8):
    """Candidate noteheads at staff-legal positions inside wide CCs."""
    n, _l, stats, _c = cv2.connectedComponentsWithStats(m, 8)
    out = []
    HEADS = {}
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if (W_MIN * gap <= w <= W_MAX * gap and W_MIN * gap <= h <= W_MAX * gap):
            continue  # already in-window: not our problem
        if w > 6.0 * gap or h > 6.0 * gap:
            continue  # system-level blob: too sparse to scan cheaply
        cx = x + w / 2
        # enclosing frame (by CC center y)
        cy = y + h / 2
        fi = min(range(len(frames)),
                 key=lambda k: min(abs(cy - l) for l in frames[k]))
        fr = frames[fi]
        # legal positions: half-gap grid between the top-2 and bottom+2 gaps
        top = fr[0] - 1.5 * gap
        bot = fr[-1] + 1.5 * gap
        yv = top
        win_w, win_h = 1.1 * gap, 1.0 * gap
        need_run = need_run_g * gap
        while yv <= min(bot, y + h):
            if y <= yv <= y + h:
                rc = run_len(dark, int(round(yv)), cx, win_w)
                ru = run_len(dark, int(round(yv - 0.45 * gap)), cx, win_w)
                rd = run_len(dark, int(round(yv + 0.45 * gap)), cx, win_w)
                vert = (ru >= need_run and rd >= need_run) if both else \
                    (ru >= need_run or rd >= need_run)
                if rc >= need_run and vert:
                    # ink density in the notehead box
                    bx0 = int(round(cx - win_w / 2))
                    by0 = int(round(yv - win_h / 2))
                    bx1 = int(round(cx + win_w / 2))
                    by1 = int(round(yv + win_h / 2))
                    ix0, iy0 = max(0, bx0), max(0, by0)
                    ix1, iy1 = min(dark.shape[1], bx1), min(dark.shape[0], by1)
                    if ix1 > ix0 and iy1 > iy0:
                        dens = float(dark[iy0:iy1, ix0:ix1].mean())
                        if dens >= dens_th:
                            out.append({"x": ix0, "y": iy0,
                                        "w": ix1 - ix0, "h": iy1 - iy0,
                                        "cx": cx, "cy": yv, "scan": True})
            yv += gap / 2
    return out


def match(heads, truth, gap):
    used = set()
    tp = 0
    for (px, py) in truth:
        hit = None
        for j, d in enumerate(heads):
            if j in used:
                continue
            if d["x"] <= px <= d["x"] + d["w"] and d["y"] <= py <= d["y"] + d["h"]:
                hit = j
                break
        if hit is None:
            best, bj = (1.2 * gap) ** 2, -1
            for j, d in enumerate(heads):
                if j in used:
                    continue
                v = (d["x"] + d["w"] / 2 - px) ** 2 + (d["y"] + d["h"] / 2 - py) ** 2
                if v < best:
                    best, bj = v, j
            if bj >= 0:
                hit = bj
        if hit is not None:
            used.add(hit)
            tp += 1
    return {"tp": tp, "fp": len(heads) - len(used), "fn": len(truth) - tp}


BOTH, DENS, NEEDRUN = False, 0.45, 0.8


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    # evaluate on the SAME 5 DEV pages as the e2e acceptance, matching the
    # e2e rule (bbox-center truth)
    import xml.etree.ElementTree as ET
    NS = "{http://www.music-encoding.org/ns/mei}"
    R = Counter()
    chord_stats = Counter()
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            frames = group_staves(lines)
            m = healed_mask(gray, lines, gap)
            heads = detect_noteheads(gray, lines, gap)
            base = len(heads)
            add = scan_wide(gray, dark, lines, frames, gap, m,
                           both=BOTH, dens_th=DENS, need_run_g=NEEDRUN)
            have = [(h["x"], h["y"]) for h in heads]
            for d in add:
                if all(((d["x"] - hx) ** 2 + (d["y"] - hy) ** 2)
                       > (0.9 * gap) ** 2 for hx, hy in have):
                    heads.append(d)
                    have.append((d["x"], d["y"]))
            truth = []
            tchord = []
            for e in evs:
                if e["kind"] != "note" or (e.get("bbox") or {}).get("page") != pg:
                    continue
                b = e["bbox"]
                truth.append(((b["x"] + b["w"] / 2 + tx) / 10 * sx,
                              (b["y"] + b["h"] / 2 + ty) / 10 * sx))
                tchord.append(bool(e.get("chord_id")))
            r = match(heads, truth, gap)
            R["tp"] += r["tp"]; R["fp"] += r["fp"]; R["fn"] += r["fn"]
            R["added"] += len(heads) - base
            # chord vs single recall
            used = set()
            for k, (px, py) in enumerate(truth):
                hit = None
                for j, d in enumerate(heads):
                    if j in used:
                        continue
                    if d["x"] <= px <= d["x"] + d["w"] and d["y"] <= py <= d["y"] + d["h"]:
                        hit = j
                        break
                if hit is None:
                    best, bj = (1.2 * gap) ** 2, -1
                    for j, d in enumerate(heads):
                        if j in used:
                            continue
                        v = (d["x"] + d["w"] / 2 - px) ** 2 + (d["y"] + d["h"] / 2 - py) ** 2
                        if v < best:
                            best, bj = v, j
                    if bj >= 0:
                        hit = bj
                if hit is not None:
                    used.add(hit)
                    chord_stats["hit_chord" if tchord[k] else "hit_single"] += 1
                else:
                    chord_stats["fn_chord" if tchord[k] else "fn_single"] += 1
    out = {"tp": R["tp"], "fp": R["fp"], "fn": R["fn"],
           "p": round(R["tp"] / max(1, R["tp"] + R["fp"]), 4),
           "r": round(R["tp"] / max(1, R["tp"] + R["fn"]), 4),
           "candidates_added": R["added"],
           "chord_recall": round(chord_stats["hit_chord"] /
                                 max(1, chord_stats["hit_chord"] + chord_stats["fn_chord"]), 4),
           "single_recall": round(chord_stats["hit_single"] /
                                  max(1, chord_stats["hit_single"] + chord_stats["fn_single"]), 4),
           "chord_fn": chord_stats["fn_chord"], "single_fn": chord_stats["fn_single"]}
    (TRAIN / "reports" / "chord_scan.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

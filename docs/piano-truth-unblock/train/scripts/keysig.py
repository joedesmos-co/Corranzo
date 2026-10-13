#!/usr/bin/env python3
"""Key-signature detection + key-aware pitch (experiment).

Why (measured): every OLiMPiC verification sample has a key signature
(fifths -5..+5) and 15-66% of its notes carry an accidental; the pipeline
estimates natural pitches only, so those notes can never match. DEV
renders are mostly C-major, which hid the gap.

Method (deterministic, TRAIN-supervised):
  1. templates: per-class mean 24x24 crops of key-signature accidentals
     from TRAIN renders (SMuFL E262 = sharp, E260 = flat);
  2. detection: in the startup region between the clef and the time
     signature (fx0+3.0 .. fx0+6.5 gaps, staff-relative), CC candidates
     classified by NCC; keep sharp/flat detections above threshold;
  3. key: fifths from the count and the standard sharp/flat order
     (the y-position order of the accidentals follows the circle of
     fifths, which is a notation invariant);
  4. pitch: diatonic step (letter, octave) -> natural midi + the key's
     alteration for that letter.
Measured on TRAIN renders (key accuracy) and the held-out scan set
(pitch multiset with/without the key).
Writes reports/keysig.json.
"""
from __future__ import annotations
import gzip
import json
import re as _re
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
from auto_page import (deskew, detect_noteheads_full_page,  # noqa: E402
                      estimate_skew)
from clef_detect import frame_left_edge  # noqa: E402
from clef_detect import detect_clef  # noqa: E402
from clef_detect import _load_templates2  # noqa: E402
from clef_map import load_templates  # noqa: E402

SIZE = 24
GLYPH_SHAPE = {"E262": "sharp", "E260": "flat"}
SHARP_ORDER = ("f", "c", "g", "d", "a", "e", "b")
FLAT_ORDER = ("b", "e", "a", "d", "g", "c", "f")
_SEMI = (0, 2, 4, 5, 7, 9, 11)
_STEP_OF_PC = {0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6}
_LETTERS = "cdefgab"


def build_templates(splits, n=120):
    """Mean 24x24 templates of key-signature accidentals (TRAIN renders)."""
    acc = {}
    MARG = _re.compile(r'<g class="page-margin" transform="translate\('
                       r'([-0-9.]+),\s*([-0-9.]+)\)')
    KEYG = _re.compile(r'<g id="[^"]+" class="keySig">(.*?)</g>\s*</g>', _re.S)
    for sid in splits["train"][:n]:
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        for pg in range(1, min(2, len(meta["page_geometry"]) + 1)):
            gray = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                              cv2.IMREAD_GRAYSCALE)
            svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
            if gray is None:
                continue
            m = MARG.search(svg)
            tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
            pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
            sx = gray.shape[1] / pw
            for kg in KEYG.finditer(svg):
                body = kg.group(1)
                for gm in _re.finditer(
                        r'xlink:href="#([A-Za-z0-9]+)-[^"]*"\s+'
                        r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', body):
                    glyph, gx, gy = gm.group(1), float(gm.group(2)), float(gm.group(3))
                    if glyph not in GLYPH_SHAPE:
                        continue
                    cx, cy = (gx + tx) / 10 * sx, (gy + ty) / 10 * sx
                    half = int(round(0.75 * 20 * sx))  # ~1.5 gaps
                    x0, y0 = int(round(cx - half)), int(round(cy - half))
                    patch = np.full((2 * half, 2 * half), 255, np.uint8)
                    ix0, iy0 = max(0, x0), max(0, y0)
                    ix1, iy1 = (min(gray.shape[1], x0 + 2 * half),
                                min(gray.shape[0], y0 + 2 * half))
                    if ix1 <= ix0 or iy1 <= iy0:
                        continue
                    patch[iy0 - y0:iy0 - y0 + (iy1 - iy0),
                          ix0 - x0:ix0 - x0 + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
                    small = cv2.resize(patch, (SIZE, SIZE),
                                      interpolation=cv2.INTER_AREA).astype(np.float32)
                    small -= small.mean()
                    nrm = np.sqrt((small ** 2).sum())
                    if nrm > 1e-9:
                        small /= nrm
                        acc.setdefault(GLYPH_SHAPE[glyph], []).append(small)
    return {k: np.mean(v, axis=0) for k, v in acc.items() if len(v) >= 5}


def detect_keysig(gray, dark, lines, fr, gap, templates):
    """-> (fifths, n_sharps, n_flats) for one frame.

    Template matching over the startup region (no CC segmentation: staff
    lines split key accidentals into fragments on both sources)."""
    if not templates:
        return 0, 0, 0
    fx0 = frame_left_edge(dark, fr)
    if fx0 is None:
        return 0, 0, 0
    rx0 = int(fx0 + 1.2 * gap)
    rx1 = int(fx0 + 6.5 * gap)
    ry0 = max(0, int(fr[0] - 2.6 * gap))
    ry1 = min(gray.shape[0], int(fr[0] + 2.6 * gap))
    region = dark[ry0:ry1, rx0:rx1].astype(np.float32)
    if region.size == 0:
        return 0, 0, 0
    found = []
    for cls, tmpl in templates.items():
        # a key accidental is ~1.0 x 2.6 gaps
        tw = max(6, int(round(1.0 * gap)))
        th = max(12, int(round(2.6 * gap)))
        if tw > region.shape[1] or th > region.shape[0]:
            continue
        t = cv2.resize(tmpl, (tw, th), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(region, t, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(res >= 0.38)
        for x, y in zip(xs, ys):
            found.append({"cls": cls, "x": float(x), "y": float(y),
                          "score": float(res[y, x])})
    # NMS: detections within 0.8 gaps are the same glyph
    found.sort(key=lambda f: -f["score"])
    kept = []
    for f in found:
        if all((f["x"] - k["x"]) ** 2 + (f["y"] - k["y"]) ** 2
               > (0.8 * gap) ** 2 for k in kept):
            kept.append(f)
    n_sharp = sum(1 for f in kept if f["cls"] == "sharp")
    n_flat = sum(1 for f in kept if f["cls"] == "flat")
    fifths = max(0, min(7, n_sharp)) if n_sharp >= n_flat else -max(0, min(7, n_flat))
    return fifths, n_sharp, n_flat


def key_alteration(letter_idx, fifths):
    """Alteration (semitones) the key signature gives a diatonic letter."""
    if fifths > 0:
        sharps = set(SHARP_ORDER[:fifths])
        return 1 if _LETTERS[letter_idx] in sharps else 0
    if fifths < 0:
        flats = set(FLAT_ORDER[:-fifths])
        return -1 if _LETTERS[letter_idx] in flats else 0
    return 0


def pitch_with_key(cy, fr, shape, line, gap, fifths):
    if shape not in ("G", "F", "C"):
        return None
    ref = {"G": ("g", 4), "F": ("f", 3), "C": ("c", 4)}[shape]
    bottom = _LETTERS.index(ref[0]) + 7 * ref[1] - (int(line or 2) - 1) * 2
    cid = int(round(2 * (fr[-1] - cy) / gap)) + bottom
    letter_idx, octave = cid % 7, cid // 7
    return _SEMI[letter_idx] + 12 * (octave + 1) + key_alteration(letter_idx, fifths)


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = build_templates(splits)
    print("[keysig] templates:", sorted(templates), flush=True)
    clef_templates = _load_templates2()
    # 1) TRAIN renders: key detection accuracy vs the MEI fifths
    C = Counter()
    for sid in splits["train"][:25]:
        gray = cv2.imread(str(RENDER / sid / "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        mei = (RENDER / sid / "score.mei").read_text()
        m = _re.search(r'<keySig[^>]*sig="([0-9]+)([sf])"', mei)
        truth_fifths = None
        if m:
            truth_fifths = int(m.group(1)) * (1 if m.group(2) == "s" else -1)
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        for fi, fr in enumerate(frames):
            if fi != 0:
                continue  # first staff only (key is global)
            gap = (fr[-1] - fr[0]) / 4
            fifths, ns, nf = detect_keysig(gray, dark, lines, fr, gap, templates)
            if truth_fifths is not None:
                C["n"] += 1
                C["ok" if fifths == truth_fifths else "bad"] += 1
                if fifths != truth_fifths:
                    C[f"t{truth_fifths}_p{fifths}"] += 1
    print("[keysig] render key acc:", C["ok"], "/", C["n"],
          dict((k, v) for k, v in C.items() if k.startswith("t")), flush=True)
    # 2) held-out scans: pitch multiset with and without the key
    all_dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    ok_no = tot = ok_key = 0
    detail = []
    for d in all_dirs[:10]:
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
        gaps = [(f[-1] - f[0]) / 4 for f in frames]
        g2 = float(np.median(gaps)) if gaps else 0.0
        heads = detect_noteheads_full_page(g, lines, frames, g2) if frames else []
        root = ET.parse(mxs[0]).getroot()
        tby = {}
        for meas in root.iter("measure"):
            st = meas.findtext("staff") or "1"
            for n in meas.iter("note"):
                p = n.find("pitch")
                if p is None:
                    continue
                pc = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7,
                      "A": 9, "B": 11}.get(p.findtext("step"), 0) + \
                    int(p.findtext("alter") or 0)
                tby.setdefault(st, []).append(pc + 12 * (int(p.findtext("octave")) + 1))
        tf = root.findtext(".//key/fifths")
        tf = int(tf) if tf is not None else 0
        staves = sorted(tby)
        by_frame = {}
        for h in heads:
            cy = h["y"] + h["h"] / 2
            fi = min(range(len(frames)),
                     key=lambda i: min(abs(cy - l) for l in frames[i]))
            by_frame.setdefault(fi, []).append(h)
        for fi, fr in enumerate(frames):
            if fi >= len(staves):
                break
            tseq = tby.get(staves[fi], [])
            if not tseq:
                continue
            shape, line = detect_clef(g, dark, fr, g2, clef_templates)[0] \
                if clef_templates else detect_clef(g, dark, fr, g2,
                                                   load_templates())[0]
            fifths, ns, nf = detect_keysig(g, dark, lines, fr, g2, templates)
            dets = by_frame.get(fi, [])
            p_no = [_pitch_natural(h["y"] + h["h"] / 2, fr, shape, line, g2)
                    for h in dets]
            p_key = [pitch_with_key(h["y"] + h["h"] / 2, fr, shape, line, g2,
                                    fifths) for h in dets]
            o0 = sum((Counter(p_no) & Counter(tseq)).values())
            o1 = sum((Counter(p_key) & Counter(tseq)).values())
            ok_no += o0
            ok_key += o1
            tot += len(tseq)
            detail.append([d.name, fi, staves[fi], tf, fifths, ns, nf, o0, o1,
                           len(tseq)])
    print("[keysig] scan pitch multiset: no-key %.4f -> with-key %.4f"
          % (ok_no / max(1, tot), ok_key / max(1, tot)), flush=True)
    out = {"render_key_acc": round(C["ok"] / max(1, C["n"]), 4),
           "render_n": C["n"],
           "scan_pitch_no_key": round(ok_no / max(1, tot), 4),
           "scan_pitch_with_key": round(ok_key / max(1, tot), 4),
           "detail": detail}
    (TRAIN / "reports" / "keysig.json").write_text(json.dumps(out, indent=1))
    for r in detail:
        print(r)


def _pitch_natural(cy, fr, shape, line, gap):
    if shape not in ("G", "F", "C"):
        return None
    ref = {"G": ("g", 4), "F": ("f", 3), "C": ("c", 4)}[shape]
    bottom = _LETTERS.index(ref[0]) + 7 * ref[1] - (int(line) - 1) * 2
    cid = int(round(2 * (fr[-1] - cy) / gap)) + bottom
    return _SEMI[cid % 7] + 12 * (cid // 7 + 1)


if __name__ == "__main__":
    main()

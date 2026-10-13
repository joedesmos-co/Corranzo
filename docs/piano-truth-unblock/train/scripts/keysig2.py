#!/usr/bin/env python3
"""Key-signature recognition: glyph-box templates + line-free CC detection.

Method (deterministic, TRAIN-supervised):
  templates: per-class mean 24x24 NCC templates from TRAIN render
     keyAccid glyphs (SMuFL E262 sharp / E260 flat), cropped at the
     accidental's own glyph box (same extraction as detection uses);
  detection: on a STAFF-LINE-FREE mask (long horizontal runs removed —
     row removal splits the accidentals), CCs in the region between the
     clef and the time signature with accidental size
     (w 0.45-1.7 gaps, h 1.5-3.6 gaps), each classified by NCC;
  key: fifths = +n_sharps or -n_flats (sharp/flat order is a notation
     invariant; the count is what the pixels show).
Measures: render key accuracy (TRAIN, MEI fifths), held-out scan key
accuracy (MusicXML fifths), and the pitch effect of applying the key.
Writes reports/keysig2.json.
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
from clef_detect import _load_templates2, frame_left_edge  # noqa: E402
from clef_detect import detect_clef  # noqa: E402
from clef_map import load_templates  # noqa: E402

SIZE = 24
SHARP_ORDER = ("f", "c", "g", "d", "a", "e", "b")
FLAT_ORDER = ("b", "e", "a", "d", "g", "c", "f")
_SEMI = (0, 2, 4, 5, 7, 9, 11)
_LETTERS = "cdefgab"
ACCID_GLYPH = {"E262": "sharp", "E260": "flat"}


def _line_free(dark, gap):
    """Mask without long horizontal runs (staff lines) — row removal would
    split the accidentals, which span 2-3 staff lines."""
    hker = cv2.getStructuringElement(cv2.MORPH_RECT,
                                     (max(3, int(round(6.0 * gap))), 1))
    m = dark.copy()
    m[cv2.morphologyEx(dark, cv2.MORPH_OPEN, hker).astype(bool)] = 0
    return m


def _norm(box):
    v = cv2.resize(box, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def _glyph_box(gray, mask, x0, y0, w, h):
    """Crop a component's box (+1px margin) from the ORIGINAL gray."""
    a, b = max(0, x0 - 1), max(0, y0 - 1)
    c = min(gray.shape[1], x0 + w + 1)
    d = min(gray.shape[0], y0 + h + 1)
    if c <= a or d <= b:
        return None
    return _norm(gray[b:d, a:c])


def merged_boxes(mask, gap, region=None):
    """CCs of a line-free mask, with fragments of the same accidental merged
    (staff-row removal splits accidentals). region=(rx0,ry0,rx1,ry1) limits
    the search. Returns [[x,y,w,h,area], ...] in absolute coordinates."""
    if region is None:
        reg_full = mask
        ox, oy = 0, 0
    else:
        ox, oy, ox2, oy2 = region
        reg_full = mask[oy:oy2, ox:ox2]
    n, _l, stats, _c = cv2.connectedComponentsWithStats(reg_full, 8)
    raw = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 12 or w < 2 or h < 2:
            continue
        raw.append([int(x) + ox, int(y) + oy, w, h, int(area)])
    merged = True
    while merged:
        merged = False
        for a in range(len(raw)):
            for b in range(a + 1, len(raw)):
                A, B = raw[a], raw[b]
                xg = max(0, max(A[0], B[0]) - min(A[0] + A[2], B[0] + B[2]))
                yg = max(0, max(A[1], B[1]) - min(A[1] + A[3], B[1] + B[3]))
                nw = max(A[0] + A[2], B[0] + B[2]) - min(A[0], B[0])
                nh = max(A[1] + A[3], B[1] + B[3]) - min(A[1], B[1])
                if (xg > 0.12 * gap or yg > 0.18 * gap
                        or nw > 1.7 * gap or nh > 3.6 * gap):
                    continue
                raw[a] = [min(A[0], B[0]), min(A[1], B[1]), nw, nh, A[4] + B[4]]
                raw.pop(b)
                merged = True
                break
            if merged:
                break
    return raw


def build_templates(splits, n=150):
    """Mean 24x24 templates from TRAIN render key-signature glyphs."""
    MARG = _re.compile(r'<g class="page-margin" transform="translate\('
                       r'([-0-9.]+),\s*([-0-9.]+)\)')
    accid = {}
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
            lines, dark = staff_lines(gray)
            frames = group_staves(lines, dark)
            gap = (frames[0][-1] - frames[0][0]) / 4 if frames else 20.0
            mask = _line_free(dark, gap)
            # accidental positions from the SVG (supervision)
            for gm in _re.finditer(
                    r'xlink:href="#([A-Za-z0-9]+)-[^"]*"\s+'
                    r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', svg):
                glyph, gx, gy = gm.group(1), float(gm.group(2)), float(gm.group(3))
                if glyph not in ACCID_GLYPH:
                    continue
                cx = (gx + tx) / 10 * sx
                cy = (gy + ty) / 10 * sx
                # merged CC box containing the known accidental position — the
                # SAME extraction the detector uses, so the crop convention
                # matches by construction. Local window keeps it cheap.
                win = int(round(2.5 * gap))
                boxes = merged_boxes(mask, gap, (
                    max(0, int(cx - win)), max(0, int(cy - win)),
                    min(mask.shape[1], int(cx + win)),
                    min(mask.shape[0], int(cy + win))))
                best = None
                for bx in boxes:
                    x, y, w, h = bx[:4]
                    if x - 2 <= cx <= x + w + 2 and y - 2 <= cy <= y + h + 2:
                        if best is None or w * h < best[2] * best[3]:
                            best = bx
                if best is None:
                    continue
                box = _glyph_box(gray, mask, *best[:4])
                if box is not None:
                    accid.setdefault(ACCID_GLYPH[glyph], []).append(box)
    return {k: np.mean(v, axis=0) for k, v in accid.items() if len(v) >= 5}


_KS_AUTO = None


def _keysig_templates_auto():
    """Cached render-supervised key-signature templates for the pipeline."""
    global _KS_AUTO
    if _KS_AUTO is None:
        p = TRAIN / "models" / "keysig_templates.npz"
        if p.is_file():
            z = np.load(p)
            _KS_AUTO = {k.split("_", 1)[1]: z[k] for k in z.files
                        if k.startswith("render_")}
        else:
            _KS_AUTO = {}
    return _KS_AUTO


def build_templates_scan(splits, verify_n=10, n=120):
    from auto_page import deskew, estimate_skew  # lazy: avoid import cycle
    """Per-class mean templates from SCAN key-signature glyphs.

    Supervision: the sample's MusicXML fifths. The key accidentals are the
    leftmost |fifths| accidental-size boxes in the startup region (sharps
    for fifths>0, flats for fifths<0 — the circle-of-fifths order is
    left-to-right in engraving). No classification is used to build them.
    """
    OL = OLIMPIC
    dirs = sorted(q for q in OL.iterdir() if q.is_dir())
    train_dirs = dirs[verify_n:verify_n + n]
    acc = {}
    for d in train_dirs:
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
        if tf is None:
            continue
        tf = int(tf)
        if tf == 0:
            continue
        fr = frames[0]
        gap = (fr[-1] - fr[0]) / 4
        fx0 = frame_left_edge(dark, fr)
        if fx0 is None:
            continue
        mask = _line_free(dark, gap)
        rx0 = int(fx0 + 2.9 * gap)
        rx1 = int(fx0 + 6.5 * gap)
        ry0 = max(0, int(fr[0] - 2.6 * gap))
        ry1 = min(g.shape[0], int(fr[0] + 3.0 * gap))
        boxes = merged_boxes(mask, gap, (rx0, ry0, rx1, ry1))
        cand = [b for b in boxes
                if 0.45 * gap <= b[2] <= 1.7 * gap and 1.5 * gap <= b[3] <= 3.6 * gap]
        cand.sort(key=lambda b: b[0])
        cls = "sharp" if tf > 0 else "flat"
        for b in cand[:abs(tf)]:
            box = _glyph_box(g, mask, b[0], b[1], b[2], b[3])
            if box is not None:
                acc.setdefault(cls, []).append(box)
    return {k: np.mean(v, axis=0) for k, v in acc.items() if len(v) >= 5}


def detect_keysig(gray, dark, fr, gap, templates, clef_shape="G"):
    """-> (fifths, n_sharp, n_flat, confidence) for one frame."""
    if not templates:
        return 0, 0, 0, 0.0
    fx0 = frame_left_edge(dark, fr)
    if fx0 is None:
        return 0, 0, 0, 0.0
    # region: after the clef (clef spans <= 2.8 gaps), before the time sig
    rx0 = int(fx0 + 2.9 * gap)
    rx1 = int(fx0 + 6.5 * gap)
    ry0 = max(0, int(fr[0] - 2.6 * gap))
    ry1 = min(gray.shape[0], int(fr[0] + 3.0 * gap))
    mask = _line_free(dark, gap)
    reg = mask[ry0:ry1, rx0:rx1]
    if reg.size == 0:
        return 0, 0, 0, 0.0
    raw = merged_boxes(mask, gap, (rx0, ry0, rx1, ry1))
    found = []
    for (x, y, w, h, area) in raw:
        if not (0.45 * gap <= w <= 1.7 * gap and 1.5 * gap <= h <= 3.6 * gap):
            continue
        box = _glyph_box(gray, mask, x, y, w, h)  # merged_boxes: absolute
        if box is None:
            continue
        best = (None, -9.0)
        for cls, t in templates.items():
            v = float((box * t).sum())
            if v > best[1]:
                best = (cls, v)
        if best[0] is not None and best[1] >= 0.30:
            found.append({"cls": best[0], "x": float(x), "score": best[1]})
    found.sort(key=lambda f: -f["score"])
    kept = []
    for f in found:
        if all(abs(f["x"] - k["x"]) > 0.6 * gap for k in kept):
            kept.append(f)
    n_sharp = sum(1 for f in kept if f["cls"] == "sharp")
    n_flat = sum(1 for f in kept if f["cls"] == "flat")
    fifths = max(0, min(7, n_sharp)) if n_sharp >= n_flat else -max(0, min(7, n_flat))
    conf = float(np.mean([f["score"] for f in kept])) if kept else 0.0
    return fifths, n_sharp, n_flat, conf


def key_alteration(letter_idx, fifths):
    if fifths > 0:
        return 1 if _LETTERS[letter_idx] in set(SHARP_ORDER[:fifths]) else 0
    if fifths < 0:
        return -1 if _LETTERS[letter_idx] in set(FLAT_ORDER[:-fifths]) else 0
    return 0


def pitch_with_key(cy, fr, shape, line, gap, fifths):
    if shape not in ("G", "F", "C"):
        return None
    ref = {"G": ("g", 4), "F": ("f", 3), "C": ("c", 4)}[shape]
    bottom = _LETTERS.index(ref[0]) + 7 * ref[1] - (int(line or 2) - 1) * 2
    cid = int(round(2 * (fr[-1] - cy) / gap)) + bottom
    li, oc = cid % 7, cid // 7
    return _SEMI[li] + 12 * (oc + 1) + key_alteration(li, fifths)


def truth_fifths_render(sid):
    mei = (RENDER / sid / "score.mei").read_text()
    m = _re.search(r'<keySig[^>]*sig="([0-9]+)([sf])"', mei)
    if not m:
        return 0
    return int(m.group(1)) * (1 if m.group(2) == "s" else -1)


def main():
    from auto_page import deskew, detect_noteheads_full_page, estimate_skew
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = build_templates(splits)
    scan_templates = build_templates_scan(splits)
    print("[ks2] scan templates:", {k: v.shape for k, v in scan_templates.items()},
          flush=True)
    if scan_templates:
        np.savez_compressed(TRAIN / "models" / "keysig_templates.npz",
                            **{f"render_{k}": v for k, v in templates.items()},
                            **{f"scan_{k}": v for k, v in scan_templates.items()})
    for cls in ("sharp", "flat"):
        if cls in templates and cls in scan_templates:
            templates[f"scan_{cls}"] = scan_templates[cls]
    print("[ks2] templates:", {k: v.shape for k, v in templates.items()},
          flush=True)
    clef_templates = _load_templates2()
    # A) TRAIN renders (development set)
    C = Counter()
    for sid in splits["train"][:40]:
        gray = cv2.imread(str(RENDER / sid / "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        if not frames:
            continue
        fr = frames[0]
        gap = (fr[-1] - fr[0]) / 4
        fifths, ns, nf, conf = detect_keysig(gray, dark, fr, gap, templates)
        tv = truth_fifths_render(sid)
        C["n"] += 1
        C["ok" if fifths == tv else "bad"] += 1
        if fifths != tv:
            C[f"t{tv}_p{fifths}"] += 1
    print("[ks2] TRAIN render key acc:", C["ok"], "/", C["n"],
          dict((k, v) for k, v in C.items() if k.startswith("t")), flush=True)
    # B) held-out scans: key accuracy + pitch effect
    ok = tot = ok_key = tot_key = 0
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
                pc = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9,
                      "B": 11}.get(p.findtext("step"), 0) + int(p.findtext("alter") or 0)
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
            shape, line = detect_clef(g, dark, fr, g2, clef_templates)[0]
            fifths, ns, nf, conf = detect_keysig(g, dark, fr, g2, templates)
            dets = by_frame.get(fi, [])
            p_no = []
            p_key = []
            for h in dets:
                cy = h["y"] + h["h"] / 2
                p_no.append(_natural(cy, fr, shape, line, g2))
                p_key.append(pitch_with_key(cy, fr, shape, line, g2, fifths))
            o0 = sum((Counter(p_no) & Counter(tseq)).values())
            o1 = sum((Counter(p_key) & Counter(tseq)).values())
            ok += o0
            tot += len(tseq)
            ok_key += o1
            tot_key += len(tseq)
            detail.append([d.name, fi, staves[fi], tf, fifths, ns, nf, o0, o1,
                           len(tseq)])
    out = {"train_key_acc": round(C["ok"] / max(1, C["n"]), 4), "train_n": C["n"],
           "scan_key_acc": round(sum(1 for r in detail if r[3] == r[4])
                                 / max(1, len(detail)), 4),
           "scan_pitch_no_key": round(ok / max(1, tot), 4),
           "scan_pitch_with_key": round(ok_key / max(1, tot_key), 4),
           "detail": detail}
    (TRAIN / "reports" / "keysig2.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "detail"}, indent=1))
    for r in detail:
        print(r)


def _natural(cy, fr, shape, line, gap):
    if shape not in ("G", "F", "C"):
        return None
    ref = {"G": ("g", 4), "F": ("f", 3), "C": ("c", 4)}[shape]
    bottom = _LETTERS.index(ref[0]) + 7 * ref[1] - (int(line) - 1) * 2
    cid = int(round(2 * (fr[-1] - cy) / gap)) + bottom
    return _SEMI[cid % 7] + 12 * (cid // 7 + 1)


if __name__ == "__main__":
    main()

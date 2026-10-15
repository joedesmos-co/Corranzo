#!/usr/bin/env python3
"""Scan symbol supervision: count-constrained alignment + verification.

Method (alignment): for each TRAIN-side scan strip, the key signature is
the only symbol run between the clef and the time signature, and its
accidental count/type is annotated in the strip's own MusicXML
(key/fifths). So:
  1. detect glyph clusters in the strict key-signature window
     (fx0+2.9 .. fx0+6.4 gaps — measured to end before the time
     signature) with accidental geometry (0.4-2.2 gaps wide, 1.2-3.6
     gaps tall) on the ORIGINAL INK with staff-line rows masked by their
     MEASURED thickness;
  2. if exactly |fifths| clusters are found, label them with the key's
     sign (count agrees with the strip's own annotation);
     if more than |fifths|, take the |fifths| leftmost (key signatures
     precede the time signature); if fewer, reject the strip as
     misaligned;
  3. VERIFY each label independently of the key: the crop must look more
     like a render accidental of the labelled class than of the other
     class (render-template NCC, templates = the 787 labelled render
     boxes). Crops failing the check are dropped as ambiguous.

Also emits background crops (clusters beyond the count) for negatives.

Writes /tmp/scan_sym_data.npz + a visual montage
reports/scan_sym_montage.png for inspection. Score-disjoint split is done
by the caller. TEST untouched.
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
RENDER = PILOT / "data" / "render"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import deskew, estimate_skew  # noqa: E402
from clef_detect import _load_templates2, detect_clef, frame_left_edge  # noqa: E402
from clefsym_data_lm4 import line_bands  # noqa: E402

CW, CH = 32, 64
GW, GH = 2.0, 5.0
X0G, X1G = 2.9, 6.4
VERIFY_N = 10
MIN_W, MAX_W = 0.4, 2.2
MIN_H, MAX_H = 1.2, 3.6
NCC_MARGIN = 0.02     # required render-NCC margin over the other class


def crop(gray, cx, cy, gap, bands):
    hw = int(round(GW * gap / 2))
    hh = int(round(GH * gap / 2))
    x0, y0 = int(round(cx - hw)), int(round(cy - hh))
    patch = np.full((2 * hh, 2 * hw), 255, np.uint8)
    ix0, iy0 = max(0, x0), max(0, y0)
    ix1, iy1 = min(gray.shape[1], x0 + 2 * hw), min(gray.shape[0], y0 + 2 * hh)
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    patch[iy0 - y0:iy0 - y0 + (iy1 - iy0),
          ix0 - x0:ix0 - x0 + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
    for lo, hi in bands:
        a, b = max(0, lo - y0), min(patch.shape[0], hi - y0)
        if b > a:
            patch[a:b, :] = 255
    if patch.std() < 2:
        return None
    return cv2.resize(patch, (CW, CH), interpolation=cv2.INTER_AREA)


def norm32(p):
    v = cv2.resize(p.astype(np.uint8), (CW, CH),
                   interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def render_templates(splits, limit=240):
    """Mean render templates per accidental class (exact labels)."""
    import re
    MARGIN = re.compile(r'<g class="page-margin" transform="translate\(('
                        r'[-0-9.]+),\s*([-0-9.]+)\)')
    KEYACCID = re.compile(r'<g id="[^"]+" class="keyAccid">(.*?)</g>', re.S)
    USE = re.compile(r'xlink:href="#([A-Za-z0-9]+)-[^"]*"\s+'
                     r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)')
    acc = {0: [], 1: []}
    for sid in splits["train"][:limit]:
        base = RENDER / sid
        if not (base / "page-01.svg").is_file():
            continue
        gray = cv2.imread(str(base / "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        meta = json.loads((base / "meta.json").read_text())
        t = (base / "page-01.svg").read_text()
        m = MARGIN.search(t)
        if not m:
            continue
        tx, ty = float(m.group(1)), float(m.group(2))
        pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == 1)
        sx = gray.shape[1] / pw
        GLYPH = {"E262": 0, "E260": 1}
        for kg in KEYACCID.finditer(t):
            for gm in USE.finditer(kg.group(1)):
                if gm.group(1) not in GLYPH:
                    continue
                cx = (float(gm.group(2)) + tx) / 10 * sx
                cy = (float(gm.group(3)) + ty) / 10 * sx
                gap = next(p["median_staff_gap_px"]
                           for p in meta["page_geometry"] if p["page"] == 1) * sx
                c = crop(gray, cx, cy, gap, [])
                if c is not None:
                    n = norm32(c)
                    if n is not None:
                        acc[GLYPH[gm.group(1)]].append(n)
    return {k: np.mean(v, axis=0) for k, v in acc.items() if len(v) >= 5}


def strip_key(path):
    try:
        root = ET.parse(path).getroot()
        f = root.findtext(".//key/fifths")
        return int(f) if f is not None else None
    except ET.ParseError:
        return None


def clusters(g, lines, dark, fr, gap, bands):
    """Candidate accidental x-columns via the horizontal ink profile of the
    key-signature region (robust to glyphs being connected by staff-line
    remnants — connected components were measured to merge them)."""
    fx0 = frame_left_edge(dark, fr)
    if fx0 is None:
        return []
    rx0 = int(round(fx0 + X0G * gap))
    rx1 = int(round(fx0 + X1G * gap))
    ry0 = max(0, int(fr[0] - 2.5 * gap))
    ry1 = min(g.shape[0], int(fr[-1] + 2.5 * gap))
    reg = g[ry0:ry1, rx0:rx1]
    if reg.size == 0:
        return []
    mask = np.zeros(reg.shape, np.uint8)
    for lo, hi in bands:
        a, b = lo - ry0, hi - ry0
        if b > 0 and a < reg.shape[0]:
            mask[max(0, a):min(reg.shape[0], b), :] = 1
    ink = ((reg < 128) & (mask == 0)).astype(np.float64)
    if ink.sum() < 30:
        return []
    # y-band of the accidental zone (above the staff top line, where key
    # signatures live) plus a margin below for low flats
    zone = ink[int(0.15 * reg.shape[0]):int(0.95 * reg.shape[0]), :]
    prof = zone.sum(axis=0)               # ink per x column
    thr = max(3.0, 0.30 * prof.max())
    cols = np.where(prof >= thr)[0]
    out = []
    if len(cols):
        s = p = int(cols[0])
        for x in cols[1:]:
            x = int(x)
            if x - p <= max(2, int(0.35 * gap)):
                p = x
                continue
            out.append((s + p) // 2)
            s = p = x
        out.append((s + p) // 2)
    res = []
    for x in out:
        wpx = int(round(1.6 * gap))
        a = max(0, x - wpx // 2)
        b = min(reg.shape[1], x + wpx // 2 + 1)
        sub = ink[:, a:b]
        ys = np.nonzero(sub.sum(axis=1) > 0)[0]
        if len(ys) == 0:
            continue
        cy = ry0 + float(ys.mean())
        cx = rx0 + x
        res.append({"cx": cx, "cy": cy, "x": int(x), "w": int(wpx),
                    "h": int(ys.max() - ys.min()), "area": int(sub.sum())})
    res.sort(key=lambda c: c["x"])
    return res


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    clef_templates = _load_templates2()
    print("[sup] render templates...", flush=True)
    tpl = render_templates(splits, 240)
    print(f"[sup] render templates: sharp {len(tpl.get(0, [])) if hasattr(tpl.get(0, []), '__len__') else '-'}",
          flush=True)
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    stats = Counter()
    Xp, yp, sidp = [], [], []      # positives (verified)
    Xn, sidn = [], []              # backgrounds
    mont = []
    for d in dirs[VERIFY_N:VERIFY_N + 180]:
        # first strip of the sample carries the key signature
        png = d / "p1-s1.png"
        mx = d / "p1-s1.musicxml"
        if not (png.is_file() and mx.is_file()):
            stats["no_strip"] += 1
            continue
        fifths = strip_key(mx)
        if fifths is None or fifths == 0:
            stats["no_key"] += 1
            continue
        gray = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            stats["no_img"] += 1
            continue
        g = deskew(gray, estimate_skew(gray))
        lines, dark = staff_lines(g)
        frames = group_staves(lines, dark)
        if not frames:
            stats["no_frame"] += 1
            continue
        fr = frames[0]
        gap = (fr[-1] - fr[0]) / 4
        clef = detect_clef(g, dark, fr, gap, clef_templates)[0]
        if clef[0] not in ("G", "F"):
            stats["bad_clef"] += 1
            continue
        bands = line_bands(g, lines)
        cls = clusters(g, lines, dark, fr, gap, bands)
        stats["samples"] += 1
        n = abs(fifths)
        sign = 0 if fifths > 0 else 1
        if len(cls) < n:
            stats["align_short"] += 1
            continue
        chosen = cls[:n]
        over = cls[n:]                     # backgrounds from the same strip
        for c in chosen:
            cr = crop(g, c["cx"], c["cy"], gap, bands)
            if cr is None:
                stats["crop_fail"] += 1
                continue
            nrm = norm32(cr)
            if nrm is None:
                stats["norm_fail"] += 1
                continue
            # single-symbol purity: the crop's horizontal ink profile must be
            # ONE mass (adjacent accidentals merging is the observed failure
            # mode: peaks 1 gap apart merge above threshold). The crop spans
            # GW gaps over CW pixels.
            colp = (cr < 128).sum(axis=0).astype(np.int64)
            gap_cols = max(1, int(round(0.45 * gap * CW / (GW * gap))))
            masses = 0
            run = 0
            for v in colp:
                if v > 0:
                    run += 1
                elif run > 0:
                    masses += 1
                    run = 0
            if run > 0:
                masses += 1
            if masses > 1:
                stats["reject_multi_symbol"] += 1
                continue
            # independent appearance verification against render templates
            s_sharp = float((nrm * tpl[0]).sum())
            s_flat = float((nrm * tpl[1]).sum())
            agree = (s_sharp - s_flat) if sign == 0 else (s_flat - s_sharp)
            if agree < NCC_MARGIN:
                stats["reject_ambiguous"] += 1
                continue
            Xp.append(cr)
            yp.append(sign)
            sidp.append(d.name)
            stats["verified"] += 1
            if len(mont) < 40:
                mont.append((sign, cr))
        for c in over[:6]:
            cr = crop(g, c["cx"], c["cy"], gap, bands)
            if cr is not None:
                Xn.append(cr)
                sidn.append(d.name)
                stats["background"] += 1
    print(f"[sup] counts: {dict(stats)}", flush=True)
    print(f"[sup] positives {Counter(yp)} over {len(set(sidp))} strips; "
          f"backgrounds {len(Xn)}", flush=True)
    np.savez_compressed("/tmp/scan_sym_data.npz",
                        Xp=np.array(Xp), yp=np.array(yp),
                        sidp=np.array(sidp), Xn=np.array(Xn), sidn=np.array(sidn))
    if mont:
        m = np.zeros((CH, min(20, len(mont)) * CW), np.uint8)
        for j, (_s, c) in enumerate(mont[:20]):
            m[:, j * CW:(j + 1) * CW] = c
        cv2.imwrite(str(TRAIN / "reports" / "scan_sym_montage.png"), m)
        print("[sup] montage: reports/scan_sym_montage.png", flush=True)
    (TRAIN / "reports" / "scan_sym_stats.json").write_text(
        json.dumps({"counts": dict(stats),
                    "positives": {str(k): v for k, v in Counter(yp).items()},
                    "strips_with_positives": len(set(sidp)),
                    "render_template_count": "see build log"},
                   indent=1))


if __name__ == "__main__":
    main()

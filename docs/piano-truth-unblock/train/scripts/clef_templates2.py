#!/usr/bin/env python3
"""Scan-aware clef templates (TRAIN-side augmentation, disjoint verification).

Build per-class mean NCC templates from TWO sources:
  A. Verovio render clef instances (SMuFL glyph labels) - existing recipe
  B. OLiMPiC scanned frames whose truth clef comes from the sample's own
     MusicXML - TRAIN-side only (verification samples are held out)
Classification keeps the class-conditional window recipe (gap-relative),
so scale invariance is preserved. Writes models/clef_templates2.npz and
reports/clef_templates2.json (accuracy on both evaluation sets).
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
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import deskew, estimate_skew  # noqa: E402
from clef_detect import _sq, frame_left_edge  # noqa: E402
from clef_map import load_templates as load_templates_v1  # noqa: E402
from staff_geometry import parse_page  # noqa: E402
from clef_vision import clef_instances, crop_clef_at  # noqa: E402

SIZE = 32
VERIFY = None  # set below: the samples reserved for verification


def norm32(patch):
    v = cv2.resize(patch, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def window(gray, dark, fr, gap, cls):
    """Class-conditional startup window (same geometry as clef_detect)."""
    fx0 = frame_left_edge(dark, fr)
    if fx0 is None:
        return None
    if cls == "G":
        cen, half = (fx0 + 2.2 * gap, fr[2] + 0.15 * gap), 4.8 * gap
    elif cls == "F":
        cen, half = (fx0 + 2.2 * gap, fr[1] + 0.4 * gap), 2.0 * gap
    else:
        cen, half = (fx0 + 2.2 * gap, fr[2]), 2.0 * gap
    return _sq(gray, cen[0], cen[1], int(round(half)))


def collect_scan(sample_dirs):
    """[(cls, crop)] from scan samples using per-frame truth clefs."""
    out = []
    for d in sample_dirs:
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
        tcl = {}
        root = ET.parse(mxs[0]).getroot()
        for attr in root.iter("attributes"):
            for c in attr.findall("clef"):
                num = c.get("number") or attr.findtext("staff") or "1"
                tcl[num] = c.findtext("sign")
        staves = sorted(tcl)
        for fi, fr in enumerate(frames):
            if fi >= len(staves):
                break
            cls = tcl[staves[fi]]
            if cls not in ("G", "F", "C"):
                continue
            gap = (fr[-1] - fr[0]) / 4
            cr = window(g, dark, fr, gap, cls)
            if cr is not None:
                out.append((cls, cr))
    return out


def collect_render(splits, n_scores=25):
    out = []
    MARG = _re.compile(r'<g class="page-margin" transform="translate\('
                       r'([-0-9.]+),\s*([-0-9.]+)\)')
    GLYPH = {"E050": "G", "E062": "F", "E05C": "C"}
    for sid in splits["train"][:n_scores]:
        meta = json.loads((PILOT / "data" / "render" / sid / "meta.json").read_text())
        for pg in range(1, min(2, len(meta["page_geometry"]) + 1)):
            gray = cv2.imread(str(PILOT / "data" / "render" / sid /
                                  f"page-{pg:02d}.png"), cv2.IMREAD_GRAYSCALE)
            svg = (PILOT / "data" / "render" / sid / f"page-{pg:02d}.svg").read_text()
            if gray is None:
                continue
            m = MARG.search(svg)
            tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
            pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
            for c in clef_instances(svg):
                if c["glyph"] not in GLYPH or not c["bbox"]:
                    continue
                cr = crop_clef_at(gray, pw, tx, ty, c["bbox"])
                if cr is not None:
                    out.append((GLYPH[c["glyph"]], cr))
    return out


def main():
    all_dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    verify_dirs = all_dirs[:10]
    train_dirs = all_dirs[10:]
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    scan_rows = collect_scan(train_dirs)
    render_rows = collect_render(splits)
    print("[tpl] scan clefs (TRAIN-side):", Counter(k for k, _ in scan_rows),
          "render clefs:", Counter(k for k, _ in render_rows), flush=True)
    acc = {}
    for cls in ("G", "F", "C"):
        rows = [c for k, c in render_rows if k == cls] + \
               [c for k, c in scan_rows if k == cls]
        if rows:
            acc[cls] = np.mean(rows, axis=0)
    np.savez_compressed(TRAIN / "models" / "clef_templates2.npz",
                        **{k: v for k, v in acc.items()})
    # evaluation: renders + held-out scan samples
    def evaluate(render=True, scan=False):
        C = Counter()
        if render:
            MARG = _re.compile(r'<g class="page-margin" transform="translate\('
                               r'([-0-9.]+),\s*([-0-9.]+)\)')
            GLYPH = {"E050": ("G", 2), "E062": ("F", 4), "E05C": ("C", 3),
                     "E052": ("G", 2)}
            for sid in splits["dev"][:5]:
                gray = cv2.imread(str(PILOT / "data" / "render" / sid /
                                      "page-01.png"), cv2.IMREAD_GRAYSCALE)
                svg = (PILOT / "data" / "render" / sid / "page-01.svg").read_text()
                lines, dark = staff_lines(gray)
                frames = group_staves(lines, dark)
                cis = {}
                for meas in parse_page(svg):
                    for st in meas["staves"]:
                        for c in meas["clefs"]:
                            if c["rank"] == st["rank"] and c["glyph"] in GLYPH:
                                cis[st["rank"]] = GLYPH[c["glyph"]]
                for fi, fr in enumerate(frames):
                    if fi not in cis:
                        continue
                    gap = (fr[-1] - fr[0]) / 4
                    best = (None, -9.0)
                    for cls in acc:
                        cr = window(gray, dark, fr, gap, cls)
                        if cr is None:
                            continue
                        v = float((cr * acc[cls]).sum())
                        if v > best[1]:
                            best = (cls, v)
                    tv = cis[fi]
                    C["n"] += 1
                    C["ok" if (best[0], 2 if best[0] == "G" else
                               (4 if best[0] == "F" else 3)) == tv else "bad"] += 1
        return C
    Cr = evaluate(render=True)
    # held-out scans: same window recipe, truth clef per frame from MusicXML
    Cs = Counter()
    scan_detail = []
    for d in verify_dirs:
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
        tcl = {}
        root = ET.parse(mxs[0]).getroot()
        for attr in root.iter("attributes"):
            for c in attr.findall("clef"):
                num = c.get("number") or attr.findtext("staff") or "1"
                tcl[num] = c.findtext("sign")
        staves = sorted(tcl)
        for fi, fr in enumerate(frames):
            if fi >= len(staves):
                break
            cls = tcl[staves[fi]]
            if cls not in ("G", "F", "C"):
                continue
            gap = (fr[-1] - fr[0]) / 4
            best = (None, -9.0)
            for c2 in acc:
                cr = window(g, dark, fr, gap, c2)
                if cr is None:
                    continue
                v = float((cr * acc[c2]).sum())
                if v > best[1]:
                    best = (c2, v)
            Cs["n"] += 1
            hit = best[0] == cls
            Cs["ok" if hit else "bad"] += 1
            Cs["ok_" + cls] += (1 if hit else 0)
            Cs["n_" + cls] += 1
            scan_detail.append([d.name, fi, cls, best[0], round(best[1], 3)])
    out = {"render_acc": round(Cr["ok"] / max(1, Cr["n"]), 4),
           "render_n": Cr["n"],
           "scan_acc": round(Cs["ok"] / max(1, Cs["n"]), 4),
           "scan_n": Cs["n"],
           "scan_by_class": {k[3:]: f"{Cs['ok_' + k[3:]]}/{Cs['n_' + k[3:]]}"
                             for k in list(Cs) if k.startswith("n_")},
           "scan_detail": scan_detail,
           "templates": {k: int(v) for k, v in Counter(
               [k for k, _ in render_rows] + [k for k, _ in scan_rows]).items()}}
    (TRAIN / "reports" / "clef_templates2.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Clef classifier variants with render+scan supervision (disjoint verify).

Variants:
  mean_all : per-class mean over render+scan crops
  bank     : nearest-exemplar NCC over all crops (render + scan)
  src_max  : per-class mean per source, score = max over sources
Evaluation: DEV renders (frame-vote truth from SVG glyphs) and the held-out
OLiMPiC verification samples. Writes reports/clef_variants.json.
"""
from __future__ import annotations
import json
import re as _re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
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
from staff_geometry import parse_page  # noqa: E402
from clef_vision import clef_instances, crop_clef_at  # noqa: E402

SIZE = 32
GLYPH = {"E050": ("G", 2), "E062": ("F", 4), "E05C": ("C", 3),
         "E052": ("G", 2)}


def norm32(patch):
    v = cv2.resize(patch, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    v = v - v.mean()
    n = np.sqrt((v ** 2).sum())
    return v / n if n > 1e-9 else None


def window(gray, dark, fr, gap, cls):
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


def collect_scan(dirs):
    out = []
    for d in dirs:
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
            cr = window(g, dark, fr, (fr[-1] - fr[0]) / 4, cls)
            if cr is not None:
                out.append((cls, cr))
    return out


def collect_render(splits, n=60):
    out = []
    MARG = _re.compile(r'<g class="page-margin" transform="translate\('
                       r'([-0-9.]+),\s*([-0-9.]+)\)')
    G = {"E050": "G", "E062": "F", "E05C": "C"}
    for sid in splits["train"][:n]:
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
                if c["glyph"] not in G or not c["bbox"]:
                    continue
                cr = crop_clef_at(gray, pw, tx, ty, c["bbox"])
                if cr is not None:
                    out.append((G[c["glyph"]], cr))
    return out


def main():
    all_dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    verify_dirs = all_dirs[:10]
    train_dirs = all_dirs[10:]
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    scan_rows = collect_scan(train_dirs)
    render_rows = collect_render(splits)
    print("[clef] train crops:", Counter(k for k, _ in scan_rows),
          Counter(k for k, _ in render_rows), flush=True)
    # render frames for evaluation (truth = SVG glyph per frame rank)
    render_eval = []
    for sid in splits["dev"]:
        gray = cv2.imread(str(PILOT / "data" / "render" / sid /
                              "page-01.png"), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        svg = (PILOT / "data" / "render" / sid / "page-01.svg").read_text()
        lines, dark = staff_lines(gray)
        frames = group_staves(lines, dark)
        cis = {}
        for meas in parse_page(svg):
            for st in meas["staves"]:
                for c in meas["clefs"]:
                    if c["rank"] == st["rank"] and c["glyph"] in GLYPH:
                        cis[st["rank"]] = GLYPH[c["glyph"]]
        render_eval.append((gray, dark, frames, cis))
    scan_eval = []
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
        scan_eval.append((g, dark, frames, tcl))
    # models
    mean_all, bank, src_mean = {}, defaultdict(list), {}
    for cls in ("G", "F", "C"):
        rows = [c for k, c in render_rows if k == cls] + \
               [c for k, c in scan_rows if k == cls]
        if rows:
            mean_all[cls] = np.mean(rows, axis=0)
            bank[cls] = rows
            src_mean[("render", cls)] = np.mean([c for k, c in render_rows
                                                 if k == cls], axis=0)
            src_mean[("scan", cls)] = np.mean([c for k, c in scan_rows
                                               if k == cls], axis=0)

    def classify(crops_by_cls):
        """crops_by_cls: {cls: crop} -> best cls by the given model."""
        best = (None, -9.0)
        for cls, cr in crops_by_cls.items():
            if cr is None:
                continue
            v = float((cr * crops_by_cls[cls]).sum()) if False else None
        return best

    def strip_lines(patch, dark, fr, gap, cen, half):
        """Zero the staff rows inside a window patch (line-thickness
        agnostic templating)."""
        x0 = int(round(cen[0] - half)); y0 = int(round(cen[1] - half))
        out = patch.copy()
        for y in fr:
            yy = int(round(y)) - y0
            if 0 <= yy < out.shape[0]:
                out[max(0, yy - 1):yy + 2, :] = 0
        return out

    bank_nl = defaultdict(list)   # line-stripped crops
    for cls in ("G", "F", "C"):
        pass

    def run(model, src):
        C = Counter()
        if src == "render":
            items = [(gray, dark, frames, cis) for (gray, dark, frames, cis)
                     in render_eval]
            for (gray, dark, frames, cis) in items:
                for fi, fr in enumerate(frames):
                    if fi not in cis:
                        continue
                    gap = (fr[-1] - fr[0]) / 4
                    tv = cis[fi]
                    scores = {}
                    for cls in ("G", "F", "C"):
                        if cls not in mean_all:
                            continue
                        cr = window(gray, dark, fr, gap, cls)
                        if cr is None:
                            continue
                        if model == "mean_all":
                            scores[cls] = float((cr * mean_all[cls]).sum())
                        elif model == "bank":
                            scores[cls] = max(float((cr * t).sum()) for t in bank[cls])
                        else:
                            scores[cls] = (max(
                                float((cr * src_mean[(s2, cls)]).sum())
                                for s2 in ("render", "scan") if (s2, cls) in src_mean)
                                if model == "src_max" else sum(
                                float((cr * src_mean[(s2, cls)]).sum())
                                for s2 in ("render", "scan") if (s2, cls) in src_mean))
                    if not scores:
                        continue
                    pred = max(scores, key=scores.get)
                    line = 2 if pred == "G" else (4 if pred == "F" else 3)
                    C["n"] += 1
                    C["ok" if (pred, line) == tv else "bad"] += 1
        else:
            for (g, dark, frames, tcl) in scan_eval:
                staves = sorted(tcl)
                for fi, fr in enumerate(frames):
                    if fi >= len(staves):
                        break
                    cls = tcl[staves[fi]]
                    if cls not in ("G", "F", "C"):
                        continue
                    gap = (fr[-1] - fr[0]) / 4
                    scores = {}
                    for c2 in ("G", "F", "C"):
                        if c2 not in mean_all:
                            continue
                        cr = window(g, dark, fr, gap, c2)
                        if cr is None:
                            continue
                        if model == "mean_all":
                            scores[c2] = float((cr * mean_all[c2]).sum())
                        elif model == "bank":
                            scores[c2] = max(float((cr * t).sum()) for t in bank[c2])
                        else:
                            scores[c2] = (max(
                                float((cr * src_mean[(s2, c2)]).sum())
                                for s2 in ("render", "scan") if (s2, c2) in src_mean)
                                if model == "src_max" else sum(
                                float((cr * src_mean[(s2, c2)]).sum())
                                for s2 in ("render", "scan") if (s2, c2) in src_mean))
                    if not scores:
                        continue
                    pred = max(scores, key=scores.get)
                    C["n"] += 1
                    C["ok" if pred == cls else "bad"] += 1
        return {"acc": round(C["ok"] / max(1, C["n"]), 4), "n": C["n"],
                "ok": C["ok"]}

    out = {}
    for model in ("mean_all", "bank", "src_max", "src_sum"):
        out[model] = {"render": run(model, "render"),
                      "scan": run(model, "scan")}
        print(model, json.dumps(out[model]), flush=True)
    (TRAIN / "reports" / "clef_variants.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

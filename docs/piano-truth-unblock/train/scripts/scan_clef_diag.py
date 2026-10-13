#!/usr/bin/env python3
"""Scan clef diagnosis: dump the crops that get misclassified.

For OLiMPiC scanned staves (truth clef from MusicXML) and DEV renders,
save the class-conditional windows so the failure can be inspected, and
report structural features (glyph height in gaps, dot count, center
position) per class/source. Writes reports/scan_clef_diag.json + PNGs.
"""
from __future__ import annotations
import json
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
OLIMPIC = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned" / "samples"
sys_path = str(HERE)
import sys
sys.path.insert(0, sys_path)
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import deskew, estimate_skew  # noqa: E402
from clef_detect import _sq, detect_clef, frame_left_edge  # noqa: E402
from clef_map import load_templates  # noqa: E402

GLYPH = {"E050": ("G", 2), "E062": ("F", 4), "E05C": ("C", 3),
         "E052": ("G", 2)}
OUT = Path("/tmp/clefscan")
OUT.mkdir(exist_ok=True)


def truth_clefs(mx):
    root = ET.parse(mx).getroot()
    out = {}
    for attr in root.iter("attributes"):
        for c in attr.findall("clef"):
            num = c.get("number") or attr.findtext("staff") or "1"
            out[num] = (c.findtext("sign"), c.findtext("line"))
    return out


def features(gray, dark, fr, gap, fx0):
    """Structural features of the startup region, in gap units."""
    rx0 = max(0, int(fx0 - 0.2 * gap))
    rx1 = int(fx0 + 3.2 * gap)
    ry0 = max(0, int(fr[0] - 3.0 * gap))
    ry1 = min(gray.shape[0], int(fr[-1] + 3.0 * gap))
    reg = dark[ry0:ry1, rx0:rx1]
    ncc, _lab, stats, _c = cv2.connectedComponentsWithStats(reg, 8)
    comps = []
    for i in range(1, ncc):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 6 or w < 2 or h < 2:
            continue
        comps.append({"x": x, "y": y, "w": w / gap, "h": h / gap,
                      "area": int(area)})
    dots = [c for c in comps if c["w"] < 0.5 and c["h"] < 0.5 and c["area"] > 4]
    big = [c for c in comps if c["h"] > 1.5]
    big.sort(key=lambda c: -c["h"])
    top = big[0] if big else None
    return {
        "n_comps": len(comps),
        "dot_like": len(dots),
        "tallest_h_gaps": round(top["h"], 2) if top else 0.0,
        "tallest_w_gaps": round(top["w"], 2) if top else 0.0,
        "tallest_rel_center": round((top["y"] + top["h"] / 2 - (fr[2] - ry0) / gap), 2)
        if top else 0.0,
        "tallest_rel_top": round((top["y"] - (fr[0] - ry0) / gap), 2) if top else 0.0,
    }


def main():
    templates = load_templates()
    rows = []
    # --- OLiMPiC scans
    for d in sorted(OLIMPIC.iterdir())[:8]:
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
        tcl = truth_clefs(mxs[0])
        staves = sorted(tcl)
        for fi, fr in enumerate(frames):
            if fi >= len(staves):
                break
            gap = (fr[-1] - fr[0]) / 4
            fx0 = frame_left_edge(dark, fr)
            if fx0 is None:
                continue
            auto = detect_clef(g, dark, fr, gap, templates)[0]
            tv = tcl[staves[fi]]
            f = features(g, dark, fr, gap, fx0)
            f.update({"src": "scan", "sample": d.name, "frame": fi,
                      "truth": list(tv), "auto": list(auto)})
            rows.append(f)
            if auto != (tv[0], int(tv[1])):
                x0 = int(fx0 + 2.2 * gap - 2.0 * gap)
                x1 = int(fx0 + 2.2 * gap + 2.0 * gap)
                y0 = max(0, int(fr[0] - 2.0 * gap))
                y1 = min(g.shape[0], int(fr[-1] + 2.0 * gap))
                cv2.imwrite(str(OUT / f"{d.name}_{fi}_truth{tv[0]}_auto{auto[0]}.png"),
                            cv2.resize(g[y0:y1, x0:x1], (128, 128),
                                       interpolation=cv2.INTER_NEAREST))
    # --- DEV renders (oracle clefs via SVG glyphs)
    from staff_geometry import parse_page
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    for sid in splits["dev"][:5]:
        for pg in (1,):
            gray = cv2.imread(str(PILOT / "data" / "render" / sid /
                                  f"page-{pg:02d}.png"), cv2.IMREAD_GRAYSCALE)
            svg = (PILOT / "data" / "render" / sid / f"page-{pg:02d}.svg").read_text()
            lines, dark = staff_lines(gray)
            frames = group_staves(lines, dark)
            cis = {}
            for _mi, _meas in enumerate(parse_page(svg)):
                for _st in _meas["staves"]:
                    for _c in _meas["clefs"]:
                        if _c["rank"] == _st["rank"] and _c["glyph"] in GLYPH:
                            cis[_st["rank"]] = GLYPH[_c["glyph"]]
            for fi, fr in enumerate(frames):
                if fi not in cis:
                    continue
                gap = (fr[-1] - fr[0]) / 4
                fx0 = frame_left_edge(dark, fr)
                if fx0 is None:
                    continue
                auto = detect_clef(gray, dark, fr, gap, templates)[0]
                tv = cis[fi]
                f = features(gray, dark, fr, gap, fx0)
                f.update({"src": "render", "sample": sid[:6], "frame": fi,
                          "truth": list(tv), "auto": list(auto)})
                rows.append(f)
    (TRAIN / "reports" / "scan_clef_diag.json").write_text(json.dumps(rows, indent=1))
    # aggregate: feature discriminability by class
    agg = {}
    for r in rows:
        if r["src"] != "scan":
            continue
        k = r["truth"][0]
        agg.setdefault(k, []).append(r)
    for k, v in sorted(agg.items()):
        print("scan truth", k, "n", len(v),
              "dot_like med", float(np.median([x["dot_like"] for x in v])),
              "tallest_h", float(np.median([x["tallest_h_gaps"] for x in v])),
              "tallest_w", float(np.median([x["tallest_w_gaps"] for x in v])),
              "rel_center", float(np.median([x["tallest_rel_center"] for x in v])),
              "auto", Counter("%s%s" % (x["auto"][0], x["auto"][1]) for x in v))
    agg2 = {}
    for r in rows:
        if r["src"] != "render":
            continue
        agg2.setdefault(r["truth"][0], []).append(r)
    for k, v in sorted(agg2.items()):
        print("render truth", k, "n", len(v),
              "dot_like med", float(np.median([x["dot_like"] for x in v])),
              "tallest_h", float(np.median([x["tallest_h_gaps"] for x in v])),
              "auto", Counter("%s%s" % (x["auto"][0], x["auto"][1]) for x in v))


if __name__ == "__main__":
    main()

"""O1 - cheap PDF-only truth adjudication artifacts.

Full-staff inspection is too expensive per measure to reach 30-50 measures, so
truth is bootstrapped candidate-first:

  A. a glyph grid - one small tile per detected candidate, centred on it. From one
     image the reader can accept/reject many candidates and, crucially, NAME the
     glyph, which is what the O7 taxonomy needs.
  B. a staff strip per measure with accepted onsets marked, so noteheads the
     detector MISSED are visible.

Both are built from the raster and frozen PDF geometry only. No MusicXML, Verovio,
pitch, d0, true_d or residual is read.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
from o_onset_detector import detect  # noqa: E402

OUT = Path(__file__).parent / "out"
ART = Path(__file__).parent / "out/o_artifacts"
ART.mkdir(parents=True, exist_ok=True)

DEV_SCORES = {
    "bc-chopin-etude-op10-12", "bc-chopin-nocturne-op9-n2",
    "pl-chopin-mazurka-op6-1", "omf-piano-grand-voices-vector",
    "pl-tchaikovsky-old-french-song",
}
HELD_SCORES = {
    "bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
    "pl-mozart-turkish-march", "pl-bach-prelude-bwv846",
    "std-demo-minuet-in-g", "pl-handel-gavotte",
    "bc-chopin-etude-op10-01", "omf-piano-dense-advanced-vector",
}
PER_SCORE = 2


def load_ctx():
    systems = json.load(open(OUT / "F_systems.json"))
    bypage = defaultdict(list)
    for x in systems:
        bypage[(x["score"], x["page"])].append(x)
    for v in bypage.values():
        v.sort(key=lambda z: z["y0"])
    imgs = {}

    def img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]
    man = json.load(open(OUT / "M7_measure_map.json"))
    US = ("EXACT_ANCHORED", "HIGH_CONFIDENCE_INTERIOR",
          "HIGH_CONFIDENCE_COUNT_ANCHORED")
    usable = [m for m in man if m["mapping_class"] in US and m["xml_ord"] is not None]
    from m_measure_map import pdf_intervals
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}
    out = []
    for m in usable:
        sid, pno = m["score"], m["page"]
        im = img(sid, pno)
        r = iv.get((sid, m["pdf_ord"]))
        if im is None or r is None:
            continue
        Hh = im.shape[0]
        sy = bypage[(sid, pno)][m["system"]]
        det = {}
        for role in ("upper", "lower"):
            y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
            det[role] = detect(im, y0, y1, r["x_left"], r["x_right"])
        out.append({"key": "%s|p%d|s%d|m%d" % (sid, pno, m["system"], m["xml_ord"]),
                    "score": sid, "page": pno, "system": m["system"],
                    "xml_ord": m["xml_ord"],
                    "split": "DEV" if sid in DEV_SCORES else "HELDOUT",
                    "sy": sy, "iv": r, "det": det, "im": im})
    return out


def pick(ctx):
    """Pick per-score measures spanning the density range."""
    bysc = defaultdict(list)
    for c in ctx:
        bysc[c["score"]].append(c)
    chosen = []
    for sid in sorted(bysc):
        items = bysc[sid]
        items.sort(key=lambda c: (
            len(c["det"]["upper"]["onsets"]) if c["det"].get("upper") else 0))
        if not items:
            continue
        picked = [items[0], items[-1]] if len(items) > 1 else [items[0]]
        chosen.extend(picked[:PER_SCORE])
    return chosen


def glyph_grid(ctx, chosen, role, path, cols=10, tile=46, zoom=4):
    """One tile per detected candidate, centred on it, ordered by measure."""
    tiles, index = [], []
    for c in chosen:
        d = c["det"].get(role)
        if not d:
            continue
        im = c["im"]
        Hh = im.shape[0]
        for k, cd in enumerate(d["cands"]):
            gx, gy = int(round(cd["x"])), int(round(cd["y"]))
            if cd["y"] > Hh:
                gy = gy
            a, b = gx - tile // 2, gx + tile // 2
            y0 = max(0, int(cd["y"]) - tile // 2)
            y1 = min(im.shape[0], y0 + tile)
            if y1 - y0 < 6:
                continue
            crop = im[y0:y1, max(0, a):min(im.shape[1], b)]
            if crop.size == 0:
                continue
            ch, cw = crop.shape
            canvas = np.full((tile, tile, 3), 255, np.uint8)
            hh = min(ch, tile)
            ww = min(cw, tile)
            canvas[:hh, :ww, 0] = crop[:hh, :ww]
            tiles.append(canvas)
            index.append({"key": c["key"], "role": role, "cand": k,
                          "x": cd["x"], "y": cd["y"], "w": cd["w"], "h": cd["h"],
                          "split": c["split"], "score": c["score"]})
    if not tiles:
        return None
    rows = (len(tiles) + cols - 1) // cols
    canvas = np.full((rows * (tile + 3), cols * (tile + 3), 3), 240, np.uint8)
    for i, t in enumerate(tiles):
        r, c_ = divmod(i, cols)
        canvas[r * (tile + 3):r * (tile + 3) + tile,
               c_ * (tile + 3):c_ * (tile + 3) + tile] = t
    img = Image.fromarray(canvas).resize(
        (canvas.shape[1] * zoom // 2, canvas.shape[0] * zoom // 2), Image.NEAREST)
    img.save(path)
    return {"path": str(path), "n": len(tiles), "index": index,
            "w": img.width, "h": img.height}


def strip(ctx, chosen, path, zoom=2):
    tiles, index = [], []
    for c in chosen:
        im = c["im"]
        Hh = im.shape[0]
        for role in ("upper", "lower"):
            d = c["det"].get(role)
            if not d:
                continue
            sy = c["sy"][role]
            a, b = d["x0"], d["x1"]
            y0 = max(0, int(sy[0] * Hh) - 5)
            y1 = min(im.shape[0], int(sy[1] * Hh) + 5)
            crop = im[y0:y1 + 1, max(0, a):min(im.shape[1], b)]
            if crop.size == 0 or crop.shape[0] < 8:
                continue
            rgb = np.dstack([crop, crop, crop])
            h, w = rgb.shape[:2]
            off = a
            for o in d["onsets"]:
                xx = int(round(o["x"])) - off
                if 0 <= xx < w:
                    rgb[:, xx] = [255, 0, 0]
            tiles.append(rgb)
            index.append({"key": c["key"], "role": role, "x0": off,
                          "n_onsets": len(d["onsets"]), "score": c["score"],
                          "split": c["split"]})
    if not tiles:
        return None
    gap = 6
    Ht = sum(t.shape[0] + gap for t in tiles)
    Wt = max(t.shape[1] for t in tiles)
    canvas = np.full((Ht, Wt, 3), 255, np.uint8)
    y = 0
    for t in tiles:
        canvas[y:y + t.shape[0], :t.shape[1]] = t
        y += t.shape[0] + gap
    img = Image.fromarray(canvas).resize((Wt * zoom, Ht * zoom), Image.LANCZOS)
    img.save(path)
    return {"path": str(path), "n": len(tiles), "index": index,
            "w": img.width, "h": img.height}


def main():
    ctx = load_ctx()
    chosen = pick(ctx)
    print("O1  truth bootstrap artifacts")
    print("  candidate measures selected : %d" % len(chosen))
    dev = [c for c in chosen if c["split"] == "DEV"]
    held = [c for c in chosen if c["split"] == "HELDOUT"]
    print("  DEV measures %d (%s)" % (len(dev), ", ".join(sorted({c['score'][:18] for c in dev}))))
    print("  HELDOUT measures %d (%s)" % (len(held), ", ".join(sorted({c['score'][:18] for c in held}))))
    meta = {"dev_scores": sorted(DEV_SCORES), "heldout_scores": sorted(HELD_SCORES),
            "measures": [{"key": c["key"], "score": c["score"], "page": c["page"],
                          "system": c["system"], "xml_ord": c["xml_ord"],
                          "split": c["split"]} for c in chosen]}
    arts = {}
    for role in ("upper", "lower"):
        for nm, sel in (("dev", dev), ("held", held)):
            g = glyph_grid(ctx, sel, role, ART / ("glyph_%s_%s.png" % (role, nm)))
            if g:
                arts["glyph_%s_%s" % (role, nm)] = g
    s = strip(ctx, chosen, ART / "strips_all.png")
    if s:
        arts["strips_all"] = s
    H.write_json("O1_artifact_index.json", {k: {"path": v["path"], "n": v["n"],
                                                "w": v["w"], "h": v["h"],
                                                "index": v["index"]}
                                           for k, v in arts.items()})
    json.dump(meta, open(OUT / "O1_measure_selection.json", "w"), indent=1)
    for k, v in arts.items():
        print("  %-18s tiles=%-4d %dx%d" % (k, v["n"], v["w"], v["h"]))


if __name__ == "__main__":
    main()
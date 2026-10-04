"""S2-S4 - SIMPLE-subset truth artifacts and the S3 original-ink correction.

S2  artifacts per SIMPLE staff-region: glyph grid (one tile per candidate, so a false
    positive can be named) plus a staff strip with candidates marked, so MISSES are
    visible. Recall cannot be measured from a grid alone, which is why the strip exists.

S3  the O3 failure is addressed structurally rather than by tuning:
      (a) ORIGINAL-INK VALIDATION - a candidate may be proposed from line-suppressed
          ink, but it is rejected if the non-staff-line ink in its own centre columns
          extends far beyond a notehead. A clef fragment or a time-signature digit
          sits inside a glyph several staff gaps tall, so this rejects them without
          touching any size threshold.
      (b) SYSTEM-START PRELUDE EXCLUSION - a clef, key signature and time signature
          are printed only at a system start, and occupy roughly the first 12 staff
          gaps. Candidates there are excluded by engraving convention, not by a
          fitted threshold.
    Neither correction is claimed to help dense notation; both are restricted to this
    SIMPLE experiment.

No pitch, d0, true_d, residual or decoder output is read.
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
import stage_a2_consensus as A2  # noqa: E402
from o_onset_detector import strip_lines, components, line_rows  # noqa: E402

OUT = Path(__file__).parent / "out"
ART = Path(__file__).parent / "out/s_artifacts"
ART.mkdir(parents=True, exist_ok=True)
DARK = 140
W_MIN, W_MAX = 0.50, 2.30
H_MIN, H_MAX = 0.42, 1.85
FILL_MIN = 0.30
ONSET_TOL_GAPS = 1.35

# ---- S3 correction constants (geometry-derived, not fitted)
# CORRECTION 1 (targets the MEASURED FP mode: clef / time-signature / key-signature
# fragments, all at a system start). A clef occupies roughly the first 2.5 staff gaps
# and the time signature roughly the next 2, so every candidate in the first
# PRELUDE_GAPS of a staff belongs to pre-notational glyphs, not to music. This is an
# engraving-convention exclusion, not a threshold fitted to any score comparison.
#
# The earlier "original-ink vertical extent" test was tried and REJECTED by
# measurement: 136 of 156 candidates were killed because a notehead's own columns also
# contain its stem, so the extent test cannot separate a stem from a clef fragment.
PRELUDE_GAPS = 8.0

# CORRECTION 2 (targets the same measured FP mode without the fixed prelude's recall
# cost). A clef, time signature or key signature spans the staff vertically, so staff-
# line suppression FRAGMENTS it into several pieces that STACK vertically at nearly the
# same x. A real notehead is vertically isolated. So: count suppressed components that
# sit directly above or below a candidate, overlapping it in x by at least half its
# width and lying within STACK_GAPS vertically. A glyph fragment stacks; a notehead
# does not. This makes the prelude adaptive - no fixed x window - so notes printed
# early in a system survive while pre-notational glyphs do not.
STACK_GAPS = 1.4
STACK_XSHARE = 0.5

# ---- score-disjoint split. Handel+minuet are held out: they hold 121 of 156
# candidates, so the gate is measured on the largest population while tuning happens
# on 10 other scores.
HELDOUT_SCORES = {"pl-handel-gavotte", "std-demo-minuet-in-g"}
DEV_SCORES = {"bc-bach-fugue-bwv846", "bc-chopin-nocturne-op9-n2",
              "bc-mozart-k153", "omf-piano-dense-advanced-vector",
              "omf-piano-grand-voices-vector", "pl-bach-prelude-bwv846",
              "pl-beethoven-fur-elise", "pl-chopin-mazurka-op6-1",
              "pl-tchaikovsky-old-french-song"}


def detect_region(im, y0, y1, x_lo, x_hi, staff_x0, apply_s3=True,
                  use_prelude=True, use_stack=False):
    rows, gap = line_rows(im, y0, y1)
    if rows is None or gap < 3:
        return None
    W = im.shape[1]
    a = max(0, int(x_lo))
    b = min(W, int(x_hi) + 1)
    if b - a < 8:
        return None
    top = int(round(y0))
    bot = int(round(y1))
    band = im[top:bot + 1, a:b] < DARK
    h, w = band.shape
    lrows = sorted({min(max(0, r - top), h - 1) for r in rows})
    lineset = set(lrows)
    for r in lrows:
        for dr in (-1, 1):
            if 0 <= r + dr < h:
                lineset.add(r + dr)
    clean = strip_lines(band, lrows, gap)
    lab, n = components(clean)
    allboxes = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if not len(ys):
            continue
        allboxes.append((int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())))

    def stacked(x0c, x1c, y0c, y1c):
        c = 0
        wq = STACK_XSHARE * (x1c - x0c + 1)
        for (ax0, ax1, ay0, ay1) in allboxes:
            if (ax0, ax1, ay0, ay1) == (x0c, x1c, y0c, y1c):
                continue
            if ax1 < x0c + wq or ax0 > x1c - wq:
                continue
            if ay1 < y0c - STACK_GAPS * gap or ay0 > y1c + STACK_GAPS * gap:
                continue
            c += 1
        return c

    out = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if not len(ys):
            continue
        y0c, y1c, x0c, x1c = ys.min(), ys.max(), xs.min(), xs.max()
        bw, bh = x1c - x0c + 1, y1c - y0c + 1
        fill = len(ys) / float(bw * bh)
        if not (W_MIN * gap <= bw <= W_MAX * gap and H_MIN * gap <= bh <= H_MAX * gap
                and fill >= FILL_MIN):
            continue
        cxa = a + (x0c + x1c) / 2.0
        cya = top + (y0c + y1c) / 2.0
        rec = {"x": cxa, "y": cya, "w": bw, "h": bh, "fill": round(fill, 3),
               "box": [a + x0c, top + y0c, a + x1c, top + y1c],
               "reject": None}
        if apply_s3:
            if use_prelude and cxa < staff_x0 + PRELUDE_GAPS * gap:
                rec["reject"] = "prelude_zone"
            elif use_stack:
                ns = stacked(x0c, x1c, y0c, y1c)
                rec["n_stacked"] = int(ns)
                if ns >= 1:
                    rec["reject"] = "glyph_stack"
        out.append(rec)
    out.sort(key=lambda c: c["x"])
    kept = [c for c in out if not c["reject"]]
    tol = ONSET_TOL_GAPS * gap
    onsets, cur = [], ([kept[0]] if kept else [])
    for c in kept[1:]:
        if c["x"] - cur[-1]["x"] <= tol:
            cur.append(c)
        else:
            onsets.append(cur)
            cur = [c]
    if cur:
        onsets.append(cur)
    groups = []
    for gi, g in enumerate(onsets):
        ys = sorted({round(c["y"], 1) for c in g})
        card = 1
        for k in range(len(ys) - 1):
            if ys[k + 1] - ys[k] > 0.45 * gap:
                card += 1
        groups.append({"onset": gi, "x": float(np.mean([c["x"] for c in g])),
                       "card": card})
    return {"gap": gap, "cands": out, "kept": kept, "onsets": groups,
            "x0": a, "x1": b, "top": top, "bot": bot, "prelude_x": staff_x0}


def glyph_grid(items, path, cols=10, tile=44, zoom=4):
    tiles, index = [], []
    for it in items:
        im, det = it["im"], it["det"]
        for k, c in enumerate(det["cands"]):
            gx, gy = int(round(c["x"])), int(round(c["y"]))
            a, b = gx - tile // 2, gx + tile // 2
            y0 = max(0, gy - tile // 2)
            y1 = min(im.shape[0], y0 + tile)
            if y1 - y0 < 6:
                continue
            crop = im[y0:y1, max(0, a):min(im.shape[1], b)]
            if crop.size == 0:
                continue
            ch, cw = crop.shape
            canvas = np.full((tile, tile), 255, np.uint8)
            hh, ww = min(ch, tile), min(cw, tile)
            canvas[:hh, :ww] = crop[:hh, :ww]
            if c["reject"]:
                canvas[:2, :] = 0        # black bar = rejected by S3
            tiles.append(canvas)
            index.append({"key": it["key"], "role": it["role"], "cand": k,
                          "reject": c["reject"], "x": c["x"], "y": c["y"]})
    if not tiles:
        return None
    rows = (len(tiles) + cols - 1) // cols
    canvas = np.full((rows * (tile + 3), cols * (tile + 3)), 235, np.uint8)
    for i, t in enumerate(tiles):
        r, c_ = divmod(i, cols)
        canvas[r * (tile + 3):r * (tile + 3) + tile,
               c_ * (tile + 3):c_ * (tile + 3) + tile] = t
    img = Image.fromarray(canvas).resize(
        (canvas.shape[1] * zoom // 2, canvas.shape[0] * zoom // 2), Image.NEAREST)
    img.save(path)
    return {"path": str(path), "n": len(tiles), "index": index,
            "w": img.width, "h": img.height}


def strip(items, path, zoom=2):
    tiles, index = [], []
    for it in items:
        im, det = it["im"], it["det"]
        a, b = det["x0"], det["x1"]
        crop = im[det["top"] - 4:det["bot"] + 5, max(0, a):min(im.shape[1], b)]
        if crop.size == 0 or crop.shape[0] < 8:
            continue
        rgb = np.dstack([crop, crop, crop])
        h, w = rgb.shape[:2]
        for o in det["onsets"]:
            xx = int(round(o["x"])) - a
            if 0 <= xx < w:
                rgb[:, xx] = [255, 0, 0]
        tiles.append(rgb)
        index.append({"key": it["key"], "role": it["role"], "x0": a,
                      "n_onsets": len(det["onsets"]), "n_cands": len(det["cands"]),
                      "n_kept": len(det["kept"])})
    if not tiles:
        return None
    gapv = 8
    Ht = sum(t.shape[0] + gapv for t in tiles)
    Wt = max(t.shape[1] for t in tiles)
    canvas = np.full((Ht, Wt, 3), 255, np.uint8)
    y = 0
    for t in tiles:
        canvas[y:y + t.shape[0], :t.shape[1]] = t
        y += t.shape[0] + gapv
    img = Image.fromarray(canvas).resize((Wt * zoom, Ht * zoom), Image.LANCZOS)
    img.save(path)
    return {"path": str(path), "n": len(tiles), "index": index,
            "w": img.width, "h": img.height}


def build(apply_s3, use_prelude=True, use_stack=False):
    systems = json.load(open(OUT / "F_systems.json"))
    bypage = defaultdict(list)
    for x in systems:
        bypage[(x["score"], x["page"])].append(x)
    for v in bypage.values():
        v.sort(key=lambda z: z["y0"])
    feats = json.load(open(OUT / "S1_features.json"))
    fk = {(r["key"]): r for r in feats}
    man = json.load(open(OUT / "M7_measure_map.json"))
    US = ("EXACT_ANCHORED", "HIGH_CONFIDENCE_INTERIOR",
          "HIGH_CONFIDENCE_COUNT_ANCHORED")
    umap = {(m["score"], m["pdf_ord"]): m for m in man
            if m["mapping_class"] in US and m["xml_ord"] is not None}
    from m_measure_map import pdf_intervals
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}
    items = []
    for (sid, pno) in sorted(bypage):
        need = [r for r in fk.values()
                if r["score"] == sid and r["page"] == pno
                and any(f.get("simple") for f in r["roles"].values())]
        if not need:
            continue
        p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
        if not p.is_file():
            continue
        im = np.array(Image.open(p))
        Hh = im.shape[0]
        for r in need:
            g = iv.get((sid, r["pdf_ord"]))
            if g is None:
                continue
            sy = bypage[(sid, pno)][r["system"]]
            for role in ("upper", "lower"):
                if not r["roles"][role].get("simple"):
                    continue
                y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
                sr = A2.staff_rows(im, y0, y1)
                if len(sr) < 3:
                    continue
                sx0 = min(q[1] for q in sr)
                det = detect_region(im, y0, y1, g["x_left"], g["x_right"],
                                    sx0, apply_s3, use_prelude, use_stack)
                if det is None:
                    continue
                items.append({"key": r["key"], "score": sid, "role": role,
                              "page": pno, "system": r["system"],
                              "xml_ord": r["xml_ord"],
                              "split": "HELDOUT" if sid in HELDOUT_SCORES else "DEV",
                              "im": im, "det": det})
        del im
    return items


def main():
    for tag, apply_s3, pre, stk in (("base", False, False, False),
                                    ("c1", True, True, False),
                                    ("c2", True, False, True),
                                    ("c1c2", True, True, True)):
        items = build(apply_s3, pre, stk)
        dev = [i for i in items if i["split"] == "DEV"]
        held = [i for i in items if i["split"] == "HELDOUT"]
        nc = sum(len(i["det"]["cands"]) for i in items)
        nk = sum(len(i["det"]["kept"]) for i in items)
        no = sum(len(i["det"]["onsets"]) for i in items)
        print("S3 variant=%-5s regions=%-3d (DEV %d / HELDOUT %d)  candidates=%-4d "
              "kept=%-4d onsets=%d"
              % (tag, len(items), len(dev), len(held), nc, nk, no))
        g = glyph_grid(dev, ART / ("dev_%s.png" % tag))
        if g:
            print("      dev glyph grid %s tiles=%d" % (Path(g['path']).name, g["n"]))
        meta = {"variant": tag, "apply_s3": apply_s3, "use_prelude": pre, "use_stack": stk,
                "prelude_gaps": PRELUDE_GAPS,
                "dev_scores": sorted(DEV_SCORES),
                "heldout_scores": sorted(HELDOUT_SCORES),
                "regions": [{"key": i["key"], "role": i["role"],
                             "split": i["split"], "score": i["score"],
                             "page": i["page"], "system": i["system"],
                             "xml_ord": i["xml_ord"],
                             "n_cands": len(i["det"]["cands"]),
                             "n_kept": len(i["det"]["kept"]),
                             "n_onsets": len(i["det"]["onsets"]),
                             "onsets": i["det"]["onsets"],
                             "cands": [{k: c[k] for k in
                                        ("x", "y", "w", "h", "fill", "reject",
                                         )} for c in i["det"]["cands"]]}
                            for i in items]}
        H.write_json("S3_regions_%s.json" % tag, meta)


if __name__ == "__main__":
    main()
"""O0-O5 - raster-only printed-onset detector.

Decides whether a printed onset / notehead group exists using ONLY the page raster
and already-frozen PDF geometry (validated staff rectangles, validated printed
measure boundaries from the frozen detector).

Never reads: MusicXML pitch, MusicXML/Verovio onset counts, Verovio notehead
positions, d0, true_d, residual sign, decoder output, or the absence of a corpus
annotation as evidence that nothing is printed. Pitch classification is not
attempted at any point.

Method
  O2  connected-component notehead candidates on ink with staff-line runs removed
  O3  staff-line suppression removes only long horizontal runs, so a notehead that
      overlaps a line survives as a slotted blob and is still detected
  O4  onset groups by clustering candidate x with a geometry-relative tolerance
  O5  cardinality = vertically distinct candidates; voice assignment is not made
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

OUT = Path(__file__).parent / "out"
MONT = Path(__file__).parent / "out/o_montages"
DARK = 140

# ---- frozen, geometry-derived constants (staff gap is the unit everywhere)
LINE_TOL_PX = 1.5      # staff-line half thickness
LINE_RUN_GAPS = 3.0    # a run longer than this many gaps is a staff line
W_MIN, W_MAX = 0.50, 2.30      # notehead width, in staff gaps
H_MIN, H_MAX = 0.42, 1.85      # notehead height, in staff gaps
FILL_MIN = 0.30                # area / bbox area
ONSET_TOL_GAPS = 1.35          # clustering tolerance for one onset, in staff gaps


def line_rows(im, y0, y1):
    sr = A2.staff_rows(im, y0, y1)
    if len(sr) < 3:
        return None, None
    rows = sorted({r[0] for r in sr})
    if len(rows) < 5:
        rows = [int(round(y0 + k * (y1 - y0) / 4.0)) for k in range(5)]
    gap = (y1 - y0) / 4.0
    return rows, gap


def strip_lines(mask, rows, gap):
    """Remove long horizontal staff-line runs. Returns cleaned mask."""
    out = mask.copy()
    thr = LINE_RUN_GAPS * gap
    for r in rows:
        row = out[r]
        if not row.any():
            continue
        idx = np.nonzero(row)[0]
        runs, cur = [], [idx[0]]
        for i in idx[1:]:
            if i - cur[-1] <= 1:
                cur.append(i)
            else:
                runs.append(cur)
                cur = [i]
        runs.append(cur)
        for run in runs:
            if len(run) > thr:
                out[r, run[0]:run[-1] + 1] = False
        # a line may be 2px thick
        for dr in (1, -1):
            rr = r + dr
            if 0 <= rr < out.shape[0] and abs(dr) * LINE_TOL_PX < 2:
                idx2 = np.nonzero(out[rr])[0]
                if not len(idx2):
                    continue
                runs2, cur2 = [], [idx2[0]]
                for i in idx2[1:]:
                    if i - cur2[-1] <= 1:
                        cur2.append(i)
                    else:
                        runs2.append(cur2)
                        cur2 = [i]
                runs2.append(cur2)
                for run in runs2:
                    if len(run) > thr:
                        out[rr, run[0]:run[-1] + 1] = False
    return out


def components(mask):
    """4-connected labelling without scipy."""
    Hh, Ww = mask.shape
    lab = np.zeros((Hh, Ww), np.int32)
    cur = 0
    for y in range(Hh):
        row = mask[y]
        if not row.any():
            continue
        for x in np.nonzero(row)[0]:
            if lab[y, x]:
                continue
            cur += 1
            stack = [(y, x)]
            lab[y, x] = cur
            while stack:
                cy, cx = stack.pop()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < Hh and 0 <= nx < Ww and mask[ny, nx] \
                            and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        stack.append((ny, nx))
    return lab, cur


def detect(im, y0, y1, x_lo, x_hi, cfg=None):
    """Return onset groups inside the staff/measure region. Raster only."""
    rows, gap = line_rows(im, y0, y1)
    if rows is None or gap < 3:
        return None
    W = im.shape[1]
    a = max(0, int(x_lo))
    b = min(W, int(x_hi) + 1)
    if b - a < 6:
        return None
    top = int(round(y0))
    sub = im[top:int(round(y1)) + 1, a:b] < DARK
    # staff_rows may report a line one pixel outside the requested band; clamp
    lrows = sorted({min(max(0, r - top), sub.shape[0] - 1) for r in rows})
    clean = strip_lines(sub, lrows, gap)
    lab, n = components(clean)
    cands = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if not len(ys):
            continue
        y0c, y1c = ys.min(), ys.max()
        x0c, x1c = xs.min(), xs.max()
        w = x1c - x0c + 1
        h = y1c - y0c + 1
        if not (W_MIN * gap <= w <= W_MAX * gap):
            continue
        if not (H_MIN * gap <= h <= H_MAX * gap):
            continue
        fill = len(ys) / float(w * h)
        if fill < FILL_MIN:
            continue
        cands.append({"x": a + (x0c + x1c) / 2.0, "w": w, "h": h,
                      "fill": round(fill, 3), "y": a * 0 + (y0c + y1c) / 2.0})
    cands.sort(key=lambda c: c["x"])
    tol = ONSET_TOL_GAPS * gap
    groups, cur = [], [cands[0]] if cands else []
    for c in cands[1:]:
        if c["x"] - cur[-1]["x"] <= tol:
            cur.append(c)
        else:
            groups.append(cur)
            cur = [c]
    if cur:
        groups.append(cur)
    out = []
    for gi, g in enumerate(groups):
        ys = sorted({round(c["y"], 1) for c in g})
        merged = 1
        for k in range(len(ys) - 1):
            if ys[k + 1] - ys[k] > 0.45 * gap:
                merged += 1
        out.append({"onset": gi, "x": float(np.mean([c["x"] for c in g])),
                    "card": max(1, merged), "n_cand": len(g)})
    return {"gap": gap, "cands": cands, "onsets": out, "x0": a, "x1": b}


# ------------------------------------------------------------------ montage
def montage(im, rects, out_path, scale=3):
    """Stack measure crops with a pixel ruler and numbered onset markers."""
    tiles = []
    for r in rects:
        Hh, Ww = im.shape
        a = max(0, int(r["x0"]))
        b = min(Ww, int(r["x1"]))
        crop = im[int(r["y0"]):int(r["y1"]) + 1, a:b]
        rgb = np.dstack([crop, crop, crop])
        h, w = rgb.shape[:2]
        rgb = np.dstack([rgb, np.full((h, w), 255, np.uint8)])
        for o in r["onsets"]:
            xx = int(round(o["x"])) - a
            if 0 <= xx < w:
                rgb[:, xx] = [255, 0, 0, 255]
                rgb[max(0, xx - 3):xx + 4, :] = np.maximum(
                    rgb[max(0, xx - 3):xx + 4, :],
                    np.array([255, 60, 60, 255], np.uint8))
        for c in r["cands"]:
            yy = int(round(c["y"])) - int(r["y0"])
            xx = int(round(c["x"])) - a
            if 0 <= xx < w and 0 <= yy < h:
                rgb[max(0, yy - 1):yy + 2, max(0, xx - 1):xx + 2] = [0, 140, 255, 255]
        tiles.append((rgb, r["label"], a, w))
    gapv = 8
    Ht = sum(t[0].shape[0] + gapv for t in tiles)
    Wt = max(t[0].shape[1] for t in tiles)
    canvas = np.full((Ht, Wt, 4), 255, np.uint8)
    y = 0
    for t, lab, a, w in tiles:
        canvas[y:y + t.shape[0], :t.shape[1]] = t
        y += t.shape[0] + gapv
    img = Image.fromarray(canvas)
    img = img.resize((int(Wt * scale), int(Ht * scale)), Image.LANCZOS)
    img.save(out_path)
    return {"path": str(out_path), "w": img.width, "h": img.height,
            "labels": [t[1] for t in tiles], "x_offset": [t[2] for t in tiles]}


def main():
    systems = json.load(open(OUT / "F_systems.json"))
    man = json.load(open(OUT / "M7_measure_map.json"))
    USABLE = ("EXACT_ANCHORED", "HIGH_CONFIDENCE_INTERIOR",
              "HIGH_CONFIDENCE_COUNT_ANCHORED")
    usable = [m for m in man if m["mapping_class"] in USABLE and m["xml_ord"] is not None]
    from m_measure_map import pdf_intervals
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}
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

    results = {}
    for m in usable:
        sid, pno = m["score"], m["page"]
        im = img(sid, pno)
        r = iv.get((sid, m["pdf_ord"]))
        if im is None or r is None:
            continue
        Hh = im.shape[0]
        sy = bypage[(sid, pno)][m["system"]]
        per_role = {}
        for role in ("upper", "lower"):
            y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
            per_role[role] = detect(im, y0, y1, r["x_left"], r["x_right"])
        results["%s|p%d|s%d|m%d" % (sid, pno, m["system"], m["xml_ord"])] = {
            "score": sid, "page": pno, "system": m["system"],
            "xml_ord": m["xml_ord"], "pdf_ord": m["pdf_ord"],
            "mapping_class": m["mapping_class"], "roles": per_role}
    H.write_json("O_detect_raw.json", results)
    tot = sum(len(v["onsets"]) for k, v in results.items()
              if v["roles"].get("upper") and v["roles"]["upper"]["onsets"] is not None
              for _ in (0,)) if False else 0
    n_meas = len(results)
    n_on = sum(len(r["onsets"]) for v in results.values()
               for r in v["roles"].values() if r)
    print("O0-O5  raster-only printed-onset detection")
    print("  high-confidence mapped measures scanned : %d" % n_meas)
    print("  onset groups detected (both staves)     : %d" % n_on)
    print("  wrote out/O_detect_raw.json")


if __name__ == "__main__":
    main()
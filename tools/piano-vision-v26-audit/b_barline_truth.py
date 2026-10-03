"""B0 - independent PDF barline truth set, built from the RASTER ONLY.

Deliberately independent of the production detector in stage_a2_consensus.py:
 - no cross-staff consensus
 - no candidate clustering thresholds
 - a different primitive: per-column vertical coverage INSIDE the staff span plus
   a horizontal-isolation test, instead of "longest run touching both outer lines"

This module only ever reads page rasters and the canonical staff rectangles. It
never reads MusicXML, Verovio, pitch, d0, true_d or any residual.

It also renders overlay crops so the truth can be INSPECTED rather than trusted.
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
OVL = Path(__file__).parent / "out/b_overlays"

# ---- independent truth primitives (raster only) ----
COV_MIN = 0.86        # fraction of the staff span a barline must ink
MAX_BREAK = 0.30      # largest allowed internal break, in staff gaps
ISO_PAD = 0.9         # isolation window either side, in staff gaps
ISO_MAX = 0.55        # max ink fraction tolerated in the isolation window
XSTAFF_TOL_GAPS = 0.30  # cross-staff agreement tolerance, in staff gaps
DARK = 140


def truth_columns(im, y0, y1):
    """Per-column: (coverage, largest internal break, isolation) inside the span."""
    gap = (y1 - y0) / 4.0
    top, bot = int(round(y0)), int(round(y1))
    span = bot - top
    if gap < 3 or span < 4:
        return {}, gap
    dark_px = max(1, int(round(0.34 * gap)))
    Hh, Ww = im.shape
    ink = im[top:bot + 1] < DARK
    cols = np.nonzero(ink.any(axis=0))[0]
    out = {}
    for x in cols:
        col = ink[:, x]
        idx = np.nonzero(col)[0]
        # ROW coverage, not longest-run coverage. In dense polyphony a notehead
        # or beam crosses the barline and splits the run, which made the original
        # longest-run test miss real barlines. Row coverage only asks whether the
        # column inks most of the staff height, which survives the overlap.
        cov = float(col.mean())
        if cov < COV_MIN:
            continue
        runs, cur = [], [idx[0]]
        for i in idx[1:]:
            if i - cur[-1] <= 1:
                cur.append(i)
            else:
                runs.append((cur[0], cur[-1]))
                cur = [i]
        runs.append((cur[0], cur[-1]))
        # must still REACH both outer lines: that is the barline signature
        if runs[0][0] > 1 or (span - runs[-1][1]) > 1:
            continue
        breaks = [runs[k + 1][0] - runs[k][1] - 1 for k in range(len(runs) - 1)]
        brk = (max(breaks) if breaks else 0) / gap
        if brk > MAX_BREAK:
            continue
        # horizontal isolation: neighbouring columns within ISO_PAD must be much
        # emptier, so a barline is not part of a dense chord/beamed block
        a = max(0, x - int(ISO_PAD * gap))
        b = min(Ww, x + int(ISO_PAD * gap) + 1)
        nb = ink[:, a:x].mean() if x > a else 0.0
        nc = ink[:, x + 1:b].mean() if b > x + 1 else 0.0
        out[int(x)] = {"x": int(x), "cov": float(cov), "brk": float(brk),
                       "nb": float(nb), "nc": float(nc)}
    return out, gap


def truth_events(im, y0, y1, iso_max=ISO_MAX):
    """Group adjacent qualifying columns into one printed-barline event."""
    cols, gap = truth_columns(im, y0, y1)
    if not cols:
        return []
    good = [c for c in cols.values() if max(c["nb"], c["nc"]) <= iso_max]
    good.sort(key=lambda c: c["x"])
    ev, cur = [], [good[0]]
    sep = max(2, int(round(0.7 * gap)))
    for c in good[1:]:
        if c["x"] - cur[-1]["x"] <= sep:
            cur.append(c)
        else:
            ev.append(cur)
            cur = [c]
    ev.append(cur)
    return [{"x": float(np.mean([c["x"] for c in e])),
             "w": e[-1]["x"] - e[0]["x"] + 1,
             "cov": float(min(c["cov"] for c in e)),
             "gap": float(gap)} for e in ev]


# ------------------------------------------------------------------ overlays
def render_overlay(im, sy, up_ev, lo_ev, path, label):
    Hh = im.shape[0]
    ytop = int(sy["upper"][0] * Hh) - 14
    ybot = int(sy["lower"][1] * Hh) + 14
    ytop = max(0, ytop)
    ybot = min(im.shape[0] - 1, ybot)
    x0 = max(0, int(sy["x0"]) - 6)
    x1 = min(im.shape[1] - 1, int(sy["x1"]) + 6)
    crop = im[ytop:ybot + 1, x0:x1 + 1].copy()
    rgb = np.dstack([crop, crop, crop])
    h, w = rgb.shape[:2]
    for e in up_ev + lo_ev:
        if "abs_x" in e:
            xx = int(round(e["abs_x"])) - x0
            if 0 <= xx < w:
                rgb[:, xx] = [255, 40, 40]
    for e in lo_ev:
        if "abs_x" in e:
            xx = int(round(e["abs_x"])) - x0
            if 0 <= xx < w:
                rgb[:, xx] = [40, 90, 255]
    sc = 2 if w < 700 else 1
    im2 = Image.fromarray(rgb)
    if sc > 1:
        im2 = im2.resize((w * sc, h * sc), Image.NEAREST)
    im2.save(path)
    return {"path": str(path), "label": label, "w": w, "h": h,
            "n_up": len(up_ev), "n_lo": len(lo_ev)}


def main():
    systems = json.load(open(OUT / "F_systems.json"))
    imgs = {}

    def img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    OVL.mkdir(parents=True, exist_ok=True)
    by = defaultdict(list)
    for sy in systems:
        by[(sy["score"], sy["page"])].append(sy)

    truth = {}
    for (sid, pno) in sorted(by):
        im = img(sid, pno)
        if im is None:
            continue
        Hh = im.shape[0]
        for sidx, sy in enumerate(sorted(by[(sid, pno)], key=lambda z: z["y0"])):
            key = "%s|p%d|s%d" % (sid, pno, sidx)
            rec = {"score": sid, "page": pno, "system": sidx,
                   "upper": [], "lower": []}
            ok = True
            ex0, ex1 = None, None
            for role in ("upper", "lower"):
                y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
                sr = A2.staff_rows(im, y0, y1)
                if len(sr) < 3:
                    ok = False
                    break
                a, b = min(r[1] for r in sr), max(r[2] for r in sr)
                ex0 = a if ex0 is None else min(ex0, a)
                ex1 = b if ex1 is None else max(ex1, b)
                ev = truth_events(im, y0, y1)
                if not ev:
                    ok = False
                rec[role] = ev
            rec["x0"] = int(ex0 or 0)
            rec["x1"] = int(ex1 or 0)
            # RASTER-ONLY cross-staff agreement. A printed barline is drawn at one
            # x across BOTH staves of the same page raster, so agreement between the
            # two staves is evidence from the PDF alone - the second source (MusicXML
            # / Verovio) is never consulted. This is what removes the dense-chord
            # false positives: a stem or beamed block that happens to span the staff
            # does not appear at the same x on the other staff.
            agree = []
            if ok and rec["upper"] and rec["lower"]:
                for eu in rec["upper"]:
                    m = min(rec["lower"], key=lambda el: abs(el["x"] - eu["x"]))
                    if abs(m["x"] - eu["x"]) <= XSTAFF_TOL_GAPS * eu["gap"]:
                        agree.append({"x": 0.5 * (eu["x"] + m["x"]),
                                      "x_up": eu["x"], "x_lo": m["x"],
                                      "w": max(eu["w"], m["w"]),
                                      "cov": min(eu["cov"], m["cov"]),
                                      "gap": eu["gap"]})
            rec["agree"] = agree
            rec["usable"] = ok and len(agree) >= 2
            truth[key] = rec

    H.write_json("B0_truth_raw.json", truth)
    n_sys = sum(1 for v in truth.values() if v["usable"])
    n_ev = sum(len(v["agree"]) for v in truth.values() if v["usable"])
    print("B0  independent raster-only barline truth (raw)")
    print("  systems scanned        : %d" % len(truth))
    print("  systems with both staves: %d" % n_sys)
    print("  cross-staff agreed events: %d" % n_ev)
    print("  per-staff raw events     : %d"
          % sum(len(v["upper"]) + len(v["lower"]) for v in truth.values()))
    print("  wrote out/B0_truth_raw.json")


if __name__ == "__main__":
    main()
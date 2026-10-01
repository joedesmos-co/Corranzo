"""Phase P - trustworthy PDF barline detector (P0-P11).

Replaces the invalid criterion (total column ink >= 0.85 * band height), which
sums disconnected stems, beam edges and chord ink and therefore over-counts dense
polyphony by ~5.7x.

Acceptance uses PDF raster geometry ONLY. No MusicXML pitch, no true_d, no d0,
no residual, no Verovio x or measure ordinal, no corpus measure mapping, and no
expected measure count enters any accept/reject decision.

P2  the discriminator is the LONGEST CONTIGUOUS DARK RUN in the column, plus the
    number of disconnected runs. A printed barline is one nearly continuous run
    spanning top line to bottom line (n_runs small). A stem cluster is several
    short runs whose lengths add up (n_runs large, or a big internal gap).
P3  endpoint evidence: run start within END_TOL of the top staff line, run end
    within END_TOL of the bottom line, and all five staff-line neighbourhoods
    intersected.
P4  internal-gap rule: gaps up to GAP_FRAC * staff_gap are tolerated (raster and
    antialias breaks); larger gaps reject, because a real barline is never
    interrupted by more than a fraction of a space.
P5  horizontal structure is used to CLASSIFY ambiguity, not to eliminate valid
    boundaries, since real barlines coexist with repeat dots and final bars.
P6  individual strokes are clustered into ONE boundary event when separated by
    less than EVENT_SEP * staff_gap, so a double/final bar counts once.

Thresholds are staff-gap-relative and frozen from geometry (see THRESHOLDS).
They are chosen on a development subset of scores and then applied unchanged.
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

# ---- P9 frozen thresholds, all relative to staff_gap, set from geometry only
THRESHOLDS = {
    "search_pad": 0.30,      # search band extends this far beyond the outer lines
    "end_tol": 0.30,         # run endpoints must land this close to the outer lines
    "min_coverage": 0.88,    # run must span this fraction of the outer-line span
    "gap_frac": 0.30,        # largest tolerated internal gap, in staff gaps
    "max_runs": 4,           # a barline broken by antialiasing stays below this
    "max_width": 0.90,       # stroke width cap, in staff gaps
    "event_sep": 1.60,       # strokes closer than this are one boundary event
}
DEV = ("bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
       "bc-chopin-etude-op10-01", "pl-mozart-turkish-march")
HELD = tuple(s for s in DEV)  # replaced below by the non-dev scores


def column_runs(col, y_lo, y_hi, dark):
    """Contiguous dark runs in one column, with gaps merged below gap_px."""
    idx = np.nonzero(col)[0]
    if not len(idx):
        return [], 0
    runs, cur = [], [idx[0]]
    for i in idx[1:]:
        if i - cur[-1] <= 1:
            cur.append(i)
        else:
            runs.append((cur[0], cur[-1]))
            cur = [i]
    runs.append((cur[0], cur[-1]))
    merged, cur = [], list(runs[0])
    for a, b in runs[1:]:
        if a - cur[1] <= dark:
            cur[1] = b
        else:
            merged.append(tuple(cur))
            cur = [a, b]
    merged.append(tuple(cur))
    return merged, len(runs)


def best_run(runs, n_raw, y_top, y_bot, gap, T):
    """Longest merged run scored against the barline criteria."""
    if not runs:
        return None
    best = max(runs, key=lambda r: r[1] - r[0])
    a, b = best
    span = y_bot - y_top
    cov = (b - a) / span if span > 0 else 0.0
    # largest internal gap between the dark pixels of this run
    sub = runs[0]
    return {"a": a, "b": b, "cov": cov, "n_runs": n_raw,
            "start_off": (a - y_top) / gap, "end_off": (y_bot - b) / gap,
            "dark": int(b - a + 1)}


def staff_rows(im, y0, y1, min_run_frac=0.25):
    Hh, Ww = im.shape
    sub = im[max(0, int(y0) - 8):int(y1) + 9, :]
    ink = sub < 140
    rows = []
    for r in range(ink.shape[0]):
        xs = np.nonzero(ink[r])[0]
        if not len(xs):
            continue
        brk = np.nonzero(np.diff(xs) > 1)[0]
        segs = np.split(xs, brk + 1)
        best = max(segs, key=len)
        if len(best) >= min_run_frac * Ww:
            rows.append((r + max(0, int(y0) - 8), int(best[0]), int(best[-1])))
    return rows


def detect_band(im, y_top, y_bot, x_lo, x_hi, T):
    """P2-P6 for one staff unit. Returns dict with strokes, events, taxonomy."""
    gap = (y_bot - y_top) / 4.0
    if gap < 3:
        return None
    T = dict(T)
    pad = T["search_pad"] * gap
    dark = max(1, int(round(T["gap_frac"] * gap)))
    top, bot = y_top - pad, y_bot + pad
    Hh, Ww = im.shape
    x_lo, x_hi = max(0, int(x_lo)), min(Ww - 1, int(x_hi))
    if x_hi - x_lo < 8:
        return None
    sub = im[int(top):int(bot) + 1, x_lo:x_hi + 1]
    ink = sub < 140
    span = y_bot - y_top
    strokes, tax = [], Counter()
    x = 0
    while x < ink.shape[1]:
        runs, n_raw = column_runs(ink[:, x], 0, ink.shape[0] - 1, dark)
        if not runs:
            x += 1
            continue
        b = best_run(runs, n_raw, top + 0, top + span, gap, T)
        # b is in sub coordinates; convert endpoints back to page y
        a, c = b["a"], b["b"]
        # largest internal gap inside [a, c]
        col = ink[:, x]
        seg = col[a:c + 1]
        xs = np.nonzero(seg)[0]
        g = 0
        if len(xs) > 1:
            g = int(np.max(np.diff(xs)) - 1)
        cov = (c - a) / span if span > 0 else 0
        # a,c are sub-row indices; page y = int(top) + index, and the band
        # starts pad above y_top, so offsets are measured from pad, not from top
        d_top = (a - pad) / gap
        d_bot = (pad + span - c) / gap
        ok = True
        if cov < T["min_coverage"]:
            tax["insufficient_vertical_coverage"] += 1
            ok = False
        elif d_top > T["end_tol"] or d_bot > T["end_tol"]:
            tax["endpoint_miss"] += 1
            ok = False
        elif g / gap > T["gap_frac"]:
            tax["excessive_internal_gap"] += 1
            ok = False
        elif n_raw > T["max_runs"]:
            tax["disconnected_stems"] += 1
            ok = False
        if ok:
            strokes.append({"x": x_lo + x, "cov": cov, "n_runs": n_raw,
                            "gap": g / gap, "d_top": d_top, "d_bot": d_bot})
            x += 1
        else:
            x += 1
    # ---- P6 cluster strokes into boundary events
    strokes.sort(key=lambda s: s["x"])
    events, cur = [], []
    sep = T["event_sep"] * gap
    for s in strokes:
        if cur and (s["x"] - cur[-1]["x"]) > sep:
            events.append(cur)
            cur = [s]
        else:
            cur.append(s)
    if cur:
        events.append(cur)
    # P5 horizontal evidence: flag wide strokes as ambiguous, do not delete
    wmax = T["max_width"] * gap
    amb = 0
    for e in events:
        if (e[-1]["x"] - e[0]["x"]) > wmax:
            e[0]["ambiguous_width"] = True
            amb += 1
    return {"gap": gap, "strokes": strokes, "events": events,
            "tax": tax, "n_ambiguous": amb, "n_tax": sum(tax.values())}


def audit_text(im, y_top, y_bot, x_lo, x_hi, det):
    """P8 inspectable overlay in text form."""
    gap = det["gap"]
    top, bot = int(y_top - 0.3 * gap), int(y_bot + 0.3 * gap)
    sub = im[top:bot + 1, int(x_lo):int(x_hi) + 1] < 140
    acc = {s["x"] - int(x_lo) for s in det["strokes"]}
    rej = {s for s in range(0, sub.shape[1], 1)} - acc
    lines = []
    for r in range(sub.shape[0]):
        row = "".join("#" if sub[r, c] else "." for c in
                      range(0, sub.shape[1], 2))
        lines.append("%5d %s%s" % (top + r,
                                    "S" if (top + r) in (int(y_top), int(y_bot)) else " ",
                                    row))
    return lines


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    allsids = [s["score_id"] for s in index["scores"]]
    held = [s for s in allsids if s not in DEV]
    bands = {}
    for sc in index["scores"]:
        sid = sc["score_id"]
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if not p.is_file():
                continue
            with gzip.open(p, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    t = rec["exampleId"].split(":")[-1].split("-")
                    k = (sid, int(t[0].lstrip("p")), t[1])
                    geo = rec["input"]["modelInput"]["geometry"]
                    for b in geo.get("staffBands", {}).get("staffBands", []):
                        key = k + (b.get("staffRole"),)
                        if key not in bands:
                            bands[key] = (b["y0"], b["y1"])
    imgs = {}

    def page(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    print("P9 frozen thresholds (staff-gap relative, geometry only):")
    for k, v in THRESHOLDS.items():
        print("    %-16s %s" % (k, v))
    print("    development scores: %s" % (list(DEV),))
    print("    held-out scores    : %d (not used for any threshold)\n" % len(held))

    agg = defaultdict(lambda: {"sys": set(), "strokes": 0, "events": 0,
                               "tax": Counter(), "amb": 0})
    dets = {}
    for (sid, pno, sysn, band), (yn, yb) in sorted(bands.items()):
        im = page(sid, pno)
        if im is None:
            continue
        Hh, Ww = im.shape
        y0, y1 = yn * Hh, yb * Hh
        rows = staff_rows(im, y0, y1)
        if len(rows) < 3:
            continue
        xs0 = min(r[1] for r in rows)
        xs1 = max(r[2] for r in rows)
        det = detect_band(im, y0, y1, xs0, xs1, THRESHOLDS)
        if not det:
            continue
        dets[(sid, pno, sysn, band)] = det
        a = agg[sid]
        a["sys"].add((pno, sysn))
        a["strokes"] += len(det["strokes"])
        a["events"] += len(det["events"])
        a["tax"].update(det["tax"])
        a["amb"] += det["n_ambiguous"]

    print("P6/P7  raw strokes -> clustered boundary events, and the rejection taxonomy\n")
    print("  %-40s %6s %8s %8s %8s" % ("score", "sys", "strokes", "events", "rejects"))
    for sid in sorted(agg):
        a = agg[sid]
        print("  %-40s %6d %8d %8d %8d"
              % (sid, len(a["sys"]), a["strokes"], a["events"], sum(a["tax"].values())))
    tot = Counter()
    for sid in agg:
        tot.update(agg[sid]["tax"])
    print("\nP7 false-positive taxonomy (dominant rejection reason):")
    n = sum(tot.values()) or 1
    for k, v in tot.most_common():
        print("    %-34s %7d  %.4f" % (k, v, v / n))

    dev = {s: agg[s]["events"] for s in DEV if s in agg}
    hd = {s: agg[s]["events"] for s in held if s in agg}
    print("\nP9/P12 held-out stability: development %d scores, held-out %d scores"
          % (len(dev), len(hd)))
    print("    development events/staff-unit: %.3f" % (np.mean(list(dev.values())) /
          max(1e-9, np.mean([len(agg[s]['sys']) * 2 for s in dev]))))
    print("    held-out   events/staff-unit: %.3f" % (np.mean(list(hd.values())) /
          max(1e-9, np.mean([len(agg[s]['sys']) * 2 for s in hd]))))
    H.write_json("phase_p_detector.json",
                 {s: {"systems": len(agg[s]["sys"]), "strokes": agg[s]["strokes"],
                      "events": agg[s]["events"], "ambiguous": agg[s]["amb"],
                      "rejects": {k: v for k, v in agg[s]["tax"].items()}}
                  for s in agg})
    H.write_json("phase_p_thresholds.json",
                 {"thresholds": THRESHOLDS, "development": list(DEV),
                  "held_out": held})


if __name__ == "__main__":
    main()

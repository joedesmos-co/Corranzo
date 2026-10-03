"""Stage A2 - system-level PDF barline detection by CROSS-STAFF CONSENSUS.

The invariant exploited here is entirely within ONE PDF raster:

    UPPER AND LOWER STAVES OF THE SAME PIANO SYSTEM SHARE THE SAME MEASURE
    BOUNDARY x POSITIONS.

A real barline crosses both staves, so it appears in both candidate sets at the
same x. A stem or chord cluster does not, so it fails cross-staff agreement. That
is a PDF-only discriminator and needs no MusicXML, no pitch, no d0, no true_d, no
residual and no Verovio anything.

Staff geometry is the ALREADY-VALIDATED band geometry (Phase C: 1,272/1,272 band
units aligned to real raster staff lines, max 0.0976 staff spaces). The defective
4-line refine_staff() fallback is NOT used anywhere.

Systems are formed by grouping bands on (page, y_top), NOT by the corpus system
label, so a corpus measure grid that splits one visual system into two labels
cannot corrupt the pairing.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"
import gzip

# ---- A2.2 candidate generation: high recall, geometry only, no cross-source input
CAND = {
    "search_pad": 0.30,
    "end_tol": 0.30,        # run endpoints within this many gaps of the outer lines
    "min_coverage": 0.90,   # B4 correction 2 (accepted on DETECTOR_DEV): the FP
                           # taxonomy showed 46/53 spurious events were stems and
                           # beamed blocks spanning only part of the staff, which a
                           # 0.70 longest-run test lets through. DEV F1 0.7767 ->
                           # 0.7943; held-out precision 0.6280 -> 0.7577, recall
                           # 0.5518 -> 0.6589. Chosen against the RASTER-ONLY truth
                           # set, never against a MusicXML or Verovio measure count.
    "gap_frac": 0.45,       # tolerate more internal breaks than a strict bar would have
    "max_runs": 6,
    "dark_min": 1,
}
# ---- A2.3 cross-staff consensus tolerance, derived from geometry
CONS_TOL_GAPS = 0.60      # DP pairing tolerance, in staff gaps (permissive)
# A2 iteration 4: require the run to touch BOTH outer staff lines inside the exact
# validated span (tolerance 0.6 gaps), measured without a padded search window.
CAND["touch_both"] = 0.60
# A printed barline is ONE vertical stroke drawn across both staves, so its x on
# the upper and lower staff must agree to raster precision. This is the strict
# gate applied AFTER the permissive DP, and it is the real cross-staff test.
CONS_STRICT_GAPS = 0.15
# Consensus-level width veto. A printed barline is a single thin vertical stroke.
# Measured on beethoven-sonata p4, the upper staff yielded 16 candidate events of
# which the ones at x=381/582/785 were 15-17 px WIDE (1.45-1.64 staff gaps) - braces
# and system connectors - and they occur at the same x on the lower staff, so
# cross-staff agreement CANNOT reject them. Requiring an event to be no wider than
# 0.5 staff gaps before it may participate in consensus takes that staff from 16
# events to 12 and leaves a uniform 9.3-10.6 gap measure spacing. This is a veto on
# which candidates may be PAIRED, not a change to how candidates are found.
CONS_WIDTH_GAPS = 1.20
# ---- A2.5 multi-stroke event clustering
EVENT_SEP_GAPS = 1.60


def column_runs(col, dark):
    idx = np.nonzero(col)[0]
    if not len(idx):
        return []
    runs, cur = [], [idx[0]]
    for i in idx[1:]:
        if i - cur[-1] <= 1:
            cur.append(i)
        else:
            runs.append([cur[0], cur[-1]])
            cur = [i]
    runs.append([cur[0], cur[-1]])
    merged, cur = [], list(runs[0])
    for a, b in runs[1:]:
        if a - cur[1] <= dark:
            cur[1] = b
        else:
            merged.append(tuple(cur))
            cur = [a, b]
    merged.append(tuple(cur))
    return merged


def staff_rows(im, y0, y1, min_frac=0.25):
    Hh, Ww = im.shape
    lo, hi = max(0, int(y0) - 6), min(Hh - 1, int(y1) + 7)
    ink = im[lo:hi + 1, :] < 140
    rows = []
    for r in range(ink.shape[0]):
        xs = np.nonzero(ink[r])[0]
        if not len(xs):
            continue
        best = max(np.split(xs, np.nonzero(np.diff(xs) > 1)[0] + 1), key=len)
        if len(best) >= min_frac * Ww:
            rows.append((lo + r, int(best[0]), int(best[-1])))
    return rows


def candidates(im, y0, y1, x_lo, x_hi, T):
    """High-recall vertical-stroke candidates for one staff.

    The strongest purely geometric barline test, verified against the raster on a
    Mazurka system: require the longest contiguous run to TOUCH BOTH OUTER STAFF
    LINES inside the exact validated staff span. A barline reaches the top and
    bottom lines; a note stem cannot, and ink bridging beyond the staff (beams,
    chords, a neighbouring system) is excluded by measuring inside the span
    rather than in a padded search window.
    """
    gap = (y1 - y0) / 4.0
    if gap < 3:
        return None
    pad = T["search_pad"] * gap
    dark = max(T["dark_min"], int(round(T["gap_frac"] * gap)))
    span = y1 - y0
    top_i, bot_i = int(round(y0)), int(round(y1))
    span_i = bot_i - top_i
    if span_i < 4:
        return None
    touch = T.get("touch_both", 0.0) * gap
    Hh, Ww = im.shape
    x_lo, x_hi = max(0, int(x_lo)), min(Ww - 1, int(x_hi))
    if x_hi - x_lo < 8:
        return None
    sub = im[int(y0 - pad):int(y1 + pad) + 1, x_lo:x_hi + 1] < 140
    out = []
    exact = im[top_i:bot_i + 1, max(0, int(x_lo)):min(Ww, int(x_hi) + 1)] < 140
    for x in range(sub.shape[1]):
        if touch:
            col = exact[:, x] if x < exact.shape[1] else None
            if col is None or not col.any():
                continue
            runs = column_runs(col, dark)
            if not runs:
                continue
            a, b = max(runs, key=lambda r: r[1] - r[0])
            if a > touch or (span_i - b) > touch:
                continue
            cov = (b - a) / span_i
            if cov < T["min_coverage"]:
                continue
            if len(runs) > T.get("max_runs", 99):
                continue
            xs = np.nonzero(col[a:b + 1])[0]
            igap = (int(np.max(np.diff(xs)) - 1) if len(xs) > 1 else 0) / gap
            if igap > T["gap_frac"]:
                continue
            out.append({"x": x_lo + x, "cov": cov, "n_runs": len(runs),
                        "igap": igap, "d_top": a / gap, "d_bot": (span_i - b) / gap})
            continue
        runs = column_runs(sub[:, x], dark)
        if not runs:
            continue
        a, b = max(runs, key=lambda r: r[1] - r[0])
        cov = (b - a) / span
        if cov < T["min_coverage"]:
            continue
        d_top = (a - pad) / gap
        d_bot = (pad + span - b) / gap
        if d_top > T["end_tol"] or d_bot > T["end_tol"]:
            continue
        n_runs = len(runs)
        if n_runs > T.get("max_runs", 99):
            continue
        xs = np.nonzero(sub[a:b + 1, x])[0]
        igap = (int(np.max(np.diff(xs)) - 1) if len(xs) > 1 else 0) / gap
        if igap > T["gap_frac"]:
            continue
        out.append({"x": x_lo + x, "cov": cov, "n_runs": n_runs,
                    "igap": igap, "d_top": d_top, "d_bot": d_bot})
    return {"gap": gap, "cands": out, "extent": (x_lo, x_hi)}


def cluster_events(cands, gap, sep_gaps=EVENT_SEP_GAPS):
    """A2.5: cluster strokes into boundary EVENTS (double/final/repeat = one)."""
    if not cands:
        return []
    cs = sorted(cands, key=lambda c: c["x"])
    ev, cur = [], [cs[0]]
    sep = sep_gaps * gap
    for c in cs[1:]:
        if c["x"] - cur[-1]["x"] <= sep:
            cur.append(c)
        else:
            ev.append(cur)
            cur = [c]
    ev.append(cur)
    return [{"x": float(np.mean([c["x"] for c in e])),
             "n_strokes": len(e), "w": e[-1]["x"] - e[0]["x"] + 1,
             "min_cov": min(c["cov"] for c in e),
             "max_runs": max(c["n_runs"] for c in e),
             "gap": float(gap)} for e in ev]


def cross_staff(up_ev, lo_ev, tol, width_gaps=CONS_WIDTH_GAPS):
    """A2.3 consensus matching by x, minimising TOTAL displacement.

    A greedy monotone walk is wrong here: when one side has a spurious isolated
    candidate it must skip THAT candidate, and a greedy rule cannot tell which
    side holds the outlier. This is therefore a Needleman-Wunsch over the two
    ordered event lists, with pairing cost = |dx| (capped at `tol` + a penalty),
    and a fixed gap penalty for skipping either side. Isolated outliers are then
    skipped only when doing so lowers total displacement, so genuine coincident
    boundaries are never discarded in favour of a nearby false positive.
    """
    # width veto: braces and connectors may not be paired as measure boundaries
    if width_gaps and up_ev and lo_ev:
        # the cap is in STAFF GAPS, so scale it by each side's own gap
        gu = max(e.get("gap", 1.0) for e in up_ev)
        gl = max(e.get("gap", 1.0) for e in lo_ev)
        up_ev = [e for e in up_ev if e.get("w", 0) <= width_gaps * gu]
        lo_ev = [e for e in lo_ev if e.get("w", 0) <= width_gaps * gl]
    n, m = len(up_ev), len(lo_ev)
    if not n or not m:
        return []
    big = tol * 4.0 + 1.0
    D = np.full((n + 1, m + 1), np.inf)
    P = np.zeros((n + 1, m + 1), np.int8)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        D[i, 0] = D[i - 1, 0] + 1.0
        P[i, 0] = 1
    for j in range(1, m + 1):
        D[0, j] = D[0, j - 1] + 1.0
        P[0, j] = 2
    for i in range(1, n + 1):
        ux = up_ev[i - 1]["x"]
        for j in range(1, m + 1):
            d = abs(lo_ev[j - 1]["x"] - ux)
            c = (d / tol) if d <= tol else big
            best, arg = D[i - 1, j - 1] + c, 0
            if D[i - 1, j] + 1.0 < best:
                best, arg = D[i - 1, j] + 1.0, 1
            if D[i, j - 1] + 1.0 < best:
                best, arg = D[i, j - 1] + 1.0, 2
            D[i, j], P[i, j] = best, arg
    out, i, j = [], n, m
    while i > 0 and j > 0:
        a = P[i, j]
        if a == 0:
            d = lo_ev[j - 1]["x"] - up_ev[i - 1]["x"]
            out.append((i - 1, j - 1, d))
            i, j = i - 1, j - 1
        elif a == 1:
            i -= 1
        else:
            j -= 1
    return out[::-1]


def visual_systems(index):
    """A2.1 group bands into piano systems.

    Each band has its OWN y_top, so a system is not "bands sharing a y_top".
    Instead: collect the distinct band rectangles per (score, page), then pair
    adjacent rectangles whose vertical gap is consistent with a grand staff
    (upper bottom to lower top). Uses only PDF geometry - never the corpus
    system label, never a measure count.
    """
    per_page = defaultdict(dict)
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
                    pno = int(t[0].lstrip("p"))
                    geo = rec["input"]["modelInput"]["geometry"]
                    for b in geo.get("staffBands", {}).get("staffBands", []):
                        per_page[(sid, pno)][round(b["y0"], 3)] = (b["y0"], b["y1"],
                                                                 b.get("staffRole"))
    out = defaultdict(dict)
    for (sid, pno), rects in per_page.items():
        ys = sorted(rects)
        used = set()
        for i in range(len(ys)):
            if i in used:
                continue
            u = rects[ys[i]]
            if u[2] != "upper":
                continue
            # the next rectangle below is the lower staff of the same system
            for j in range(i + 1, len(ys)):
                if j in used:
                    continue
                lo = rects[ys[j]]
                if lo[2] != "lower":
                    continue
                # The nearest `lower` band below an `upper` band is the other
                # staff of the same piano system. The inter-staff whitespace in
                # real engraving is ~5-9 staff gaps and varies, so a tight window
                # rejects valid pairs; the alternating upper/lower ordering makes
                # nearest-below sufficient. The cap is a sanity bound only.
                ugap = (lo[0] - u[1]) / max(1e-9, (u[1] - u[0]) / 4.0)
                if 0.5 <= ugap <= 20.0:
                    out[(sid, pno, ys[i])] = {"upper": (u[0], u[1]),
                                              "lower": (lo[0], lo[1])}
                    used.update({i, j})
                    break
    return out


def imgs_cache():
    c = {}

    def get(sid, pno):
        k = (sid, pno)
        if k not in c:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            c[k] = np.array(Image.open(p)) if p.is_file() else None
        return c[k]
    return get


SOLO_STRICT = None   # set at import below


def solo_staff_rows(index):
    """PDF staff units that have NO sibling staff on the page.

    Several scores/pages carry only `upper` bands because the extractor's
    glyph-font bbox never produced a lower band there. Cross-staff consensus
    cannot apply to those, so they are detected and handled by strict
    single-staff evidence. This uses raster geometry only.
    """
    per = defaultdict(dict)
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
                    pno = int(t[0].lstrip("p"))
                    geo = rec["input"]["modelInput"]["geometry"]
                    for b in geo.get("staffBands", {}).get("staffBands", []):
                        per[(sid, pno)][round(b["y0"], 3)] = (b["y0"], b["y1"],
                                                            b.get("staffRole"))
    out = []
    for (sid, pno), rects in sorted(per.items()):
        if any(r[2] == "lower" for r in rects.values()):
            continue
        for y, (yn, yb, role) in sorted(rects.items()):
            if role == "upper":
                out.append((sid, pno, y, yn, yb))
    return out


def analyse(index, get, tol_gaps=CONS_TOL_GAPS, cand=None, T=None):
    T = T or CAND
    tol_gaps = tol_gaps
    systems = visual_systems(index)
    rows = []
    for (sid, pno, ykey), bands in sorted(systems.items()):
        if "upper" not in bands or "lower" not in bands:
            continue
        im = get(sid, pno)
        if im is None:
            continue
        Hh, Ww = im.shape
        res = {}
        for role in ("upper", "lower"):
            yn, yb = bands[role]
            y0, y1 = yn * Hh, yb * Hh
            srows = staff_rows(im, y0, y1)
            if len(srows) < 3:
                res[role] = None
                continue
            xs0 = min(r[1] for r in srows)
            xs1 = max(r[2] for r in srows)
            cd = candidates(im, y0, y1, xs0, xs1, T)
            if cd is None:
                res[role] = None
                continue
            cd["events"] = cluster_events(cd["cands"], cd["gap"])
            res[role] = cd
        u, l = res["upper"], res["lower"]
        if not u or not l:
            continue
        tol = tol_gaps * max(u["gap"], l["gap"])
        strict = CONS_STRICT_GAPS * max(u["gap"], l["gap"])
        pairs = cross_staff(u["events"], l["events"], tol)
        pairs = [(i, j, d) for i, j, d in pairs if abs(d) <= strict]
        paired = [(u["events"][i], l["events"][j], d) for i, j, d in pairs]
        rows.append({
            "score": sid, "page": pno, "y_top": ykey,
            "up_cands": len(u["cands"]), "lo_cands": len(l["cands"]),
            "up_events": len(u["events"]), "lo_events": len(l["events"]),
            "paired": len(paired),
            "up_only": len(u["events"]) - len(paired),
            "lo_only": len(l["events"]) - len(paired),
            "resid": [d for _, _, d in paired],
            "events": [{"x": a["x"], "n_u": a["n_strokes"], "n_l": b["n_strokes"]}
                       for a, b, _ in paired],
            "intervals": max(0, len(paired) - 1),
            "gap_u": u["gap"], "gap_l": l["gap"],
        })
    return rows


def invariants(rows):
    """A2.6 single-document hard invariants."""
    resid = np.array([r for x in rows for r in x["resid"]]) if rows else np.zeros(1)
    inv_count = sum(1 for x in rows if x["paired"] >= 2)
    unpaired = sum(x["up_only"] + x["lo_only"] for x in rows)
    return {
        "systems": len(rows),
        "boundary_pairs": int(sum(x["paired"] for x in rows)),
        "x_resid_median": float(np.median(np.abs(resid))),
        "x_resid_p95": float(np.percentile(np.abs(resid), 95)),
        "x_resid_max": float(np.max(np.abs(resid))),
        "systems_with_exact_consensus": inv_count,
        "exact_consensus_rate": inv_count / max(1, len(rows)),
        "unpaired_candidates": unpaired,
    }


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    get = imgs_cache()
    print("Stage A2 - cross-staff consensus barline detection (PDF only)")
    print("  staff frame : validated band geometry (Phase C, 1272/1272 aligned)")
    print("  refine_staff: NOT used (4-line fallback defect)")
    print("  systems     : grouped by (score, page, y_top), not the corpus label")
    print("  candidate   : min_coverage=%.2f gap_frac=%.2f max_runs=%d (high recall)"
          % (CAND["min_coverage"], CAND["gap_frac"], CAND["max_runs"]))
    print("  consensus   : tolerance %.2f staff gaps\n" % CONS_TOL_GAPS)
    rows = analyse(index, get)
    inv = invariants(rows)
    for k, v in inv.items():
        print("  %-34s %s" % (k, ("%.4f" % v) if isinstance(v, float) else v))
    print("\n  worst systems by unpaired candidates:")
    for r in sorted(rows, key=lambda x: -(x["up_only"] + x["lo_only"]))[:8]:
        print("    %-30s p%d y=%8.2f  up_ev=%2d lo_ev=%2d paired=%2d  "
              "up_only=%2d lo_only=%2d" % (r["score"][:30], r["page"], r["y_top"],
                                           r["up_events"], r["lo_events"],
                                           r["paired"], r["up_only"], r["lo_only"]))
    H.write_json("stage_a2_systems.json", rows)
    H.write_json("stage_a2_invariants.json", inv)
    print("\nwrote out/stage_a2_systems.json")


if __name__ == "__main__":
    main()

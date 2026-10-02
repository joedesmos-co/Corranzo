"""Q1-Q6 - single-staff fallback for systems whose sibling staff is sparse.

The normal two-staff consensus detector (Stage A2) is NOT redesigned. This adds a
fallback that applies ONLY to systems identified as sparse-sibling by PDF raster
evidence alone, and uses strict single-staff evidence for a boundary.

Q1  classify systems by PDF ink only:
      non-staff ink density, connected musical components, candidate strokes
Q2  strict single-staff boundary evidence (near-full contiguous run, endpoints on
      the outer lines, small internal gap, narrow persistent stroke)
Q3  sibling support is REPORTED but never required
Q4  system edges are separate from internal boundaries; intervals = events - 1
Q5  freeze on development pages, then run held-out; cross-source counts only after
Q6  recompute per-score PDF intervals and compare post hoc
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402

DEV = ("bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
       "pl-mozart-turkish-march", "bc-chopin-etude-op10-01")

# ---- Q2 strict single-staff boundary evidence, all staff-gap relative
STRICT = {
    "search_pad": 0.30,
    "dark_min": 1,
    "min_coverage": 0.92,   # a bar spans 4 gaps = 1.00; a stem reaches 3.5 = 0.875
    # NOTE (fix #1, REVERTED): capping coverage at 1.06 was wrong. With a 0.30-gap
    # search pad, a genuine barline that touches the outer lines legitimately
    # measures 1.0 up to ~1.15, so the cap removed real boundaries and collapsed
    # the fallback to 2 intervals corpus-wide. Coverage above 1.0 is therefore NOT
    # a usable false-positive signal, and the fallback remains unvalidated.
    "max_coverage": 99.0,
    "end_tol": 0.20,        # endpoints within 1/5 space of the outer lines
    "gap_frac": 0.20,       # a real bar has no meaningful internal break
    "max_runs": 3,          # antialias only
    "max_width": 0.60,      # narrow persistent stroke
    "event_sep": 1.60,
}
# ---- Q1 sparsity: non-staff ink density, PDF only
SPARSE = {"ink_frac": 0.030, "comp_min": 3}   # ink_frac OR runs below -> sparse


def band_ink_profile(im, y0, y1, xs0, xs1):
    """PDF-only musical-activity measures for one staff band.

    No scipy is available, so components are counted as horizontal ink runs
    after staff-line removal, which is a fast and sufficient activity proxy: an
    empty staff has essentially no ink between its outer lines once the five
    staff-line rows are deleted.
    """
    rows_ = A2.staff_rows(im, y0, y1)
    if len(rows_) < 3:
        return None
    top, bot = int(y0), int(y1)
    if bot - top < 6:
        return None
    ink = im[top:bot + 1, xs0:xs1 + 1] < 140
    # delete rows that are dominated by one long run: those are staff lines
    keep = ink.copy()
    n_lines = 0
    for r in range(ink.shape[0]):
        row = ink[r]
        if not row.any():
            continue
        xs = np.nonzero(row)[0]
        segs = np.split(xs, np.nonzero(np.diff(xs) > 1)[0] + 1)
        if max(len(s) for s in segs) > 0.6 * ink.shape[1]:
            keep[r] = False
            n_lines += 1
    n_runs = 0
    for r in range(keep.shape[0]):
        xs = np.nonzero(keep[r])[0]
        if not len(xs):
            continue
        n_runs += 1 + int(np.sum(np.diff(xs) > 2))
    return {"gap": (y1 - y0) / 4.0, "extent": (xs0, xs1),
            "ink_frac": float(keep.sum()) / max(1, keep.size),
            "n_runs": n_runs, "n_lines": n_lines}


def strict_candidates(im, y0, y1, xs0, xs1, T):
    """Q2: strict single-staff boundary strokes on one staff.

    A printed barline spans all four staff gaps (coverage 1.00) and reaches the
    outer lines, so these criteria are far tighter than the permissive
    cross-staff candidate generation. A note stem reaches 3.5 of 4 gaps = 0.875
    and is rejected by min_coverage alone.
    """
    cd = A2.candidates(im, y0, y1, xs0, xs1, T)
    if cd is None:
        return None
    ev = A2.cluster_events(cd["cands"], cd["gap"], T["event_sep"])
    keep = []
    for e in ev:
        if e["w"] > T["max_width"] * cd["gap"]:
            continue
        if e["min_cov"] < T["min_coverage"] or e["min_cov"] > T["max_coverage"]:
            continue
        if e["max_runs"] > T["max_runs"]:
            continue
        keep.append(e)
    return {"gap": cd["gap"], "events": keep, "cands": cd["cands"]}


def classify(prof_u, prof_l):
    """Q1 classification from PDF ink only."""
    if not prof_u or not prof_l:
        return "AMBIGUOUS"
    du, dl = prof_u["ink_frac"], prof_l["ink_frac"]
    cu, cl = prof_u["n_runs"], prof_l["n_runs"]
    su = du < SPARSE["ink_frac"] or cu < SPARSE["comp_min"]
    sl = dl < SPARSE["ink_frac"] or cl < SPARSE["comp_min"]
    if not su and not sl:
        return "NORMAL_TWO_STAFF"
    if su and not sl:
        return "LOWER_ACTIVE_UPPER_SPARSE"
    if sl and not su:
        return "UPPER_ACTIVE_LOWER_SPARSE"
    return "AMBIGUOUS"


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    get = A2.imgs_cache()
    systems = A2.visual_systems(index)

    print("Q1 - sparse-sibling detection from PDF ink only")
    print("  sparsity rule (PDF only): non-staff ink_frac < %.3f OR ink runs < %d"
          % (SPARSE["ink_frac"], SPARSE["comp_min"]))
    print("  strict single-staff rule: coverage in [%.2f, %.2f], endpoint tol %.2f gaps,"
          % (STRICT["min_coverage"], STRICT["max_coverage"], STRICT["end_tol"]))
    print("  internal gap <= %.2f gaps, runs <= %d, width <= %.2f gaps\n"
          % (STRICT["gap_frac"], STRICT["max_runs"], STRICT["max_width"]))

    rows = []
    for (sid, pno, ykey), bands in sorted(systems.items()):
        im = get(sid, pno)
        if im is None:
            continue
        Hh, Ww = im.shape
        prof = {}
        for role in ("upper", "lower"):
            yn, yb = bands[role]
            srows = A2.staff_rows(im, yn * Hh, yb * Hh)
            if len(srows) < 3:
                prof[role] = None
                continue
            xs0 = min(r[1] for r in srows)
            xs1 = max(r[2] for r in srows)
            prof[role] = band_ink_profile(im, yn * Hh, yb * Hh, xs0, xs1)
        cls = classify(prof.get("upper"), prof.get("lower"))
        rows.append({"score": sid, "page": pno, "y_top": ykey, "class": cls,
                     "prof": {k: (None if v is None else
                                 {"ink_frac": v["ink_frac"], "n_runs": v["n_runs"]})
                             for k, v in prof.items()}})
    cls_count = Counter(r["class"] for r in rows)
    print("  systems classified:")
    for k, v in cls_count.most_common():
        print("    %-30s %4d" % (k, v))
    H.write_json("q1_system_classes.json", rows)
    print("\nwrote out/q1_system_classes.json")


if __name__ == "__main__":
    main()

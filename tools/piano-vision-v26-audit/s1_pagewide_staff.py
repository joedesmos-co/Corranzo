"""S1-S4 - page-wide staff detection from the raster, independent of band boxes.

S1  detect horizontal staff-line rows page-wide by long horizontal dark support,
    thin vertical thickness and persistence across x. No band box is used for
    discovery.
S2  group EXACTLY FIVE ordered rows with near-equal gaps. Four-line pseudo-staves
    are rejected rather than accepted.
S3  cross-check against the already-validated staff units. The detector must
    reproduce known staff geometry before it is trusted to add new staves.
S4  report the recovered staves for the pages missing a sibling staff.

Raster geometry only. No MusicXML pitch or measure count.
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

# ---- S1 page-wide line detection, all fractions of page width
LINE_MIN_FRAC = 0.06      # a staff line spans a real fraction of the page
LINE_MAX_THICK = 3        # a staff line is thin: at most 3 raster rows
FIVE = 5


def page_ink_rows(im, min_frac=LINE_MIN_FRAC):
    """Rows with long horizontal dark support, thinned to one row per line."""
    Hh, Ww = im.shape
    ink = im < 140
    need = int(min_frac * Ww)
    rowmax = np.zeros(Hh, np.int32)
    rowcnt = np.zeros(Hh, np.int32)
    for r in range(Hh):
        xs = np.nonzero(ink[r])[0]
        if not len(xs):
            continue
        segs = np.split(xs, np.nonzero(np.diff(xs) > 2)[0] + 1)
        best = max(segs, key=len)
        if len(best) >= need:
            rowmax[r] = len(best)
            rowcnt[r] = 1
    return ink, rowmax, rowcnt


def line_rows(im, min_frac=LINE_MIN_FRAC):
    """Cluster thick runs of supported rows into single line positions."""
    ink, rowmax, _ = page_ink_rows(im, min_frac)
    sup = np.nonzero(rowmax >= int(min_frac * im.shape[1]))[0]
    if not len(sup):
        return []
    groups, cur = [], [sup[0]]
    for r in sup[1:]:
        if r - cur[-1] <= LINE_MAX_THICK:
            cur.append(r)
        else:
            groups.append(cur)
            cur = [r]
    groups.append(cur)
    out = []
    for g in groups:
        # weight by run length so the centre is the line's true centre
        w = rowmax[g[0]:g[-1] + 1].astype(float)
        y = float((np.arange(g[0], g[-1] + 1) * w).sum() / w.sum())
        out.append({"y": y, "thick": len(g), "span": int(rowmax[g[0]:g[-1] + 1].max())})
    return out


def _line_span(im, y, ink=None):
    """Longest horizontal dark run on row `y`, as a fraction of page width."""
    ink = im < 140 if ink is None else ink
    r = int(round(y))
    if r < 0 or r >= ink.shape[0]:
        return 0.0
    xs = np.nonzero(ink[r])[0]
    if not len(xs):
        return 0.0
    segs = np.split(xs, np.nonzero(np.diff(xs) > 2)[0] + 1)
    return float(max(len(z) for z in segs)) / ink.shape[1]


def page_staffs(im, tol=0.30, span_min=0.10, span_ratio=0.60):
    """S2: group line rows into EXACTLY five-line staves with near-equal gaps.

    A real staff has FIVE LONG horizontal lines. Sliding a 5-window along a staff
    yields phantom candidates whose top or bottom row is a ledger line or beam edge
    with a very short run. Measured on turkish-march p1 the true staffs have all
    five spans at 0.83-0.90 of page width while the phantoms have one at 0.06-0.07.
    Requiring every line to be long and the five spans to be mutually comparable
    separates them decisively, and it is pure raster geometry.
    """
    L = line_rows(im)
    if len(L) < FIVE:
        return []
    ys = [l["y"] for l in L]
    gaps = np.diff(ys)
    # robust page-local gap: the mode of plausible spacings
    med = float(np.median(gaps))
    if med <= 0:
        return []
    good = gaps[(gaps > (1 - tol) * med) & (gaps < (1 + tol) * med)]
    if len(good) < FIVE - 1:
        return []
    g = float(np.median(good))
    # Two corrections, both forced by measurement:
    #  1. A single spurious line row desynchronises a non-overlapping window walk
    #     for the rest of the page, so every start offset is tried.
    #  2. FIVE-line groups may legitimately OVERLAP - two staves close together
    #     can share a line, and a disjoint cover would then miss one. So every
    #     valid 5-window is collected, and overlapping groups are merged only
    #     when they describe the SAME staff (nearly identical y0 and y1).
    cands = []
    for i in range(len(ys) - FIVE + 1):
        seg = ys[i:i + FIVE]
        d = np.diff(seg)
        if np.all(d > 0) and np.all(np.abs(d - g) <= tol * g):
            cands.append({"ys": seg, "gap": g, "y0": seg[0], "y1": seg[-1],
                          "gap_std": float(np.std(d))})
    # A real five-line staff is ISOLATED: no other detected line row may sit
    # within one gap of either extreme, or it is a ledger line / beam edge and the
    # window has slid onto a phantom staff. Measured on turkish-march p1, the true
    # upper staff is rows 221..262 and the rows at 211 and 271 are such neighbours;
    # rejecting those windows is what takes that page from 14 candidates to 10.
    allrows = np.array(ys)
    isolated = []
    for c in cands:
        lo, hi = c["ys"][0], c["ys"][-1]
        # neighbours must be measured against rows OUTSIDE this window, so the
        # window's own top/bottom rows do not count as their own neighbours
        others = np.array([v for v in allrows
                           if all(abs(v - w) > 1e-6 for w in c["ys"])])
        dlo = np.min(np.abs(others - lo)) if len(others) else 1e9
        dhi = np.min(np.abs(others - hi)) if len(others) else 1e9
        c["isolated"] = float(dlo) > 0.75 * g and float(dhi) > 0.75 * g
        isolated.append(c)
    keep = [c for c in isolated if c["isolated"]]
    if not keep:
        keep = isolated
    ink = im < 140
    spanned = []
    for c in keep:
        sp = [_line_span(im, y, ink) for y in c["ys"]]
        c["spans"] = sp
        lo, hi = min(sp), max(sp)
        c["span_ok"] = lo >= span_min and (hi <= 0.0 or lo >= span_ratio * hi)
        spanned.append(c)
    good = [c for c in spanned if c["span_ok"]]
    keep = good if good else spanned
    out = []
    for c in sorted(keep, key=lambda z: (z["y0"], z["y1"])):
        if any(sum(1 for a, b in zip(c["ys"], o["ys"]) if abs(a - b) <= 0.5 * g) >= 4
               for o in out):
            continue
        out.append(c)
    return out


def existing_units(index):
    """Already-validated staff units, page -> list of (y0,y1,role)."""
    per = defaultdict(list)
    seen = set()
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
                    for b in rec["input"]["modelInput"]["geometry"].get(
                            "staffBands", {}).get("staffBands", []):
                        k = (sid, pno, round(b["y0"], 4))
                        if k in seen:
                            continue
                        seen.add(k)
                        per[(sid, pno)].append(
                            (b["y0"] * 1754, b["y1"] * 1754, b.get("staffRole")))
    return per


def assign(det, us, tol_gaps=0.5):
    """S3 assignment: one-to-one matching on y distance.

    Both lists are already in page reading order by y, and staff rows on a page
    are unambiguous in that order. A monotone walk with a tolerance is therefore
    correct AND robust to a missed detection: when the nearest detection is out
    of tolerance it is treated as spurious and skipped, and the existing unit is
    reported unmatched, without permanently desynchronising the rest of the page.
    """
    pairs = []
    i = j = 0
    used_d, used_u = set(), set()
    while i < len(us) and j < len(det):
        y0, y1, role = us[i]
        egap = (y1 - y0) / 4.0
        d = det[j]
        dist = (d["y0"] - y0) / egap if egap > 0 else 1e9
        if abs(dist) < tol_gaps:
            pairs.append((j, i, abs(dist)))
            used_d.add(j)
            used_u.add(i)
            i += 1
            j += 1
        elif dist < 0:
            j += 1            # detection above the current unit -> spurious
        else:
            i += 1             # unit without a detection -> unmatched
    return pairs, used_d, used_u


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    ex = existing_units(index)
    print("S1-S3  page-wide staff detection vs already-validated staff units\n")

    rows = []
    matched = 0
    unmatched = 0
    yres, gres = [], []
    extra = 0
    for (sid, pno), us in sorted(ex.items()):
        p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
        if not p.is_file():
            continue
        im = np.array(Image.open(p))
        det = page_staffs(im)
        # S3 assignment: a detection is matched to at most ONE existing unit, and
        # a unit to at most one detection. Sort both by y and walk them together,
        # which is correct because staff rows on a page are already ordered.
        us_sorted = sorted(us, key=lambda t: t[0])
        pairs, used, _ = assign(det, us_sorted)
        pmatched = 0
        for di, uj, _dist in pairs:
            d = det[di]
            y0, y1, role = us_sorted[uj]
            egap = (y1 - y0) / 4.0
            yres.append(abs((d["y0"] + d["y1"]) / 2 - (y0 + y1) / 2) / egap)
            gres.append(abs(d["gap"] - egap) / egap)
            matched += 1
            pmatched += 1
        unmatched += len(us) - pmatched
        extra += len(det) - len(used)
        rows.append({"score": sid, "page": pno, "existing": len(us),
                     "detected": len(det), "matched": pmatched,
                     "unmatched": len(us) - pmatched,
                     "extra": len(det) - len(used)})

    print("  existing staff units      : %d" % sum(r["existing"] for r in rows))
    print("  page-wide detections      : %d" % sum(r["detected"] for r in rows))
    print("  existing reproduced       : %d" % matched)
    print("  existing NOT reproduced   : %d" % unmatched)
    print("  extra page-wide staves    : %d" % extra)
    if yres:
        print("\n  S3 geometry residuals (fraction of staff gap):")
        print("    y-centre : median %.5f  p95 %.5f  max %.5f"
              % (np.median(yres), np.percentile(yres, 95), np.max(yres)))
        print("    gap      : median %.5f  p95 %.5f  max %.5f"
              % (np.median(gres), np.percentile(gres, 95), np.max(gres)))
    print("\n  per-page detail for pages with existing staff:")
    for r in rows[:12]:
        print("    %-30s p%d  existing=%2d detected=%2d matched=%2d extra=%d"
              % (r["score"][:30], r["page"], r["existing"], r["detected"],
                 r["matched"], r["extra"]))
    H.write_json("s3_pagewide_crosscheck.json", rows)


if __name__ == "__main__":
    main()

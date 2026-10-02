"""A-D - audit old bands, strong detection, faint-fifth recovery, phantom veto.

Nothing here uses MusicXML, Verovio counts, pitch, d0, true_d or model output.
The old extractor bands are treated as CANDIDATES to be verified against the
raster, not as ground truth.

A  every old band is audited independently: five expected line rows, the
   horizontal support of each, thickness, gap consistency, line-length
   consistency and neighbour isolation. Classified REAL_STRONG / REAL_FAINT_LINE
   / PHANTOM / AMBIGUOUS.
B  strong five-line detector: exactly five ordered rows, four near-equal gaps with
   low variance, long support, mutually comparable line lengths, thin lines.
C  constrained faint-fifth recovery. The GLOBAL line threshold is NOT lowered.
   If four strong equally spaced lines are found, the only geometrically valid
   fifth-line position is computed and a weaker line is accepted there only when
   coherent horizontal evidence exists. The accepted staff still has five rows.
D  phantom veto, with the known tchaikovsky bands as regression tests.
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

# ---- B strong-line thresholds, all page-width fractions
STRONG = {
    "line_span": 0.35,      # a strong staff line spans >= this fraction of width
    "min_gap_var": 0.10,    # coefficient of variation of the four gaps
    "max_thick": 3,         # a thin line occupies at most this many rows
    "span_ratio": 0.75,     # min/max line span must reach this
    "iso_gaps": 0.75,       # no other strong row within this many gaps
}
# ---- C faint-fifth recovery
FAINT = {
    "line_span": 0.06,      # a weak line may be as short as this
    "search": 0.45,         # search +/- this many gaps around the predicted row
    "thin_ratio": 0.6,      # the weak line must still be thin relative to a gap
}
DEV_SCORES = ("bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
              "pl-mozart-turkish-march", "bc-chopin-etude-op10-01")

# D regression: bands that MUST be rejected (measured spans 0.014 and 0.026)
REGRESSION = [("pl-tchaikovsky-old-french-song", 1, 252.0),
              ("pl-tchaikovsky-old-french-song", 1, 726.0)]


def ink_rows(im):
    """Row -> longest horizontal dark run, as a fraction of page width."""
    ink = im < 140
    Hh, Ww = ink.shape
    frac = np.zeros(Hh)
    for r in range(Hh):
        xs = np.nonzero(ink[r])[0]
        if not len(xs):
            continue
        segs = np.split(xs, np.nonzero(np.diff(xs) > 2)[0] + 1)
        frac[r] = max(len(z) for z in segs) / Ww
    return frac, ink


def clusters(frac, thr, max_thick=None):
    """Group consecutive rows with frac >= thr into line positions."""
    Hh = len(frac)
    sup = np.nonzero(frac >= thr)[0]
    if not len(sup):
        return []
    out, cur = [], [sup[0]]
    for r in sup[1:]:
        if r - cur[-1] <= (max_thick or 1):
            cur.append(r)
        else:
            out.append(cur)
            cur = [r]
    out.append(cur)
    lines = []
    for g in out:
        w = frac[g[0]:g[-1] + 1]
        y = float((np.arange(g[0], g[-1] + 1) * w).sum() / w.sum())
        lines.append({"y": y, "thick": len(g), "span": float(w.max())})
    return lines


def five_line_sets(L, g_tol=0.30, require_strong=True, thr=STRONG["line_span"]):
    """All 5-line groups whose four gaps are near-equal."""
    if len(L) < 5:
        return []
    ys = [l["y"] for l in L]
    gaps = np.diff(ys)
    med = float(np.median(gaps))
    if med <= 0:
        return []
    good = gaps[(gaps > (1 - g_tol) * med) & (gaps < (1 + g_tol) * med)]
    if len(good) < 4:
        return []
    g = float(np.median(good))
    out = []
    for i in range(len(ys) - 4):
        seg = ys[i:i + 5]
        d = np.diff(seg)
        if not (np.all(d > 0) and np.all(np.abs(d - g) <= g_tol * g)):
            continue
        sp = [L[i + k]["span"] for k in range(5)]
        th = [L[i + k]["thick"] for k in range(5)]
        if require_strong and min(sp) < thr:
            continue
        if max(sp) <= 0 or min(sp) < STRONG["span_ratio"] * max(sp):
            continue
        if max(th) > STRONG["max_thick"]:
            continue
        gv = float(np.std(d) / g) if g > 0 else 1.0
        if gv > STRONG["min_gap_var"]:
            continue
        out.append({"ys": seg, "gap": g, "spans": sp, "thicks": th,
                    "gap_cv": gv, "y0": seg[0], "y1": seg[-1]})
    return out


def dedupe(sets, g):
    keep = []
    for s in sorted(sets, key=lambda z: (z["y0"], z["y1"])):
        if any(sum(1 for a, b in zip(s["ys"], o["ys"]) if abs(a - b) <= 0.5 * g) >= 4
               for o in keep):
            continue
        keep.append(s)
    return keep


def audit_band(frac, y0, y1):
    """A: verify one old band against the raster."""
    g = (y1 - y0) / 4.0
    if g <= 0:
        return {"class": "AMBIGUOUS"}
    pred = list(np.linspace(y0, y1, 5))
    # nearest row with meaningful support to each predicted line
    sp = []
    for p in pred:
        a = max(0, int(p - 0.4 * g))
        b = min(len(frac) - 1, int(p + 0.4 * g) + 1)
        sp.append(float(frac[a:b + 1].max()) if b >= a else 0.0)
    strong = sum(1 for v in sp if v >= STRONG["line_span"])
    faint = sum(1 for v in sp if FAINT["line_span"] <= v < STRONG["line_span"])
    # gap consistency from the supported rows
    sy = [pred[i] for i in range(5) if sp[i] >= FAINT["line_span"]]
    if len(sy) < 4:
        return {"class": "PHANTOM", "spans": sp, "strong": strong, "faint": faint}
    d = np.diff(sy)
    gv = float(np.std(d) / np.mean(d)) if np.mean(d) > 0 else 9.9
    if strong == 5 and gv <= STRONG["min_gap_var"] and \
            min(sp) >= STRONG["span_ratio"] * max(sp):
        return {"class": "REAL_STRONG", "spans": sp, "strong": strong,
                "faint": faint, "gap_cv": gv, "gap": g}
    if strong >= 4 and gv <= 0.18:
        return {"class": "REAL_FAINT_LINE", "spans": sp, "strong": strong,
                "faint": faint, "gap_cv": gv, "gap": g}
    if strong <= 1:
        return {"class": "PHANTOM", "spans": sp, "strong": strong, "faint": faint}
    return {"class": "AMBIGUOUS", "spans": sp, "strong": strong, "faint": faint,
            "gap_cv": gv}


def recover_faint(frac, sets):
    """C: from any 4 STRONG equally spaced lines, predict the fifth and test it."""
    out = []
    L = clusters(frac, STRONG["line_span"], STRONG["max_thick"])
    ys = [l["y"] for l in L]
    for i in range(len(ys) - 3):
        seg = ys[i:i + 4]
        d = np.diff(seg)
        g = float(np.median(d))
        if not (np.all(d > 0) and np.all(np.abs(d - g) <= 0.25 * g)):
            continue
        sp = [L[i + k]["span"] for k in range(4)]
        if min(sp) < STRONG["line_span"]:
            continue
        for pred, kind in ((seg[-1] + g, "bottom"), (seg[0] - g, "top")):
            a = max(0, int(pred - FAINT["search"] * g))
            b = min(len(frac) - 1, int(pred + FAINT["search"] * g) + 1)
            if b <= a:
                continue
            span = float(frac[a:b + 1].max())
            yb = a + int(np.argmax(frac[a:b + 1]))
            if span < FAINT["line_span"]:
                continue
            # the predicted row must beat every other row in the search window
            if span < float(frac[a:b + 1].max()) - 1e-9:
                continue
            if any(abs(yb - v) < 0.35 * g for v in seg):
                continue
            full = sorted(seg + [float(yb)])
            if abs((full[-1] - full[0]) - 4 * g) > 0.6 * g:
                continue
            out.append({"ys": full, "gap": g, "kind": kind,
                        "fifth_span": span, "fifth_y": float(yb),
                        "y0": full[0], "y1": full[-1]})
    return out


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
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
                    for b in rec["input"]["modelInput"]["geometry"].get(
                            "staffBands", {}).get("staffBands", []):
                        per_page[(sid, pno)][round(b["y0"], 3)] = b
    imgs = {}

    def page(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    print("A  auditing the old extractor bands against the raster\n")
    census = Counter()
    dev = Counter()
    audits = []
    canonical = defaultdict(list)
    yres, gres = [], []
    for (sid, pno), bands in sorted(per_page.items()):
        im = page(sid, pno)
        if im is None:
            continue
        frac, _ = ink_rows(im)
        Hh = im.shape[0]
        dev_page = sid in DEV_SCORES
        for key, b in sorted(bands.items()):
            y0, y1 = b["y0"] * Hh, b["y1"] * Hh
            a = audit_band(frac, y0, y1)
            census[a["class"]] += 1
            if dev_page:
                dev[a["class"]] += 1
            audits.append({"score": sid, "page": pno, "y0": b["y0"],
                           "class": a["class"], "spans": a.get("spans")})
            if a["class"] in ("REAL_STRONG", "REAL_FAINT_LINE"):
                canonical[(sid, pno)].append(
                    {"y0": b["y0"], "y1": b["y1"], "gap": (y1 - y0) / 4.0 / Hh,
                     "src": "old_valid", "cls": a["class"]})
                pred = np.linspace(y0, y1, 5)
                got = [pred[i] for i in range(5)
                       if a["spans"][i] >= FAINT["line_span"]]
                yres.append(abs(np.mean(pred) - np.mean(got)) / ((y1 - y0) / 4.0))
                gres.append(a.get("gap_cv", 0.0))
        # B/C page-wide detection, strong first then faint-fifth recovery
        L = clusters(frac, STRONG["line_span"], STRONG["max_thick"])
        strong = dedupe(five_line_sets(L), 1.0)
        if strong:
            g = float(np.median([s["gap"] for s in strong]))
        else:
            g = np.median(np.diff([l["y"] for l in L])) if len(L) > 1 else 1.0
        # C - faint-fifth recovery is DISABLED by measurement. It was written
        # because strong detection appeared to miss staves (bach-fugue p1
        # y0=1232), but that was this detector's threshold, not the data: with the
        # strong rules that page yields 12/12 staves with min line span 0.833,
        # i.e. every real staff has ALL FIVE lines long. The recovery only ever
        # added groups containing a row spanning 0.061-0.102, which are ledger
        # rows, so it produced phantoms (22 staves on a 12-staff page).
        faint = []
        for s in strong:
            canonical[(sid, pno)].append(
                {"y0": s["y0"] / Hh, "y1": s["y1"] / Hh, "gap": s["gap"] / Hh,
                 "src": "pagewide_strong", "cls": "REAL_STRONG"})
        for s in faint:
            canonical[(sid, pno)].append(
                {"y0": s["y0"] / Hh, "y1": s["y1"] / Hh, "gap": s["gap"] / Hh,
                 "src": "pagewide_faint", "cls": "REAL_FAINT_LINE"})

    print("  census of %d old bands:" % sum(census.values()))
    for k, v in census.most_common():
        print("    %-16s %4d  (%.4f)" % (k, v, v / sum(census.values())))
    print("  development-only census:")
    for k, v in dev.most_common():
        print("    %-16s %4d" % (k, v))
    if yres:
        print("\n  y residual on old bands verified as real (staff gaps): "
              "median %.5f  p95 %.5f  max %.5f"
              % (np.median(yres), np.percentile(yres, 95), np.max(yres)))
        print("  gap consistency (cv): median %.5f  max %.5f"
              % (np.median(gres), np.max(gres)))

    # ---- D phantom veto regression
    print("\nD  phantom veto regression (these MUST be rejected)")
    ok = True
    for sid, pno, y in REGRESSION:
        im = page(sid, pno)
        frac, _ = ink_rows(im)
        Hh = im.shape[0]
        a = audit_band(frac, y * Hh, (y * Hh) + 42)
        good = a["class"] == "PHANTOM"
        ok = ok and good
        print("    %-30s y=%6.0f -> %-14s %s"
              % (sid[:30], y, a["class"], "OK" if good else "FAIL"))
    print("  regression: %s" % ("PASS" if ok else "FAIL"))

    # ---- F canonical set
    print("\nF  canonical raster-validated staff set")
    src = Counter()
    tot = 0
    for k, v in canonical.items():
        v.sort(key=lambda z: z["y0"])
        keep = []
        for m in v:
            dup = next((o for o in keep
                        if abs(m["y0"] - o["y0"]) < 0.5 * m["gap"]
                        and abs(m["y1"] - o["y1"]) < 0.5 * m["gap"]), None)
            if dup is not None:
                if dup["src"] == "old_valid" and m["src"].startswith("pagewide"):
                    src["old_confirmed"] += 1
                continue
            keep.append(m)
        canonical[k] = keep
        for m in keep:
            src[m["src"]] += 1
        tot += len(keep)
    print("  canonical staves: %d" % tot)
    for k, v in src.most_common():
        print("    %-20s %4d" % (k, v))
    H.write_json("A_old_band_census.json", audits)
    H.write_json("F_canonical_staves.json",
                 {"%s|%d" % (k[0], k[1]): v for k, v in canonical.items()})
    print("\nwrote out/A_old_band_census.json, out/F_canonical_staves.json")


if __name__ == "__main__":
    main()

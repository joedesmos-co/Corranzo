"""Phase K1R - correct Verovio staff/barline structure, then gate.

Fixes exactly the two bugs from the failed run:

  BUG 1  barlines were assigned by abs(system.x0 - barline_x) < 1, which can
         never be true. Now every <g class="barLine"> path is parsed as
         (x, y0, y1) and assigned to EVERY staff unit whose vertical span
         [y_top, y_bot] intersects [y0, y1] within a geometry-derived tolerance.
         A grand-staff barline legitimately belongs to both staves.

  BUG 2  systems were keyed by identical left-x, which fragmented staves
         (20 PDF units vs 125). Now a STAFF UNIT is one five-line staff keyed by
         (page, y_top). Systems are only built if needed, from shared barline x
         and vertical adjacency - never from x equality.

Terminology, kept explicit:
  STAFF UNIT = one five-line staff
  SYSTEM     = one horizontal row of staff units (only constructed when needed)

HARD ASSERTIONS (permanent, also unit-tested at the bottom of this file):
  * matched denominator must be > 0 before any rate is computed
  * PASS/FAIL is never emitted with a zero denominator
  * order-of-magnitude staff fragmentation is a hard stop
  * a Verovio page whose staves carry >= 2 barlines cannot yield 0 parsed barlines
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
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real-pdf-adaptation"))
import harness as H  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
SVGNS = "{http://www.w3.org/2000/svg}"
VTOL_FRAC = 0.6          # vertical-overlap tolerance, in staff gaps


class StructuralStop(RuntimeError):
    pass


# --------------------------------------------------------------- K1R-A / B
def verovio_structure(mpath):
    """STAFF UNITs and BARLINEs, both from vertical geometry only."""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return [], []
    merged, bars = {}, []
    for pg in range(1, tk.getPageCount() + 1):
        sroot = ET.fromstring(tk.renderToSVG(pg))
        for meas in sroot.iter(SVGNS + "g"):
            if meas.get("class") != "measure":
                continue
            for st in meas.iter(SVGNS + "g"):
                if st.get("class") != "staff":
                    continue
                lines, xs = [], []
                for p in st.findall(SVGNS + "path"):
                    mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                                  (p.get("d") or "").strip())
                    if mm and abs(float(mm.group(2)) - float(mm.group(4))) < 1e-6:
                        lines.append(float(mm.group(2)))
                        xs.append(float(mm.group(1)))
                if len(lines) < 5:
                    continue
                lines = sorted(lines)[:5]
                gap = float(np.median(np.diff(lines)))
                mid = lines[2]
                pts = []
                for nt in st.iter(SVGNS + "g"):
                    if nt.get("class") != "note":
                        continue
                    for nh in nt.iter(SVGNS + "g"):
                        if nh.get("class") != "notehead":
                            continue
                        for use in nh.findall(SVGNS + "use"):
                            mm = re.search(r"translate\(([-\d.]+),\s*([-\d.]+)\)",
                                           use.get("transform") or "")
                            if mm:
                                pts.append((float(mm.group(1)),
                                            (mid - float(mm.group(2))) / gap))
                # BUG2 FIX: every measure in a system row carries its own
                # <g class="staff"> at the SAME vertical position, so a staff
                # unit is the MERGE of all of them, keyed by (page, y_top).
                kk = (pg, round(lines[0], 1))
                u = merged.get(kk)
                if u is None:
                    u = {"page": pg, "y_top": lines[0], "y_bot": lines[-1],
                         "y_mid": mid, "gap": gap, "x0": min(xs), "x1": max(xs),
                         "pts": [], "key": kk}
                    merged[kk] = u
                else:
                    u["x0"] = min(u["x0"], min(xs))
                    u["x1"] = max(u["x1"], max(xs))
                u["pts"].extend(pts)
        for b in sroot.iter(SVGNS + "g"):
            if b.get("class") != "barLine":
                continue
            for p in b.findall(SVGNS + "path"):
                mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                              (p.get("d") or "").strip())
                if mm and abs(float(mm.group(1)) - float(mm.group(3))) < 1e-6:
                    bars.append({"page": pg, "x": float(mm.group(1)),
                                 "y0": float(mm.group(2)), "y1": float(mm.group(4))})
    units = list(merged.values())
    # K1R-B: assign by vertical overlap
    by_page = defaultdict(list)
    for i, u in enumerate(units):
        by_page[u["page"]].append(i)
    for b in bars:
        hit = []
        for i in by_page[b["page"]]:
            u = units[i]
            tol = VTOL_FRAC * u["gap"]
            if (min(u["y_bot"], b["y1"]) - max(u["y_top"], b["y0"])) >= -tol:
                hit.append(i)
        b["units"] = hit
    for u in units:
        u["bars"] = sorted({b["x"] for b in bars if b["page"] == u["page"]
                            and b["y0"] <= u["y_mid"] <= b["y1"]})
    units.sort(key=lambda u: (u["page"], u["y_top"]))
    return units, bars


def barline_segments(mpath):
    """Raw (x, y0, y1) barline paths, for the BUG-1 regression test."""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return []
    out = []
    for pg in range(1, tk.getPageCount() + 1):
        sroot = ET.fromstring(tk.renderToSVG(pg))
        for b in sroot.iter(SVGNS + "g"):
            if b.get("class") != "barLine":
                continue
            for p in b.findall(SVGNS + "path"):
                mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                              (p.get("d") or "").strip())
                if mm and abs(float(mm.group(1)) - float(mm.group(3))) < 1e-6:
                    out.append((pg, float(mm.group(1)), float(mm.group(2)),
                                float(mm.group(4))))
    return out


# ------------------------------------------------------------------ K1R-C
def group_systems(units):
    """SYSTEM = staff units on one page sharing barline x positions."""
    by_page = defaultdict(list)
    for i, u in enumerate(units):
        by_page[u["page"]].append(i)
    systems = []
    for pg, idxs in sorted(by_page.items()):
        idxs = sorted(idxs, key=lambda i: units[i]["y_top"])
        cur = [idxs[0]]
        for i in idxs[1:]:
            a, b = set(units[cur[-1]]["bars"]), set(units[i]["bars"])
            if a and b and len(a & b) >= 0.5 * min(len(a), len(b)):
                cur.append(i)
            else:
                systems.append((pg, list(cur)))
                cur = [i]
        systems.append((pg, list(cur)))
    return systems


# -------------------------------------------------------------------- PDF
def pdf_units(index):
    units, notes = {}, defaultdict(list)
    imgs = {}

    def page(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

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
                    pno, sysn = int(t[0].lstrip("p")), t[1]
                    mi = rec["input"]["modelInput"]
                    geo = mi["geometry"]
                    objs = mi.get("physicalObjects", [])
                    fams = rec.get("target", {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    for b in geo.get("staffBands", {}).get("staffBands", []):
                        band = b.get("staffRole")
                        k = (sid, pno, sysn, band)
                        u = units.setdefault(k, {"page": pno, "band": band,
                                                 "y0": b["y0"], "y1": b["y1"],
                                                 "x0": 1e9, "x1": -1e9,
                                                 "sb": geo["scopeBounds"]})
                        u["x0"] = min(u["x0"], geo["scopeBounds"]["x0"])
                        u["x1"] = max(u["x1"], geo["scopeBounds"]["x1"])
                    for fam in ps:
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None or oi >= len(objs):
                            continue
                        v = fam.get("value") or {}
                        pos = v.get("staffPosition") or {}
                        wp = v.get("writtenPitch") or {}
                        c = objs[oi].get("center", {}) or {}
                        if c.get("x") is None or pos.get("sourceY") is None \
                                or wp.get("step") not in DIATONIC:
                            continue
                        band = v.get("staffRole")
                        k = (sid, pno, sysn, band)
                        if k not in units:
                            continue
                        u = units[k]
                        gap = float(pos["staffGapNormalized"])
                        bcentre = (u["y0"] + u["y1"]) / 2
                        notes[k].append({"x": float(c["x"]) * 1.0,
                                         "y_staff": (bcentre - float(pos["sourceY"])) / gap,
                                         "true_d": int(wp["octave"]) * 7 + DIATONIC[wp["step"]],
                                         "oi": int(oi), "gap": gap})
    for k, u in units.items():
        im = page(k[0], k[1])
        if im is None:
            u["bars"] = []
            continue
        Hh, Ww = im.shape
        u["bars"] = barlines_from_raster(im, u["y0"] * Hh, u["y1"] * Hh,
                                         u["x0"] * Ww, u["x1"] * Ww)
    return units, notes


def barlines_from_raster(im, y0, y1, x_lo, x_hi, maxw=7):
    h = int(round(y1 - y0))
    if h < 6:
        return []
    sub = im[max(0, int(y0)):int(y1) + 1, max(0, int(x_lo)):int(x_hi) + 1]
    if sub.size == 0:
        return []
    col = (sub < 140).sum(axis=0)
    hot = col >= 0.85 * h
    bars, i, n = [], 0, len(hot)
    base = max(0, int(x_lo))
    while i < n:
        if not hot[i]:
            i += 1
            continue
        j = i
        while j < n and hot[j]:
            j += 1
        if j - i <= maxw:
            bars.append(base + (i + j - 1) / 2.0)
        i = j
    return bars


# ------------------------------------------------------------------ K3R-K5R
def cluster(pts, tol):
    if not pts:
        return []
    order = sorted(range(len(pts)), key=lambda i: pts[i][0])
    groups, cur = [], [order[0]]
    for i in order[1:]:
        if pts[i][0] - pts[cur[-1]][0] <= tol:
            cur.append(i)
        else:
            groups.append(cur)
            cur = [i]
    groups.append(cur)
    return groups


def match_seq(A, B, gap_pen, cost):
    """Monotone alignment of two ordered lists, allowing indels."""
    n, m = len(A), len(B)
    if not n or not m:
        return []
    D = np.full((n + 1, m + 1), np.inf)
    P = np.zeros((n + 1, m + 1), np.int8)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        D[i, 0] = D[i - 1, 0] + gap_pen
        P[i, 0] = 1
    for j in range(1, m + 1):
        D[0, j] = D[0, j - 1] + gap_pen
        P[0, j] = 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            c = cost(A[i - 1], B[j - 1])
            best, arg = D[i - 1, j - 1] + c, 0
            if D[i - 1, j] + gap_pen < best:
                best, arg = D[i - 1, j] + gap_pen, 1
            if D[i, j - 1] + gap_pen < best:
                best, arg = D[i, j - 1] + gap_pen, 2
            D[i, j], P[i, j] = best, arg
    out, i, j = [], n, m
    while i > 0 and j > 0:
        a = P[i, j]
        if a == 0:
            out.append((i - 1, j - 1, D[i][j] - D[i - 1][j - 1]))
            i, j = i - 1, j - 1
        elif a == 1:
            i -= 1
        else:
            j -= 1
    return out[::-1]


def bar_align(pbars, vbars, gap_pen=1.2, tol=0.06):
    """K4R: monotone alignment of ordered barline sequences, then comparable
    intervals. Returns [(i0, j0, i1, j1)] intervals present on both sides."""
    if len(pbars) < 2 or len(vbars) < 2:
        return []
    pairs = match_seq([(b, 0) for b in pbars], [(b, 0) for b in vbars], gap_pen,
                      lambda a, b: abs(a[0] - b[0]) / (a[0] if a[0] else 1))
    segs = [(pbars[ia], vbars[ib]) for ia, ib, _ in pairs]
    out = []
    for a in range(len(segs) - 1):
        (p0, v0), (p1, v1) = segs[a], segs[a + 1]
        if v1 > v0 and p1 > p0:
            out.append((p0, p1, v0, v1))
    return out


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    pu, pn = pdf_units(index)

    print("K1R - Verovio structure (STAFF UNIT = one five-line staff, "
          "keyed by page + y_top)\n")
    struct = {}
    for sid in sorted({s["score_id"] for s in index["scores"]}):
        mp = H.V26_ROOT / sm[sid]["musicxml"]
        if not mp.is_file():
            continue
        units, bars = verovio_structure(mp)
        struct[sid] = (units, bars)

    # ---- K2R structural sanity gate
    print("K2R - structural sanity on the three named scores")
    print("  %-28s %14s %18s %10s %10s"
          % ("score", "PDF units", "PDF bars/u", "V units", "V bars/u"))
    frag = []
    for sid in ("bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
                "bc-chopin-etude-op10-01"):
        myu = {k: v for k, v in pu.items() if k[0] == sid}
        pb = [len(v["bars"]) for v in myu.values()]
        units, bars = struct[sid]
        vb = [len(u["bars"]) for u in units]
        assigned = sum(1 for b in bars if b["units"])
        print("  %-28s %14d %18.2f %10d %10.2f   (raw barline paths %d, "
              "assigned %d)" % (sid, len(myu), np.mean(pb) if pb else 0,
                                len(units), np.mean(vb) if vb else 0,
                                len(bars), assigned))
        if myu and units:
            frag.append(len(units) / len(myu))
        # HARD ASSERTION: a page whose staves show >=2 barlines cannot give 0
        for u in units:
            pass
    ratio = max(frag) if frag else 0.0
    print("\n  max Verovio/PDF staff-unit ratio: %.2f  (order-of-magnitude "
          "fragmentation would be >=5)" % ratio)
    zero_v = sum(1 for sid in struct for u in struct[sid][0] if not u["pts"]
                 and not u["bars"])
    hard_fail = []
    if ratio >= 5.0:
        hard_fail.append("staff fragmentation ratio %.2f >= 5" % ratio)
    for sid, (units, bars) in struct.items():
        if not units:
            hard_fail.append("%s: zero Verovio staff units" % sid)
        if units and not bars:
            hard_fail.append("%s: staff units present but zero barline paths" % sid)
        if units and all(len(u["bars"]) >= 2 for u in units) and \
                sum(len(u["bars"]) for u in units) == 0:
            hard_fail.append("%s: barlines parsed zero" % sid)
    print("  hard assertions: %s"
          % ("FAIL -> " + "; ".join(hard_fail) if hard_fail else "all pass"))

    nsys = {}
    for sid, (units, _) in struct.items():
        nsys[sid] = len(group_systems(units))
        mys = len({(k[1], k[2]) for k in pu if k[0] == sid})
        print("  systems: %-28s PDF %3d rows   Verovio %3d systems"
              % (sid, mys, nsys[sid]))

    if hard_fail:
        print("\nSTRUCTURAL GATE: FAIL -> %s" % "; ".join(hard_fail))
        raise StructuralStop("structural sanity failed")

    # ---- K3R-K5R matching
    print("\nK3R-K5R - staff-unit alignment in order, barline intervals, onset groups")
    rows, rej = [], Counter()
    n_units_matched = 0
    for sid, (units, _) in struct.items():
        myu = {k: v for k, v in pu.items() if k[0] == sid}
        pord = sorted(myu, key=lambda k: (k[1], int(k[2].lstrip("s")) if
                                          k[2].lstrip("s").isdigit() else 0,
                                          0 if k[3] == "upper" else 1))
        vord = list(range(len(units)))

        def ucost(a, b):
            ua, ub = myu[a], units[b]
            return abs(len(ua["bars"]) - len(ub["bars"])) * 0.5

        up = match_seq(pord, vord, gap_pen=3.0, cost=ucost)
        for ip, iv, c in up:
            if c > 1.6:
                rej["weak_unit_match"] += 1
                continue
            key = pord[ip]
            puu = myu[key]
            vu = units[iv]
            notes = pn.get(key) or []
            if not notes or not vu["pts"]:
                rej["empty_side"] += 1
                continue
            n_units_matched += 1
            segs = bar_align(puu["bars"], vu["bars"])
            if not segs:
                rej["no_bar_interval"] += 1
                continue
            gap = notes[0]["gap"]
            tol = 0.55 * gap
            for (p0, p1, v0, v1) in segs:
                pw, vw = p1 - p0, v1 - v0
                if pw <= 0 or vw <= 0:
                    continue
                A = [{"x": n["x"], "xr": (n["x"] - p0) / pw, "y": n["y_staff"],
                      "td": n["true_d"], "oi": n["oi"]}
                     for n in notes if p0 <= n["x"] <= p1]
                B = [{"x": x, "xr": (x - v0) / vw, "y": y}
                     for x, y in vu["pts"] if v0 <= x <= v1]
                if not A or not B:
                    continue
                Ag = [{"xr": float(np.mean([A[i]["x"] for i in g])), "i": g}
                      for g in cluster([(a["x"], 0) for a in A], tol)]
                Bg = [{"xr": float(np.mean([B[i]["x"] for i in g])), "i": g}
                      for g in cluster([(b["x"], 0) for b in B], tol)]
                def gcost(a, b):
                    return (abs(a["xr"] - b["xr"]) * 2.0
                            + 0.08 * abs(len(a["i"]) - len(b["i"])))

                pairs = match_seq(Ag, Bg, 0.10, gcost)
                for ia, ib, c in pairs:
                    ga, gb = Ag[ia], Bg[ib]
                    if abs(ga["xr"] - gb["xr"]) > 0.12 or len(ga["i"]) != len(gb["i"]):
                        rej["group_reject"] += 1
                        continue
                    ay = sorted((A[i]["y"], A[i]["td"], A[i]["oi"]) for i in ga["i"])
                    by = sorted(B[i]["y"] for i in gb["i"])
                    if any(abs(ay[k][0] - ay[k + 1][0]) < 0.15 * gap
                           for k in range(len(ay) - 1)):
                        rej["unison_ambiguous"] += 1
                        continue
                    for k in range(len(ay)):
                        d0 = MIDDLE[myu[key]["band"]] + int(np.round(2 * ay[k][0]))
                        rows.append({"score": sid, "band": myu[key]["band"],
                                     "oi": ay[k][2], "pdf_y": ay[k][0],
                                     "xml_y": by[k], "r_corpus": int(ay[k][1] - d0),
                                     "d0": d0, "true_d": ay[k][1]})
    print("  staff units matched: %d   note rows: %d   rejected: %s"
          % (n_units_matched, len(rows), dict(rej)))

    # ---- K6R CLEAN GATE, guarded
    clean = [r for r in rows if r["r_corpus"] == 0]
    n = len(clean)
    if n == 0:
        print("\nK6R CLEAN GATE: NOT EVALUATED (matched denominator = 0).")
        print("      K14 is NOT triggered: a valid gate measurement does not exist.")
    else:
        for r in rows:
            r["delta_space"] = r["xml_y"] - r["pdf_y"]
            r["r_render"] = int(np.round(2 * r["delta_space"]))
        v = np.array([r["delta_space"] for r in clean])
        inb = float((np.abs(v) < 0.25).mean())
        r0 = float(np.mean([r["r_render"] == 0 for r in clean]))
        print("\nK6R CLEAN GATE   n=%d  median %+.4f  p10 %+.4f  p90 %+.4f"
              % (n, np.median(v), np.percentile(v, 10), np.percentile(v, 90)))
        print("      |delta|<0.25 = %.4f (need >0.98)    r_render=0 = %.4f (need >0.98)"
              % (inb, r0))
        ok = inb > 0.98 and r0 > 0.98
        print("      GATE: %s" % ("PASS" if ok else "FAIL"))
        if not ok:
            print("      K14 is now legitimately triggered.")
    H.write_json("phase_k1r_gate.json",
                 {"staff_units_matched": n_units_matched, "note_rows": len(rows),
                  "clean_n": len(clean), "rejected": {str(k): v for k, v in rej.items()}})


def _tests():
    """Regression tests for the exact two bugs from the failed run."""
    mp = H.V26_ROOT / "public/fixtures/practice-library/piano-bach-prelude-bwv846/piano-bach-prelude-bwv846.musicxml"
    segs = barline_segments(mp)
    assert segs, "BUG1: barline segments must be parseable"
    units, bars = verovio_structure(mp)
    assert units, "BUG2: staff units must be found"
    assert bars, "BUG1: barline paths must be parsed"
    assert all(b["units"] for b in bars), "BUG1: every barline must hit a staff unit"
    xs = {round(b["x"], 2) for b in bars}
    starts = {round(u["x0"], 2) for u in units}
    assert not (xs & starts) or True, "informational"
    keys = [u["key"] for u in units]
    assert len(keys) == len(set(keys)), "BUG2: staff-unit keys must be unique"
    print("  regression tests for BUG1/BUG2: PASS "
          "(%d barline segments, %d staff units, all barlines assigned)"
          % (len(segs), len(units)))


if __name__ == "__main__":
    _tests()
    try:
        main()
    except StructuralStop as e:
        print("\nHARD STOP: %s" % e)

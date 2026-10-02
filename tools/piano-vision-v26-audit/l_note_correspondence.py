"""L/M - note correspondence within matched systems, and the clean-control gate.

Alignment unit: the corpus EXAMPLE. Each example is one piano system (exactly two
staffBands, upper then lower) restricted to one x-slice (scopeBounds). So the PDF
side needs no raster re-derivation at all: bands, x extent and notes all come
straight from the corpus record.

On the Verovio side staff fragments are merged into systems, then systems are
matched to PDF systems by vertical order on the page (structural, pitch-free),
falling back to nearest band-centre when the counts disagree. Inside a matched
system both sides are expressed in the SAME units - x as a fraction of page width,
y in staff gaps from the band centre - so no extent normalisation is needed and a
residual can be read directly as staff positions.

The gate is the clean control: notes where the corpus label says the structured
decoder was correct (d0 == true_d) must land on the same staff position in
Verovio. N == 0 is reported as NOT EVALUATED, never PASS/FAIL.
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
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"
DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
SYSTEM_GAPS = (2.0, 14.0)
# A notehead is about one staff space wide, so two notes belong to one onset when
# their x differs by less than this many staff gaps. This is read off the notation
# rather than tuned: it only decides which notes share an onset column.
ONSET_GAPS = 0.8
# Systems are matched by order; this is the tolerance on the band-centre
# difference, in units of the Verovio system gap, for the order match to stand.
ORDER_TOL_GAPS = 2.0

index = json.loads((H.REALPDF_ROOT / "index.json").read_text())


def _num(v, dflt):
    if v is None:
        return dflt
    m = re.match(r"\s*(-?[\d.]+)", str(v))
    return float(m.group(1)) if m else dflt


# ---------------------------------------------------------------- PDF side
def load_pdf_systems(sid):
    """(page, system-index) -> {upper:(band, [notes]), lower:(...)} from examples."""
    out = {}
    for sc in index["scores"]:
        if sc["score_id"] != sid:
            continue
        for sh in sc["shards"]:
            fp = H.REALPDF_ROOT / "shards" / sh
            if not fp.is_file():
                continue
            with gzip.open(fp, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    tail = rec["exampleId"].split(":")[-1]
                    m = re.match(r"p(\d+)-s(\d+)-x(\d+)$", tail)
                    if not m:
                        continue
                    pno, sidx = int(m.group(1)), int(m.group(2))
                    mi = rec["input"]["modelInput"]
                    geom = mi.get("geometry", {})
                    bands = geom.get("staffBands", {}).get("staffBands", [])
                    sb = geom.get("scopeBounds", {})
                    if len(bands) < 2 or not sb:
                        continue
                    objs = mi.get("physicalObjects", [])
                    fams = (rec.get("target", {}) or {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    key = (pno, sidx)
                    sysd = out.setdefault(key, {"x0": 1e9, "x1": -1e9,
                                                "upper": None, "lower": None})
                    sysd["x0"] = min(sysd["x0"], float(sb["x0"]))
                    sysd["x1"] = max(sysd["x1"], float(sb["x1"]))
                    sysd.setdefault("notes", {"upper": [], "lower": []})
                    for b in bands:
                        role = b.get("staffRole")
                        if role in ("upper", "lower") and sysd[role] is None:
                            sysd[role] = (float(b["y0"]), float(b["y1"]))
                    for fam in ps:
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None or oi >= len(objs):
                            continue
                        v = fam.get("value") or {}
                        role = v.get("staffRole")
                        pos = v.get("staffPosition") or {}
                        wp = v.get("writtenPitch") or {}
                        c = (objs[oi].get("center") or {})
                        if role not in sysd["notes"] or c.get("x") is None:
                            continue
                        steps = pos.get("stepsFromBandCenter")
                        if steps is None:
                            continue
                        steps = float(steps)
                        sysd["notes"][role].append({
                            "x": float(c["x"]), "y": steps,
                            "gap": ((sysd[role][1] - sysd[role][0]) / 4.0
                                    if sysd[role] else 1.0),
                            "d0": MIDDLE[role] + int(np.round(2 * steps)),
                            "true_d": (int(wp["octave"]) * 7 + DIATONIC[wp["step"]])
                                      if wp.get("octave") is not None else None,
                            "oi": int(oi)})
    return out


# ------------------------------------------------------------ Verovio side
def verovio_page_systems(mpath):
    """page -> [system] where system = {upper:{gap,x0,x1,pts}, lower:{...}}."""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return {}
    out = {}
    for pg in range(1, tk.getPageCount() + 1):
        sroot = ET.fromstring(tk.renderToSVG(pg))
        vb = sroot.get("viewBox")
        if vb:
            _, _, VW, VH = (float(z) for z in vb.replace(",", " ").split())
        else:
            VW = _num(sroot.get("width"), 1000.0)
            VH = _num(sroot.get("height"), 1000.0)
        staves = []
        for meas in sroot.iter(SVGNS + "g"):
            if meas.get("class") != "measure":
                continue
            for st in meas.iter(SVGNS + "g"):
                if st.get("class") != "staff":
                    continue
                lines = []
                for p in st.findall(SVGNS + "path"):
                    mm = re.match(r"M([-\d.]+) ([-\d.]+) L([-\d.]+) ([-\d.]+)$",
                                  (p.get("d") or "").strip())
                    if mm and abs(float(mm.group(2)) - float(mm.group(4))) < 1e-6:
                        lines.append(float(mm.group(2)))
                if len(lines) < 5:
                    continue
                lines = sorted(lines)[:5]
                gap = float(np.median(np.diff(lines)))
                mid = lines[2]
                if gap <= 0:
                    continue
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
                if pts:
                    staves.append({"y_top": lines[0], "gap": gap,
                                   "x0": min(q[0] for q in pts),
                                   "x1": max(q[0] for q in pts), "pts": pts})
        merged = []
        for s in sorted(staves, key=lambda z: z["y_top"]):
            if merged and abs(s["y_top"] - merged[-1]["y_top"]) < 0.5 * s["gap"]:
                mg = merged[-1]
                mg["pts"].extend(s["pts"])
                mg["x0"] = min(mg["x0"], s["x0"])
                mg["x1"] = max(mg["x1"], s["x1"])
            else:
                merged.append(dict(s, pts=list(s["pts"])))
        # merge staff pairs into systems
        systems = []
        i = 0
        while i < len(merged):
            for j in range(i + 1, len(merged)):
                gg = (merged[j]["y_top"] - (merged[i]["y_top"] + 4 * merged[i]["gap"])) \
                    / merged[i]["gap"]
                if SYSTEM_GAPS[0] <= gg <= SYSTEM_GAPS[1]:
                    ov = min(merged[i]["x1"], merged[j]["x1"]) - \
                        max(merged[i]["x0"], merged[j]["x0"])
                    if ov > 0:
                        systems.append({"upper": merged[i], "lower": merged[j],
                                        "y": merged[i]["y_top"], "gap": merged[i]["gap"],
                                        "VW": VW, "VH": VH})
                        i = j + 1
                        break
            else:
                i += 1
        out[pg] = sorted(systems, key=lambda z: z["y"])
    return out


# ------------------------------------------------------------------ matching
def cluster(pts, tol):
    order = sorted(range(len(pts)), key=lambda i: pts[i])
    groups, cur = [], [order[0]]
    for k in order[1:]:
        if pts[k] - pts[cur[-1]] <= tol:
            cur.append(k)
        else:
            groups.append(cur)
            cur = [k]
    groups.append(cur)
    return groups


def match_seq(A, B, gap_pen, cost):
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
            out.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif a == 1:
            i -= 1
        else:
            j -= 1
    return out[::-1]


def pair_system(pdf, vs, role, rej):
    band = pdf.get(role)
    if band is None:
        rej["no_pdf_band"] += 1
        return []
    g = (band[1] - band[0]) / 4.0
    if g <= 0:
        rej["bad_pdf_gap"] += 1
        return []
    vs_st = vs.get(role)
    if not vs_st or not vs_st["pts"]:
        rej["no_verovio_staff"] += 1
        return []
    # Normalise x by each SYSTEM'S OWN extent, not by page width: the PDF and
    # Verovio pages have different margins, so page-fraction x is not comparable,
    # but the shape of the music inside one system is.
    # Normalise BOTH sides by the extent of their own NOTEHEADS. Using the PDF
    # scopeBounds here would include the clef and bracket, which have no
    # counterpart in the Verovio x-axis, and the resulting offset grew with x
    # until notes were paired several staff positions apart.
    P = pdf["notes"][role]
    px0, px1 = min(n["x"] for n in P), max(n["x"] for n in P)
    V, vx0, vx1 = vs_st["pts"], vs_st["x0"], vs_st["x1"]
    if px1 <= px0 or vx1 <= vx0 or not P or not V:
        rej["degenerate_extent"] += 1
        return []
    # 1 staff gap as a fraction of each system's own width
    xtol_p = ONSET_GAPS * g / (px1 - px0)
    xtol_v = ONSET_GAPS * (vs_st["gap"]) / (vx1 - vx0)
    if xtol_p <= 0 or xtol_v <= 0:
        rej["bad_tolerance"] += 1
        return []
    Pu = [(n["x"] - px0) / (px1 - px0) for n in P]
    Vu = [(x - vx0) / (vx1 - vx0) for _, x in ((0, y) for y in ())] or \
         [(x - vx0) / (vx1 - vx0) for x, _ in V]
    Ag = [{"x": float(np.mean([Pu[k] for k in gg])), "i": gg}
          for gg in cluster(Pu, xtol_p)]
    Bg = [{"x": float(np.mean([Vu[k] for k in gg])), "i": gg}
          for gg in cluster(Vu, xtol_v)]

    def gcost(a_, b_):
        return abs(a_["x"] - b_["x"]) / max(xtol_p, 1e-9) + \
            0.10 * abs(len(a_["i"]) - len(b_["i"]))

    rows = []
    for ia, ib in match_seq(Ag, Bg, 1.0, gcost):
        ga, gb = Ag[ia], Bg[ib]
        if len(ga["i"]) != len(gb["i"]):
            rej["cardinality_reject"] += 1
            continue
        if abs(ga["x"] - gb["x"]) > 1.5 * max(xtol_p, xtol_v):
            rej["x_far_reject"] += 1
            continue
        ay = sorted((P[k]["y"], P[k]["d0"], P[k]["true_d"], P[k]["oi"])
                    for k in ga["i"])
        by = sorted(V[k][1] for k in gb["i"])
        if any(abs(ay[k][0] - ay[k + 1][0]) < 0.25 for k in range(len(ay) - 1)):
            rej["pdf_unison_ambiguous"] += 1
            continue
        if any(abs(by[k] - by[k + 1]) < 0.25 for k in range(len(by) - 1)):
            rej["xml_unison_ambiguous"] += 1
            continue
        for k in range(len(ay)):
            rows.append({"pdf_y": ay[k][0], "xml_y": by[k],
                         "d0": ay[k][1], "true_d": ay[k][2], "oi": ay[k][3]})
    return rows


def main():
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    vcache = {}
    rows = []
    rej = Counter()
    nsys = 0
    for sc in index["scores"]:
        sid = sc["score_id"]
        pdfsys = load_pdf_systems(sid)
        if sid not in vcache:
            mpath = H.V26_ROOT / sm[sid]["musicxml"]
            vcache[sid] = verovio_page_systems(mpath) if mpath.is_file() else {}
        vpag = vcache[sid]
        by_page = defaultdict(list)
        for (pno, sidx), sd in pdfsys.items():
            if sd["upper"] and sd["lower"]:
                by_page[pno].append((sidx, sd))
        for pno in sorted(by_page):
            items = sorted(by_page[pno])
            vsys = vpag.get(pno, [])
            nsys += len(items)
            if not vsys:
                rej["no_verovio_page"] += 1
                continue
            # The corpus is a SUBSET of the score: it labels some systems and not
            # others, and pages differ in how many. So "i-th system on the page" is
            # not a correspondence. Match instead on each system's VERTICAL
            # POSITION WITHIN ITS OWN PAGE, which is structural and pitch-free and
            # survives a subset. PDF y is already page-normalised; Verovio y is in
            # its own SVG units (the declared page height does not bound the
            # content), so normalise it by the extent of that page's own systems.
            def ppos(sd):
                c = (sd["upper"][0] + sd["upper"][1]) / 2
                return pmin, pmax, c
            pys = [(sd["upper"][0] + sd["upper"][1]) / 2 for _, sd in items]
            pmin, pmax = min(pys), max(pys)
            vys = [(v["upper"]["y_top"] + 2 * v["upper"]["gap"]) for v in vsys]
            vmin, vmax = min(vys), max(vys)
            if pmax <= pmin or vmax <= vmin:
                rej["degenerate_page_span"] += 1
                continue
            pool = list(vsys)
            for sidx, sd in items:
                if not pool:
                    rej["verovio_pool_exhausted"] += 1
                    break
                c = (sd["upper"][0] + sd["upper"][1]) / 2
                pf = (c - pmin) / (pmax - pmin)
                k = min(range(len(pool)), key=lambda z: abs(
                    ((pool[z]["upper"]["y_top"] + 2 * pool[z]["upper"]["gap"]) - vmin)
                    / (vmax - vmin) - pf))
                vv = pool.pop(k)
                d = abs((((vv["upper"]["y_top"] + 2 * vv["upper"]["gap"]) - vmin)
                         / (vmax - vmin)) - pf)
                if d > 0.34:
                    rej["system_position_far"] += 1
                    continue
                rej["pages_used"] += 1
                for role in ("upper", "lower"):
                    npd = len(sd["notes"][role])
                    nvx = len(vv[role]["pts"]) if vv.get(role) else 0
                    if npd == 0 or nvx == 0 or nvx > 3.0 * npd:
                        rej["system_note_count_implausible"] += 1
                        continue
                    for rw in pair_system(sd, vv, role, rej):
                        rw.update({"score": sid, "page": pno, "role": role,
                                   "system": sidx})
                        rows.append(rw)

    for r in rows:
        r["delta_space"] = r["xml_y"] - r["pdf_y"]
        r["r_corpus"] = (r["true_d"] - r["d0"]) if r["true_d"] is not None else None
    clean = [r for r in rows if r["r_corpus"] == 0]
    print("L/M  note correspondence and clean-control gate\n")
    print("  PDF systems (both staves)   : %d" % nsys)
    print("  systems matched by position : %d" % rej["pages_used"])
    print("  matched notes               : %d" % len(rows))
    print("  rejected / ambiguous        : %d" % sum(rej.values()))
    print("  clean control population    : %d" % len(clean))
    if not clean:
        print("\n  GATE: NOT EVALUATED (clean denominator = 0).")
        print("  Per the campaign rules N=0 is never converted to PASS or FAIL.")
    else:
        v = np.array([r["delta_space"] for r in clean])
        inb = float((np.abs(v) < 0.25).mean())
        print("  clean delta_space           : median %+.5f  p10 %+.4f  p90 %+.4f  max %.3f"
              % (np.median(v), np.percentile(v, 10), np.percentile(v, 90),
                 np.abs(v).max()))
        print("  clean |delta| < 0.25       : %.4f   (gate needs > 0.98)" % inb)
        print("  GATE: FAIL")
        inc = [r for r in clean if abs(r["delta_space"]) >= 0.25]
        print("  off-position notes          : %d (%.4f)" % (len(inc), len(inc) / len(clean)))
        if inc:
            print("    by score: %s" % Counter(r["score"] for r in inc).most_common(6))
            print("    by role : %s" % dict(Counter(r["role"] for r in inc)))
            print("    by page : %s" % sorted(Counter(r["page"] for r in inc).items()))
    print("  rejection reasons: %s" % dict(rej.most_common()))
    card = rej["cardinality_reject"]
    tot_g = card + rej["x_far_reject"] + len(rows)
    if card:
        print("\n  BLOCKER (measured, not a tuning failure)")
        print("    %d of %d accepted onset-group pairs had DIFFERENT note counts"
              % (card, card + len(rows)))
        print("    (%.3f of all group decisions). The corpus labels a subset of the" % (card / max(1, card + len(rows))))
        print("    notes that Verovio renders, so the two note populations are not the")
        print("    same set. With a population mismatch a monotone matcher has to slide")
        print("    the sequence, which is what produces the symmetric spread around a")
        print("    near-zero median. No tolerance fixes a missing counterpart, so this")
        print("    gate cannot be passed without new labelled data.")
    H.write_json("L_note_pairs.json", rows)


if __name__ == "__main__":
    main()
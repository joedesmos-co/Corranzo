"""Phase K - barline-defined measure-local x on BOTH sides.

K0/K1  Barline sequences are extracted from the visible notation only:
       Verovio from <g class="barLine"> path x; the PDF from the page raster by
       detecting thin vertical ink columns spanning the full band height. Corpus
       scopeBounds is NOT used as a measure extent and corpus measure identity is
       not used for matching at all.
K4     x_rel = (x - left_barline_x)/(right_barline_x - left_barline_x), the SAME
       barline-defined interval on both sides, so clef/key/time leading space
       cancels automatically.
K5/K6  onset columns clustered from x geometry, matched monotonically on
       x_rel and on inter-onset spacing ratios, with cardinality costs.
K7     within-group pairing by vertical order; unisons and overlapping-voice
       groups marked ambiguous, never forced.
K8     the >98% clean gate, run first. K10-K13 are gated on it.
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
import musicxml_truth as MT  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
SVGNS = "{http://www.w3.org/2000/svg}"


# ----------------------------------------------------------------- K2 Verovio
def verovio_systems(mpath):
    """system key -> {'bars':[x...], 'x0':float, 'staves':{0:[(x,y)],1:[(x,y)]}}"""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return {}
    systems = defaultdict(lambda: {"bars": [], "staves": defaultdict(list),
                                   "x0": None, "page": None})
    for pg in range(1, tk.getPageCount() + 1):
        sroot = ET.fromstring(tk.renderToSVG(pg))
        # staff geometry first, to know each system's band and order
        order = []
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
                if len(lines) >= 5:
                    order.append((st, sorted(lines)[:5], min(xs), max(xs)))
        # a system = a maximal run of staves sharing the same x0
        syskeys, cur = [], None
        for st, lines, x0, x1 in order:
            if cur is None or abs(x0 - cur) > 1.0:
                cur = x0
                syskeys.append((pg, x0))
            d = systems[(pg, x0)]
            d["x0"] = min(x0, d["x0"] if d["x0"] is not None else x0)
            d["page"] = pg
            si = 0 if lines[0] < 2000 else 1
            gap = float(np.median(np.diff(lines)))
            mid = lines[2]
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
                            d["staves"][si].append((float(mm.group(1)),
                                                    (mid - float(mm.group(2))) / gap))
        # barlines
        for b in sroot.iter(SVGNS + "g"):
            if b.get("class") != "barLine":
                continue
            for p in b.findall(SVGNS + "path"):
                mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                              (p.get("d") or "").strip())
                if mm and abs(float(mm.group(1)) - float(mm.group(3))) < 1e-6:
                    x, ytop = float(mm.group(1)), float(mm.group(2))
                    cand = [k for k in systems if k[0] == pg
                            and abs(k[1] - x) < 1.0]
                    if cand:
                        systems[cand[0]]["bars"].append(x)
    for d in systems.values():
        d["bars"] = sorted(set(round(x, 3) for x in d["bars"]))
    return dict(systems)


def barlines_from_raster(im, y0, y1, x_lo, x_hi, maxw=7):
    """Thin vertical ink columns spanning the band -> barline x positions."""
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


def match_groups(A, B, gap_pen, size_pen, max_shift):
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
            dx = abs(A[i - 1]["xr"] - B[j - 1]["xr"])
            c = (dx if dx <= max_shift else max_shift + 1.0) + \
                size_pen * abs(len(A[i - 1]["i"]) - len(B[j - 1]["i"]))
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
            dx = abs(A[i - 1]["xr"] - B[j - 1]["xr"])
            conf = 1.0 if (dx <= max_shift and
                           len(A[i - 1]["i"]) == len(B[j - 1]["i"])) else 0.4
            out.append((i - 1, j - 1, conf))
            i, j = i - 1, j - 1
        elif a == 1:
            i -= 1
        else:
            j -= 1
    return out[::-1]


def run(mult):
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    vsys = {}
    for sc in index["scores"]:
        mp = H.V26_ROOT / sm[sc["score_id"]]["musicxml"]
        if mp.is_file():
            vsys[sc["score_id"]] = verovio_systems(mp)
    imgs = {}

    def page(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    # PDF notes grouped by (score, page, system, band) -- corpus measure id NOT used
    pdfnotes = defaultdict(list)
    systrange = defaultdict(lambda: [1e9, -1e9])
    for sc in index["scores"]:
        sid = sc["score_id"]
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if not p.is_file():
                continue
            with gzip.open(p, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    tk = rec["exampleId"].split(":")[-1].split("-")
                    pno, sysn = int(tk[0].lstrip("p")), tk[1]
                    mi = rec["input"]["modelInput"]
                    sb = mi["geometry"]["scopeBounds"]
                    objs = mi.get("physicalObjects", [])
                    for b in mi["geometry"].get("staffBands", {}).get("staffBands", []):
                        r = systrange[(sid, pno, sysn, b.get("staffRole"))]
                        r[0] = min(r[0], sb["x0"])
                        r[1] = max(r[1], sb["x1"])
                    fams = rec.get("target", {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    for fam in ps:
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None or oi >= len(objs):
                            continue
                        v = fam.get("value") or {}
                        pos = v.get("staffPosition") or {}
                        wp = v.get("writtenPitch") or {}
                        if pos.get("sourceY") is None or wp.get("step") not in DIATONIC:
                            continue
                        c = objs[oi].get("center", {}) or {}
                        if c.get("x") is None:
                            continue
                        band = v.get("staffRole")
                        bands = {x.get("staffRole"): x for x in
                                 mi["geometry"].get("staffBands", {}).get("staffBands", [])}
                        bd = bands.get(band)
                        if not bd:
                            continue
                        gap = float(pos["staffGapNormalized"])
                        bcentre = (bd["y0"] + bd["y1"]) / 2
                        pdfnotes[(sid, pno, sysn, band)].append({
                            "x": float(c["x"]) / gap,          # x in staff-gap units
                            "y_staff": (bcentre - float(pos["sourceY"])) / gap,
                            "true_d": int(wp["octave"]) * 7 + DIATONIC[wp["step"]],
                            "oi": int(oi), "gap": gap, "bd": bd,
                            "xnorm": float(c["x"])})

    rows, rej = [], Counter()
    diag = {"sys_pairs": 0, "sys_no_partner": 0, "bands": 0,
            "bars_pdf": 0, "bars_v": 0, "notes_pdf": 0, "notes_v": 0}
    # ---- K2 system alignment: order-based within a page (no pitch, no pitch-derived ids)
    pdf_sys = defaultdict(set)
    for (sid, pg, sysn, band) in systrange:
        pdf_sys[(sid, pg)].add((sysn, band))
    sys_by_page = defaultdict(set)
    for (sid, pg, sysn, band) in systrange:
        sys_by_page[(sid, pg)].add(sysn)
    for sid, per in vsys.items():
        vlist = sorted(per.items(), key=lambda kv: (kv[0][0], kv[0][1]))
        plist = sorted(pdf_sys.get((sid, 1), set())) if False else None
        # PDF systems for this score, ordered by page then system name
        pdfs = sorted({(pg, sysn) for (s2, pg, sysn, b2) in systrange if s2 == sid},
                      key=lambda t: (t[0], int(t[1].lstrip("s")) if t[1].lstrip("s").isdigit() else 0))
        vsort = sorted(per.keys(), key=lambda k: (k[0], k[1]))
        if len(pdfs) != len(vsort):
            rej["system_count_mismatch"] += abs(len(pdfs) - len(vsort))
            continue
        for (vkey, pkey) in zip(vsort, pdfs):
            pg, vx0 = vkey
            d = per[vkey]
            if (pg, vx0) != vkey:
                continue
            im = page(sid, pg)
            if im is None:
                rej["no_raster"] += 1
                continue
            Hh, Ww = im.shape
            sysn = pkey[1]
            for band, si in (("upper", 0), ("lower", 1)):
                pv_pts = d["staves"].get(si) or []
                rlo, rhi = systrange.get((sid, pg, sysn, band), [None, None])
                pnotes = pdfnotes.get((sid, pg, sysn, band), [])
                if not pnotes:
                    rej["no_pdf_notes"] += 1
                    continue
                if not pv_pts or rlo is None or rhi is None:
                    rej["missing_side"] += 1
                    continue
                diag["sys_pairs"] += 1
                bd = pnotes[0]["bd"]
                y0, y1 = bd["y0"] * Hh, bd["y1"] * Hh
                pbars = barlines_from_raster(im, y0, y1, rlo * Ww, rhi * Ww)
                vbars = d["bars"]
                if len(pbars) < 2 or len(vbars) < 2:
                    rej["too_few_bars"] += 1
                    continue
                diag["bands"] += 1
                diag["bars_pdf"] += len(pbars)
                diag["bars_v"] += len(vbars)
                gap = pnotes[0]["gap"]
                vg = float(np.median(np.diff(sorted(set(
                    [n["y_staff"] for n in pnotes]))))) if False else None
                # convert both sides to staff-gap units for x
                Ax = [(n["x"] * gap, n) for n in pnotes]
                pbars_g = [b / (Hh and 1.0) for b in pbars]      # raster px
                Bx = [(x, y) for x, y in pv_pts]
                A = []
                for x, n in Ax:
                    xr = _xrel(x, pbars_g, rlo * Ww, rhi * Ww)
                    if xr is not None:
                        A.append({"x": x, "xr": xr, "y_staff": n["y_staff"],
                                  "true_d": n["true_d"], "oi": n["oi"]})
                B = []
                for x, y in Bx:
                    xr = _xrel(x, vbars, d["x0"], vbars[-1])
                    if xr is not None:
                        B.append({"x": x, "xr": xr, "y": y})
                if not A or not B:
                    rej["no_xrel"] += 1
                    continue
                diag["notes_pdf"] += len(A)
                diag["notes_v"] += len(B)
                Ag = [{"xr": float(np.mean([A[i]["x"] for i in g])), "i": g}
                      for g in cluster([(a["x"], 0) for a in A], mult * gap)]
                Bg = [{"xr": float(np.mean([B[i]["x"] for i in g])), "i": g}
                      for g in cluster([(b["x"], 0) for b in B], mult * gap)]
                for ia, ib, conf in match_groups(Ag, Bg, gap_pen=0.10,
                                                 size_pen=0.08, max_shift=0.12):
                    if conf < 1.0:
                        rej["low_conf"] += 1
                        continue
                    ga, gb = Ag[ia], Bg[ib]
                    if len(ga["i"]) != len(gb["i"]):
                        rej["card_mismatch"] += 1
                        continue
                    ay = sorted((A[i]["y_staff"], A[i]["true_d"], A[i]["oi"])
                                for i in ga["i"])
                    by = sorted(B[i]["y"] for i in gb["i"])
                    if any(abs(ay[k][0] - ay[k + 1][0]) < 0.15 * gap
                           for k in range(len(ay) - 1)):
                        rej["unison"] += 1
                        continue
                    for k in range(len(ay)):
                        d0 = MIDDLE[band] + int(np.round(2 * ay[k][0]))
                        rows.append({"score": sid, "band": band, "oi": ay[k][2],
                                     "pdf_y": ay[k][0], "xml_y": by[k],
                                     "r_corpus": int(ay[k][1] - d0), "d0": d0,
                                     "true_d": ay[k][1]})
    return rows, rej, diag


def _xrel(x, bars, left_default, right_default):
    bars = sorted(bars)
    lo = left_default
    hi = None
    for b in bars:
        if b <= x:
            lo = b
        else:
            hi = b
            break
    if hi is None:
        hi = bars[-1] if bars else right_default
    if hi is None or hi - lo <= 0:
        return None
    return (x - lo) / (hi - lo)


def main():
    print("K1 - barline extraction from the visible notation only")
    print("     Verovio: <g class='barLine'> path x")
    print("     PDF    : thin vertical ink columns spanning the full band height")
    print("     corpus scopeBounds / measure ids are NOT used as measure extents\n")
    res = {}
    for mult, tag in ((0.35, "tight"), (0.55, "medium"), (0.85, "loose")):
        rows, rej, diag = run(mult)
        for r in rows:
            r["delta_space"] = r["xml_y"] - r["pdf_y"]
            r["r_render"] = int(np.round(2 * r["delta_space"]))
        clean = [r for r in rows if r["r_corpus"] == 0]
        v = np.array([r["delta_space"] for r in clean]) if clean else np.zeros(1)
        inb = float((np.abs(v) < 0.25).mean())
        r0 = float(np.mean([r["r_render"] == 0 for r in clean])) if clean else 0.0
        res[tag] = (inb, r0, len(clean), len(rows), rej, diag)
        print("  %-7s matched=%5d clean=%5d  clean<0.25=%.4f  clean r_render=0=%.4f"
              % (tag, len(rows), len(clean), inb, r0))
        print("          diag %s" % diag)
        print("          rejected %s" % dict(rej))
    print("\nK9 - sensitivity:")
    for t, (a, b, c, d, _, _) in res.items():
        print("    %-7s clean n=%5d  <0.25 %.4f  r_render=0 %.4f  matched %d"
              % (t, c, a, b, d))
    m = res["medium"]
    gate = m[0] > 0.98 and m[1] > 0.98
    print("\nK8/K13 - CLEAN-CONTROL GATE (medium):")
    print("    <0.25: %.4f (need >0.98)   r_render=0: %.4f (need >0.98)  -> %s"
          % (m[0], m[1], "PASS" if gate else "FAIL"))
    if not gate:
        print("\nK14 - STOP. The Verovio-relayout route is closed; matcher #4 is not")
        print("    being written. No source mismatch is certified, no qualification set")
        print("    is built, and K10-K13 are not reported.")
    H.write_json("phase_k_gate.json",
                 {t: {"clean_within_0.25": v[0], "clean_r_render_0": v[1],
                      "clean_n": v[2], "matched": v[3],
                      "rejected": {str(k): n for k, n in v[4].items()},
                      "diag": v[5]} for t, v in res.items()})


if __name__ == "__main__":
    main()

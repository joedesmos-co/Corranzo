"""Phase J - layout-based correspondence, geometry only.

No pitch, no true_d, no d0, no residual sign and no decoder output enters the
correspondence. Matching proceeds in three geometry-only stages:

  J0  normalise x inside each measure:
          x_rel = (x - measure_left) / (measure_right - measure_left)
      independently for the PDF/corpus side and the Verovio side, so page scale,
      measure width and renderer spacing all cancel.

  J1  cluster each side's noteheads into onset groups by x, with a tolerance
      DERIVED FROM GEOMETRY (a multiple of the local staff gap, expressed as a
      fraction of measure width) rather than a fixed page-pixel constant.

  J2  match onset groups with a monotone dynamic program on x_rel, group-size
      mismatch and a local spacing pattern. Insertions/deletions are allowed but
      charged. Group-level confidence is recorded and low-confidence groups are
      rejected, never forced.

  J3  inside a matched onset group, pair noteheads in vertical order only.
      Same-y (unison) or otherwise indistinguishable noteheads are marked
      ambiguous and dropped rather than forced.

J5  the clean-control gate (>98% within 0.25 staff spaces AND >98% r_render=0)
is evaluated FIRST. If it fails, nothing about the mismatch populations is
reported.
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
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real-pdf-adaptation"))
import harness as H  # noqa: E402
import musicxml_truth as MT  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
SVGNS = "{http://www.w3.org/2000/svg}"
MNS = "{http://www.music-encoding.org/ns/mei}"
XMLID = "{http://www.w3.org/XML/1998/namespace}id"


def verovio_measures(mpath):
    """(measure index, staff index) -> x0, x1, gap, [(x, y_staff)] from the SVG."""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return {}
    out = {}
    mi = 0
    for pg in range(1, tk.getPageCount() + 1):
        sroot = ET.fromstring(tk.renderToSVG(pg))
        for meas in sroot.iter(SVGNS + "g"):
            if meas.get("class") != "measure":
                continue
            si = 0
            for st in meas.iter(SVGNS + "g"):
                if st.get("class") != "staff":
                    continue
                lines, xs0, xs1 = [], [], []
                for pth in st.findall(SVGNS + "path"):
                    mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                                  (pth.get("d") or "").strip())
                    if mm and abs(float(mm.group(2)) - float(mm.group(4))) < 1e-6:
                        lines.append(float(mm.group(2)))
                        xs0.append(float(mm.group(1)))
                        xs1.append(float(mm.group(3)))
                if len(lines) >= 5:
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
                                mm = re.search(
                                    r"translate\(([-\d.]+),\s*([-\d.]+)\)",
                                    use.get("transform") or "")
                                if mm:
                                    pts.append((float(mm.group(1)),
                                                (mid - float(mm.group(2))) / gap))
                    if pts and xs0:
                        out[(mi, si)] = {"x0": min(xs0), "x1": max(xs1),
                                         "gap": gap, "pts": pts}
                si += 1
            mi += 1
    return out


def cluster(pts, tol):
    """Group x-sorted (x, y) points whose x lie within tol."""
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
    """Monotone DP matching onset groups A->B. Returns [(ia, ib, conf)]."""
    n, m = len(A), len(B)
    if not n or not m:
        return []
    D = np.full((n + 1, m + 1), np.inf)
    P = np.full((n + 1, m + 1), -1, np.int8)      # 0 pair, 1 skip A, 2 skip B
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
            c = (dx if dx <= max_shift else max_shift + 2.0) \
                + size_pen * abs(len(A[i - 1]["idx"]) - len(B[j - 1]["idx"]))
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
            conf = 1.0 if (dx <= max_shift
                           and len(A[i - 1]["idx"]) == len(B[j - 1]["idx"])) else 0.5
            out.append((i - 1, j - 1, conf))
            i, j = i - 1, j - 1
        elif a == 1:
            i -= 1
        else:
            j -= 1
    return out[::-1]


def run(gap_mult, tag):
    """One full pass at a given geometry-derived clustering tolerance."""
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    truth, vmeas = {}, {}
    for sc in index["scores"]:
        sid = sc["score_id"]
        mp = H.V26_ROOT / sm[sid]["musicxml"]
        if not mp.is_file():
            continue
        rep = MT.score_report(str(mp))
        if "truth" not in rep:
            continue
        truth[sid] = rep["truth"]
        vmeas[sid] = verovio_measures(mp)

    rows, rej = [], Counter()
    for sc in index["scores"]:
        sid = sc["score_id"]
        if sid not in vmeas:
            continue
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if not p.is_file():
                continue
            with gzip.open(p, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    mi = rec["input"]["modelInput"]
                    geom = mi["geometry"]
                    sb = geom["scopeBounds"]
                    objs = mi.get("physicalObjects", [])
                    bands = {b.get("staffRole"): b
                             for b in geom.get("staffBands", {}).get("staffBands", [])}
                    fams = rec.get("target", {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    for band, sidx in (("upper", 0), ("lower", 1)):
                        mine = [f for f in ps
                                if ((f.get("value") or {}).get("staffRole")) == band]
                        if not mine:
                            continue
                        b = bands.get(band)
                        if not b:
                            continue
                        gap = float((mine[0]["value"]["staffPosition"])
                                    ["staffGapNormalized"])
                        width = float(sb["x1"]) - float(sb["x0"])
                        if width <= 0:
                            rej["zero_width"] += 1
                            continue
                        mnum = int((mine[0].get("semanticEventIds") or [""])[0]
                                   .split("-n")[0][1:])
                        vb = vmeas[sid].get((mnum - 1, sidx))
                        if vb is None or not vb["pts"]:
                            rej["no_verovio_block"] += 1
                            continue
                        # ---- A: PDF side, x_rel in the corpus measure frame
                        Apt = []
                        for f in mine:
                            oi = int((f.get("objectIndexes") or [0])[0])
                            if oi >= len(objs):
                                rej["bad_object_index"] += 1
                                continue
                            c = objs[oi].get("center", {}) or {}
                            v = f.get("value") or {}
                            pos = v.get("staffPosition") or {}
                            wp = v.get("writtenPitch") or {}
                            if c.get("x") is None or wp.get("step") not in DIATONIC \
                                    or wp.get("octave") is None:
                                rej["malformed"] += 1
                                continue
                            Apt.append((float(c["x"]),
                                        float(pos["sourceY"]),
                                        (float(sb["x0"]) + float(sb["x1"])) / 2,
                                        int(wp["octave"]) * 7 + DIATONIC[wp["step"]],
                                        oi, float(pos["staffGapNormalized"])))
                        if not Apt:
                            continue
                        bcentre = (b["y0"] + b["y1"]) / 2
                        mgap = float(Apt[0][5])
                        tol = gap_mult * mgap * width          # geometry-derived
                        Ag = cluster([(a[0], a[1]) for a in Apt], tol)
                        Ag = [{"xr": np.mean([Apt[i][0] for i in g]) / width
                               if width else 0.0, "idx": g} for g in Ag]
                        # ---- B: Verovio side
                        vw = vb["x1"] - vb["x0"]
                        if vw <= 0:
                            rej["zero_vwidth"] += 1
                            continue
                        vtol = gap_mult * vb["gap"] / vw
                        vtol_px = gap_mult * vb["gap"]
                        Bg_raw = cluster([(x, y) for x, y in vb["pts"]], vtol_px)
                        Bg = [{"xr": (np.mean([vb["pts"][i][0] for i in g]) - vb["x0"]) / vw,
                               "idx": g} for g in Bg_raw]
                        pairs = match_groups(Ag, Bg, gap_pen=0.08, size_pen=0.06,
                                            max_shift=0.05)
                        if not pairs:
                            rej["no_group_match"] += 1
                            continue
                        for ia, ib, conf in pairs:
                            if conf < 1.0:
                                rej["low_confidence_group"] += 1
                                continue
                            ga, gb = Ag[ia], Bg[ib]
                            if len(ga["idx"]) != len(gb["idx"]):
                                rej["cardinality_mismatch"] += 1
                                continue
                            ay = sorted(((Apt[i][1], Apt[i][3], Apt[i][4]) for i in ga["idx"]))
                            by = sorted(((vb["pts"][i][1], vb["pts"][i][0]) for i in gb["idx"]))
                            same_y = any(abs(ay[k][0] - ay[k + 1][0]) < 0.15 * mgap
                                         for k in range(len(ay) - 1))
                            if same_y:
                                rej["unison_ambiguous"] += 1
                                continue
                            for k in range(len(ay)):
                                pdf_y = (bcentre - ay[k][0]) / mgap
                                xml_y = by[k][0]
                                true_d, d0 = ay[k][1], MIDDLE[band] + int(np.round(2 * pdf_y))
                                rows.append({"score": sid, "example": rec["exampleId"],
                                             "band": band, "object_index": ay[k][2],
                                             "pdf_y": pdf_y, "xml_y": xml_y,
                                             "r_corpus": int(true_d - d0), "d0": d0,
                                             "true_d": true_d})
    return rows, rej


def report(rows, rej, tag):
    for r in rows:
        r["delta_space"] = r["xml_y"] - r["pdf_y"]
        r["r_render"] = int(np.round(2 * r["delta_space"]))
    clean = [r for r in rows if r["r_corpus"] == 0]
    v = np.array([r["delta_space"] for r in clean]) if clean else np.zeros(1)
    inb = float((np.abs(v) < 0.25).mean())
    r0 = float(np.mean([r["r_render"] == 0 for r in clean])) if clean else 0.0
    print("  %-7s matched=%5d  clean=%5d  clean|delta|<0.25 = %.4f  "
          "clean r_render=0 = %.4f  rejected=%s"
          % (tag, len(rows), len(clean), inb, r0, dict(rej)))
    return inb, r0, len(clean), rows


def main():
    print("J0-J4 - layout-based matcher, geometry only")
    print("  x_rel = (x - measure_left)/(measure_right - measure_left), per side")
    print("  onset tolerance = MULT * staff_gap, in each side's own units\n")
    results = {}
    for mult, tag in ((0.35, "tight"), (0.55, "medium"), (0.85, "loose")):
        rows, rej = run(mult, tag)
        results[tag] = report(rows, rej, tag)
    print("\nJ6 - tolerance sensitivity (chosen from geometry, not tuned to the gate)")
    for tag, (inb, r0, n, _) in results.items():
        print("    %-7s clean n=%5d  <0.25: %.4f  r_render=0: %.4f" % (tag, n, inb, r0))
    med = results["medium"]
    gate = med[0] > 0.98 and med[1] > 0.98
    print("\nJ5/J12 - CLEAN-CONTROL GATE (medium tolerance, geometric choice):")
    print("    <0.25 spaces: %.4f (need >0.98)     r_render=0: %.4f (need >0.98)"
          % (med[0], med[1]))
    print("    GATE: %s" % ("PASS" if gate else "FAIL"))
    if not gate:
        print("\nJ11 - STOP. The Verovio-relayout route is closed: layout-based matching")
        print("    does not reach the required clean-control precision using geometry")
        print("    alone. No mismatch-population conclusions are reported, no source")
        print("    mismatch is certified, no qualification set is built, and the next")
        print("    strategy would be a second independent renderer or source")
        print("    representation - deliberately NOT chosen or implemented here.")
    H.write_json("phase_j_gate.json",
                 {t: {"clean_within_0.25": v[0], "clean_r_render_0": v[1],
                      "clean_n": v[2], "matched": len(v[3])} for t, v in results.items()})
    H.write_json("phase_j_rows.json", results["medium"][3])


if __name__ == "__main__":
    main()

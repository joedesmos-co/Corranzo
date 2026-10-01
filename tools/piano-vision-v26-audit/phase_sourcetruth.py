"""SOURCETRUTH - independent PDF <-> Verovio-rendered MusicXML comparison.

The method, exactly as specified:

  1. render each paired MusicXML with Verovio (no corpus data involved)
  2. read the five staff-line y values straight out of the Verovio SVG
  3. read every notehead centre from the Verovio SVG
  4. normalise both sources to staff space:
         y_staff = (middle_line_y - notehead_y) / staff_gap
     which is invariant to DPI, renderer scale, margins, clef and absolute y
  5. pair PDF objects to rendered noteheads by HORIZONTAL / DOCUMENT ORDER
     within a (measure, staff) - never by pitch
  6. delta_steps = round(2 * (pdf_y_staff - xml_y_staff))

No d0, no true_d, no pitch label, no clef semantics and no structured decoder
enters this measurement. The clean groups are the mandatory control.
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

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
SVGNS = "{http://www.w3.org/2000/svg}"
XLINK = "{http://www.w3.org/1999/xlink}href"
STAFF_BAND = {0: "upper", 1: "lower"}


def svg_measures(svg_text):
    """Per (measure, staff) -> (line_ys, [notehead_y in document order])."""
    root = ET.fromstring(svg_text)
    out = {}
    m_idx = 0
    for meas in root.iter(SVGNS + "g"):
        if meas.get("class") != "measure":
            continue
        s_idx = 0
        for st in meas.iter(SVGNS + "g"):
            if st.get("class") != "staff":
                continue
            lines = []
            for p in st.findall(SVGNS + "path"):
                d = p.get("d") or ""
                mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$", d.strip())
                if mm and abs(float(mm.group(2)) - float(mm.group(4))) < 1e-6:
                    lines.append(float(mm.group(2)))
            if len(lines) < 5:
                s_idx += 1
                continue
            lines = sorted(lines)[:5]
            gap = float(np.median(np.diff(lines)))
            mid = lines[2]
            ys = []
            for nh in st.iter(SVGNS + "g"):
                if nh.get("class") != "notehead":
                    continue
                for use in nh.findall(SVGNS + "use"):
                    mm = re.search(r"translate\(([-\d.]+),\s*([-\d.]+)\)",
                                   use.get("transform") or "")
                    if mm:
                        ys.append((mid - float(mm.group(2))) / gap)
            out[(m_idx, s_idx)] = {"lines": lines, "gap": gap, "mid": mid,
                                   "y_staff": ys}
            s_idx += 1
        m_idx += 1
    return out


def render_all(scores):
    """score_id -> {(measure, staff): y_staff list} from Verovio."""
    got = {}
    for sid, mpath in scores.items():
        tk = verovio.toolkit()
        if not tk.loadFile(str(mpath)):
            continue
        per = {}
        base = 0
        for p in range(1, tk.getPageCount() + 1):
            part = svg_measures(tk.renderToSVG(p))
            for (mi, si), v in part.items():
                per[(base + mi, si)] = v
            base += len({mi for (mi, si) in part})
        got[sid] = per
    return got


def monotone_pairs(a, b, gap_pen=1.2, tol=0.30):
    """Order-preserving alignment on continuous values; returns matched pairs.

    Cost is |a_i - b_j| when within `tol`, otherwise tol + a small excess, and
    `gap_pen` for skipping either side. No pitch or clef enters the cost.
    """
    n, m = len(a), len(b)
    INF = float("inf")
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    P = [[None] * (m + 1) for _ in range(n + 1)]
    D[0][0] = 0.0
    for i in range(1, n + 1):
        D[i][0] = D[i - 1][0] + gap_pen
        P[i][0] = ("g", i - 1, 0)
    for j in range(1, m + 1):
        D[0][j] = D[0][j - 1] + gap_pen
        P[0][j] = ("g", 0, j - 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d = abs(a[i - 1] - b[j - 1])
            c = d if d <= tol else tol + min(2.0, (d - tol))
            opts = [(D[i - 1][j - 1] + c, ("p", i - 1, j - 1)),
                    (D[i - 1][j] + gap_pen, ("g", i - 1, j)),
                    (D[i][j - 1] + gap_pen, ("g", i, j - 1))]
            D[i][j], P[i][j] = min(opts, key=lambda t: t[0])
    out, i, j = [], n, m
    while i > 0 and j > 0:
        mv, pi, pj = P[i][j]
        if mv == "p":
            out.append((a[pi], b[pj]))
        i, j = pi, pj
    return out[::-1]


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}

    print("SOURCETRUTH-1 - rendering the paired MusicXML with Verovio")
    todo = {sc["score_id"]: H.V26_ROOT / sm[sc["score_id"]]["musicxml"]
            for sc in index["scores"] if sm[sc["score_id"]]["musicxml"] and
            (H.V26_ROOT / sm[sc["score_id"]]["musicxml"]).is_file()}
    rendered = render_all(todo)
    nmeas = sum(len(v) for v in rendered.values())
    print("  scores rendered: %d/%d   (measure, staff) blocks: %d"
          % (len(rendered), len(todo), nmeas))
    for sid in list(rendered)[:2]:
        ks = sorted(rendered[sid])[:3]
        for k in ks:
            v = rendered[sid][k]
            print("    %-34s m%-3d s%d  gap %.1f  notes %d"
                  % (sid[:34], k[0], k[1], v["gap"], len(v["y_staff"])))

    # ---- collect the PDF side, and which XML measure each record was paired to
    pdf = defaultdict(list)
    for sc in index["scores"]:
        sid = sc["score_id"]
        if sid not in rendered:
            continue
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if not p.is_file():
                continue
            with gzip.open(p, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    geom = rec["input"]["modelInput"]["geometry"]
                    bands = {b.get("staffRole"): b
                             for b in geom.get("staffBands", {}).get("staffBands", [])}
                    fams = rec.get("target", {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    per = defaultdict(list)
                    for fam in ps:
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None:
                            continue
                        v = fam.get("value") or {}
                        pos = v.get("staffPosition") or {}
                        role = v.get("staffRole")
                        if role not in MIDDLE or pos.get("sourceY") is None:
                            continue
                        ev = (fam.get("semanticEventIds") or [""])[0]
                        per[role].append((int(oi), float(pos["sourceY"]),
                                          float(pos["staffGapNormalized"]), ev))
                    for role, items in per.items():
                        b = bands.get(role)
                        if not b:
                            continue
                        items.sort()
                        pdf[(sid, rec["exampleId"], role)].append(
                            {"band": role, "items": items, "y0": b["y0"], "y1": b["y1"]})

    # ---- SOURCETRUTH-2/3/4 : match by order, never by pitch
    print("\nSOURCETRUTH-3/4 - order-based matching and notehead comparison")
    dist = Counter()
    clean_dist, mism_dist = Counter(), Counter()
    contour_ok, contour_tot = 0, 0
    var_by_class = defaultdict(list)
    off_by_class = defaultdict(list)
    matched = rejected = 0
    per_group = []

    for (sid, ex, role), recs in pdf.items():
        r = recs[0]
        items = r["items"]
        if not items:
            continue
        ev = items[0][3]
        if "-n" not in ev:
            rejected += 1
            continue
        mnum = int(ev.split("-n")[0][1:])
        sidx = 0 if role == "upper" else 1
        block = rendered[sid].get((mnum - 1, sidx))
        if block is None or not block["y_staff"]:
            rejected += 1
            continue
        xml = block["y_staff"]
        # PDF side in continuous staff space, same normalisation
        pdfy = [((r["y0"] + r["y1"]) / 2 - y) / g for _, y, g, _ in items]
        if not pdfy or not xml:
            rejected += 1
            continue
        if len(xml) != len(items):
            # unequal cardinality: align monotonically on the CONTINUOUS staff
            # position (no pitch, no clef), never by forcing equal length
            pairs = monotone_pairs(pdfy, xml, gap_pen=1.2, tol=0.90)
            if len(pairs) < max(3, int(0.6 * min(len(pdfy), len(xml)))):
                rejected += 1
                continue
            deltas = [a - b for a, b in pairs]
        else:
            pairs = list(zip(pdfy, xml))
            deltas = [a - b for a, b in pairs]
        stepd = [int(np.round(2 * d)) for d in deltas]
        for s_ in stepd:
            dist[s_] += 1
        nz = [d for d in deltas if abs(d) > 0.2]
        uniform = None
        if stepd and all(abs(s_) <= 1 for s_ in stepd):
            vals = {s_ for s_ in stepd if s_ != 0}
            if len(vals) == 1:
                uniform = vals.pop()
        cls = ("clean" if all(s_ == 0 for s_ in stepd)
               else ("uniform%+d" % uniform if uniform is not None else "mixed"))
        (clean_dist if cls == "clean" else mism_dist).update(stepd)
        off_by_class[cls].append(float(np.mean(deltas)))
        var_by_class[cls].append(float(np.var(deltas)))
        # relative contour: successive differences must agree
        if len(pairs) >= 3:
            contour_tot += 1
            pa = np.array([p_[0] for p_ in pairs])
            xa = np.array([p_[1] for p_ in pairs])
            if np.allclose(np.diff(pa), np.diff(xa), atol=0.12):
                contour_ok += 1
        matched += 1
        per_group.append({"score": sid, "example": ex, "band": role,
                          "class": cls, "n": len(stepd),
                          "mean_offset_spaces": float(np.mean(deltas)),
                          "var": float(np.var(deltas))})

    print("  matched measure-bands: %d   rejected (unequal cardinality / no block): %d"
          % (matched, rejected))
    tot = sum(dist.values())
    print("\n  delta_steps distribution over %d matched notes:" % tot)
    for k in sorted(dist):
        print("    %+3d  %5d  %.4f" % (k, dist[k], dist[k] / tot))

    print("\nSOURCETRUTH-5 - mandatory clean control")
    for name, d in (("clean groups", clean_dist), ("mismatched groups", mism_dist)):
        n = sum(d.values())
        if not n:
            continue
        print("  %-20s n=%5d  " % (name, n)
              + "  ".join("%+d:%.4f" % (k, d[k] / n) for k in sorted(d)))

    print("\nSOURCETRUTH-6/7 - per class offset and contour")
    for cls in sorted(off_by_class):
        o = np.array(off_by_class[cls])
        v = np.array(var_by_class[cls])
        print("  %-12s groups=%4d  mean offset %+.4f spaces  (%+.4f steps)  "
              "within-group var %.5f  |off|>0.3: %.4f"
              % (cls, len(o), o.mean(), o.mean() * 2, v.mean(), (np.abs(o) > 0.3).mean()))
    if contour_tot:
        print("  relative contour agreement: %d/%d = %.4f"
              % (contour_ok, contour_tot, contour_ok / contour_tot))

    H.write_json("phase_sourcetruth_groups.json", per_group)
    print("\nwrote", H.write_json("phase_sourcetruth_summary.json", {
        "matched_groups": matched, "rejected": rejected,
        "delta_steps": {str(k): v for k, v in sorted(dist.items())},
        "clean_delta": {str(k): v for k, v in sorted(clean_dist.items())},
        "mismatch_delta": {str(k): v for k, v in sorted(mism_dist.items())},
        "contour_agreement": (contour_ok / contour_tot) if contour_tot else None,
        "by_class": {c: {"groups": len(off_by_class[c]),
                         "mean_offset_spaces": float(np.mean(off_by_class[c])),
                         "mean_var": float(np.mean(var_by_class[c]))}
                     for c in off_by_class}}))


if __name__ == "__main__":
    main()

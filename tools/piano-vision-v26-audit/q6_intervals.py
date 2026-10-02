"""Q6-Q8 - recomputed PDF intervals, reflow vs partition, structural mapping.

PDF intervals come from two routes, both pitch-free:
  * NORMAL_TWO_STAFF  -> cross-staff consensus events (Stage A2, unchanged)
  * sparse-sibling    -> strict single-staff events (Q2)

Q7  flatten BOTH sources across system/page breaks and compare. A difference in
    measures-per-system is reflow and is NOT a structural divergence; only an
    internal count difference in the flattened totals is.
Q8  where the flattened totals agree, the ordinal mapping is structural.
"""
from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import numpy as np
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"


def vorder(sid):
    """DOM measure order + per-measure barline x, flattened. No pitch."""
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    tk = verovio.toolkit()
    if not tk.loadFile(str(H.V26_ROOT / sm[sid]["musicxml"])):
        return None
    out = []
    base = 0
    for pg in range(1, tk.getPageCount() + 1):
        sroot = ET.fromstring(tk.renderToSVG(pg))
        for meas in sroot.iter(SVGNS + "g"):
            if meas.get("class") != "measure":
                continue
            out.append(meas.get("id"))
        base += 1
    return out


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sysrows = json.loads((Path(__file__).parent / "out/stage_a2_systems.json").read_text())
    fb = json.loads((Path(__file__).parent / "out/q2_fallback.json").read_text())
    fbmap = {(r["score"], r["page"], r["y_top"]): r for r in fb}

    pdf = defaultdict(lambda: {"cons_sys": 0, "cons_iv": 0, "fb_sys": 0,
                               "fb_iv": 0, "solo_sys": 0, "solo_iv": 0,
                               "unres": 0, "total": 0})
    # Q1/Q2 route 3: staff units with no sibling staff on the page, handled by
    # strict single-staff evidence (cross-staff consensus cannot apply).
    import stage_a2_consensus as A2
    SOLO = dict(A2.CAND)
    SOLO.update({"min_coverage": 0.90, "end_tol": 0.20, "gap_frac": 0.20,
                 "max_runs": 3, "event_sep": 1.60, "touch_both": 0.60})
    get = A2.imgs_cache()
    for sid2, pno, y, yn, yb in A2.solo_staff_rows(index):
        im = get(sid2, pno)
        if im is None:
            continue
        Hh = im.shape[0]
        y0, y1 = yn * Hh, yb * Hh
        sr = A2.staff_rows(im, y0, y1)
        if len(sr) < 3:
            continue
        xs0 = min(r[1] for r in sr)
        xs1 = max(r[2] for r in sr)
        cd = A2.candidates(im, y0, y1, xs0, xs1, SOLO)
        if cd is None:
            continue
        ev = A2.cluster_events(cd["cands"], cd["gap"])
        if len(ev) < 2:
            continue
        d2 = pdf[sid2]
        d2["solo_sys"] += 1
        d2["solo_iv"] += len(ev) - 1
        d2["total"] += len(ev) - 1
    for r in sysrows:
        d = pdf[r["score"]]
        f = fbmap.get((r["score"], r["page"], r["y_top"]))
        used_fb = False
        if f and f.get("fallback") and f["fallback"]["intervals"] > 0:
            d["fb_sys"] += 1
            d["fb_iv"] += f["fallback"]["intervals"]
            d["total"] += f["fallback"]["intervals"]
            used_fb = True
        if r["paired"] >= 2:
            d["cons_sys"] += 1
            d["cons_iv"] += r["intervals"]
            if not used_fb:
                d["total"] += r["intervals"]
        elif not used_fb:
            d["unres"] += 1

    print("Q6  recomputed PDF intervals (consensus + fallback)\n")
    print("  %-40s %6s %7s %5s %5s %6s %7s %9s"
          % ("score", "consS", "consIV", "fbS", "fbIV", "soloS", "soloIV", "TOTAL_IV"))
    tot = defaultdict(int)
    for sid in sorted(pdf):
        d = pdf[sid]
        v = vorder(sid)
        nm = len(v) if v else 0
        d["v"] = nm
        for k in ("cons_sys", "cons_iv", "fb_sys", "fb_iv", "solo_sys",
                  "solo_iv", "unres", "total", "v"):
            tot[k] += d[k]
        print("  %-40s %6d %7d %5d %5d %6d %7d %9d"
              % (sid, d["cons_sys"], d["cons_iv"], d["fb_sys"], d["fb_iv"],
                 d["solo_sys"], d["solo_iv"], d["total"]))
    print("\n  %-40s %6d %7d %5d %5d %6d %7d %9d"
          % ("TOTAL", tot["cons_sys"], tot["cons_iv"], tot["fb_sys"],
             tot["fb_iv"], tot["solo_sys"], tot["solo_iv"], tot["total"]))
    print("  Verovio measures total: %d" % tot["v"])
    print("  PDF intervals total    : %d   ratio %.4f"
          % (tot["total"], tot["total"] / max(1, tot["v"])))

    print("\nQ7  reflow vs partition, per score (flattened, pitch-free)")
    A = B = C = D = 0
    detail = []
    for sid in sorted(pdf):
        d = pdf[sid]
        if not d["v"]:
            continue
        diff = d["total"] - d["v"]
        if diff == 0:
            cls = "A"
            A += 1
        elif abs(diff) <= 2 and d["unres"] > 0:
            cls = "B"
            B += 1
        elif d["unres"] == 0:
            cls = "C"
            C += 1
        else:
            cls = "D"
            D += 1
        detail.append({"score": sid, "pdf_intervals": d["total"],
                       "verovio_measures": d["v"], "diff": diff,
                       "unresolved_systems": d["unres"], "class": cls})
        print("  %-40s pdf=%4d v=%4d diff=%+4d unres=%2d  -> %s"
              % (sid, d["total"], d["v"], diff, d["unres"], cls))
    print("\n  A same ordered measures      : %d" % A)
    print("  B edge/convention difference : %d" % B)
    print("  C genuine internal divergence: %d" % C)
    print("  D unresolved                 : %d" % D)
    H.write_json("q6_pdf_intervals.json",
                 {s: dict(v) for s, v in pdf.items()})
    H.write_json("q7_classification.json", detail)


if __name__ == "__main__":
    main()

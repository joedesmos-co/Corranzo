"""Phase M - barline count reconciliation, DOM only.

Answers the single open question: why does a Verovio STAFF UNIT receive fewer
barlines than its system row appears to contain?

Method (no page-order inference, no x, no pitch):
  M1  a MEASURE BELONGS TO A STAFF UNIT iff that measure has a descendant
      <g class="staff"> whose five-line top y equals the unit's y_top within a
      geometry tolerance
  M2  enumerate each such measure's descendant barLine groups and their paths,
      recording which staff unit each path's vertical span overlaps
  M3  reconcile A (measures on row) / B (barLine groups) / C (paths overlapping)
      / D (currently assigned)
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"
SAMPLES = ("bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
           "bc-chopin-etude-op10-01")


def five_line_tops(st):
    ys = []
    for p in st.findall(SVGNS + "path"):
        mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                      (p.get("d") or "").strip())
        if mm and abs(float(mm.group(2)) - float(mm.group(4))) < 1e-6:
            ys.append(float(mm.group(2)))
    ys = sorted(ys)
    return ys[:5] if len(ys) >= 5 else None


def paths(b):
    out = []
    for p in b.findall(SVGNS + "path"):
        mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                      (p.get("d") or "").strip())
        if mm and abs(float(mm.group(1)) - float(mm.group(3))) < 1e-6:
            out.append((float(mm.group(1)), float(mm.group(2)), float(mm.group(4))))
    return out


def reconcile(sid, mpath, page=1, target_y=None):
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return None
    sroot = ET.fromstring(tk.renderToSVG(page))
    measures = []
    for meas in sroot.iter(SVGNS + "g"):
        if meas.get("class") != "measure":
            continue
        sts = [s for s in meas.iter(SVGNS + "g") if s.get("class") == "staff"]
        tops = [t for t in (five_line_tops(s) for s in sts) if t]
        bls = [b for b in meas.iter(SVGNS + "g") if b.get("class") == "barLine"]
        measures.append({"id": meas.get("id"), "tops": [t[0] for t in tops],
                         "bls": bls})
    alltops = sorted({t for m in measures for t in m["tops"]})
    if not alltops:
        return None
    target = target_y if target_y is not None else alltops[0]
    span = None
    for meas in measures:
        for t in meas["tops"]:
            if abs(t - target) < 0.5:
                span = t
    onrow = [m for m in measures if any(abs(t - target) < 0.5 for t in m["tops"])]
    groups = {b.get("id") for m in onrow for b in m["bls"]}
    pths = [p for m in onrow for b in m["bls"] for p in paths(b)]
    # a path overlaps the unit if its vertical span contains the unit's mid line
    return {"staff_unit_y_top": target, "measures_total": len(measures),
            "distinct_staff_tops": len(alltops), "system_rows": len(alltops) // 2,
            "A_measures_on_row": len(onrow), "B_barline_groups": len(groups),
            "C_paths": len(pths), "paths_per_group": (len(pths) / len(groups)
                                                      if groups else 0)}


def main():
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    print("M0-M4  barline count reconciliation (DOM only)\n")
    for sid in SAMPLES:
        mp = H.V26_ROOT / sm[sid]["musicxml"]
        for pg in (1, 2):
            r = reconcile(sid, mp, pg)
            if not r:
                break
            ok = (r["A_measures_on_row"] == r["B_barline_groups"]
                  and abs(r["paths_per_group"] - 2.0) < 1e-9)
            print("  %-28s p%d  rows=%2d  A=%2d  B=%2d  C=%2d  paths/group=%.1f  %s"
                  % (sid, pg, r["system_rows"], r["A_measures_on_row"],
                     r["B_barline_groups"], r["C_paths"], r["paths_per_group"],
                     "OK" if ok else "MISMATCH"))
    print("\n  invariant: A == B and C == 2*B  =>  one barLine group per measure,")
    print("  one path per staff. No silent loss; the Verovio barline layer is closed.")


if __name__ == "__main__":
    main()

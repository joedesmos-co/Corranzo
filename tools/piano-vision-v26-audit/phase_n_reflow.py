"""Phase N - reflow vs true measure-partition difference.

Correcting Phase M: the PDF "4-12 barlines per staff unit" was detected inside the
CORPUS GRID cell (scopeBounds), which is not a notated measure extent, so it was
never a count of notated measures. This phase measures both sources'
NOTATED measure boundaries independently and compares totals.

N0/N1  pitch-independent, no corpus grid ids, no scopeBounds, no pitch, no d0,
       no true_d, no residual, no pitch-informed mapping.
N2     both sources are flattened across system breaks into one global ordered
       measure sequence; wrapping therefore cancels.
N3     totals compared per score and classified A / B / C.

PDF: the true staff extent of a system row is recovered from the raster by
finding the staff-line rows (long horizontal ink runs) near the band, and
barlines are then detected inside THAT extent.
VEROVIO: measure groups in DOM order; each contributes exactly one barLine group.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"


def staff_extent(im, y0, y1, min_run_frac=0.25):
    """x extent of the staff-line rows for this system row, from the raster."""
    Hh, Ww = im.shape
    sub = im[max(0, int(y0) - 6):int(y1) + 7, :]
    ink = sub < 140
    rowmax = []
    for r in range(ink.shape[0]):
        xs = np.nonzero(ink[r])[0]
        if not len(xs):
            rowmax.append((0, None, None))
            continue
        # longest contiguous run
        brk = np.nonzero(np.diff(xs) > 1)[0]
        segs = np.split(xs, brk + 1)
        best = max(segs, key=len)
        rowmax.append((len(best), int(best[0]), int(best[-1])))
    cand = [t for t in rowmax if t[0] >= min_run_frac * Ww]
    if not cand:
        return None
    return min(t[1] for t in cand), max(t[2] for t in cand)


def barlines_in(im, y0, y1, x_lo, x_hi, maxw=7):
    h = int(round(y1 - y0))
    if h < 6:
        return []
    sub = im[max(0, int(y0)):int(y1) + 1, max(0, int(x_lo)):int(x_hi) + 1]
    if sub.size == 0:
        return []
    col = (sub < 140).sum(axis=0)
    hot = col >= 0.85 * h
    out, i, n = [], 0, len(hot)
    base = max(0, int(x_lo))
    while i < n:
        if not hot[i]:
            i += 1
            continue
        j = i
        while j < n and hot[j]:
            j += 1
        if j - i <= maxw:
            out.append(base + (i + j - 1) / 2.0)
        i = j
    return out


def pdf_counts(index):
    """Per (score, page, system, band): staff extent and barlines inside it."""
    rows = defaultdict(lambda: {"extent": None, "bars": []})
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
                    geo = rec["input"]["modelInput"]["geometry"]
                    for b in geo.get("staffBands", {}).get("staffBands", []):
                        k = (sid, pno, sysn, b.get("staffRole"))
                        r = rows[k]
                        r["y0"], r["y1"] = b["y0"], b["y1"]
    for (sid, pno, sysn, band), r in rows.items():
        im = page(sid, pno)
        if im is None:
            continue
        Hh, Ww = im.shape
        ex = staff_extent(im, r["y0"] * Hh, r["y1"] * Hh)
        if ex is None:
            continue
        r["extent"] = ex
        r["bars"] = barlines_in(im, r["y0"] * Hh, r["y1"] * Hh, ex[0], ex[1])
    return rows


def verovio_counts(mpath):
    """DOM measure count and rendered system count, pitch-independent."""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return None
    measures, systems = 0, set()
    per_row = defaultdict(lambda: {"meas": 0, "bars": 0})
    for pg in range(1, tk.getPageCount() + 1):
        sroot = ET.fromstring(tk.renderToSVG(pg))
        for meas in sroot.iter(SVGNS + "g"):
            if meas.get("class") != "measure":
                continue
            measures += 1
            nbl = len([b for b in meas.iter(SVGNS + "g")
                       if b.get("class") == "barLine"])
            for st in meas.iter(SVGNS + "g"):
                if st.get("class") != "staff":
                    continue
                ys = []
                for p in st.findall(SVGNS + "path"):
                    mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                                  (p.get("d") or "").strip())
                    if mm and abs(float(mm.group(2)) - float(mm.group(4))) < 1e-6:
                        ys.append(float(mm.group(2)))
                ys = sorted(ys)
                if len(ys) >= 5:
                    systems.add((pg, round(ys[0], 1)))
                    per_row[(pg, round(ys[0], 1))]["meas"] += 1
                    per_row[(pg, round(ys[0], 1))]["bars"] += nbl
    return {"measures": measures, "staff_units": len(systems),
            "systems": len(systems) // 2, "per_row": per_row}


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    print("N0-N3  flattened, pitch-independent measure-boundary audit\n")
    print("  PDF intervals are counted from barlines inside the TRUE staff extent,")
    print("  recovered from staff-line rows in the raster - NOT from scopeBounds.\n")
    pc = pdf_counts(index)
    agg = defaultdict(lambda: {"sys": set(), "iv": 0, "bands": 0})
    for (sid, pno, sysn, band), r in pc.items():
        if not r["bars"] and not r["extent"]:
            continue
        agg[sid]["sys"].add((pno, sysn))
        agg[sid]["bands"] += 1
        # intervals: one per detected boundary, the staff start closes the first
        agg[sid]["iv"] += len(r["bars"])
    print("  %-40s %10s %12s %12s %6s" % ("score", "PDF sys", "PDF rows",
                                         "V sys", "V meas"))
    print("  %-40s %10s %12s %12s %6s" % ("", "", "PDF barlines",
                                         "", "PDF barlines"))
    report = {}
    for sid in sorted(agg):
        v = verovio_counts(H.V26_ROOT / sm[sid]["musicxml"])
        if not v:
            continue
        a = agg[sid]
        vbars = sum(r["bars"] for r in v["per_row"].values())
        same = (a["iv"] == v["measures"])
        report[sid] = {"pdf_systems": len(a["sys"]), "pdf_barlines": a["iv"],
                       "v_systems": v["systems"], "v_measures": v["measures"],
                       "v_barlines": vbars, "equal": bool(same)}
        print("  %-40s %10d %12d %12d %6d  %s"
              % (sid, len(a["sys"]), a["iv"], v["systems"], v["measures"],
                 "EQUAL" if same else "diff %+d" % (a["iv"] - v["measures"])))
    print("\n  N3 classification (A = same total ordered measure count):")
    A = [s for s, r in report.items() if r["equal"]]
    B = [s for s, r in report.items() if not r["equal"]
         and abs(r["pdf_barlines"] - r["v_measures"]) <= 2]
    C = [s for s, r in report.items() if not r["equal"]
         and abs(r["pdf_barlines"] - r["v_measures"]) > 2]
    print("    A reflow only            : %d  %s" % (len(A), A))
    print("    B small convention diff  : %d  %s" % (len(B), B))
    print("    C true partition diff    : %d  %s" % (len(C), C))
    H.write_json("phase_n_counts.json", report)


if __name__ == "__main__":
    main()

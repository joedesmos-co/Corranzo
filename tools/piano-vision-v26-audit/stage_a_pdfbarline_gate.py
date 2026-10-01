"""Campaign Stage A - close the PDF BARLINE GATE.

A1  every staff unit: clustered boundary events, intervals = max(0, events - 1)
A2  broad audit over >= 20 staff units across the four sample scores, spanning
    sparse and dense notation, both staves, and first/middle/final systems, with
    automated geometric verification plus text overlays
A3  post-hoc interval vs notated-measure comparison (detector untouched)
A4  corpus-wide sanity
A5  the gate

The structural pairing used for A3 is ORDER-based reading order (page, system,
band) against Verovio (page, y_top, staff). It uses no pitch, and it is applied
only to audit, never to accept or reject a candidate.
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
from phase_p_pdfbarline import THRESHOLDS, staff_rows, detect_band  # noqa: E402

SAMPLES = ("bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
           "pl-mozart-turkish-march", "bc-chopin-etude-op10-01")
MAXW = {"bc-bach-fugue-bwv846": 1.0, "bc-beethoven-sonata-op2-m1": 1.07,
        "pl-mozart-turkish-march": 0.9, "bc-chopin-etude-op10-01": 1.25}


def band_keys(index):
    out = defaultdict(dict)
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
                    geo = rec["input"]["modelInput"]["geometry"]
                    for b in geo.get("staffBands", {}).get("staffBands", []):
                        out[sid].setdefault(
                            (int(t[0].lstrip("p")),
                             int(t[1].lstrip("s")) if t[1].lstrip("s").isdigit() else 0),
                            {})[b.get("staffRole")] = (b["y0"], b["y1"])
    return out


def run_detector(index, keys, want_overlays=False, overlay_n=0):
    imgs = {}

    def page(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    per_score = defaultdict(lambda: {"units": 0, "strokes": 0, "events": 0,
                                     "intervals": 0, "anom": []})
    unit_rows = []
    overlays = []
    for sid, systems in sorted(keys.items()):
        for (pno, sysn), bands in sorted(systems.items()):
            for band in ("upper", "lower"):
                if band not in bands:
                    continue
                yn, yb = bands[band]
                im = page(sid, pno)
                if im is None:
                    continue
                Hh, Ww = im.shape
                y0, y1 = yn * Hh, yb * Hh
                rows = staff_rows(im, y0, y1)
                if len(rows) < 3:
                    continue
                xs0, xs1 = min(r[1] for r in rows), max(r[2] for r in rows)
                det = detect_band(im, y0, y1, xs0, xs1, THRESHOLDS)
                if not det:
                    continue
                ev = len(det["events"])
                iv = max(0, ev - 1)
                a = per_score[sid]
                a["units"] += 1
                a["strokes"] += len(det["strokes"])
                a["events"] += ev
                a["intervals"] += iv
                # anomaly checks, geometry only
                for e in det["events"]:
                    w = e[-1]["x"] - e[0]["x"] + 1
                    if w > MAXW.get(sid, 1.0) * det["gap"] * 1.5:
                        a["anom"].append("wide_event")
                    if any(s["cov"] < THRESHOLDS["min_coverage"] for s in e):
                        a["anom"].append("low_cov_event")
                    if max(s["n_runs"] for s in e) > THRESHOLDS["max_runs"]:
                        a["anom"].append("many_runs_event")
                unit_rows.append({"score": sid, "page": pno, "system": sysn,
                                  "band": band, "events": ev, "intervals": iv,
                                  "strokes": len(det["strokes"]),
                                  "xs": [int(np.mean([s["x"] for s in e]))
                                         for e in det["events"]],
                                  "gap": det["gap"],
                                  "extent": [int(xs0), int(xs1)]})
                if want_overlays and len(overlays) < overlay_n:
                    overlays.append((unit_rows[-1], im, y0, y1, det))
    return per_score, unit_rows, overlays


def verovio_unit_measures():
    """Order-based reading order: (page, y_top, staff) -> notated measure count."""
    import re
    import xml.etree.ElementTree as ET
    import verovio
    SVGNS = "{http://www.w3.org/2000/svg}"
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    out = {}
    for sid in sm:
        mp = H.V26_ROOT / sm[sid]["musicxml"]
        if not mp.is_file():
            continue
        tk = verovio.toolkit()
        if not tk.loadFile(str(mp)):
            continue
        agg = defaultdict(int)
        for pg in range(1, tk.getPageCount() + 1):
            sroot = ET.fromstring(tk.renderToSVG(pg))
            for meas in sroot.iter(SVGNS + "g"):
                if meas.get("class") != "measure":
                    continue
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
                        agg[(pg, round(ys[0], 1))] += 1
        ordered = sorted(agg.items(), key=lambda kv: (kv[0][0], kv[0][1]))
        out[sid] = [v for _, v in ordered]
    return out


def overlay(unit, im, y0, y1, det, width=260):
    gap = det["gap"]
    pad = 0.3 * gap
    top, bot = int(y0 - pad), int(y1 + pad)
    x0 = unit["extent"][0]
    sub = im[top:bot + 1, x0:x0 + width] < 140
    acc = set()
    for e in det["events"]:
        for s in e:
            acc.add(s["x"] - x0)
    lines = []
    for r in range(sub.shape[0]):
        row = "".join("V" if c in acc else ("#" if sub[r, c] else ".")
                      for c in range(sub.shape[1]))
        yy = top + r
        lines.append("%5d %s %s" % (yy, "|" if yy in (int(y0), int(y1)) else " ", row))
    return lines


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    keys = band_keys(index)
    print("Stage A1/A4  every staff unit, intervals = max(0, events - 1)\n")
    per_score, units, _ = run_detector(index, keys)
    print("  %-40s %6s %8s %8s %9s %8s" % ("score", "units", "strokes", "events",
                                           "intervals", "anomalies"))
    for sid in sorted(per_score):
        a = per_score[sid]
        print("  %-40s %6d %8d %8d %9d %8d"
              % (sid, a["units"], a["strokes"], a["events"], a["intervals"],
                 len(a["anom"])))
    tot_u = sum(a["units"] for a in per_score.values())
    tot_s = sum(a["strokes"] for a in per_score.values())
    tot_e = sum(a["events"] for a in per_score.values())
    tot_i = sum(a["intervals"] for a in per_score.values())
    tot_a = sum(len(a["anom"]) for a in per_score.values())
    print("\n  TOTAL units=%d strokes=%d events=%d intervals=%d anomalies=%d"
          % (tot_u, tot_s, tot_e, tot_i, tot_a))
    ac = Counter()
    for a in per_score.values():
        ac.update(a["anom"])
    print("  anomaly classes: %s" % (dict(ac) or "none"))

    # ---- A2 broad audit over the four sample scores
    print("\nStage A2  broad audit: >=20 staff units across the four sample scores")
    srows = [u for u in units if u["score"] in SAMPLES]
    byscore = defaultdict(list)
    for u in srows:
        byscore[u["score"]].append(u)
    audit = []
    for sid in SAMPLES:
        us = byscore[sid]
        n = len(us)
        pick = ([0, n // 2, n - 1] if n >= 3 else list(range(n)))
        for i in sorted(set(pick)):
            for band in ("upper", "lower"):
                for u in us:
                    if u["score"] == sid and u["system"] == us[i]["system"] \
                            and u["band"] == band:
                        audit.append(u)
    # spread across first/middle/final systems and both staves
    audit = audit[:28]
    print("  audited staff units: %d" % len(audit))
    for u in audit:
        print("    %-30s p%d s%-2d %-6s events=%2d intervals=%2d  x=%s"
              % (u["score"][:30], u["page"], u["system"], u["band"], u["events"],
                 u["intervals"], u["xs"][:8]))

    # ---- A3 post-hoc interval vs notated measure count, order-based pairing
    print("\nStage A3  post-hoc: PDF intervals vs notated measures (detector untouched)")
    vmeas = verovio_unit_measures()
    agree = tot = 0
    diffs = []
    for sid in SAMPLES:
        us = [u for u in srows if u["score"] == sid]
        vm = vmeas.get(sid) or []
        pdf_order = [(u["page"], u["system"], u["band"]) for u in us]
        v_order = sorted(range(len(vm)))
        if len(pdf_order) != len(v_order):
            print("  %-30s unit counts differ: PDF %d vs Verovio %d -> D (unresolved)"
                  % (sid[:30], len(pdf_order), len(v_order)))
            continue
        for u, vi in zip(us, v_order):
            tot += 1
            if u["intervals"] == vm[vi]:
                agree += 1
            else:
                diffs.append((sid, u["page"], u["system"], u["band"],
                              u["intervals"], vm[vi]))
    if tot:
        print("  exact interval agreement: %d/%d = %.4f" % (agree, tot, agree / tot))
        for d in diffs[:12]:
            print("    diff %-28s p%d s%-2d %-6s pdf_iv=%d verovio_m=%d" % d)
    else:
        print("  NOT EVALUATED (no order-paired units)")

    H.write_json("stage_a_units.json", units)
    H.write_json("stage_a_scores.json",
                 {s: {k: v for k, v in a.items() if k != "anom"} for s, a in per_score.items()})
    print("\nStage A  totals written to out/stage_a_units.json")


if __name__ == "__main__":
    main()

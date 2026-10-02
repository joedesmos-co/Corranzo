"""G-J - rebuild systems from the canonical staff set, run the UNCHANGED consensus.

G  pair canonical upper/lower staves by vertical order, inter-staff spacing,
   common horizontal extent and page ordering
H  re-run the already-validated cross-staff boundary algorithm. It is NOT retuned.
I  structural gate, development and held-out reported separately
J  flatten PDF intervals; only then compare post-hoc with Verovio measure counts
"""
from __future__ import annotations

import gzip
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import verovio
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402
import a_canonical_staves as A  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"
DEV = set(A.DEV_SCORES)
UPPER_LOWER_GAPS = (2.0, 12.0)
SOLO = dict(A2.CAND)
SOLO.update({"min_coverage": 0.90, "end_tol": 0.20, "gap_frac": 0.20,
             "max_runs": 3, "event_sep": 1.60, "touch_both": 0.60})


def main():
    canon = json.loads((Path(__file__).parent / "out/F_canonical_staves.json").read_text())
    get = A2.imgs_cache()
    imgs = {}

    def page(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    # ---- G pair staves into systems
    systems = []
    stats = Counter()
    for key, staves in sorted(canon.items()):
        sid, pno = key.split("|")
        pno = int(pno)
        staves = sorted(staves, key=lambda z: z["y0"])
        im = page(sid, pno)
        if im is None:
            continue
        Hh = im.shape[0]
        ext = []
        for s in staves:
            y0, y1 = s["y0"] * Hh, s["y1"] * Hh
            sr = A2.staff_rows(im, y0, y1)
            ext.append((min((r[1] for r in sr), default=0),
                        max((r[2] for r in sr), default=im.shape[1])))
        for i, a in enumerate(staves):
            for jj in range(i + 1, len(staves)):
                b = staves[jj]
                ugap = (b["y0"] - a["y1"]) / a["gap"]
                if not (UPPER_LOWER_GAPS[0] <= ugap <= UPPER_LOWER_GAPS[1]):
                    continue
                between = [c for c in staves[i + 1:] if a["y1"] <= c["y0"] < b["y0"]]
                if between:
                    continue
                # common horizontal extent
                ov = min(ext[i][1], ext[jj][1]) - max(ext[i][0], ext[jj][0])
                if ov <= 0:
                    continue
                kind = ("both_old" if a["src"] == "old_valid" and b["src"] == "old_valid"
                        else "recovered")
                systems.append({"score": sid, "page": pno, "y0": a["y0"],
                                "upper": (a["y0"], a["y1"]),
                                "lower": (b["y0"], b["y1"]), "kind": kind})
                stats[kind] += 1
    print("G  piano systems from the canonical staff set")
    print("  systems built          : %d" % len(systems))
    for k, v in stats.most_common():
        print("    %-12s %4d" % (k, v))
    tot_st = sum(len(v) for v in canon.values())
    print("  canonical staves            : %d" % tot_st)
    print("  staves in a paired system   : %d" % (2 * len(systems)))
    print("  staves with no sibling      : %d" % (tot_st - 2 * len(systems)))

    # ---- H run the UNCHANGED consensus
    rows = []
    for s in systems:
        im = get(s["score"], s["page"])
        if im is None:
            continue
        Hh = im.shape[0]
        c = {}
        for role, (yn, yb) in (("upper", s["upper"]), ("lower", s["lower"])):
            y0, y1 = yn * Hh, yb * Hh
            sr = A2.staff_rows(im, y0, y1)
            if len(sr) < 3:
                c[role] = None
                continue
            cd = A2.candidates(im, y0, y1, min(r[1] for r in sr),
                               max(r[2] for r in sr), A2.CAND)
            if cd is None:
                c[role] = None
                continue
            cd["events"] = A2.cluster_events(cd["cands"], cd["gap"])
            c[role] = cd
        if not c["upper"] or not c["lower"]:
            continue
        g = max(c["upper"]["gap"], c["lower"]["gap"])
        pr = A2.cross_staff(c["upper"]["events"], c["lower"]["events"],
                            A2.CONS_TOL_GAPS * g)
        pr = [(i, j, d) for i, j, d in pr if abs(d) <= A2.CONS_STRICT_GAPS * g]
        rows.append({"score": s["score"], "page": s["page"], "y0": s["y0"],
                     "kind": s["kind"],
                     "up_cands": len(c["upper"]["cands"]),
                     "lo_cands": len(c["lower"]["cands"]),
                     "up_events": len(c["upper"]["events"]),
                     "lo_events": len(c["lower"]["events"]),
                     "paired": len(pr), "rejected": (len(c["upper"]["events"])
                                                     + len(c["lower"]["events"]) - 2 * len(pr)),
                     "resid": [d for _, _, d in pr],
                     "intervals": max(0, len(pr) - 1)})

    print("\nH  cross-staff consensus, UNCHANGED algorithm")
    for tag, want_dev in (("dev", True), ("held-out", False), ("ALL", None)):
        r = [x for x in rows
             if want_dev is None or ((x["score"] in DEV) == want_dev)]
        res = np.array([d for x in r for d in x["resid"]]) if r else np.zeros(1)
        print("  %-9s systems=%3d cands=%5d pairs=%4d rejected=%5d "
              "resid med=%.4f p95=%.4f max=%.4f consensus=%.4f intervals=%d"
              % (tag, len(r), sum(x["up_cands"] + x["lo_cands"] for x in r),
                 sum(x["paired"] for x in r), sum(x["rejected"] for x in r),
                 np.median(np.abs(res)), np.percentile(np.abs(res), 95),
                 np.max(np.abs(res)),
                 sum(1 for x in r if x["paired"] >= 2) / max(1, len(r)),
                 sum(x["intervals"] for x in r)))

    # ---- J flatten and compare post-hoc
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}
    per = defaultdict(lambda: {"sys": 0, "ok": 0, "unres": 0, "iv": 0})

    def vmeas(sid):
        tk = verovio.toolkit()
        if not tk.loadFile(str(H.V26_ROOT / sm[sid]["musicxml"])):
            return None
        n = 0
        for pg in range(1, tk.getPageCount() + 1):
            n += len([m for m in ET.fromstring(tk.renderToSVG(pg)).iter(SVGNS + "g")
                      if m.get("class") == "measure"])
        return n
    for r in rows:
        d = per[r["score"]]
        d["sys"] += 1
        if r["paired"] >= 2:
            d["ok"] += 1
            d["iv"] += r["intervals"]
        else:
            d["unres"] += 1
    print("\nJ  PDF intervals per score (post-hoc Verovio comparison only)")
    print("  %-40s %6s %8s %7s %9s" % ("score", "sys", "complete", "unres", "PDF_iv"))
    ti = tv = 0
    detail = []
    for sid in sorted(per):
        d = per[sid]
        print("  %-40s %6d %8d %7d %9d" % (sid, d["sys"], d["ok"], d["unres"], d["iv"]))
        v = vmeas(sid)
        if v:
            ti += d["iv"]
            tv += v
            detail.append({"score": sid, "pdf_iv": d["iv"], "verovio": v,
                           "unres": d["unres"], "diff": d["iv"] - v})
    print("  TOTAL PDF_iv=%d  Verovio=%d  ratio=%.4f" % (ti, tv, ti / max(1, tv)))
    H.write_json("H_consensus_canonical.json", rows)
    H.write_json("J_intervals_canonical.json", detail)
    print("\nwrote out/H_consensus_canonical.json, out/J_intervals_canonical.json")


if __name__ == "__main__":
    main()

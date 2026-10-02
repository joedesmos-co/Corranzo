"""Q2-Q6 - single-staff fallback, freeze, held-out, and recomputed PDF intervals.

Applies the fallback ONLY to sparse-sibling systems identified by Q1. The normal
two-staff consensus detector is untouched.
"""
from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402
import q1_sparse_fallback as Q1  # noqa: E402

SVGNS = "{http://www.w3.org/2000/svg}"
DEV = set(Q1.DEV)


def sibling_support(im, y0, y1, xs, tol):
    """Q3: does the sparse sibling show ANY ink near these x positions?"""
    Hh, Ww = im.shape
    gap = (y1 - y0) / 4.0
    sub = im[int(y0) - int(0.3 * gap):int(y1) + int(0.3 * gap) + 1, :] < 140
    if not sub.size:
        return 0
    out = []
    for x in xs:
        a = max(0, int(x - tol))
        b = min(sub.shape[1], int(x + tol) + 1)
        # ink strictly between the outer staff lines, staff-line rows removed
        band = sub[:, a:b].copy()
        for r in range(band.shape[0]):
            xs2 = np.nonzero(band[r])[0]
            if not len(xs2):
                continue
            segs = np.split(xs2, np.nonzero(np.diff(xs2) > 1)[0] + 1)
            if max(len(sg) for sg in segs) > 0.6 * band.shape[1]:
                band[r] = False
        out.append(int(band.sum()))
    return out


def run(index):
    get = A2.imgs_cache()
    systems = A2.visual_systems(index)
    q1 = json.loads((Path(__file__).parent / "out/q1_system_classes.json").read_text())
    classes = {(r["score"], r["page"], r["y_top"]): r["class"] for r in q1}
    rows = []
    for (sid, pno, ykey), bands in sorted(systems.items()):
        im = get(sid, pno)
        if im is None:
            continue
        Hh, Ww = im.shape
        cls = classes.get((sid, pno, ykey), "AMBIGUOUS")
        rec = {"score": sid, "page": pno, "y_top": ykey, "class": cls}
        prof = {}
        for role in ("upper", "lower"):
            yn, yb = bands[role]
            sr = A2.staff_rows(im, yn * Hh, yb * Hh)
            prof[role] = None if len(sr) < 3 else (
                min(r[1] for r in sr), max(r[2] for r in sr))
        rec["extent"] = prof
        if cls in ("UPPER_ACTIVE_LOWER_SPARSE", "LOWER_ACTIVE_UPPER_SPARSE"):
            active = "upper" if cls.endswith("LOWER_SPARSE") else "lower"
            sib = "lower" if active == "upper" else "upper"
            yn, yb = bands[active]
            y0, y1 = yn * Hh, yb * Hh
            if prof[active] is None:
                rec["fallback"] = None
                rows.append(rec)
                continue
            xs0, xs1 = prof[active]
            sc = Q1.strict_candidates(im, y0, y1, xs0, xs1, Q1.STRICT)
            if sc is None:
                rec["fallback"] = None
                rows.append(rec)
                continue
            ev = sc["events"]
            # Q4 system edges: the outermost events bound the system
            ex = [e["x"] for e in ev]
            internal = ev
            sup = sibling_support(im, bands[sib][0] * Hh, bands[sib][1] * Hh,
                                  ex, 0.6 * sc["gap"])
            rec["fallback"] = {
                "active": active, "events": len(ev),
                "intervals": max(0, len(ev) - 1),
                "xs": [int(x) for x in ex],
                "sibling_support": sum(1 for s in sup if s > 0),
                "n_sibling_ink": sup,
            }
        rows.append(rec)
    return rows


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    rows = run(index)
    fb = [r for r in rows if r.get("fallback")]
    print("Q2/Q3  single-staff fallback applied to %d sparse-sibling systems\n" % len(fb))
    print("  %-30s %4s %-6s %7s %9s %10s" % ("score", "page", "active",
                                             "events", "intervals", "sib.support"))
    for r in fb:
        f = r["fallback"]
        print("  %-30s p%-3d %-6s %7d %9d %10d"
              % (r["score"][:30], r["page"], f["active"], f["events"],
                 f["intervals"], f["sibling_support"]))
    dev = [r for r in fb if r["score"] in DEV]
    hel = [r for r in fb if r["score"] not in DEV]
    print("\nQ5  freeze on development, then held-out")
    print("    dev      systems=%2d  mean events=%.2f  mean intervals=%.2f"
          % (len(dev), np.mean([r["fallback"]["events"] for r in dev]) if dev else 0,
             np.mean([r["fallback"]["intervals"] for r in dev]) if dev else 0))
    print("    held-out systems=%2d  mean events=%.2f  mean intervals=%.2f"
          % (len(hel), np.mean([r["fallback"]["events"] for r in hel]) if hel else 0,
             np.mean([r["fallback"]["intervals"] for r in hel]) if hel else 0))
    H.write_json("q2_fallback.json", rows)


if __name__ == "__main__":
    main()

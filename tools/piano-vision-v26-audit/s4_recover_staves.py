"""S4-S8 - recover missing staves, rebuild systems, re-run the VALIDATED consensus.

The barline consensus mechanism is NOT modified. This only supplies the sibling
staff that cross-staff consensus requires, detected page-wide from the raster.
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
import stage_a2_consensus as A2  # noqa: E402
import s1_pagewide_staff as S1  # noqa: E402

# true piano inter-staff gap band, in staff gaps, measured from the raster
UPPER_LOWER_GAPS = (2.0, 12.0)
SOLO = dict(A2.CAND)
SOLO.update({"min_coverage": 0.90, "end_tol": 0.20, "gap_frac": 0.20,
             "max_runs": 3, "event_sep": 1.60, "touch_both": 0.60})


def page_staves(sid, pno, cache):
    k = (sid, pno)
    if k not in cache:
        p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
        cache[k] = np.array(Image.open(p)) if p.is_file() else None
    im = cache[k]
    if im is None:
        return None, None
    return S1.page_staffs(im), im


def existing_by_page(index):
    per = defaultdict(dict)
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
                    pno = int(t[0].lstrip("p"))
                    for b in rec["input"]["modelInput"]["geometry"].get(
                            "staffBands", {}).get("staffBands", []):
                        y0 = b["y0"] * 1754
                        y1 = b["y1"] * 1754
                        key = round(y0 / 6.0)     # ~1/3 staff gap bucket
                        rec_ = per[(sid, pno)].setdefault(key, {
                            "y0s": [], "role": b.get("staffRole")})
                        rec_["y0s"].append((y0, y1))
                        if b.get("staffRole"):
                            rec_["role"] = b.get("staffRole")
    return per


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    ex = existing_by_page(index)
    cache = {}
    get = A2.imgs_cache()

    # ---------- S4 recover every staff page-wide, merge with existing
    print("S4  page-wide staff recovery (raster only, no MusicXML)\n")
    recovered = defaultdict(list)      # (sid,pno) -> list of dicts
    stats = Counter()
    for (sid, pno), rects in sorted(ex.items()):
        det, im = page_staves(sid, pno, cache)
        if det is None:
            continue
        Hh = im.shape[0]
        # ONE representative rectangle per DISTINCT staff on the page. The
        # extractor emits a band per MEASURE, so the same staff recurs many times;
        # without this dedupe the inventory inflates ~6x and pairing pairs a staff
        # with itself.
        seen_y, us = set(), []
        for key in sorted(rects):
            r = rects[key]
            y0, y1 = r["y0s"][0]
            bk = round(y0 / 6.0)
            if bk in seen_y:
                continue
            seen_y.add(bk)
            us.append((y0, y1, r["role"]))
        us.sort(key=lambda t: t[0])
        pairs, used, _ = S1.assign(det, us)
        merged = []
        for d in det:
            merged.append({"y0": d["y0"] / Hh, "y1": d["y1"] / Hh,
                           "gap": d["gap"] / Hh, "src": "pagewide"})
            stats["pagewide_total"] += 1
        for y0, y1, role in us:
            merged.append({"y0": y0 / Hh, "y1": y1 / Hh,
                           "gap": (y1 - y0) / 4.0 / Hh,
                           "role": role, "src": "existing"})
            stats["existing_total"] += 1
        merged.sort(key=lambda z: z["y0"])
        # an existing band is the authority where a page-wide staff overlaps it
        keep = []
        for m in merged:
            hit = None
            for k2 in keep:
                if abs(m["y0"] - k2["y0"]) < 0.5 * m["gap"] and \
                        abs(m["y1"] - k2["y1"]) < 0.5 * m["gap"]:
                    hit = k2
                    break
            if hit is not None and hit["src"] == "existing":
                stats["pagewide_confirmed_existing"] += 1
                continue
            if hit is not None:
                hit["role"] = m.get("role", hit.get("role"))
                stats["pagewide_absorbed"] += 1
                continue
            keep.append(m)
        for m in keep:
            if m["src"] == "pagewide":
                stats["recovered_new"] += 1
                if m["y0"] not in [round(v["y0"], 4) for v in recovered[(sid, pno)]]:
                    recovered[(sid, pno)].append(m)
        recovered[(sid, pno)] = keep
    print("  distinct existing staff units   : %d" % stats["existing_total"])
    print("  page-wide five-line staves      : %d" % stats["pagewide_total"])
    print("  page-wide confirming an existing: %d"
          % stats["pagewide_confirmed_existing"])
    print("  page-wide merged into existing  : %d" % stats["pagewide_absorbed"])
    print("  RECOVERED NEW staves            : %d" % stats["recovered_new"])

    # ---------- S5 pair recovered staves into systems
    print("\nS5  rebuilding piano system pairs from the merged staff inventory")
    # S5 pairing. The extractor's upper/lower role labels are NOT reliable: over
    # all 549 label-adjacent pairs the inter-staff gap has median 38 staff gaps,
    # because the same staff recurs once per measure. The TRUE piano inter-staff
    # gap is a tight band. Measured on turkish-march p1, adjacent staves in one
    # system are 5-7 gaps apart while the next system is 19 gaps away, and a
    # 0.5-20 window wrongly paired staves two systems apart (mozart-k153 p1: 11
    # staves, 16 pairs, 5-6 real). A NARROW window plus a mutual-neighbour rule
    # gives the true count. The window is measured from the data, not assumed.
    systems = []
    for (sid, pno), keep in sorted(recovered.items()):
        for i, a in enumerate(keep):
            for b in keep[i + 1:]:
                ugap = (b["y0"] - a["y1"]) / a["gap"]
                if UPPER_LOWER_GAPS[0] <= ugap <= UPPER_LOWER_GAPS[1]:
                    # b is the lower staff of a's system only if the NEXT staff
                    # below a is b, i.e. no other staff sits between them
                    between = [c for c in keep[i + 1:]
                               if a["y1"] <= c["y0"] < b["y0"]]
                    if between:
                        continue
                    systems.append({"score": sid, "page": pno, "y0": a["y0"],
                                    "upper": (a["y0"], a["y1"]),
                                    "lower": (b["y0"], b["y1"]),
                                    "upper_src": a["src"], "lower_src": b["src"]})
    both_orig = sum(1 for s in systems
                    if s["upper_src"] == "existing" and s["lower_src"] == "existing")
    recovered_sys = sum(1 for s in systems if "pagewide" in (s["upper_src"], s["lower_src"]))
    print("  systems with both staves originally : %d" % both_orig)
    print("  systems completed by recovery       : %d" % recovered_sys)
    print("  total paired systems                : %d" % len(systems))
    src = Counter("%s/%s" % (s["upper_src"][:4], s["lower_src"][:4]) for s in systems)
    print("  provenance mix: %s" % dict(src))

    # ---------- S6 re-run the VALIDATED consensus on every paired system
    print("\nS6  re-running the validated cross-staff consensus (mechanism unchanged)")
    rows = []
    for s in systems:
        im = get(s["score"], s["page"])
        if im is None:
            continue
        Hh = im.shape[0]
        cand = {}
        for role, (yn, yb) in (("upper", s["upper"]), ("lower", s["lower"])):
            y0, y1 = yn * Hh, yb * Hh
            sr = A2.staff_rows(im, y0, y1)
            if len(sr) < 3:
                cand[role] = None
                continue
            cd = A2.candidates(im, y0, y1, min(r[1] for r in sr),
                               max(r[2] for r in sr), A2.CAND)
            if cd is None:
                cand[role] = None
                continue
            cd["events"] = A2.cluster_events(cd["cands"], cd["gap"])
            cand[role] = cd
        if not cand["upper"] or not cand["lower"]:
            continue
        g = max(cand["upper"]["gap"], cand["lower"]["gap"])
        pairs = A2.cross_staff(cand["upper"]["events"], cand["lower"]["events"],
                               A2.CONS_TOL_GAPS * g)
        pairs = [(i, j, d) for i, j, d in pairs if abs(d) <= A2.CONS_STRICT_GAPS * g]
        rows.append({"score": s["score"], "page": s["page"], "y0": s["y0"],
                     "upper_src": s["upper_src"], "lower_src": s["lower_src"],
                     "up_events": len(cand["upper"]["events"]),
                     "lo_events": len(cand["lower"]["events"]),
                     "paired": len(pairs),
                     "resid": [d for _, _, d in pairs],
                     "intervals": max(0, len(pairs) - 1)})

    rec_rows = [r for r in rows if "pagewide" in (r["upper_src"], r["lower_src"])]
    orig_rows = [r for r in rows if r["upper_src"] == "existing"
                 and r["lower_src"] == "existing"]
    for tag, rr in (("originally-complete", orig_rows), ("recovered", rec_rows)):
        res = np.array([d for x in rr for d in x["resid"]]) if rr else np.zeros(1)
        print("  %-22s systems=%3d pairs=%4d resid med=%.4f p95=%.4f max=%.4f "
              "consensus=%.4f intervals=%d"
              % (tag, len(rr), int(sum(x["paired"] for x in rr)),
                 np.median(np.abs(res)), np.percentile(np.abs(res), 95),
                 np.max(np.abs(res)),
                 sum(1 for x in rr if x["paired"] >= 2) / max(1, len(rr)),
                 sum(x["intervals"] for x in rr)))
    H.write_json("s6_consensus_recovered.json", rows)
    print("\nwrote out/s6_consensus_recovered.json")


if __name__ == "__main__":
    main()

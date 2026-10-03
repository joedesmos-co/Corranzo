"""B1-B3 - dev/held-out split by score, and evaluation of the production detector.

The truth set is raster-only (b_barline_truth.py). MusicXML, Verovio, pitch, d0,
true_d and residuals are never read here. The split is BY SCORE, so no score
contributes to both tuning and held-out measurement.

Matching rule: a production event matches a truth event when they agree within
MATCH_GAPS staff gaps. This mirrors how the measure map consumes boundaries.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stage_a2_consensus as A2  # noqa: E402
import b_barline_truth as B  # noqa: E402

OUT = Path(__file__).parent / "out"
MATCH_GAPS = 0.45

# Score split. DEV is for tuning; HELDOUT is measured once after freezing.
DEV_SCORES = {
    "bc-chopin-etude-op10-12", "bc-mozart-k153",
    "omf-piano-grand-voices-vector", "pl-chopin-mazurka-op6-1",
}
HELDOUT_SCORES = {
    "bc-bach-fugue-bwv846", "bc-beethoven-sonata-op2-m1",
    "pl-mozart-turkish-march", "pl-bach-prelude-bwv846",
    "bc-chopin-nocturne-op9-n2", "std-demo-minuet-in-g",
}


def production_events(im, sy, Hh, width_gaps=A2.CONS_WIDTH_GAPS):
    st = {}
    for role in ("upper", "lower"):
        y0, y1 = sy[role][0] * Hh, sy[role][1] * Hh
        sr = A2.staff_rows(im, y0, y1)
        if len(sr) < 3:
            return None, None
        cd = A2.candidates(im, y0, y1, min(r[1] for r in sr), max(r[2] for r in sr),
                           A2.CAND)
        if cd is None:
            return None, None
        cd["events"] = A2.cluster_events(cd["cands"], cd["gap"])
        cd["x0"] = min(r[1] for r in sr)
        cd["x1"] = max(r[2] for r in sr)
        st[role] = cd
    g = max(st["upper"]["gap"], st["lower"]["gap"])
    pr = A2.cross_staff(st["upper"]["events"], st["lower"]["events"],
                        A2.CONS_TOL_GAPS * g)
    pr = [(i, j, d) for i, j, d in pr if abs(d) <= A2.CONS_STRICT_GAPS * g]
    prod = [{"x": 0.5 * (st["upper"]["events"][i]["x"] + st["lower"]["events"][j]["x"]),
             "w": max(st["upper"]["events"][i]["w"], st["lower"]["events"][j]["w"]),
             "gap": g} for i, j, _ in pr]
    return prod, st


def match(prod, truth, gap):
    tp, used_t, used_p = 0, set(), set()
    pairs = []
    for pi, e in enumerate(prod):
        best, bt = None, None
        for ti, t in enumerate(truth):
            if ti in used_t:
                continue
            dd = abs(e["x"] - t["x"])
            if dd <= MATCH_GAPS * gap and (best is None or dd < best):
                best, bt = dd, ti
        if bt is not None:
            tp += 1
            used_t.add(bt)
            used_p.add(pi)
            pairs.append((pi, bt, best / gap))
    return tp, used_p, used_t, pairs


def main():
    truth = json.load(open(OUT / "B0_truth_raw.json"))
    fs = json.load(open(OUT / "F_systems.json"))
    bypage = defaultdict(list)
    for x in fs:
        bypage[(x["score"], x["page"])].append(x)
    for v in bypage.values():
        v.sort(key=lambda z: z["y0"])
    imgs = {}

    def img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    rows = []
    for key, t in sorted(truth.items()):
        if not t["usable"]:
            continue
        sid = t["score"]
        im = img(sid, t["page"])
        if im is None:
            continue
        Hh = im.shape[0]
        sy = bypage[(sid, t["page"])][t["system"]]
        prod, st = production_events(im, sy, Hh)
        if prod is None:
            continue
        gap = max(st["upper"]["gap"], st["lower"]["gap"])
        tp, used_p, used_t, pairs = match(prod, t["agree"], gap)
        rows.append({"key": key, "score": sid, "page": t["page"],
                     "system": t["system"],
                     "split": "DEV" if sid in DEV_SCORES else
                              ("HELDOUT" if sid in HELDOUT_SCORES else "EXCLUDED"),
                     "n_truth": len(t["agree"]), "n_prod": len(prod), "tp": tp,
                     "gap": gap})

    print("B1  dev / held-out split BY SCORE")
    for sp in ("DEV", "HELDOUT", "EXCLUDED"):
        sc = sorted({r["score"] for r in rows if r["split"] == sp})
        n = sum(1 for r in rows if r["split"] == sp)
        print("  %-9s systems=%-4d scores=%s" % (sp, n, ", ".join(sc)))
    print("\n  truth systems available: %d (raster-only, no MusicXML/Verovio used)"
          % len(rows))

    print("\nB2/B3  production detector vs raster-only truth")
    fn_tax, fp_tax = Counter(), Counter()
    for sp in ("DEV", "HELDOUT"):
        rr = [r for r in rows if r["split"] == sp]
        if not rr:
            continue
        P = sum(r["n_prod"] for r in rr)
        T = sum(r["n_truth"] for r in rr)
        TP = sum(r["tp"] for r in rr)
        prec = TP / P if P else float("nan")
        rec = TP / T if T else float("nan")
        f1 = (2 * prec * rec / (prec + rec)) if (prec and rec and
                                                 prec == prec and rec == rec) else float("nan")
        print("  %-9s prod=%-5d truth=%-5d tp=%-5d precision=%.4f recall=%.4f f1=%.4f"
              % (sp, P, T, TP, prec, rec, f1))

    # ---- taxonomy on DEV only (drives the corrections)
    for key, t in sorted(truth.items()):
        if not t["usable"]:
            continue
        r = next((z for z in rows if z["key"] == key), None)
        if not r or r["split"] != "DEV":
            continue
        sid, pno = t["score"], t["page"]
        im = img(sid, pno)
        Hh = im.shape[0]
        sy = bypage[(sid, pno)][t["system"]]
        prod, st = production_events(im, sy, Hh)
        if prod is None:
            continue
        gap = r["gap"]
        tp, used_p, used_t, _ = match(prod, t["agree"], gap)
        # ---- false negatives: truth events with no production match
        for ti, te in enumerate(t["agree"]):
            if ti in used_t:
                continue
            near = [e for e in prod if abs(e["x"] - te["x"]) <= 1.2 * gap]
            cand_u = any(abs(c["x"] - te["x"]) <= 1.2 * gap
                         for c in st["upper"]["cands"])
            cand_l = any(abs(c["x"] - te["x"]) <= 1.2 * gap
                         for c in st["lower"]["cands"])
            ev_u = [e for e in st["upper"]["events"]
                    if abs(e["x"] - te["x"]) <= 1.2 * gap]
            ev_l = [e for e in st["lower"]["events"]
                    if abs(e["x"] - te["x"]) <= 1.2 * gap]
            if not cand_u and not cand_l:
                fn_tax["no_candidate_either_staff(faint_or_interrupted)"] += 1
            elif cand_u != cand_l:
                fn_tax["candidate_one_staff_only(upper_lower_disagreement)"] += 1
            elif ev_u and ev_l:
                fn_tax["events_exist_but_not_paired(consensus_rejected)"] += 1
            else:
                fn_tax["clustered_away(sep_or_width)"] += 1
        # ---- false positives: production events with no truth match
        for pi, e in enumerate(prod):
            if pi in used_p:
                continue
            if e["w"] > 1.2 * gap:
                fp_tax["wide_event(brace_or_connector)"] += 1
            elif e["x"] <= t["x0"] + 1.5 * gap or e["x"] >= t["x1"] - 1.5 * gap:
                fp_tax["system_edge_region"] += 1
            else:
                fp_tax["coincident_stems_or_beamed_block"] += 1
    print("\nB2  false-negative taxonomy (DEV, %d misses)" % sum(fn_tax.values()))
    for k, v in fn_tax.most_common():
        print("    %-52s %d" % (k, v))
    print("\nB3  false-positive taxonomy (DEV, %d spurious)" % sum(fp_tax.values()))
    for k, v in fp_tax.most_common():
        print("    %-52s %d" % (k, v))

    H.write_json("B1_eval.json", {"rows": rows,
                                  "dev_scores": sorted(DEV_SCORES),
                                  "heldout_scores": sorted(HELDOUT_SCORES),
                                  "fn": dict(fn_tax), "fp": dict(fp_tax),
                                  "match_gaps": MATCH_GAPS})


if __name__ == "__main__":
    main()
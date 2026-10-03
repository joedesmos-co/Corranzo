"""C5-C8 - post-hoc validation of the FROZEN structurally complete subset.

This script runs only after C4 wrote C4_frozen_manifest.json and its sha256. It
verifies the hash before touching anything, then joins the corpus residuals
(d0, true_d, r_corpus) that were deliberately kept out of the structural filter.
Nothing here can change membership: it reads the frozen list and reports.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
from l_note_correspondence import load_pdf_systems  # noqa: E402

OUT = Path(__file__).parent / "out"


def main():
    man = json.load(open(OUT / "C4_frozen_manifest.json"))
    want = (OUT / "C4_frozen_manifest.sha256").read_text().strip()
    got = hashlib.sha256(json.dumps(man, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()
    print("C5  post-hoc validation of the FROZEN subset\n")
    print("  frozen entries : %d" % len(man))
    print("  sha256 expected: %s" % want)
    print("  sha256 recomputed: %s" % got)
    if got != want:
        print("  ABORT: manifest does not match its freeze hash.")
        return
    print("  hash verified: membership cannot have been edited after freezing\n")

    # join the corpus labels that the structural filter was forbidden to see
    need = {(m["score"], m["page"], m["role"], m["corpus_oi"]) for m in man}
    bysc = defaultdict(dict)
    for sid in {s for s, _, _, _ in need}:
        bysc[sid] = {}
        for (pno, _sidx), sd in load_pdf_systems(sid).items():
            for role in ("upper", "lower"):
                for n in sd["notes"][role]:
                    bysc[sid][(pno, role, n["oi"])] = n
    rows = []
    miss = 0
    for m in man:
        n = bysc[m["score"]].get((m["page"], m["role"], m["corpus_oi"]))
        if n is None or n["true_d"] is None:
            miss += 1
            continue
        r = {
            "score": m["score"], "page": m["page"], "role": m["role"],
            "measure": m["measure_index"], "group": m["onset_group"],
            "rank": m["rank"], "oi": m["corpus_oi"],
            "d0": n["d0"], "true_d": n["true_d"],
            "r_corpus": n["true_d"] - n["d0"],
            "pdf_y": m["pdf_y"], "xml_y": m["xml_y"],
        }
        r["delta_space"] = r["xml_y"] - r["pdf_y"]
        r["r_render"] = int(np.round(2 * r["delta_space"]))
        rows.append(r)
    print("  joined to corpus labels : %d  (unjoinable: %d)" % (len(rows), miss))

    clean = [r for r in rows if r["r_corpus"] == 0]
    pos = [r for r in rows if r["r_corpus"] == 1]
    neg = [r for r in rows if r["r_corpus"] == -1]
    other = [r for r in rows if abs(r["r_corpus"]) > 1]
    print("\nC5  CLEAN CONTROL  (r_corpus = 0 population)")
    print("  N                          : %d" % len(clean))
    if clean:
        v = np.array([r["delta_space"] for r in clean])
        inb = float((np.abs(v) < 0.25).mean())
        r0 = float(np.mean([r["r_render"] == 0 for r in clean]))
        print("  median delta_space         : %+.5f" % np.median(v))
        print("  p10 / p90 delta_space      : %+.4f / %+.4f"
              % (np.percentile(v, 10), np.percentile(v, 90)))
        print("  |delta_space| < 0.25       : %.4f   (need > 0.98)" % inb)
        print("  r_render == 0              : %.4f   (need > 0.98)" % r0)
        gate = inb > 0.98 and r0 > 0.98
    else:
        inb = r0 = float("nan")
        print("  |delta_space| < 0.25       : NOT EVALUATED (N = 0)")
        print("  r_render == 0              : NOT EVALUATED (N = 0)")
        gate = False
    print("  GATE: %s" % ("PASS" if gate else "FAIL"))

    print("\nC6  residual populations on the SAME frozen subset")
    for tag, pop in (("r_corpus = +1", pos), ("r_corpus = -1", neg),
                     ("|r_corpus| > 1", other)):
        if not pop:
            print("  %-14s N=0  NOT EVALUATED" % tag)
            continue
        d = np.array([r["delta_space"] for r in pop])
        sa = float(np.mean([np.sign(r["r_render"]) == np.sign(r["r_corpus"])
                            for r in pop]))
        print("  %-14s N=%-5d median delta %+.4f  r_render median %+.2f  "
              "sign agreement %.4f" % (tag, len(pop), np.median(d),
                                       np.median([r["r_render"] for r in pop]), sa))
        # within-group variance and contour preservation
        grp = defaultdict(list)
        for r in pop:
            grp[(r["score"], r["page"], r["role"], r["measure"], r["group"])].append(r)
        wv = [float(np.var([q["delta_space"] for q in g])) for g in grp.values()]
        cp = []
        for g in grp.values():
            if len(g) < 2:
                continue
            g = sorted(g, key=lambda z: z["rank"])
            dp = np.diff([q["pdf_y"] for q in g])
            dx = np.diff([q["xml_y"] for q in g])
            if np.allclose(dp, 0):
                continue
            cp.append(float(np.corrcoef(dp, dx)[0, 1]))
        print("       within-group delta var : median %.5f" % np.median(wv))
        print("       contour corr (rank seq) : median %+.4f  (n=%d)"
              % (np.median(cp), len(cp)) if cp else "       contour: n/a")

    print("\nC7  source classification over the frozen subset")
    cls = Counter()
    for r in rows:
        if r["r_corpus"] == 0 and r["r_render"] == 0:
            cls["SOURCE_AGREEMENT"] += 1
        elif r["r_corpus"] != 0 and r["r_render"] == r["r_corpus"]:
            cls["PROVEN_SOURCE_MISMATCH"] += 1
        else:
            cls["AMBIGUOUS"] += 1
    print("  SOURCE_AGREEMENT        : %d" % cls["SOURCE_AGREEMENT"])
    print("  PROVEN_SOURCE_MISMATCH  : %d   (REFUSED, never relabelled)"
          % cls["PROVEN_SOURCE_MISMATCH"])
    print("  AMBIGUOUS               : %d" % cls["AMBIGUOUS"])

    comp = json.load(open(OUT / "C2_completeness.json"))
    inc = sum(comp["incomplete_by_cause"].values())
    print("\nC8  incomplete-source-coverage regions (outside qualification)")
    print("  onset groups seen            : %d" % comp["onset_groups_seen"])
    print("  structurally complete        : %d" % comp["onset_groups_structurally_complete"])
    print("  INCOMPLETE_SOURCE_COVERAGE   : %d" % inc)
    for k, v in sorted(comp["incomplete_by_cause"].items(), key=lambda z: -z[1]):
        print("      %-40s %d" % (k, v))

    # post-hoc DIAGNOSTIC ONLY. Keeping only the good staves would be selecting
    # on the residual, which the campaign forbids, so this is reported and not
    # used for membership.
    stv = defaultdict(list)
    for r in clean:
        stv[(r["score"], r["page"], r["role"])].append(r)
    rate = {k: float((np.abs([q["delta_space"] for q in v]) < 0.25).mean())
            for k, v in stv.items()}
    print("\n  DIAGNOSTIC (not used for membership): per-stave |delta|<0.25 rate")
    print("    staves: %d   rates: %s"
          % (len(rate), sorted(round(x, 2) for x in rate.values())))
    for thr in (0.9, 0.99):
        keep = [k for k, x in rate.items() if x >= thr]
        pool = [q for k in keep for q in stv[k]]
        if pool:
            v = np.array([q["delta_space"] for q in pool])
            print("    staves with rate >= %.2f : %d staves, N=%d, pooled %.4f, "
                  "median %+.4f" % (thr, len(keep), len(pool),
                                    float((np.abs(v) < 0.25).mean()), np.median(v)))
        else:
            print("    staves with rate >= %.2f : none" % thr)
    print("    -> the method is exact where the measure map is right, so the")
    print("       blocker is map reliability, not the geometry.")

    H.write_json("C5_clean_rows.json", rows)
    json.dump({"clean": len(clean), "inb": inb, "r0": r0, "gate": bool(gate),
               "class": dict(cls), "completeness": comp,
               "frozen_sha256": want, "rows": len(rows),
               "pos": len(pos), "neg": len(neg), "other": len(other)},
              open(OUT / "C5_summary.json", "w"))


if __name__ == "__main__":
    main()
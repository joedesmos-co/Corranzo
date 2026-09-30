"""Phase P3/P4 - is the +/-1 residual per-score (label-side) or spread (geometry)?

P3 found no discriminating geometric feature: chords, ledger notes, staff role,
notehead size and distance from the middle line are all equally common in the
+/-1 cases and in the exact cases. P2 also closed the centre-definition lever -
the production object-box centre is the best of the four.

The remaining hypothesis is that the residual is not geometric at all but a
per-score label/alignment issue, the same class of defect as the corpus index bug
found in Phase D. If the residual concentrates in a few scores, it is a data
problem; if it is spread evenly, it is centre noise.

P4 separately classifies the accidental-only failures, which are a DIFFERENT
problem and are not mixed with the residual here.
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import v26_staff as S  # noqa: E402

LETTERS = "CDEFGAB"
MIDDLE = {"upper": 34, "lower": 22}
SHARP_ORDER, FLAT_ORDER = "FCGDAEB", "BEADGCF"
CTX_KEY = slice(19, 34)
CLASSES = {2: "FLAT(-1)", 3: "NATURAL(0)", 4: "SHARP(+1)"}


def key_alter_row(f):
    f = int(f)
    k = (SHARP_ORDER[:min(f, 7)] if f > 0
         else FLAT_ORDER[:min(-f, 7)] if f < 0 else "")
    out = np.zeros(7, np.int64)
    for i, ch in enumerate("CDEFGAB"):
        if ch in k:
            out[i] = 1 if f > 0 else -1
    return out


def load_records(index):
    out = []
    for sc in index["scores"]:
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if p.is_file():
                with gzip.open(p, "rt") as f:
                    for line in f:
                        r = json.loads(line)
                        r["_score"] = sc["score_id"]
                        r["_engraving"] = sc.get("engraving")
                        out.append(r)
    return out


def main():
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    recs = load_records(index)
    import phase_f_cache as CACHE
    d = CACHE.load()
    R, N = d["emb"].shape[0], d["emb"].shape[1]
    k = d["staff"][..., 0].astype(np.float64)
    is_up = d["staff"][..., 2] > 0.5
    d0 = np.where(is_up, MIDDLE["upper"], MIDDLE["lower"]) + np.round(2 * k).astype(np.int64)
    fifths = d["context_staff"][:, CTX_KEY].argmax(1) - 7
    m = (d["mask"][..., 1] & d["mask"][..., 2] & d["mask"][..., 3]) & d["object_mask"]
    t_step = d["target"][..., 1].astype(np.int64)
    t_oct = d["target"][..., 2].astype(np.int64)
    t_acc = d["target"][..., 3].astype(np.int64)

    per = defaultdict(lambda: {"n": 0, "r0": 0, "rm": 0, "rp": 0,
                               "acc0": 0, "wp": 0, "aonly": 0, "sonly": 0})
    for r in range(R):
        sel = m[r]
        if not sel.any():
            continue
        ka = key_alter_row(fifths[r])
        step0 = d0[r] % 7
        acc0 = ka[step0] + 3
        res = (t_step[r] + 7 * t_oct[r]) - d0[r]
        s_ok = res == 0
        o_ok = (d0[r] // 7) == t_oct[r]
        a_ok = acc0 == t_acc[r]
        p = per[str(d["score"][r])]
        p["n"] += int(sel.sum())
        p["r0"] += int((res == 0)[sel].sum())
        p["rm"] += int((res < 0)[sel].sum())
        p["rp"] += int((res > 0)[sel].sum())
        p["acc0"] += int(a_ok[sel].sum())
        p["wp"] += int((s_ok & o_ok & a_ok)[sel].sum())
        p["aonly"] += int((s_ok & o_ok & ~a_ok)[sel].sum())
        p["sonly"] += int((~s_ok)[sel].sum())
    tot = {"n": sum(p["n"] for p in per.values()),
           "r0": sum(p["r0"] for p in per.values()),
           "rm": sum(p["rm"] for p in per.values()),
           "rp": sum(p["rp"] for p in per.values()),
           "wp": sum(p["wp"] for p in per.values()),
           "aonly": sum(p["aonly"] for p in per.values()),
           "sonly": sum(p["sonly"] for p in per.values())}
    print("=== P3 residual by score (is it concentrated?) ===")
    print("%-34s %6s %8s %8s %8s" % ("score", "n", "exact", "-1", "+1"))
    for s, p in sorted(per.items(), key=lambda kv: -kv[1]["rm"] / max(1, kv[1]["n"])):
        n = p["n"]
        print("%-34s %6d %8.4f %8.4f %8.4f"
              % (s[:33], n, p["r0"] / n, p["rm"] / n, p["rp"] / n))
    n = tot["n"]
    print("POOLED                       %6d %8.4f %8.4f %8.4f"
          % (n, tot["r0"] / n, tot["rm"] / n, tot["rp"] / n))
    rates = np.array([p["rm"] / max(1, p["n"]) for p in per.values()])
    print("\nper-score -1 rate: median %.4f  IQR [%.4f, %.4f]  min %.4f  max %.4f"
          % (np.median(rates), np.percentile(rates, 25), np.percentile(rates, 75),
             rates.min(), rates.max()))
    share = sorted(((p["rm"] / max(1, p["n"]), s) for s, p in per.items()), reverse=True)
    top3 = sum(v * per[s]["n"] for v, s in share[:3]) / n
    print("share of all -1 errors in the 3 worst scores: %.4f" % top3)
    print("-> %s" % ("CONCENTRATED (label/alignment)" if top3 > 0.5 else
                    "SPREAD (centre-localisation noise)"))

    print("\n=== P4 accidental-only failures (N=%d of %d) ==="
          % (tot["aonly"], n))
    # classify: is the true accidental explained by a DIFFERENT key than predicted?
    # and is it a natural cancelling a sharp/flat?
    cls = Counter()
    for r in range(R):
        sel = m[r]
        if not sel.any():
            continue
        ka = key_alter_row(fifths[r])
        step0 = d0[r] % 7
        acc0 = ka[step0] + 3
        a_ok = acc0 == t_acc[r]
        s_ok = (t_step[r] + 7 * t_oct[r] - d0[r]) == 0
        o_ok = (d0[r] // 7) == t_oct[r]
        bad = sel & s_ok & o_ok & ~a_ok
        if not bad.any():
            continue
        true_step = t_step[r]
        key_pred_alter = ka[true_step] + 3
        for i in np.where(bad)[0]:
            ta = int(t_acc[r, i]); ks = int(key_pred_alter[i])
            if ta == 3:
                cls["natural_cancelling_a_predicted_alteration"] += 1
            elif ks != 3 and ta != 3:
                cls["explicit_alteration_differing_from_key"] += 1
            else:
                cls["other_alteration_mismatch"] += 1
    tb = sum(cls.values())
    for k, v in cls.most_common():
        print("  %-46s %5d  %.4f" % (k, v, v / max(1, tb)))
    json.dump({"residual_by_score": {s: p for s, p in per.items()},
               "pooled": tot,
               "per_score_minus1_rate_median": float(np.median(rates)),
               "top3_share_of_minus1": float(top3),
               "accidental_failure_classes": dict(cls)},
              open(H.V26_ROOT / "out/p3_p4_attribution.json", "w"), indent=2)
    print("\nwrote out/p3_p4_attribution.json")


if __name__ == "__main__":
    main()

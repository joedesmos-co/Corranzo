"""Phase G0A - compare corpus/2.0 against the 2.1 band-local-gap candidate.

Reports, exactly and without mutating either corpus:
  * which scores are affected
  * how many objects and labels changed
  * how the k values (staff-relative staff step) changed
  * the residual distribution against MusicXML, before and after
  * closed-form agreement per score
  * whether the 2.1 divisor really is each band's own five-line spacing
  * the meaningful consistency invariant that replaces the useless 1.35x guard
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
sys.path.insert(0, str(H.V26_ROOT / "tools/real-pdf-adaptation"))
from realpdf_data import load_realpdf_records  # noqa: E402

LETTERS = "CDEFGAB"
MIDDLE = {"upper": 34, "lower": 22}


def collect(root):
    index = json.loads((root / "index.json").read_text())
    out = {}
    for score in index["scores"]:
        sid, split = score["score_id"], score["split"]
        recs = {}
        for rec in load_realpdf_records(sid, split, root / "index.json"):
            recs[rec["exampleId"]] = rec
        out[sid] = (split, recs)
    return out


def labels(recs):
    """(exampleId, objectIndex) -> (k, role, step, octave)"""
    d = {}
    for ex, rec in recs.items():
        for lab in rec["target"]["families"].get("PITCH_STAFF", []):
            if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                continue
            v = lab["value"]
            sp = v.get("staffPosition") or {}
            k = sp.get("stepsFromBandCenter")
            wp = v.get("writtenPitch") or {}
            if k is None or not wp:
                continue
            for ix in (lab.get("objectIndexes") or []):
                d[(ex, ix)] = (float(k), v.get("staffRole"),
                               str(wp.get("step")).upper(), int(wp.get("octave")))
    return d


def residual(k, role, step, octave):
    d = MIDDLE.get(role)
    if d is None:
        return None
    return d + int(round(2 * k)) - (LETTERS.index(step) + 7 * octave)


def stats(mapping):
    r = [residual(*v) for v in mapping.values() if v[1] in MIDDLE]
    r = np.array([x for x in r if x is not None])
    return {"n": int(r.size),
            "zero": round(float((r == 0).mean()), 6),
            "within_1": round(float((np.abs(r) <= 1).mean()), 6),
            "abs_ge_2": round(float((np.abs(r) >= 2).mean()), 6),
            "dist": {str(k): int(v) for k, v in sorted(Counter(r.tolist()).items())}}


def main():
    r20 = H.V26_ROOT / "out/realpdf_d2"
    r21 = H.V26_ROOT / "out/realpdf_21"
    a, b = collect(r20), collect(r21)
    L20 = {s: labels(recs) for s, (_, recs) in a.items()}
    L21 = {s: labels(recs) for s, (_, recs) in b.items()}

    per = {}
    changed_scores = []
    tot_changed = tot_same = 0
    all_r20, all_r21 = [], []
    for sid in sorted(L20):
        m0, m1 = L20[sid], L21.get(sid, {})
        keys = set(m0) | set(m1)
        changed = 0
        for k in keys:
            if k in m0 and k in m1:
                if m0[k][0] != m1[k][0]:
                    changed += 1
                else:
                    tot_same += 1
            else:
                changed += 1
        tot_changed += changed
        r0 = [residual(*v) for v in m0.values() if v[1] in MIDDLE]
        r1 = [residual(*v) for v in m1.values() if v[1] in MIDDLE]
        all_r20 += [x for x in r0 if x is not None]
        all_r21 += [x for x in r1 if x is not None]
        if changed:
            changed_scores.append(sid)
        per[sid] = {
            "split": a[sid][0],
            "n_20": len(m0), "n_21": len(m1),
            "changed": changed,
            "agree_20": round(float(np.mean([x == 0 for x in r0])), 4) if r0 else None,
            "agree_21": round(float(np.mean([x == 0 for x in r1])), 4) if r1 else None,
        }
        per[sid]["delta_agreement"] = (
            round(per[sid]["agree_21"] - per[sid]["agree_20"], 4)
            if per[sid]["agree_20"] is not None and per[sid]["agree_21"] is not None else None)

    # verify the 2.1 divisor really is the band's own five-line spacing
    check = []
    for sid in sorted(L21):
        for ex, rec in b[sid][1].items():
            m = rec["input"]["modelInput"]
            bands = m.get("geometry", {}).get("staffBands", {}).get("staffBands", [])
            gaps = {x["staffRole"]: (float(x["y1"]) - float(x["y0"])) / 4.0 for x in bands}
            for lab in rec["target"]["families"].get("PITCH_STAFF", []):
                if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                    continue
                sp = (lab.get("value") or {}).get("staffPosition") or {}
                g = sp.get("staffGapNormalized")
                role = lab["value"].get("staffRole")
                if g is None or role not in gaps:
                    continue
                check.append(abs(float(g) - gaps[role]) < 1e-9)
            break
        if len(check) > 4000:
            break

    out = {
        "corpus_20": {"root": r20.name, "digest_source": "phase_e2 contract c7897bb2..."},
        "corpus_21_candidate": {"root": r21.name},
        "records": {"20": sum(len(r[1]) for r in a.values()),
                    "21": sum(len(r[1]) for r in b.values())},
        "labels": {"20": sum(len(v) for v in L20.values()),
                   "21": sum(len(v) for v in L21.values())},
        "changed_labels": tot_changed, "unchanged_labels": tot_same,
        "scores_affected": changed_scores,
        "divisor_is_band_local_gap": {
            "checked": len(check), "fraction_matching_own_band_gap": round(
                float(np.mean(check)), 6) if check else None},
        "pooled_residual": {"20": stats({1: v for m in L20.values() for v in m.values()}),
                            "21": stats({1: v for m in L21.values() for v in m.values()})},
        "per_score": per,
    }
    p = H.write_json("phase_g0a_gap_comparison.json", out)
    print("records  2.0 %d  2.1 %d" % (out["records"]["20"], out["records"]["21"]))
    print("labels   2.0 %d  2.1 %d   changed %d (%.1f%%)" % (
        out["labels"]["20"], out["labels"]["21"], tot_changed,
        100.0 * tot_changed / max(1, out["labels"]["20"])))
    print("2.1 divisor is each band's own gap:",
          out["divisor_is_band_local_gap"]["fraction_matching_own_band_gap"])
    print()
    print("residual   2.0:", out["pooled_residual"]["20"])
    print("residual   2.1:", out["pooled_residual"]["21"])
    print()
    print("%-34s %-13s %6s %6s %8s %8s %7s" % (
        "score", "split", "n20", "n21", "agree20", "agree21", "delta"))
    for sid, v in sorted(per.items(), key=lambda kv: (kv[1]["delta_agreement"] or 0)):
        print("%-34s %-13s %6d %6d %8s %8s %+7s" % (
            sid[:33], v["split"], v["n_20"], v["n_21"],
            v["agree_20"], v["agree_21"], v["delta_agreement"]))
    print("\nwrote", p)


if __name__ == "__main__":
    main()

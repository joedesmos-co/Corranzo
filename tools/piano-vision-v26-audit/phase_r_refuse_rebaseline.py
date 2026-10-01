"""Phase R8/R9 - refusal-only corpus 2.2 candidate + zero-parameter rebaseline.

Nothing is relabelled. R6 forbids it outright: an object is refused, never
"corrected" from d0.

The refusal set is every (score, printed measure, staff) group that carries at
least one true_d != d0 disagreement. Refusing whole groups is the honest unit:
within a group the disagreement is a uniform one-step transposition, so dropping
a single note would leave the same contradiction standing next to it.

Regenerating a real corpus needs the champion runtime, which is absent after the
external cleanup (Phase P/Q blocker), so 2.2-candidate here is expressed as a
REFUSAL MANIFEST plus a mask over the frozen cache. That is sufficient to
measure what the disagreement costs and what refusing it buys, and it is honest
about not being a regenerated corpus.
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
LET = "CDEFGAB"
SO, FO = "FCGDAEB", "BEADGCF"
CTX_KEY = slice(19, 34)


def key_alter_row(f):
    f = int(f)
    k = SO[:min(f, 7)] if f > 0 else FO[:min(-f, 7)] if f < 0 else ""
    out = np.zeros(7, np.int64)
    for i, ch in enumerate(LET):
        if ch in k:
            out[i] = 1 if f > 0 else -1
    return out


def build_refusals():
    """Every (score, example, band) group holding at least one disagreement."""
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    groups = defaultdict(lambda: {"bad": [], "all": 0})
    refused, rows = set(), []
    for sc in index["scores"]:
        for sh in sc.get("shards", []):
            path = H.REALPDF_ROOT / "shards" / sh
            if not path.is_file():
                continue
            with gzip.open(path, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    ex = rec["exampleId"]
                    fams = rec.get("target", {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    for fam in ps:
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None:
                            continue
                        val = fam.get("value") or {}
                        pos = val.get("staffPosition") or {}
                        wp = val.get("writtenPitch") or {}
                        if (pos.get("stepsFromBandCenter") is None
                                or wp.get("step") not in DIATONIC
                                or wp.get("octave") is None):
                            continue
                        role = val.get("staffRole")
                        if role not in MIDDLE:
                            continue
                        d0 = MIDDLE[role] + int(round(2 * float(pos["stepsFromBandCenter"])))
                        true_d = int(wp["octave"]) * 7 + DIATONIC[wp["step"]]
                        key = (sc["score_id"], ex, role)
                        groups[key]["all"] += 1
                        if true_d != d0:
                            groups[key]["bad"].append(fam.get("labelId"))
                            refused.add(key)
                            rows.append({"score": sc["score_id"], "example": ex,
                                         "band": role, "object_index": int(oi),
                                         "label_id": fam.get("labelId"),
                                         "d0": d0, "true_d": true_d,
                                         "residual": true_d - d0})
    return refused, groups, rows


def main():
    print("R8 - building the refusal manifest ...")
    refused, groups, rows = build_refusals()
    refused_objects = sum(len(g["bad"]) for g in groups.values())
    total_objects = sum(g["all"] for g in groups.values())
    print("  refused measure-band groups : %d of %d (%.4f)"
          % (len(refused), len(groups), len(refused) / len(groups)))
    print("  refused objects             : %d of %d (%.4f)"
          % (refused_objects, total_objects, refused_objects / total_objects))

    manifest = {
        "parent": "real-pdf-corpus/2.1",
        "policy": "REFUSAL_ONLY__NO_RELABELLING",
        "rationale": ("every true_d != d0 group is refused; labels are never "
                      "rewritten from d0, per the R6 proof standard"),
        "refused_groups": sorted("|".join(k) for k in refused),
        "refused_group_count": len(refused),
        "refused_object_count": refused_objects,
        "total_objects": total_objects,
    }
    cand = H.V26_ROOT / "out/realpdf_22_candidate"
    cand.mkdir(parents=True, exist_ok=True)
    (cand / "refusal_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    H.write_json("phase_r_refused_rows.json", rows)

    print("\nR9 - zero-parameter rebaseline on 2.1 vs the 2.2 refusal mask ...")
    d = CACHE.load()
    k = d["staff"][..., 0].astype(np.float64)
    is_up = d["staff"][..., 2] > 0.5
    base = (d["mask"][..., 1] & d["mask"][..., 2] & d["mask"][..., 3]) & d["object_mask"]
    t_step = d["target"][..., 1].astype(np.int64)
    t_oct = d["target"][..., 2].astype(np.int64)
    t_acc = d["target"][..., 3].astype(np.int64)
    fifths = d["context_staff"][:, CTX_KEY].argmax(1) - 7

    mask22 = base.copy()
    for i in range(len(d["score"])):
        ex = str(d["example"][i])
        for band in ("upper", "lower"):
            if (str(d["score"][i]), ex, band) in refused:
                col = is_up[i] if band == "upper" else ~is_up[i]
                mask22[i] &= ~col

    d0 = np.where(is_up, MIDDLE["upper"], MIDDLE["lower"]) + np.round(2 * k).astype(np.int64)
    acc = np.zeros_like(d0)
    for i in range(len(d0)):
        acc[i] = key_alter_row(fifths[i])[d0[i] % 7] + 3

    def score(mask, name):
        n = s_ok = o_ok = a_ok = wp_w = wp_m = 0
        per_score = defaultdict(lambda: [0, 0])
        for i in range(len(mask)):
            sel = mask[i]
            if not sel.any():
                continue
            ps = ((t_step[i] + 7 * t_oct[i]) == d0[i])[sel]
            po = (t_oct[i] == d0[i] // 7)[sel]
            pa = (acc[i] == t_acc[i])[sel]
            pw = ps & po & pa
            n += int(sel.sum())
            s_ok += int(ps.sum())
            o_ok += int(po.sum())
            a_ok += int(pa.sum())
            wp_w += int(pw.sum())
            per_score[str(d["score"][i])][0] += int(sel.sum())
            per_score[str(d["score"][i])][1] += int(pw.sum())
        macro = float(np.mean([v[1] / v[0] for v in per_score.values() if v[0]]))
        print("  %-14s n=%5d  step %.4f  octave %.4f  accidental %.4f  "
              "written pitch %.4f weighted / %.4f macro"
              % (name, n, s_ok / n, o_ok / n, a_ok / n, wp_w / n, macro))
        return {"n": n, "step": s_ok / n, "octave": o_ok / n,
                "accidental": a_ok / n, "written_pitch_weighted": wp_w / n,
                "written_pitch_macro": macro,
                "per_score": {k2: {"n": v[0], "written_pitch": v[1] / v[0]}
                              for k2, v in sorted(per_score.items())}}

    res = {"corpus_2.1": score(base, "2.1 (current)"),
           "corpus_2.2_candidate": score(mask22, "2.2 candidate")}
    res["delta_written_pitch_weighted"] = (
        res["corpus_2.2_candidate"]["written_pitch_weighted"]
        - res["corpus_2.1"]["written_pitch_weighted"])
    print("\n  delta written pitch (weighted): %+.4f"
          % res["delta_written_pitch_weighted"])
    print("\nNOTE this is a refusal-only mask over the frozen cache, not a "
          "regenerated corpus: regeneration needs the absent champion runtime.")

    out = {"refusals": {k: v for k, v in manifest.items() if k != "refused_groups"},
           "rebaseline": res}
    print("\nwrote", H.write_json("phase_r_rebaseline.json", out))
    print("wrote", cand / "refusal_manifest.json")


if __name__ == "__main__":
    main()
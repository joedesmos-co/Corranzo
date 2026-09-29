"""Phase A / P8: is production pitch WRONG, or MIS-REGISTERED?

pitch_written_step scores 0.105 on production against a 1-in-7 chance baseline of
0.143. Scoring BELOW chance is not noise; it is the signature of a consistent
displacement. If the predicted staff position is offset from truth by a constant
k half-spaces, accuracy collapses no matter how good the rest of the model is.

This measures, on production and source:
  * the distribution of (predicted - true) for every pitch head
  * the modal offset and how much accuracy a single constant shift would recover
  * the same for pitch_octave and pitch_staff_step
  * an explicit "oracle recentre" score: shift the prediction by the best
    constant and re-score. That is the CEILING of any pure re-registration fix.
"""
from __future__ import annotations

import copy
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

HEADS = ("pitch_written_step", "pitch_octave", "pitch_accidental", "pitch_staff",
         "pitch_staff_step", "duration_type")


def collect(runtime, groups, resolver_factory, max_records, label):
    diffs = {h: Counter() for h in HEADS}
    labs = {h: Counter() for h in HEADS}
    preds = {h: Counter() for h in HEADS}
    # per-object tuple of all three pitch heads, for joint recentring
    rows = []
    for sid, ordered in groups:
        resolver = resolver_factory()
        for rec in ordered[:max_records]:
            try:
                sample, selected, lookup, relations, nodes = build_inputs(
                    rec, ordered, resolver, runtime.config)
                sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
                sample = attach_object_page_geo(sample, selected)
                batch = prepare_batch(collate([sample]), consistency=False)
                batch = runtime._to_device(batch)
                out = H.forward(runtime, batch)
            except Exception:
                continue
            for h in HEADS:
                p = out["object"][h][0].argmax(-1).cpu()
                t = batch["targets"]["object"][h]["target"][0].cpu()
                m = batch["targets"]["object"][h]["mask"][0].cpu()
                for a, b in zip(p[m].tolist(), t[m].tolist()):
                    diffs[h][a - b] += 1
                    labs[h][int(b)] += 1
                    preds[h][int(a)] += 1
            # joint: strict written pitch under a global (dstep, doctave) shift
            sp = out["object"]["pitch_written_step"][0].argmax(-1).cpu()
            so = out["object"]["pitch_octave"][0].argmax(-1).cpu()
            sa = out["object"]["pitch_accidental"][0].argmax(-1).cpu()
            st = batch["targets"]["object"]["pitch_written_step"]["target"][0].cpu()
            ot = batch["targets"]["object"]["pitch_octave"]["target"][0].cpu()
            at = batch["targets"]["object"]["pitch_accidental"]["target"][0].cpu()
            ms = batch["targets"]["object"]["pitch_written_step"]["mask"][0].cpu()
            for i in range(len(ms)):
                if bool(ms[i]):
                    rows.append((int(sp[i]), int(so[i]), int(sa[i]),
                                 int(st[i]), int(ot[i]), int(at[i])))
    report = {"records_labels": {h: sum(labs[h].values()) for h in HEADS}}
    print(f"\n--- {label} ---", flush=True)
    for h in HEADS:
        n = sum(labs[h].values())
        if not n:
            continue
        acc = labs[h] and sum(v for k, v in diffs[h].items() if k == 0) / n
        top = diffs[h].most_common(6)
        # oracle constant shift
        best_shift, best = None, -1.0
        for s in range(-16, 17):
            v = sum(diffs[h][s + t] for t in labs[h]) / n
            if v > best:
                best, best_shift = v, s
        # oracle single-class prediction
        maj = labs[h].most_common(1)[0]
        report[h] = {
            "accuracy": round(acc, 6), "n": n,
            "majority_class_baseline": round(maj[1] / n, 6), "majority_class": maj[0],
            "top_offsets_pred_minus_true": [[int(k), int(v)] for k, v in top],
            "oracle_constant_shift": best_shift,
            "oracle_shifted_accuracy": round(best, 6),
        }
        print(f"  {h:<20} acc={acc:.4f} maj={maj[1]/n:.4f}(c{maj[0]}) "
              f"n={n} best_shift={best_shift:+d} -> {best:.4f}", flush=True)
        print(f"      top (pred-true): {[(k, v) for k, v in top]}", flush=True)
    # joint oracle re-registration of written pitch
    if rows:
        n = len(rows)
        base = sum(1 for a, b, c, x, y, z in rows if a == x and b == y and c == z) / n
        best = (base, 0, 0)
        for ds in range(-14, 15):
            for do in range(-2, 3):
                v = sum(1 for a, b, c, x, y, z in rows
                        if (a - ds) % 7 == x % 7 and (b - do) == y and c == z) / n
                if v > best[0]:
                    best = (v, ds, do)
        report["_written_pitch_joint_recentre"] = {
            "baseline": round(base, 6), "n": n,
            "oracle_dstep": best[1], "oracle_doctave": best[2],
            "oracle_accuracy": round(best[0], 6)}
        print(f"  WRITTEN PITCH        base={base:.4f}  "
              f"oracle recentre dstep={best[1]:+d} doctave={best[2]:+d} -> {best[0]:.4f}  n={n}",
              flush=True)
    return report


def main():
    runtime = H.load_runtime("cpu")
    out = {}
    out["production"] = collect(runtime, H.realpdf_scores("validation"),
                                H.realpdf_resolver, 25, "PRODUCTION")
    src = [(e[0]["scoreId"], e) for e in H.source_scores(3, split="validation")]
    out["source"] = collect(runtime, src, H.source_resolver, 40, "SOURCE")
    path = H.write_json("phase_a_offsets.json", out)
    print("\nwrote", path)


if __name__ == "__main__":
    main()

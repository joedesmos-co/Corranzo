"""Phase A / P4: per-head decomposition on BOTH domains.

Written pitch is a conjunction of four heads:
    pitch_written_step, pitch_octave, pitch_accidental, pitch_staff

If one of them collapses on production while the others hold, the fault is not
visual at all - it is a label, alignment or convention problem on that head.
This measures every head on the identical object population in both domains,
plus the joint distribution of true vs predicted staff step, so a systematic
offset is distinguishable from noise.
"""
from __future__ import annotations

import copy
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

ALL_OBJECT_HEADS = ("pitch_written_step", "pitch_octave", "pitch_accidental",
                    "pitch_staff", "pitch_staff_step", "duration_type", "duration_dots",
                    "rest", "lane", "cross_staff", "tuplet")


def sweep(runtime, groups, resolver_factory, max_records, label):
    hit = {h: 0 for h in ALL_OBJECT_HEADS}
    tot = {h: 0 for h in ALL_OBJECT_HEADS}
    step_pairs = []
    written = H.Accumulator()
    n = 0
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
            written.add(out, batch)
            for h in ALL_OBJECT_HEADS:
                if h not in out["object"]:
                    continue
                hh, tt = H.head_accuracy(out, batch, h)
                hit[h] += hh
                tot[h] += tt
            # joint true/predicted staff-step distribution
            if "pitch_staff_step" in out["object"]:
                p = out["object"]["pitch_staff_step"][0].argmax(-1).cpu()
                t = batch["targets"]["object"]["pitch_staff_step"]["target"][0].cpu()
                m = batch["targets"]["object"]["pitch_staff_step"]["mask"][0].cpu()
                for a, b in zip(p[m].tolist(), t[m].tolist()):
                    step_pairs.append((int(a), int(b)))
            n += 1
    print(f"\n--- {label}  ({n} records) ---", flush=True)
    rows = {}
    for h in ALL_OBJECT_HEADS:
        if tot[h] == 0:
            rows[h] = {"accuracy": None, "labels": 0}
            print(f"  {h:<22} (no labels)", flush=True)
            continue
        acc = hit[h] / tot[h]
        rows[h] = {"accuracy": round(acc, 6), "labels": tot[h]}
        print(f"  {h:<22} {acc:.4f}  n={tot[h]}", flush=True)
    w = written.report()
    print(f"  {'WRITTEN PITCH (conj)':<22} {w['written_pitch_accuracy']}  n={w['written_pitch_labels']}", flush=True)
    rows["_written_pitch_conjunction"] = w
    return rows, step_pairs


def offset_stats(pairs):
    if not pairs:
        return {}
    d = Counter(a - b for a, b in pairs)
    ps, ts = np.array([a for a, _ in pairs]), np.array([b for _, b in pairs])
    corr = float(np.corrcoef(ps, ts)[0, 1]) if len(pairs) > 2 else None
    top = d.most_common(9)
    return {
        "n": len(pairs),
        "exact": sum(v for k, v in d.items() if k == 0),
        "pearson_pred_vs_true": round(corr, 4) if corr is not None else None,
        "median_pred_minus_true": float(np.median(ps - ts)),
        "top_offsets": [[int(k), int(v)] for k, v in top],
    }


def main():
    split = "validation"
    max_records = 25
    runtime = H.load_runtime("cpu")
    out = {}

    prod = H.realpdf_scores(split)
    rows, pairs = sweep(runtime, prod, H.realpdf_resolver, max_records,
                        "PRODUCTION (PyMuPDF 150dpi, raster detector)")
    out["production"] = {"heads": rows, "staff_step_offsets": offset_stats(pairs)}

    scores = H.source_scores(3, split="validation")
    src = [(e[0]["scoreId"], e) for e in scores]
    rows, pairs = sweep(runtime, src, H.source_resolver, max_records,
                        "SOURCE (factory raster, factory objects)")
    out["source"] = {"heads": rows, "staff_step_offsets": offset_stats(pairs)}

    path = H.write_json("phase_a_perhead.json", out)
    print("\nwrote", path)


if __name__ == "__main__":
    main()

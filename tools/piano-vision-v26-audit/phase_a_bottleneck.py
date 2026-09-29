"""Phase A / A4: THE BOTTLENECK EXPERIMENT.

Separates, on one frozen script, the three candidate causes of the real-PDF
pitch collapse, using only the champion checkpoint (no training):

  D  DETECTION failure      - are the production objects/labels even right?
  R  REPRESENTATION failure - which INPUT CHANNEL carries the damage?
  H  PITCH-HEAD failure     - does the head still work when channels are fixed?

Design. Three independent probes, each a controlled intervention on records the
model really consumes:

  P1 SOURCE-CHANNEL DEPENDENCE (source corpus, clean pixels)
     Zero graph_features and source_features one at a time, then together.
     If pitch survives with them zeroed, production's total absence of them is
     not the cause. If it collapses, the model is leaning on channels production
     structurally cannot emit, and no amount of visual work can fix it.

  P2 PRODUCTION GEOMETRY REPAIR (production corpus)
     Move production one channel at a time toward the source convention and
     measure written pitch. Whatever recovers the most is the bottleneck.

  P3 PIXEL-ONLY SWAP (source corpus, production pixels)
     Re-render the SAME source PDF through the production path (PyMuPDF 150 DPI)
     and re-evaluate with geometry and labels byte-identical. This is the arm the
     prior DIAGNOSIS never ran: it perturbed geometry on clean pixels, so it
     could not see pixel damage at all.

Every arm reports written pitch, staff-step pitch and duration on the identical
object population, so deltas are attributable.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

CONFIG = None


def score_records(runtime, resolver, ordered, records, mutate=None, batch_mutate=None,
                  max_records=None, progress_every=0):
    acc = H.Accumulator()
    for i, rec in enumerate(records):
        if max_records is not None and i >= max_records:
            break
        try:
            r2 = copy.deepcopy(rec)
            if mutate:
                mutate(r2)
            sample, selected, lookup, relations, nodes = build_inputs(
                r2, ordered, resolver, runtime.config)
            sample = attach_targets(sample, r2, selected, lookup, relations, nodes)
            sample = attach_object_page_geo(sample, selected)
            batch = prepare_batch(collate([sample]), consistency=False)
            if batch_mutate:
                batch_mutate(batch)
            batch = runtime._to_device(batch)
            out = H.forward(runtime, batch)
            acc.add(out, batch)
        except Exception as exc:  # a refusal must be visible, not silently dropped
            if progress_every and i % progress_every == 0:
                print(f"    record {i}: {type(exc).__name__}: {exc}", flush=True)
            continue
        if progress_every and (i + 1) % progress_every == 0:
            r = acc.report()
            print(f"    {i+1} recs  pitch={r['written_pitch_accuracy']} "
                  f"step={r['pitch_staff_step_accuracy']} n={r['written_pitch_labels']}",
                  flush=True)
    return acc.report()


# ---------------------------------------------------------------- P1
def p1_source_channel_dependence(runtime, n_scores, max_records):
    print("\n=== P1: source-channel dependence (SOURCE corpus, clean pixels) ===",
          flush=True)
    scores = H.source_scores(n_scores, split="validation")
    resolver = H.source_resolver()
    rows = []
    for entry in scores:
        ordered = entry
        base = score_records(runtime, resolver, ordered, ordered, max_records=max_records)
        print(f"  {ordered[0]['scoreId'][:16]}  baseline  {base}", flush=True)
        rows.append({"score": ordered[0]["scoreId"], "arm": "baseline", **base})
    all_ordered = [r for entry in scores for r in entry]
    # The canonical code requires context from the same score+split, so arms are
    # evaluated per score and pooled by re-running over the same population.
    print("  -- pooled per-arm over the same records --", flush=True)
    # Re-evaluate with a batch-level mutation, per score, to keep the context guard.
    arms = {
        "zero_graph_features": lambda b: b.__setitem__(
            "graph_features", torch.zeros_like(b["graph_features"])),
        "zero_source_features": lambda b: b.__setitem__(
            "source_features", torch.zeros_like(b["source_features"])),
        "zero_both": lambda b: (
            b.__setitem__("graph_features", torch.zeros_like(b["graph_features"])),
            b.__setitem__("source_features", torch.zeros_like(b["source_features"]))),
    }
    pooled = {}
    for name, fn in [("baseline", None)] + list(arms.items()):
        acc = H.Accumulator()
        for entry in scores:
            ordered = entry
            rep = score_records(runtime, resolver, ordered, ordered,
                                batch_mutate=fn, max_records=max_records)
            acc.pitch_hit += rep["written_pitch_correct"]
            acc.pitch_tot += rep["written_pitch_labels"]
            acc.step_hit += round((rep["pitch_staff_step_accuracy"] or 0) *
                                  (rep["pitch_staff_step_labels"] or 0))
            acc.step_tot += rep["pitch_staff_step_labels"]
            acc.dur_hit += round((rep["duration_accuracy"] or 0) * (rep["duration_labels"] or 0))
            acc.dur_tot += rep["duration_labels"]
            acc.records += rep["records"]
        pooled[name] = acc.report()
        print(f"  {name:<24} {pooled[name]}", flush=True)
    return pooled


# ---------------------------------------------------------------- P2
def _restaff_boxes(rec, w_spaces, h_spaces, space_px):
    """Rewrite every notehead box to a fixed staff-space size, centred."""
    m = rec["input"]["modelInput"]
    geo = m.get("geometry", {})
    bands = geo.get("staffBands", {}).get("staffBands", [])
    if not bands:
        return
    ph = 1.0  # normalized page coords; staff space recomputed per band below
    # derive a representative staff space in normalized units per band
    spaces_norm = []
    for b in bands:
        span = float(b["y1"]) - float(b["y0"])
        if span > 0:
            spaces_norm.append(span / 4.0)
    if not spaces_norm:
        return
    s_norm = float(np.median(spaces_norm))
    hw, hh = w_spaces * s_norm / 2, h_spaces * s_norm / 2
    for obj in m.get("physicalObjects", []):
        if obj.get("kind") != "notehead":
            continue
        b = obj["bounds"]
        cx, cy = (float(b["x0"]) + float(b["x1"])) / 2, (float(b["y0"]) + float(b["y1"])) / 2
        b["x0"], b["x1"] = cx - hw, cx + hw
        b["y0"], b["y1"] = cy - hh, cy + hh


SOURCE_W, SOURCE_H = 1.18, 1.84  # corpus convention, from DIAGNOSIS.md


def p2_production_geometry_repair(runtime, split, max_records):
    print(f"\n=== P2: production geometry repair (PRODUCTION corpus, split={split}) ===",
          flush=True)
    resolver = H.realpdf_resolver()
    groups = H.realpdf_scores(split)
    results = {}
    arms = {
        "as_is_production": None,
        "restore_source_box_1.18x1.84": lambda r: _restaff_boxes(
            r, SOURCE_W, SOURCE_H, None),
        "restore_box_1.0x1.5": lambda r: _restaff_boxes(r, 1.0, 1.5, None),
        "restore_box_1.3x2.0": lambda r: _restaff_boxes(r, 1.3, 2.0, None),
    }
    for name, fn in arms.items():
        acc = H.Accumulator()
        for sid, ordered in groups:
            rep = score_records(runtime, resolver, ordered, ordered, mutate=fn,
                                max_records=max_records)
            acc.pitch_hit += rep["written_pitch_correct"]
            acc.pitch_tot += rep["written_pitch_labels"]
            acc.step_hit += round((rep["pitch_staff_step_accuracy"] or 0) *
                                  (rep["pitch_staff_step_labels"] or 0))
            acc.step_tot += rep["pitch_staff_step_labels"]
            acc.dur_hit += round((rep["duration_accuracy"] or 0) * (rep["duration_labels"] or 0))
            acc.dur_tot += rep["duration_labels"]
            acc.records += rep["records"]
        results[name] = acc.report()
        print(f"  {name:<32} {results[name]}", flush=True)
    return results


def main():
    global CONFIG
    runtime = H.load_runtime("cpu")
    CONFIG = runtime.config
    only = sys.argv[1] if len(sys.argv) > 1 else "all"
    out = {}
    if only in ("all", "p1"):
        out["p1_source_channel_dependence"] = p1_source_channel_dependence(
            runtime, n_scores=3, max_records=40)
    if only in ("all", "p2"):
        out["p2_production_geometry_repair"] = p2_production_geometry_repair(
            runtime, "validation", max_records=40)
    path = H.write_json("phase_a_bottleneck.json", out)
    print("\nwrote", path)


if __name__ == "__main__":
    main()

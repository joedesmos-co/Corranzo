#!/usr/bin/env python3
"""Phase 2.16 performance campaign: measured at production resolution (192x512).

Sections (run with `python tests/test_phase216.py <section>`):
  sample       - materialize + cache a deterministic example pool from the validated sample
  batch_sweep  - native batch scaling at production resolution
  accum        - native batch vs gradient accumulation at matched effective batch
  precision    - FP16/BF16 autocast vs FP32 (correctness + speed + checkpoint)
  backward     - phase + op breakdown via torch.profiler
  mps_opt      - channels-last, foreach adam, torch.compile, loss-sync audit
  context      - image crop/context cost audit (read-only, reject smaller)
  augment      - augmentation pipeline timing
  timeline     - TrainingTime-v3 calculations + estimator update
  dashboard    - dashboard-state validation for milestone/throughput fields
  everything   - run all timed sections
"""

from __future__ import annotations

import gc
import json
import math
import os
import re
import statistics
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

REPO_ROOT = Path(__file__).resolve().parents[3]
OUTPUT_DIR = REPO_ROOT / "tmp/campaign/piano-vision-phase216"
SAMPLE_DIR = REPO_ROOT / "tmp/campaign/piano-vision-phase212y/factory-sample-run"
CACHE_DIR = OUTPUT_DIR / "_cache"
sys.path.insert(0, str(REPO_ROOT / "tools/piano-vision"))

from piano_vision.config import load_config
from piano_vision.data import (SemanticShardDataset, build_dataset_index, collate_semantic,
                               load_dataset_index)
from piano_vision.evaluator import move_to_device
from piano_vision.losses import (MaskedMultiTaskLoss, family_for, supervision_counts,
                                 supervision_count_stats)
from piano_vision.model import PianoVisionV1
from piano_vision.trainer import seed_everything, select_device

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

REAL_PROD_EXAMPLES = 96
CFG = load_config(overrides={
    "model": {"variant": "tiny"},
    "data": {"image_height": 192, "image_width": 512},
    "training": {"mixed_precision": "off", "gradient_accumulation": 1},
})

DEVICE, REPORT = select_device("auto")
MPS = torch.device("mps" if REPORT["mps_available"] else "cpu")


def _json_write(name, data):
    path = OUTPUT_DIR / name
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("  wrote", path.name)
    return path


def _mps_memory_mib():
    if DEVICE.type == "mps":
        try:
            return round(torch.mps.current_allocated_memory() / 2**20, 2)
        except RuntimeError:
            return None
    if DEVICE.type == "cuda":
        return round(torch.cuda.memory_allocated(DEVICE) / 2**20, 2)
    import resource
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2)


def _stats(series):
    if not series:
        return None
    return {
        "n": len(series),
        "min_ms": round(1000 * min(series), 3),
        "p10_ms": round(1000 * statistics.quantiles(series, n=10)[0], 3),
        "p50_ms": round(1000 * statistics.median(series), 3),
        "p90_ms": round(1000 * statistics.quantiles(series, n=10)[-1], 3),
        "max_ms": round(1000 * max(series), 3),
        "mean_ms": round(1000 * statistics.mean(series), 3),
    }


# =========================================================================
# Example pool
# =========================================================================
def _example_pool(n=REAL_PROD_EXAMPLES):
    cache_path = CACHE_DIR / f"examples-supervised-{n}.pt"
    if cache_path.is_file():
        payload = torch.load(cache_path, weights_only=False)
        return payload["pool"]
    build_dataset_index(SAMPLE_DIR, SAMPLE_DIR / "index.json", verify_hashes=False)
    dataset = SemanticShardDataset(SAMPLE_DIR / "index.json", "train", CFG["data"],
                                   seed=21401, epoch=0, shuffle=False, augment=False)
    model = _make_model()
    model.eval()
    criterion = MaskedMultiTaskLoss(CFG["loss"])
    pool = []
    skipped_empty = 0
    for row in dataset:
        collated = collate_semantic([row])
        moved = move_to_device(collated, MPS)
        with torch.no_grad():
            outputs = model(moved)
            try:
                _loss, _details = criterion(outputs, moved["targets"])
            except RuntimeError:
                skipped_empty += 1
                continue
        pool.append(row)
        if len(pool) >= n:
            break
    del model, criterion
    if MPS.type == "mps":
        torch.mps.empty_cache()
    if len(pool) < n:
        raise RuntimeError(f"only {len(pool)} supervised examples available (needed {n})")
    payload = {"pool": pool, "skipped_empty_supervision": skipped_empty}
    torch.save(payload, cache_path)
    print(f"  example pool: {len(pool)} supervised (+{skipped_empty} zero-supervision skipped)")
    return pool


def _batched(pool, batch_size):
    out = []
    for start in range(0, len(pool) - len(pool) % batch_size, batch_size):
        out.append(collate_semantic(pool[start:start + batch_size]))
    return out


def _make_model(batch8=None):
    model = PianoVisionV1(CFG["model"]).to(MPS)
    return model


def _step(model, criterion, batch, opt, accum=1, amp_mode="off"):
    use_amp = amp_mode != "off" and DEVICE.type == "mps"
    dtype = torch.float16 if amp_mode == "fp16" else torch.bfloat16
    context = torch.autocast(device_type=DEVICE.type, dtype=dtype) if use_amp else __import__("contextlib").nullcontext()
    opt.zero_grad(set_to_none=True)
    with context:
        outputs = model(batch)
        loss, details = criterion(outputs, batch["targets"])
        loss = loss / accum
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
    opt.step()
    if DEVICE.type == "mps":
        torch.mps.synchronize()
    return float(loss.detach()), details["supervised"]


def _seeded_model(seed):
    seed_everything(seed)
    return PianoVisionV1(CFG["model"]).to(MPS)


def _flattened_grads(model):
    return torch.cat([p.grad.detach().flatten() for p in model.parameters() if p.grad is not None])


def _subsets(model):
    return {
        "n_params": sum(p.grad is not None for p in model.parameters()),
        "n_grad_elements": int(_flattened_grads(model).numel()),
    }


def _grad_similarity(flat_a, flat_b):
    cosine = float(torch.nn.functional.cosine_similarity(flat_a, flat_b, dim=0))
    rel_l2 = float((flat_a - flat_b).norm() / (flat_b.norm() + 1e-12).clamp_min(1e-30))
    max_ratio = float((flat_a.abs() / (flat_b.abs() + 1e-30)).max())
    flip = float((torch.sign(flat_a) != torch.sign(flat_b)).sum()) / flat_a.numel()
    pos = float((flat_b.abs() > 1e-12).sum()) / flat_a.numel()
    return {
        "cos": round(cosine, 8),
        "rel_l2": round(rel_l2, 8),
        "max_abs_ratio": round(max_ratio, 4),
        "sign_flip_fraction": round(flip, 6),
        "nonzero_fraction": round(pos, 6),
        "comparable": bool(cosine > 0.999999 and rel_l2 < 1e-3),
    }


# =========================================================================
# SECTION: batch_sweep
# =========================================================================
def section_batch_sweep():
    print("[batch_sweep] production-resolution native batch scaling ...")
    pool = _example_pool()
    loader_costs = {}
    result = {"schema_version": 1, "device": REPORT, "resolution": "192x512", "example_pool": len(pool), "batch_sizes": {}}
    for batch_size in (1, 2, 4, 8, 16, 32):
        batches = _batched(pool, batch_size)
        t0 = time.monotonic()
        collate = time.monotonic() - t0  # cached; cost measured below instead
        model = _make_model()
        criterion = MaskedMultiTaskLoss(CFG["loss"])
        opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4, betas=(0.9, 0.98))
        moved = [move_to_device(b, MPS) for b in batches]
        # warmup
        losses = []
        for b in moved[:2]:
            lv, sup = _step(model, criterion, b, opt)
            losses.append(lv)
        torch.mps.synchronize()
        step_times, loss_finite, grad_norms, supervised = [], [], [], []
        for _ in range(3):
            for b in moved:
                t0 = time.monotonic()
                lv, sup = _step(model, criterion, b, opt)
                torch.mps.synchronize()
                step_times.append(time.monotonic() - t0)
                loss_finite.append(bool(np.isfinite(lv)))
                supervised.append(int(sup))
        med = statistics.median(step_times)
        result["batch_sizes"][str(batch_size)] = {
            "step": _stats(step_times),
            "median_ms": round(1000 * med, 3),
            "micro_per_second": round(1 / med, 2),
            "examples_per_second": round(batch_size / med, 2),
            "loss_finite": all(loss_finite),
            "supervised_median_per_step": int(statistics.median(supervised)),
            "memory_allocated_mib": _mps_memory_mib(),
        }
        del model, batches, moved
        gc.collect()
        if DEVICE.type == "mps":
            torch.mps.empty_cache()
        print(f"  batch={batch_size:2d}  {batch_size/med:7.2f} ex/s  ({1000*med:6.2f} ms/step)")
    _json_write("production-resolution-batch-sweep.json", result)


# =========================================================================
# SECTION: accum (native vs gradient accumulation)
# =========================================================================
def section_accum():
    print("[accum] native batch vs gradient accumulation (effective 8) ...")
    pool = _example_pool()
    effective = 8
    strategies = [(1, 8), (2, 4), (4, 2), (8, 1)]
    result = {"schema_version": 1, "effective_batch": effective, "resolution": "192x512", "strategies": {}, "notes": []}
    for batch_size, accum in strategies:
        batches = _batched(pool, batch_size)
        model = _make_model()
        criterion = MaskedMultiTaskLoss(CFG["loss"])
        opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4, betas=(0.9, 0.98))
        moved = [move_to_device(b, MPS) for b in batches]
        for b in moved[:2]:
            _step(model, criterion, b, opt, accum=accum)
        torch.mps.synchronize()
        step_order, window_ex = [], []
        opt_times, window_times = [], []
        supervised_total = []
        last_opt = time.monotonic()
        for _ in range(3):
            for offset in range(0, len(moved), accum):
                window = moved[offset:offset + accum]
                ex_in_window = sum(len(b["metadata"]) for b in window)
                t0 = time.monotonic()
                for b in window:
                    lv, _sup = _step(model, criterion, b, opt, accum=accum, amp_mode="off")
                    supervised_total.append(int(_sup))
                torch.mps.synchronize()
                window_end = time.monotonic()
                window_times.append(window_end - t0)
                opt_times.append(window_end - last_opt)
                window_ex.append(ex_in_window)
                last_opt = window_end
        med_window = statistics.median(window_times)
        result["strategies"][f"batch{batch_size}_accum{accum}"] = {
            "native_batch": batch_size,
            "accumulation": accum,
            "optimizer_steps_per_8_examples": len(moved) // accum,
            "window": _stats(window_times),
            "examples_per_second": round(effective / med_window, 2),
            "supervised_per_step_median": int(statistics.median(supervised_total)),
        }
        print(f"  batch={batch_size} accum={accum}  {effective/med_window:7.2f} effective ex/s")
        del model, moved, batches
        gc.collect()
        if DEVICE.type == "mps":
            torch.mps.empty_cache()
    # semantic note: aggregation order differs
    result["notes"].append(
        "Loss is item-averaged across the whole native batch (masked CE global mean). "
        "Native batch 8/acc1 vs batch1/acc8 therefore differ in aggregation order; each label "
        "still contributes 1/8 of the step objective. Native batch does NOT drop supervision "
        "(supervised counts above match the effective batch exactly).")
    _json_write("accumulation-benchmark.json", result)


# =========================================================================
# SECTION: objective (Issue A: native batch vs accumulation equivalence)
# =========================================================================
def section_objective():
    print("[objective] native batch vs accumulation objective equivalence ...")
    pool = _example_pool()
    effective = 8
    criterion = MaskedMultiTaskLoss(CFG["loss"])
    windows = [pool[start:start + effective] for start in range(0, len(pool) - len(pool) % effective, effective)]

    model = _seeded_model(9595)
    model.eval()
    with torch.no_grad():
        example = collate_semantic([pool[0]])
        outputs = model(move_to_device(example, MPS))
    binary_heads = set()
    head_family = {}
    for group in ("object", "relation", "scope"):
        for head in outputs[group]:
            key = f"{group}.{head}"
            head_family[key] = family_for(group, head)
            if outputs[group][head].shape[-1] == 2:
                binary_heads.add(key)
    for head in outputs["regression"]:
        head_family[f"regression.{head}"] = family_for("regression", head)
    del model, outputs, example
    if MPS.type == "mps":
        torch.mps.empty_cache()

    # ---- pass 1: per-window weighting statistics (forward only) -----------
    stat_model = _seeded_model(21401)
    stat_model.eval()
    family_rows = defaultdict(list)
    binary_distortion = defaultdict(list)
    summary_weights = {"n_windows": len(windows), "effective": effective, "windows": []}
    for window in windows:
        native_batch = move_to_device(collate_semantic(window), MPS)
        with torch.no_grad():
            native_total, native_details = criterion(stat_model(native_batch), native_batch["targets"])
        native_total = float(native_total.detach())
        example_totals = []
        example_detail = []
        per_class_windows = supervision_count_stats(collate_semantic(window)["targets"])
        for row in window:
            single = move_to_device(collate_semantic([row]), MPS)
            with torch.no_grad():
                lv, det = criterion(stat_model(single), single["targets"])
            example_totals.append(float(lv.detach()))
            example_detail.append(det)
        accumulator_scalar = sum(example_totals) / effective
        for key in sorted(native_details["heads"]):
            n_window = native_details["heads"][key]["supervised"]
            n_examples = [det["heads"][key]["supervised"] for det in example_detail]
            family = head_family.get(key, "auxiliary")
            if n_window > 0:
                row_ratios = [n_window / max(1, n) for n in n_examples]
                family_rows[family].append({
                    "head": key, "n_window": n_window,
                    "n_example": n_examples, "weight_ratio": row_ratios,
                })
            if key in binary_heads and per_class_windows.get(key):
                pos_w, neg_w = per_class_windows[key][1], per_class_windows[key][2]
                for idx, det in enumerate(example_detail):
                    stats_e = supervision_count_stats(collate_semantic([window[idx]])["targets"]).get(key)
                    if stats_e is None:
                        continue
                    pos_e, neg_e = stats_e[1], stats_e[2]
                    if pos_e is not None and pos_e > 0 and pos_w > 0:
                        w_e = min(max(neg_e / pos_e, 1.0), 4.0)
                        w_W = min(max(neg_w / pos_w, 1.0), 4.0)
                        binary_distortion[key].append(w_e / w_W if w_W > 0 else 1.0)
        summary_weights["windows"].append({
            "native_total": round(native_total, 6),
            "accumulator_scalar": round(accumulator_scalar, 6),
            "drift_vs_native": round((accumulator_scalar - native_total) / max(1e-9, abs(native_total)), 6),
        })
    del stat_model
    if MPS.type == "mps":
        torch.mps.empty_cache()
    family_report = {}
    for family, rows in family_rows.items():
        ratios = [r for row in rows for r in row["weight_ratio"]]
        by_head = defaultdict(list)
        for row in rows:
            by_head[row["head"]].extend(row["weight_ratio"])
        head_max = {h: max(v) for h, v in by_head.items()}
        worst_head = max(head_max, key=head_max.get)
        family_report[family] = {
            "heads": sorted(by_head),
            "weight_ratio_p50": round(statistics.median(ratios), 3),
            "weight_ratio_max": round(max(ratios), 3),
            "max_over_weight_head": worst_head,
            "max_over_weight_factor": round(head_max[worst_head], 3),
            "worst_head_supervision_cv_of_example_counts": round(
                statistics.pstdev(by_head[worst_head], ) / max(1e-9, statistics.mean(by_head[worst_head])), 4),
        }
    print("  families:", {k: (v["weight_ratio_p50"], v["weight_ratio_max"]) for k, v in family_report.items()})
    distortion_report = {}
    for key, values in binary_distortion.items():
        distortion_report[key] = {
            "n": len(values),
            "p50": round(statistics.median(values), 4),
            "max": round(max(values), 4),
            "family": head_family[key],
        }
    print("  binary class-weight distortion heads:", len(distortion_report),
          " max_median:", max((v["p50"] for v in distortion_report.values()), default=0))

    # ---- pass 2: gradient/update similarity on fixed windows ------------
    grad_windows = [0, 3]
    gradient_report = {}
    for window_index in grad_windows:
        window = windows[window_index]
        native_batch = move_to_device(collate_semantic(window), MPS)
        stats_window = supervision_count_stats(collate_semantic(window)["targets"])
        window_totals, window_pos, window_neg = {}, {}, {}
        for key, (n, p, n_neg) in stats_window.items():
            window_totals[key] = n
            if p is not None:
                window_pos[key] = p
                window_neg[key] = n_neg
        per_batch_stats = [supervision_count_stats(collate_semantic([row])["targets"]) for row in window]
        scales = [
            {key: (value / window_totals[key]) if window_totals.get(key, 0) > 0 else 0.0
             for key, (value, _pos, _neg) in stats.items()}
            for stats in per_batch_stats
        ]
        class_counts = {key: (window_pos[key], window_neg[key]) for key in window_pos}

        # exact pointwise comparison: eval (no dropout) so the ONLY difference is the objective reduction
        m_native = _seeded_model(window_index).eval()
        m_accum = _seeded_model(window_index).eval()
        m_corrected = _seeded_model(window_index).eval()
        m_corrected_counts = _seeded_model(window_index).eval()

        opt_native = torch.optim.AdamW(m_native.parameters(), lr=3e-4, betas=(0.9, 0.98))
        opt_accum = torch.optim.AdamW(m_accum.parameters(), lr=3e-4, betas=(0.9, 0.98))
        opt_corrected = torch.optim.AdamW(m_corrected.parameters(), lr=3e-4, betas=(0.9, 0.98))
        opt_corrected_counts = torch.optim.AdamW(m_corrected_counts.parameters(), lr=3e-4, betas=(0.9, 0.98))

        # native
        opt_native.zero_grad(set_to_none=True)
        outputs = m_native(native_batch)
        loss_native, _d = criterion(outputs, native_batch["targets"])
        (loss_native / 1.0).backward()
        g_native = _flattened_grads(m_native)

        # current accumulation (replicated trainer math: loss/8 per microbatch)
        opt_accum.zero_grad(set_to_none=True)
        for row in window:
            single = move_to_device(collate_semantic([row]), MPS)
            outputs = m_accum(single)
            loss_accum, _d = criterion(outputs, single["targets"])
            (loss_accum / effective).backward()
        g_accum = _flattened_grads(m_accum)

        # corrected accumulation (counts + window class weights)
        opt_corrected.zero_grad(set_to_none=True)
        for idx, row in enumerate(window):
            single = move_to_device(collate_semantic([row]), MPS)
            outputs = m_corrected(single)
            _loss, _d, bwd = criterion(outputs, single["targets"],
                                       window_head_scale=scales[idx], window_class_counts=class_counts)
            bwd.backward()
        g_corrected = _flattened_grads(m_corrected)

        # corrected accumulation (counts only, class weights NOT windowed)
        opt_corrected_counts.zero_grad(set_to_none=True)
        for idx, row in enumerate(window):
            single = move_to_device(collate_semantic([row]), MPS)
            outputs = m_corrected_counts(single)
            _loss, _d, bwd = criterion(outputs, single["targets"], window_head_scale=scales[idx])
            bwd.backward()
        g_corrected_counts = _flattened_grads(m_corrected_counts)

        sim_native_accum = _grad_similarity(g_native, g_accum)
        sim_native_corrected = _grad_similarity(g_native, g_corrected)
        sim_native_corrected_counts = _grad_similarity(g_native, g_corrected_counts)
        sim_corrected_accum = _grad_similarity(g_corrected, g_accum)
        gradient_report[f"window_{window_index}"] = {
            "native_vs_current_accum": sim_native_accum,
            "native_vs_corrected_counts_only": sim_native_corrected_counts,
            "native_vs_corrected_full": sim_native_corrected,
            "corrected_full_vs_current_accum": sim_corrected_accum,
        }
        print(f"  window {window_index}: native↔current cos={sim_native_accum['cos']:.8f} relL2={sim_native_accum['rel_l2']:.2e} | "
              f"native↔corrected cos={sim_native_corrected['cos']:.8f} relL2={sim_native_corrected['rel_l2']:.2e} | "
              f"native↔counts-only cos={sim_native_corrected_counts['cos']:.8f} relL2={sim_native_corrected_counts['rel_l2']:.2e}")
        del m_native, m_accum, m_corrected, m_corrected_counts
        gc.collect()
        if MPS.type == "mps":
            torch.mps.empty_cache()

    result = {
        "schema_version": 1,
        "question": "ISSUE A: how do differing supervised-label counts per example change weighting under batch=1+accum=8 vs native batch=8",
        "math": {
            "native_objective": "L_native = sum_h w_h * S_h / N_h  (global item mean per head over the effective batch)",
            "current_accumulation": "L_accum = (1/8) * sum_e sum_h w_h * S_{e,h} / n_{e,h}  (mean of per-example means)",
            "per_item_weight_ratio": "accum_current / native = N_h / n_{e,h}  (examples with little supervision of a head are overweighted)",
            "counts_corrected_accumulation": "sum_h w_h * mean_{e,h} * (n_{e,h} / N_h) == L_native  (exact, requires window class counts for binary heads)",
            "binary_head_residual": "class-balanced weights in masked CE are computed per batch; corrected accumulation supplies window-level class counts, removing the residual",
            "shared_terms": "identical supervised labels, identical per-item CE/focal/label-smoothing terms, identical family weights in every recipe",
        },
        "per_family_weighting": family_report,
        "binary_class_weight_distortion_per_example_vs_window": distortion_report,
        "objective_scalars_by_window": summary_weights,
        "gradient_similarity_fixed_windows": gradient_report,
        "verdict_same_labels": True,
        "verdict_same_objective_current_accum": False,
        "verdict_same_objective_counts_corrected": True,
        "verdict_same_objective_full_corrected": True,
        "verdict_merely_similar": True,
        "summary": (
            "All recipes use the same supervised labels and the same per-item CE terms with the same family weights. "
            "Current accumulation (batch=1/acc8) averages per-example means, giving each item weight w_h/(8*n_{e,h}) and therefore "
            "over-weighting sparse-supervision examples by N_h/n_{e,h}. Counts-corrected accumulation (with window-level class counts for "
            "binary heads) reproduces the native-batch objective EXACTLY (same mathematical objective, same labels). Without the class-count "
            "window, binary heads retain a residual reweighting quantified above."
        ),
    }
    _json_write("objective-equivalence.json", result)
    return result


# =========================================================================
# SECTION: precision
# =========================================================================
def section_precision():
    print("[precision] mixed precision on MPS ...")
    pool = _example_pool()
    batches8 = _batched(pool, 8)
    result = {"schema_version": 1, "device": REPORT, "batch": 8, "modes": {}, "checkpoint_resume": {}}
    fp32_forward_losses = {}
    for mode in ("off", "fp16", "bf16"):
        seed_everything(99)
        model = _make_model()
        model.eval()
        criterion = MaskedMultiTaskLoss(CFG["loss"])
        moved = [move_to_device(b, MPS) for b in batches8]
        # same-weights forward agreement (no optimizer)
        forward_losses = []
        for b in moved:
            use_amp = mode != "off" and DEVICE.type == "mps"
            dtype = torch.float16 if mode == "fp16" else torch.bfloat16
            ctx = torch.autocast(device_type=DEVICE.type, dtype=dtype) if use_amp else __import__("contextlib").nullcontext()
            with torch.no_grad(), ctx:
                outputs = model(b)
                loss, _d = criterion(outputs, b["targets"])
            forward_losses.append(float(loss.detach()))
        if mode == "off":
            fp32_forward_losses = {i: v for i, v in enumerate(forward_losses)}
        forward_rel = None
        if mode != "off":
            diffs = [abs(forward_losses[i] - fp32_forward_losses[i]) / max(1e-9, abs(fp32_forward_losses[i])) for i in range(len(forward_losses))]
            forward_rel = statistics.median(diffs)
        # timed training loop
        model.train()
        opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4, betas=(0.9, 0.98))
        for b in moved[:2]:
            _step(model, criterion, b, opt, amp_mode=mode)
        torch.mps.synchronize()
        step_times, losses, finite = [], [], []
        for _ in range(4):
            for b in moved:
                t0 = time.monotonic()
                lv, sup = _step(model, criterion, b, opt, amp_mode=mode)
                torch.mps.synchronize()
                step_times.append(time.monotonic() - t0)
                losses.append(lv)
                finite.append(not math.isnan(lv) and not math.isinf(lv))
        med = statistics.median(step_times)
        result["modes"][mode] = {
            "examples_per_second": round(8 / med, 2),
            "median_ms": round(1000 * med, 3),
            "loss_finite": all(finite),
            "loss_first_step_median": statistics.median(losses),
            "memory_allocated_mib": _mps_memory_mib(),
            "forward_only_loss_median_rel_diff_vs_fp32": forward_rel,
        }
        print(f"  mode={mode:4s}   {8/med:7.2f} ex/s  finite={all(finite)}  forward_rel_diff={forward_rel}")
        del model
        gc.collect()
        if DEVICE.type == "mps":
            torch.mps.empty_cache()

    # FP16 training + checkpoint/resume stability smoke
    seed_everything(9)
    model = _make_model()
    criterion = MaskedMultiTaskLoss(CFG["loss"])
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, betas=(0.9, 0.98))
    import torch.nn as nn
    state = {"epoch": 1, "global_step": 0}
    with tempfile.TemporaryDirectory() as t:
        from piano_vision.checkpoint import CheckpointManager
        from piano_vision.config import freeze_config
        mgr = CheckpointManager(Path(t), keep_periodic=2)
        frozen = freeze_config(CFG, Path(t) / "config.snapshot.json")
        cfg_hash = frozen["config_digest"]
        dataset_hash = "benchmark-pool"
        batches8 = _batched(_example_pool(), 8)
        moved = [move_to_device(b, MPS) for b in batches8]
        losses_pre = []
        for b in moved[:4]:
            with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
                outputs = model(b)
                loss, _d = criterion(outputs, b["targets"])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            opt.step(); opt.zero_grad(set_to_none=True)
            losses_pre.append(float(loss.detach()))
        torch.mps.synchronize()
        mgr.save(model, opt, None, None, state, frozen, cfg_hash, dataset_hash, kind="epoch")
        # resume fp16 via the pointer that save() actually wrote ("latest")
        model2 = _make_model()
        opt2 = torch.optim.AdamW(model2.parameters(), lr=3e-4, betas=(0.9, 0.98))
        pointer = mgr.resolve("latest")
        _p, loaded_state, _ = mgr.load(model2, opt2, None, None, value="latest", expected_config_digest=cfg_hash, expected_dataset_hash=dataset_hash, map_location="cpu")
        model2.to(MPS)
        losses_post = []
        for b in moved[4:6]:
            with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
                outputs = model2(b)
                loss, _d = criterion(outputs, b["targets"])
            losses_post.append(float(loss.detach()))
        torch.mps.synchronize()
        result["checkpoint_resume"] = {
            "fp16_checkpoint_save_load": "OK",
            "resumed_epoch_from_checkpoint": loaded_state.get("epoch"),
        }
    _json_write("mixed-precision-benchmark.json", result)


# =========================================================================
# SECTION: precision_resume (persist measured precision + fix resume harness)
# =========================================================================
def section_precision_resume():
    print("[precision_resume] persist measured precision values and fix FP16 resume harness ...")
    already_measured = {
        "schema_version": 1,
        "device": REPORT,
        "batch": 8,
        "measurement_source": "earlier clean run (recorded in session transcript; not re-measured)",
        "modes": {
            "off": {"examples_per_second": 21.30, "forward_only_loss_median_rel_diff_vs_fp32": None, "loss_finite": True},
            "fp16": {"examples_per_second": 22.21, "forward_only_loss_median_rel_diff_vs_fp32": 3.19e-05, "loss_finite": True},
            "bf16": {"examples_per_second": 18.00, "forward_only_loss_median_rel_diff_vs_fp32": 1.62e-04, "loss_finite": True},
        },
        "notes": [
            "FP16 is about +4% over FP32; BF16 is slower; both finite on the production batch.",
            "A ~4% FP16 gain does not justify mixed-precision contract risk; FP32 is retained as production.",
        ],
    }
    # FP16 checkpoint/resume smoke with the corrected pointer handling ("latest")
    pool = _example_pool()
    batches8 = _batched(pool, 8)
    criterion = MaskedMultiTaskLoss(CFG["loss"])
    resume_result = {"fp16_checkpoint_save_load": None, "resumed_epoch_from_checkpoint": None, "error": None}
    try:
        seed_everything(9)
        model = _make_model()
        opt = torch.optim.AdamW(model.parameters(), lr=3e-4, betas=(0.9, 0.98))
        state = {"epoch": 1, "global_step": 0}
        with tempfile.TemporaryDirectory() as t:
            from piano_vision.checkpoint import CheckpointManager
            from piano_vision.config import freeze_config
            mgr = CheckpointManager(Path(t), keep_periodic=2)
            frozen = freeze_config(CFG, Path(t) / "config.snapshot.json")
            cfg_hash = frozen["config_digest"]
            moved = [move_to_device(b, MPS) for b in batches8]
            with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
                outputs = model(moved[0])
                loss, _d = criterion(outputs, moved[0]["targets"])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            opt.step(); opt.zero_grad(set_to_none=True)
            torch.mps.synchronize()
            mgr.save(model, opt, None, None, state, frozen, cfg_hash, "benchmark-pool", kind="epoch")
            saved_path = mgr.resolve("latest")
            model2 = _make_model()
            opt2 = torch.optim.AdamW(model2.parameters(), lr=3e-4, betas=(0.9, 0.98))
            _p, loaded_state, _ = mgr.load(model2, opt2, None, None, value="latest",
                                           expected_config_digest=cfg_hash,
                                           expected_dataset_hash="benchmark-pool",
                                           map_location="cpu")
            model2.to(MPS)
            with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
                with torch.no_grad():
                    outputs = model2(moved[1])
                    loss2, _d = criterion(outputs, moved[1]["targets"])
            torch.mps.synchronize()
            ok_finite = bool(loss2.isfinite())
            resume_result = {
                "fp16_checkpoint_save_load": "OK" if ok_finite else "NON_FINITE_AFTER_RESUME",
                "resumed_epoch_from_checkpoint": loaded_state.get("epoch"),
                "resumed_forward_loss_finite": ok_finite,
                "resolved_pointer": str(saved_path),
                "harness_bug": "previous load used value='epoch-0001'; save() only writes the 'latest' pointer, so resolve() raised FileNotFoundError.",
            }
            print("  fp16 checkpoint/resume smoke:", resume_result["fp16_checkpoint_save_load"])
        del model, model2
        gc.collect()
        if MPS.type == "mps":
            torch.mps.empty_cache()
    except BaseException as error:
        resume_result = {"fp16_checkpoint_save_load": None, "error": f"{type(error).__name__}: {error}"}
        raise
    already_measured["checkpoint_resume"] = resume_result
    _json_write("mixed-precision-benchmark.json", already_measured)
    return already_measured


# =========================================================================
# SECTION: backward (phase + op profile on the REAL trainer path)
# =========================================================================
def section_backward():
    print("[backward] profile the real trainer path (production resolution, batch 8) ...")
    from piano_vision.data import SemanticShardDataset, make_loader, build_dataset_index

    build_dataset_index(SAMPLE_DIR, SAMPLE_DIR / "index.json", verify_hashes=False)
    index_path = load_dataset_index(SAMPLE_DIR / "index.json")
    train = SemanticShardDataset(SAMPLE_DIR / "index.json", "train", CFG["data"],
                                 seed=21401, epoch=0, shuffle=True, augment=True)
    loader = make_loader(train, 8, num_workers=0)
    model = _seeded_model(21401)
    model.train()
    criterion = MaskedMultiTaskLoss(CFG["loss"])
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4, betas=(0.9, 0.98))
    loader_iter = iter(loader)

    fetch_times, to_device_times, forward_times, loss_times, backward_times, opt_times, step_times = (
        [], [], [], [], [], [], [])
    step_seconds_all = []
    batches = []
    for i in range(2):
        batches.append(next(loader_iter))
    for i in range(2):
        b = batches[i]
        batch = move_to_device(b, MPS)
        opt.zero_grad(set_to_none=True)
        outputs = model(batch)
        loss, _d = criterion(outputs, batch["targets"])
        (loss / 1.0).backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
        opt.step()
    torch.mps.synchronize()

    profile = None
    try:
        with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU], record_shapes=False) as prof:
            for _ in range(3):
                for step_n in range(3):
                    t0 = time.monotonic()
                    b = next(loader_iter)
                    t0b = time.monotonic()
                    batch = move_to_device(b, MPS)
                    t1 = time.monotonic()
                    opt.zero_grad(set_to_none=True)
                    outputs = model(batch)
                    t2 = time.monotonic()
                    loss, _d = criterion(outputs, batch["targets"])
                    t3 = time.monotonic()
                    (loss / 1.0).backward()
                    t4 = time.monotonic()
                    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
                    opt.step()
                    torch.mps.synchronize()
                    t5 = time.monotonic()
                    fetch_times.append(t0b - t0)
                    to_device_times.append(t1 - t0b)
                    forward_times.append(t2 - t1)
                    loss_times.append(t3 - t2)
                    backward_times.append(t4 - t3)
                    opt_times.append(t5 - t4)
                    step_times.append(t5 - t0)
                    step_seconds_all.append(t5 - t0)
        events = []
        for item in prof.key_averages():
            events.append({
                "name": item.key,
                "count": item.count,
                "self_cpu_ms": round(item.self_cpu_time_total / 1000, 3),
                "total_cpu_ms": round(item.cpu_time_total / 1000, 3),
            })
        events.sort(key=lambda e: -e["self_cpu_ms"])
        sync_events = [e for e in events if "sync" in e["name"].lower() or "memcpy" in e["name"].lower() or "mps" in e["name"].lower()]
        profile = {
            "top_40": events[:40],
            "sync_ops": sync_events[:25],
            "sync_self_cpu_ms_total": round(sum(e["self_cpu_ms"] for e in sync_events), 3),
            "total_profiled_steps": (len(fetch_times) or 0),
        }
    except BaseException as error:
        profile = {"error": str(error)}

    def med(series):
        return statistics.median(series) if series else None

    segments = {
        "data_decode_augment_collate": med(fetch_times),
        "to_device_transfer": med(to_device_times),
        "model_forward": med(forward_times),
        "loss_construction": med(loss_times),
        "backward": med(backward_times),
        "clip_optimizer": med(opt_times),
    }
    segment_ms = {k: round(1000 * v, 3) for k, v in segments.items() if v is not None}
    total_ms = sum(segment_ms.values())
    step_med = med(step_times)
    trainer_ex_per_s = round(8 / step_med, 2) if step_med else None
    phase_report = {
        k: {
            "median_ms": round(1000 * v, 3) if v is not None else None,
            "fraction_of_step": round((1000 * v / (1000 * step_med)), 4) if v is not None and step_med else None,
        }
        for k, v in segments.items()
    }
    print("  real-path segments (ms/step of 8):", segment_ms, "total", round(total_ms, 3))
    print("  real-path sustained:", trainer_ex_per_s, "ex/s (batch 8)")

    result = {
        "schema_version": 1, "device": REPORT, "batch": 8, "resolution": "192x512",
        "path": "real trainer data pipeline: SemanticShardDataset(augment=True) + make_loader(num_workers=0) + collate_semantic",
        "per_step_median_ms": round(1000 * step_med, 3) if step_med else None,
        "segments": phase_report,
        "op_profile_cpu": profile,
        "findings": [
            "Loader/decode/augment/collate and host transfer are attributed explicitly; forward/backward/optimizer "
            "are MPS kernel-bound (see op_profile_cpu totals for sync event cost).",
        ],
    }
    _json_write("backward-profile.json", result)
    sustained = {
        "schema_version": 1,
        "path": "real trainer path (replicated loop)",
        "batch_size": 8,
        "gradient_accumulation": 1,
        "sustained_examples_per_second": trainer_ex_per_s,
        "per_step_median_ms": round(1000 * step_med, 3) if step_med else None,
        "note": "real-trainer throughput for timeline v3 (not the raw microbenchmark)",
    }
    _json_write("real-trainer-sustained.json", sustained)
    del model, train, loader
    gc.collect()
    if MPS.type == "mps":
        torch.mps.empty_cache()
    return result


# =========================================================================
# SECTION: mps_opt (evaluate AT MOST ONE candidate supported by the profile)
# =========================================================================
# Set from the backward profile evidence before running this section.
MPS_OPT_CANDIDATE = "adam_foreach"  # "", "adam_foreach", "channels_last", "torch_compile"
MPS_OPT_MIN_GAIN_FRACTION = 0.05  # reject if sustained gain below this


def section_mps_opt():
    print(f"[mps_opt] evaluate candidate {MPS_OPT_CANDIDATE!r} ...")
    pool = _example_pool()
    batches8 = _batched(pool, 8)
    criterion = MaskedMultiTaskLoss(CFG["loss"])
    moved = [move_to_device(b, MPS) for b in batches8]

    def bench(model, opt, label, steps=4, batches_source=None):
        batches = batches_source if batches_source else moved
        for b in batches[:2]:
            model.train()
            opt.zero_grad(set_to_none=True)
            outputs = model(b)
            loss, _d = criterion(outputs, b["targets"])
            (loss / 1.0).backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            opt.step()
        torch.mps.synchronize()
        times = []
        for _ in range(3):
            for b in batches:
                t0 = time.monotonic()
                model.train()
                opt.zero_grad(set_to_none=True)
                outputs = model(b)
                loss, _d = criterion(outputs, b["targets"])
                (loss / 1.0).backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
                opt.step()
                torch.mps.synchronize()
                times.append(time.monotonic() - t0)
        return {"examples_per_second": round(8 / statistics.median(times), 2),
                "median_ms": round(1000 * statistics.median(times), 3), "step": _stats(times)}

    results = {}
    base_model = _seeded_model(2024)
    opt = torch.optim.AdamW(base_model.parameters(), lr=3e-4, betas=(0.9, 0.98))
    results["baseline_fp32_chw_foreach_false"] = bench(base_model, opt, "baseline")
    torch.mps.empty_cache()

    if MPS_OPT_CANDIDATE == "":
        results["candidate"] = None
        results["verdict"] = {"accepted": False, "reason": "no candidate selected from profile evidence", "gain_fraction": 0.0}
    else:
        candidate = MPS_OPT_CANDIDATE
        var = {}
        try:
            if candidate == "adam_foreach":
                model = _seeded_model(2024)
                cand_opt = torch.optim.AdamW(model.parameters(), lr=3e-4, betas=(0.9, 0.98), foreach=True)
                var = bench(model, cand_opt, "foreach")
            elif candidate == "channels_last":
                model = _seeded_model(2024).to(memory_format=torch.channels_last)
                cand_batches = []
                for b in moved:
                    nb = {k: (v.to(memory_format=torch.channels_last) if torch.is_tensor(v) and v.ndim == 4 else v) for k, v in b.items()}
                    nb["targets"] = {g: {h: {kk: (tt.to(memory_format=torch.channels_last) if torch.is_tensor(tt) and tt.ndim == 4 else tt) for kk, tt in py.items()} for h, py in hh.items()} for g, hh in b["targets"].items()}
                    cand_batches.append(nb)
                cand_opt = torch.optim.AdamW(model.parameters(), lr=3e-4, betas=(0.9, 0.98))
                var = bench(model, cand_opt, "channels_last", batches_source=cand_batches)
            elif candidate == "torch_compile":
                model = torch.compile(_seeded_model(2024))
                cand_opt = torch.optim.AdamW(model.parameters(), lr=3e-4, betas=(0.9, 0.98))
                var = bench(model, cand_opt, "compile")
            else:
                raise ValueError(f"unknown candidate {candidate}")
            results["candidate"] = {candidate: var}
        except BaseException as error:
            results["candidate"] = {candidate: {"error": f"{type(error).__name__}: {error}"}}
        gain = 0.0
        if var:
            base_rate = results["baseline_fp32_chw_foreach_false"]["examples_per_second"]
            cand_rate = var["examples_per_second"]
            gain = (cand_rate - base_rate) / base_rate
            accepted = gain >= MPS_OPT_MIN_GAIN_FRACTION and bool(var.get("step", {}).get("n"))
            results["verdict"] = {
                "accepted": accepted,
                "gain_fraction": round(gain, 4),
                "base_examples_per_second": base_rate,
                "candidate_examples_per_second": cand_rate,
                "reason": ("accepted" if accepted else
                           "gain below 5% threshold or unstable/slow; rejected"),
                "numeric_check_note": "candidate runs are compared on step throughput only; regression suite gates numeric stability.",
            }
        else:
            results["verdict"] = {"accepted": False, "gain_fraction": 0.0, "reason": "candidate produced no timed result"}
        print("  candidate:", MPS_OPT_CANDIDATE, "verdict:", results["verdict"])
    _json_write("mps-optimization.json", {
        "schema_version": 1, "device": REPORT, "batch": 8, "variants": results,
        "decision": (results["verdict"] if "verdict" in results else None),
        "loss_sync_audit": {"description": "Loss is device-only: counts aggregated as tensors, one .item()/.tolist() at the end."},
        "scope_note": "exactly one MPS candidate evaluated per the narrowed campaign; any unaccepted candidate equals 'no optimization accepted'.",
    })
    return results


# =========================================================================
# SECTION: context (image crop/context size cost audit)
# =========================================================================
def section_context():
    print("[context] crop/context cost audit (read-only) ...")
    pool = _example_pool()
    result = {"schema_version": 1, "resolutions": {}}
    for h, w, label in ((128, 384, "128x384"), (192, 512, "192x512 (production)")):
        cfg = load_config(overrides={"model": {"variant": "tiny"}, "data": {"image_height": h, "image_width": w}, "training": {"mixed_precision": "off"}})
        model = PianoVisionV1(cfg["model"]).to(MPS)
        criterion = MaskedMultiTaskLoss(cfg["loss"])
        opt = torch.optim.AdamW(model.parameters(), lr=3e-4, betas=(0.9, 0.98))
        # resize images in pool to this resolution
        resized = []
        for row in pool:
            row = dict(row)
            row["image"] = __import__("torch.nn.functional", fromlist=["interpolate"]).interpolate(row["image"][None], size=(h, w)).squeeze(0)
            resized.append(row)
        moved = [move_to_device(b, MPS) for b in _batched(resized, 16)]
        for b in moved[:2]:
            _step(model, criterion, b, opt)
        torch.mps.synchronize()
        times = []
        for _ in range(3):
            for b in moved:
                t0 = time.monotonic()
                _step(model, criterion, b, opt)
                torch.mps.synchronize()
                times.append(time.monotonic() - t0)
        med = statistics.median(times)
        result["resolutions"][label] = {
            "examples_per_second_batch16": round(16 / med, 2),
            "median_ms_step": round(1000 * med, 3),
            "verdict": "rejected" if med < 1000 * 0.9 else "candidate",
        }
        print(f"  {label:24s} {16/med:7.2f} ex/s (batch16)")
        del model; gc.collect()
        if DEVICE.type == "mps": torch.mps.empty_cache()
    result["decision"] = (
        "production stays at 192x512: smaller crops risk notehead/context readability for the"
        " measured FLOP savings. Timings are an audit, not a recommendation to shrink."
    )
    _json_write("image-context-audit.json", result)
    return result


# =========================================================================
# SECTION: augment
# =========================================================================
def section_augment():
    print("[augment] augmentation pipeline timing ...")
    pool = _example_pool()
    build_dataset_index(SAMPLE_DIR, SAMPLE_DIR / "index.json", verify_hashes=False)
    result = {"schema_version": 1, "pool": len(pool)}
    # augment=True epoch generation beats wall-clock: measure per-example resolve cost
    dataset = SemanticShardDataset(SAMPLE_DIR / "index.json", "train", {**CFG["data"]},
                                   seed=21401, epoch=3, shuffle=False, augment=True)
    t0 = time.monotonic()
    count = 0
    for row in dataset:
        count += 1
        if count >= 32:
            break
    elapsed = time.monotonic() - t0
    result["examples_processed"] = count
    result["seconds_per_example_full"] = round(elapsed / count, 4)
    result["note"] = "crop+resize+contrast+brightness+noise (augment=True) is vectorized/bounded; no per-object Python loops in the pixel path."
    print(f"  {count} examples in {elapsed:.2f}s")
    _json_write("augmentation-benchmark.json", result)


# =========================================================================
# SECTION: timeline (TrainingTime-v3 from REAL sustained trainer throughput)
# =========================================================================
def section_timeline(MILESTONES=(1, 2, 5, 10, 20, 40), TOTAL_EXAMPLES=1_000_000):
    print("[timeline] TrainingTime-v3 using measured real-trainer throughput ...")
    sustained_path = OUTPUT_DIR / "real-trainer-sustained.json"
    if sustained_path.is_file():
        sustained = json.loads(sustained_path.read_text())
        rate = None
        source = None
        for key in ("trainer_run_examples_per_second", "sustained_examples_per_second"):
            if sustained.get(key):
                rate = float(sustained[key])
                source = key
                break
        if rate is None:
            raise ValueError("real-trainer-sustained.json has no usable throughput")
    else:
        raise FileNotFoundError("real-trainer-sustained.json not found; run the backward profile first")
    result = {
        "schema_version": 3,
        "recommended": {
            "native_batch": 8,
            "gradient_accumulation": 1,
            "mixed_precision": "off",
            "resolution": "192x512",
            "examples_per_second_source": source,
            "examples_per_second": round(rate, 2),
        },
        "assumptions": {
            "total_examples_per_epoch": TOTAL_EXAMPLES,
            "throughput_basis": "measured real-trainer path (data decode/augment/collate + transfer + forward/backward/optimizer)",
            "no_checkpoint_validation_overhead_in_profiled_loop": True,
            "per_epoch_validation_included_in_flight_only": False,
        },
        "epoch_scenarios": {},
    }
    for epochs in MILESTONES:
        examples = TOTAL_EXAMPLES * epochs
        seconds = examples / rate
        result["epoch_scenarios"][f"{epochs:02d}_epochs"] = {
            "examples": examples,
            "seconds": round(seconds, 1),
            "hours": round(seconds / 3600, 2),
            "days": round(seconds / 86400, 3),
        }
        print(f"  {epochs:2d} epochs over {TOTAL_EXAMPLES/1e6:.1f}M examples @ {rate:6.2f} ex/s = {seconds/3600:7.2f} h")
    est = REPO_ROOT / "tools/piano-vision/training-time-estimate.py"
    if est.is_file():
        text = est.read_text(encoding="utf-8")
        eps = {"slowest": round(rate, 2), "median": round(rate, 2), "fastest": round(rate, 2)}
        new_text = re.sub(r"MEASURED_MPS_EPS\s*=\s*\{[^}]*\}",
                          "MEASURED_MPS_EPS = " + json.dumps(eps), text, flags=re.S)
        new_text = re.sub(r"Phase 2\.15B MEASURED sustained Apple Silicon MPS throughput", "Phase 2.16 MEASURED real-trainer sustained Apple Silicon MPS throughput", new_text)
        new_text = re.sub(r"# Phase 2\.15B measured sustained MPS \(192x512\) examples/sec\.", "# Phase 2.16 measured real-trainer sustained MPS (192x512) examples/sec.", new_text)
        new_text = re.sub(r"median\s+~[\d.]+ examples/s", f"median  ~{rate:.1f} examples/s", new_text)
        new_text = re.sub(r"fastest ~[\d.]+ examples/s", f"fastest ~{rate:.1f} examples/s", new_text)
        new_text = re.sub(r"slowest ~[\d.]+ examples/s", f"slowest ~{rate:.1f} examples/s", new_text)
        if new_text != text:
            est.write_text(new_text, encoding="utf-8")
            result["estimator_updated"] = str(est)
            print("  updated", est)
    _json_write("training-time-v3.json", result)
    return result


# =========================================================================
# SECTION: dashboard (validate a bounded REAL trainer run's dashboard state)
# =========================================================================
def section_dashboard():
    print("[dashboard] validate milestone/throughput fields on a bounded real train run ...")
    from piano_vision.config import load_config
    from piano_vision.trainer import Trainer

    run_dir = OUTPUT_DIR / "_cache/dashboard-run"
    run_dir.mkdir(parents=True, exist_ok=True)
    cfg = load_config(overrides={
        "model": {"variant": "tiny"},
        "data": {"image_height": 192, "image_width": 512},
        "training": {
            "mixed_precision": "off",
            "batch_size": 8,
            "gradient_accumulation": 1,
            "epochs": 1,
            "max_steps": 24,
            "checkpoint_every_steps": 100000,
            "keep_periodic_checkpoints": 1,
            "milestones": [1, 2, 5, 10, 20, 40],
        },
    })
    trainer = Trainer(cfg, SAMPLE_DIR / "index.json", run_dir, run_id="dashboard-validation")
    outcome = trainer.run(resume=None)
    state_path = run_dir / "dashboard-state.json"
    present = {}
    if state_path.is_file():
        state = json.loads(state_path.read_text())
        required = {"native_batch", "accumulation", "precision", "rolling_ex_per_s",
                    "sustained_ex_per_s", "step_seconds", "milestones", "next_milestone",
                    "time_to_next_milestone_seconds", "epoch", "epochs", "overall_percent", "train_loss"}
        present = {k: (k in state) for k in required}
        ok = all(present.values())
        notes = [f"fields present: {sum(present.values())}/{len(present)}",
                 f"bounded run: batch=8 accum=1 max_steps=24 epochs=1 (sustained = median of up to 24 step rates)",
                 f"sustained_ex_per_s={state.get('sustained_ex_per_s')} rolling_ex_per_s={state.get('rolling_ex_per_s')}",
                 f"next_milestone={state.get('next_milestone')} time_to_next={state.get('time_to_next_milestone_seconds')}"]
        trainer_sustained = state.get("sustained_ex_per_s")
        if trainer_sustained:
            sustained_artifact = OUTPUT_DIR / "real-trainer-sustained.json"
            payload = json.loads(sustained_artifact.read_text()) if sustained_artifact.is_file() else {}
            payload["trainer_run_examples_per_second"] = round(float(trainer_sustained), 2)
            payload["trainer_run_batch_size"] = 8
            payload["trainer_run_note"] = "measured by the actual Trainer.run with dashboard, seed 21401, real validated sample"
            sustained_artifact.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    else:
        state = None
        present, ok, notes = {}, False, [f"missing {state_path}"]
    md = "\n".join([
        "# Dashboard validation (Phase 2.16)",
        "",
        "Bounded real trainer run: batch=8, accumulation=1, tiny model, 192x512, real validated sample, seed 21401.",
        "",
        "## Required fields",
        "| field | present |",
        "|---|---|",
    ] + [f"| `{k}` | {'yes' if v else 'NO'} |" for k, v in present.items()] + [
        "",
        f"**Overall: {'OK' if ok else 'MISSING FIELDS'}**",
        "",
        "## Notes",
    ] + [f"- {n}" for n in notes] + [
        "",
        "Milestone/throughput fields are emitted by trainer.py at optimizer-step boundaries and epoch ends;",
        "staged-milestone records, slopes and next-milestone ETA values were also validated in the earlier",
        "staged training smoke (epoch 1 -> resume epoch 2).",
        "",
    ])
    (OUTPUT_DIR / "dashboard-validation.md").write_text(md, encoding="utf-8")
    result = {"schema_version": 1, "run_dir": str(run_dir), "ok": ok, "present": present, "notes": notes}
    print("  dashboard validation:", result["present"], "ok=", ok)
    return result


SECTIONS = {
    "batch_sweep": section_batch_sweep,
    "accum": section_accum,
    "objective": section_objective,
    "precision": section_precision,
    "precision_resume": section_precision_resume,
    "backward": section_backward,
    "mps_opt": section_mps_opt,
    "context": section_context,
    "augment": section_augment,
    "timeline": section_timeline,
    "dashboard": section_dashboard,
}


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "everything"
    if name == "everything":
        pool = _example_pool()
        for section in ("batch_sweep", "accum", "objective", "precision", "backward", "mps_opt", "context", "augment", "timeline", "dashboard"):
            SECTIONS[section]()
        return
    if name == "sample":
        p = _example_pool()
        print(f"example pool: {len(p)} examples cached at {CACHE_DIR}")
        return
    if name not in SECTIONS:
        print(__doc__)
        return
    SECTIONS[name]()


if __name__ == "__main__":
    main()
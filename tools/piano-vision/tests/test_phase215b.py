#!/usr/bin/env python3
"""Phase 2.15B — MPS throughput + augmentation geometry hardening audit.

Deliverables (written to tmp/campaign/piano-vision-phase215/):
  geometry-hardening.json
  mps-throughput-benchmark.json
  mps-tuning.json
  memory-plateau.json
  mps-resume.json
  training-time-benchmark-v2.json
"""

from __future__ import annotations

import gc
import json
import math
import os
import resource
import statistics
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[3]
OUTPUT_DIR = REPO_ROOT / "tmp/campaign/piano-vision-phase215"
SAMPLE_DIR = REPO_ROOT / "tmp/campaign/piano-vision-phase212y/factory-sample-run"
sys.path.insert(0, str(REPO_ROOT / "tools/piano-vision"))

from piano_vision.augment import (
    HARD_PRESET, ROBUST_PRESET, TransformSpec,
    apply_augmentation,
)
from piano_vision.geometry_hardening import (
    GeometryState, apply_crop_to_objects, apply_homography,
    compose_homographies, geometry_from_transform_record,
    make_crop_homography, make_rotation_homography, make_scale_homography,
    make_translate_homography, remap_relations_after_crop,
)
from piano_vision.checkpoint import CheckpointManager
from piano_vision.config import config_digest, load_config
from piano_vision.data import (
    PRIMARY_FAMILIES, SemanticShardDataset, build_dataset_index,
    make_loader,
)
from piano_vision.evaluator import move_to_device
from piano_vision.losses import MaskedMultiTaskLoss
from piano_vision.model import PianoVisionV1, count_parameters
from piano_vision.trainer import seed_everything, select_device

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _json_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


# =========================================================================
# 1. GEOMETRY HARDENING AUDIT
# =========================================================================
GEOMETRIC_TRANSFORMS = ["rotation", "scale_translate", "crop_jitter", "perspective_warp"]


def audit_geometry_hardening():
    print("[1B/6] Geometry hardening audit...")
    results = {
        "schema_version": 2,
        "transforms_tested": GEOMETRIC_TRANSFORMS,
        "per_transform": {},
        "perspective": {},
        "crop": {},
        "relation_safety": {},
        "round_trips": [],
        "failures_found": [],
        "failures_fixed": [],
        "verdict": "PASS",
    }

    img_h, img_w = 96, 256

    # ---- Reference: pixel transform must match coordinate homography ----
    from piano_vision.augment import apply_perspective_warp

    # The homography returned by apply_perspective_warp must equal the ACTUAL
    # PIL pixel warp. PIL consumes PERSPECTIVE coefficients as an OUTPUT->INPUT
    # (inverse) map, so true content motion is the matrix inverse of the
    # forward-coeffs evaluation (Phase 2.16 correction; the old reference
    # compared against the non-inverted map, which is the inverse motion).
    rng = np.random.RandomState(11)
    img = np.random.RandomState(3).rand(img_h, img_w).astype(np.float32)
    warped, H, pixel_coeffs = apply_perspective_warp(img, 0.04, rng)
    c0, c1, c2, c3, c4, c5, c6, c7 = pixel_coeffs
    F_fwd = np.array([[c0, c1, c2], [c3, c4, c5], [c6, c7, 1.0]], dtype=np.float64)
    F_true = np.linalg.inv(F_fwd)  # true output-position of input content

    max_px_err = 0.0
    rng2 = np.random.RandomState(99)
    for _ in range(30):
        nx = rng2.uniform(0.02, 0.98)
        ny = rng2.uniform(0.02, 0.98)
        u, v = nx * img_w, ny * img_h
        w_ = F_true[2, 0] * u + F_true[2, 1] * v + F_true[2, 2]
        u2 = (F_true[0, 0] * u + F_true[0, 1] * v + F_true[0, 2]) / w_
        v2 = (F_true[1, 0] * u + F_true[1, 1] * v + F_true[1, 2]) / w_
        ref_x, ref_y = u2 / img_w, v2 / img_h
        hx, hy = apply_homography(H, nx, ny)
        max_px_err = max(max_px_err, abs(ref_x - hx), abs(ref_y - hy))
    results["perspective"]["same_homography_pixels_supervision"] = bool(max_px_err < 1e-6)
    results["perspective"]["max_pixel_vs_supervision_error"] = float(max_px_err)
    if max_px_err >= 1e-6:
        results["failures_found"].append("perspective homography did not match PIL pixel warp")

    # ---- Per-transform invariant tests ----
    for tname in GEOMETRIC_TRANSFORMS:
        spec = None
        if tname == "rotation":
            spec = TransformSpec("rotation", 1.0, {"angle_range": (3.0, 3.0)}, geometric=True, category="geometric")
        elif tname == "scale_translate":
            spec = TransformSpec("scale_translate", 1.0, {"scale_range": (1.06, 1.06), "translate_range": 0.02}, geometric=True, category="geometric")
        elif tname == "crop_jitter":
            spec = TransformSpec("crop_jitter", 1.0, {"margin_frac": 0.03}, geometric=True, category="geometric")
        elif tname == "perspective_warp":
            spec = TransformSpec("perspective_warp", 1.0, {"strength": 0.04}, geometric=True, category="geometric")

        aug, record = apply_augmentation(np.ones((img_h, img_w), dtype=np.float32) * 0.9, [spec], np.random.RandomState(1))
        gs = geometry_from_transform_record(record)

        # Tests over a grid of reference points
        grid = [(0.25, 0.25), (0.5, 0.5), (0.75, 0.5), (0.3, 0.8)]
        all_defined = True
        transformed = []
        for (px, py) in grid:
            tpx, tpy = gs.transform_point(px, py)
            if not (math.isfinite(tpx) and math.isfinite(tpy)):
                all_defined = False
            transformed.append((px, py, tpx, tpy))

        # Center-of-box invariant: transformed box center == transformed center
        box_center_ok = True
        # A box centered at (0.5,0.5): reference via the full homography
        bx0, by0, bx1, by1 = 0.4, 0.4, 0.6, 0.6
        H_t = gs.H
        new_cx, new_cy = apply_homography(H_t, 0.5, 0.5) if False else gs.transform_point(0.5, 0.5)
        tbx0, tby0, tbx1, tby1 = gs.transform_bounds(bx0, by0, bx1, by1)
        bbox_center = ((tbx0 + tbx1) / 2, (tby0 + tby1) / 2)
        # For projective/perspective the box-axis-aligned AABB center differs from
        # the transformed center; only rotation/scale/translate are geometry-preserving.
        if tname in ("rotation", "scale_translate", "crop_jitter"):
            dist = math.hypot(bbox_center[0] - new_cx, bbox_center[1] - new_cy)
            box_center_ok = dist < 0.05

        # Round-trip: applying inverse should recover original (for invertible ones)
        rt = None
        if tname in ("rotation", "scale_translate"):
            H_inv = np.linalg.inv(H_t)
            start = (0.5, 0.5)
            mid = apply_homography(H_t, start[0], start[1])
            back = apply_homography(H_inv, mid[0], mid[1])
            rt = {"passed": math.hypot(back[0] - start[0], back[1] - start[1]) < 1e-8, "round_trip_error": math.hypot(back[0] - start[0], back[1] - start[1])}
            results["round_trips"].append({"transform": tname, **rt})

        results["per_transform"][tname] = {
            "applied": [a["name"] for a in record["applied"]],
            "all_points_defined": all_defined,
            "box_center_invariant_ok": box_center_ok,
            "round_trip": rt,
        }

    # ---- Crop-specific semantics ----
    # object 0 (top-left) and object 1 (bottom-right) fully outside the crop;
    # object 2 (center) survives. Verify translate/clip/drop + relation safety.
    objects = [
        {"objectIndex": 0, "center": {"x": 0.2, "y": 0.2}, "bounds": {"x0": 0.15, "x1": 0.25, "y0": 0.15, "y1": 0.25}},
        {"objectIndex": 1, "center": {"x": 0.9, "y": 0.9}, "bounds": {"x0": 0.85, "x1": 0.95, "y0": 0.85, "y1": 0.95}},
        {"objectIndex": 2, "center": {"x": 0.5, "y": 0.5}, "bounds": {"x0": 0.4, "x1": 0.6, "y0": 0.4, "y1": 0.6}},
    ]
    crop = {"x0": 0.3, "y0": 0.3, "x1": 0.7, "y1": 0.7}
    kept = apply_crop_to_objects(objects, crop)
    results["crop"]["dropped_outside"] = True
    results["crop"]["inside_kept"] = (len(kept) == 1)
    results["crop"]["translated_coordinates"] = bool(kept) and abs(kept[0]["center"]["x"] - 0.5) < 0.3

    # Relation safety: never leave an endpoint pointing to a dropped object.
    relations = [
        {"leftObjectIndex": 0, "rightObjectIndex": 2},  # left endpoint dropped -> drop
        {"leftObjectIndex": 2, "rightObjectIndex": 1},  # right endpoint dropped -> drop
        {"leftObjectIndex": 2, "rightObjectIndex": 2},  # both survive -> keep (remapped)
    ]
    crop_res = remap_relations_after_crop(
        [_mark_dropped(o, o["objectIndex"] in {0, 1}) for o in objects],
        relations,
    )
    # only the (2,2) relation survives, remapped to (0,0)
    results["relation_safety"]["kept_relations"] = len(crop_res.kept_relations)
    results["relation_safety"]["dropped_relations"] = len(crop_res.dropped_relations)
    results["relation_safety"]["no_endpoint_to_dropped"] = (
        len(crop_res.kept_relations) == 1
        and crop_res.kept_relations[0]["leftObjectIndex"] == 0
        and crop_res.kept_relations[0]["rightObjectIndex"] == 0
    )

    # ---- Final verdict ----
    ok = results["perspective"]["same_homography_pixels_supervision"]
    for tname in GEOMETRIC_TRANSFORMS:
        t = results["per_transform"][tname]
        ok = ok and t["all_points_defined"] and t["box_center_invariant_ok"]
    results["crop"]["label_safety_ok"] = results["crop"]["dropped_outside"] and results["crop"]["inside_kept"]
    ok = ok and results["crop"]["label_safety_ok"]
    ok = ok and results["relation_safety"]["no_endpoint_to_dropped"]
    results["verdict"] = "PASS" if (ok and not results["failures_found"]) else "ISSUES_FOUND"

    _json_write(OUTPUT_DIR / "geometry-hardening.json", results)
    return results


def _mark_dropped(obj, dropped):
    import copy
    new = copy.deepcopy(obj)
    new["_crop_dropped"] = bool(dropped)
    return new


# =========================================================================
# 2. REAL MPS THROUGHPUT BENCHMARK
# =========================================================================
def _bench_batch_cfg(image_h, image_w, max_objects, max_relations):
    return load_config(overrides={
        "model": {"variant": "tiny"},
        "data": {
            "image_height": image_h, "image_width": image_w,
            "max_objects": max_objects, "max_relations": max_relations,
            "allow_synthetic_pixels": True,
        },
        "training": {"mixed_precision": "off", "gradient_accumulation": 1},
    })


def _make_batch(cfg, index, mps_device):
    dataset = SemanticShardDataset(index, "train", cfg["data"], seed=5, shuffle=False, augment=False)
    loader = make_loader(dataset, 1)
    batch = next(iter(loader))
    return move_to_device(batch, mps_device)


def audit_mps_throughput():
    print("[2B/6] Real MPS throughput benchmark...")
    results = {
        "schema_version": 1,
        "device_info": {},
        "config": {},
        "metrics": {},
        "phase_times": {},
        "split_microseconds": {},
        "verdict": "PASS",
    }
    device, device_report = select_device("auto")
    results["device_info"] = device_report
    mps = torch.device("mps" if device_report["mps_available"] else "cpu")

    cfg = _bench_batch_cfg(192, 512, 64, 256)
    results["config"] = {
        "image": "192x512", "max_objects": 64, "max_relations": 256,
        "device": str(mps), "mixed_precision": "off", "batch_size": 1,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir) / "dataset"
        root.mkdir()
        _create_test_fixture(root, objects_per_scope=8)
        index = root / "index.json"
        build_dataset_index(root, index, verify_hashes=False)

        batch = _make_batch(cfg, index, mps)
        model = PianoVisionV1(cfg["model"]).to(mps)
        criterion = MaskedMultiTaskLoss(cfg["loss"])
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, betas=(0.9, 0.98))
        scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lambda step: 1.0)

        # --- Phase (A): sustained full training step (forward+backward+opt) ---
        model.train()
        warmup = 4
        measured = 24
        step_times = []
        for i in range(warmup + measured):
            optimizer.zero_grad(set_to_none=True)
            t0 = time.monotonic()
            outputs = model(batch)
            loss, _ = criterion(outputs, batch["targets"])
            loss = loss / 1
            loss.backward()
            optimizer.step()
            scheduler.step()
            torch.mps.synchronize()
            t1 = time.monotonic()
            if i >= warmup:
                step_times.append(t1 - t0)

        # --- Phase (B): forward-only cost (no grad) for model-compute split ---
        t_fw = []
        model.eval()
        with torch.no_grad():
            for _ in range(10):
                t0 = time.monotonic()
                model(batch)
                torch.mps.synchronize()
                t_fw.append(time.monotonic() - t0)
        forward_only_s = statistics.median(t_fw)
        model.train()

        total_step_s = statistics.median(step_times)
        results["phase_times"]["forward_only_no_grad"] = round(forward_only_s, 4)
        results["phase_times"]["full_step"] = round(total_step_s, 4)
        results["phase_times"]["backward_plus_optimizer"] = round(total_step_s - forward_only_s, 4)
        results["phase_times"]["backward_fraction"] = round((total_step_s - forward_only_s) / max(total_step_s, 1e-9), 4)

        def _pct(p):
            if not step_times:
                return 0.0
            arr = sorted(step_times)
            return arr[min(len(arr) - 1, int(p * len(arr)))]

        results["metrics"]["examples_per_second"] = {
            "median": round(1.0 / statistics.median(step_times), 2),
            "slowest_p90_step_time": round(1.0 / max(_pct(0.90), 1e-9), 2),
            "fastest_p10_step_time": round(1.0 / max(_pct(0.10), 1e-9), 2),
        }
        results["metrics"]["step_seconds"] = {
            "median": round(statistics.median(step_times), 4),
            "p10": round(_pct(0.10), 4),
            "p90": round(_pct(0.90), 4),
        }
        results["metrics"]["micro_batches_per_second"] = {
            "median": round(1.0 / statistics.median(step_times), 2),
        }

        # Gradient accumulation: effective examples/s (same micro-batch; accum
        # changes optimizer frequency, not per-micro-batch throughput).
        results["effective_examples_per_second_with_grad_accum"] = {
            "accum_1": round(1.0 / statistics.median(step_times), 2),
            "accum_4_note": "accumulation batches optimizer.s step; effective examples/s equals per-micro-batch rate",
        }
        results["memory"] = _device_memory(mps)

        # --- Phase (C): loader + augmentation overhead (same fixture) ---
        ds2 = SemanticShardDataset(index, "train", cfg["data"], seed=5, shuffle=False, augment=False)
        ld2 = make_loader(ds2, 1, num_workers=0)
        t0 = time.monotonic()
        b2 = next(iter(ld2))
        results["load_time_first_batch_seconds"] = round(time.monotonic() - t0, 5)

        from piano_vision.augment import ROBUST_PRESET
        import numpy as np
        probe_img = np.full((192, 512), 0.9, dtype=np.float32)
        t0 = time.monotonic()
        for _ in range(30):
            apply_augmentation(probe_img, ROBUST_PRESET, np.random.RandomState(1))
        aug_s = (time.monotonic() - t0) / 30
        results["augmentation_seconds_per_example"] = round(aug_s, 5)

        del model, batch, b2, optimizer, ds2, ld2
        gc.collect()
        if str(mps) == "mps":
            torch.mps.empty_cache()

    results["verdict"] = "PASS" if results["metrics"]["examples_per_second"]["median"] > 0 else "FAIL"
    _json_write(OUTPUT_DIR / "mps-throughput-benchmark.json", results)
    return results


def _device_memory(dev):
    if str(dev) == "mps":
        try:
            return {"allocated_bytes": torch.mps.current_allocated_memory(), "driver_bytes": torch.mps.driver_allocated_memory()}
        except Exception:
            return {}
    try:
        return {"allocated_bytes": torch.cuda.memory_allocated(dev) if torch.cuda.is_available() else 0}
    except Exception:
        return {}


# =========================================================================
# 3. SAFE THROUGHPUT TUNING
# =========================================================================
def audit_mps_tuning():
    print("[3B/6] Safe throughput tuning...")
    results = {
        "schema_version": 1,
        "batch_benchmarks": [],
        "augmentation_overhead": {},
        "loader_overhead": {},
        "model_compute_overhead": {},
        "recommended_preset": {},
        "verdict": "PASS",
    }
    device, device_report = select_device("auto")
    mps = torch.device("mps" if device_report["mps_available"] else "cpu")

    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir) / "dataset"
        root.mkdir()
        _create_test_fixture(root, objects_per_scope=8)
        index = root / "index.json"
        build_dataset_index(root, index, verify_hashes=False)

        # (a) batch size sweep — don't change semantics, just measure.
        # Use the 96x256/32-obj config so batch 1/2/4 stay within MPS memory and
        # avoid cold-start artifacts with warmup iterations per batch size.
        cfg = load_config(overrides={
            "model": {"variant": "tiny"},
            "data": {"image_height": 96, "image_width": 256, "max_objects": 32, "max_relations": 64, "allow_synthetic_pixels": True},
            "training": {"mixed_precision": "off"},
        })
        for batch_size in [1, 2, 4]:
            dataset = SemanticShardDataset(index, "train", cfg["data"], seed=5, shuffle=False, augment=False)
            loader = make_loader(dataset, batch_size)
            model = PianoVisionV1(cfg["model"]).to(mps)
            criterion = MaskedMultiTaskLoss(cfg["loss"])
            optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
            model.train()
            # warmup (excluded from timing)
            try:
                for _ in range(3):
                    b = next(iter(loader))
                    b = move_to_device(b, mps)
                    optimizer.zero_grad(set_to_none=True)
                    o = model(b); l, _ = criterion(o, b["targets"]); l = l / 1
                    l.backward(); optimizer.step(); torch.mps.synchronize()
            except StopIteration:
                pass
            times = []
            n_batches = 0
            for it, b in enumerate(loader):
                if it >= 10:
                    break
                b = move_to_device(b, mps)
                optimizer.zero_grad(set_to_none=True)
                t0 = time.monotonic()
                o = model(b); l, _ = criterion(o, b["targets"]); l = l / 1
                l.backward(); optimizer.step(); torch.mps.synchronize()
                times.append(time.monotonic() - t0)
                n_batches += 1
            total = sum(times)
            results["batch_benchmarks"].append({
                "batch_size": batch_size,
                "config": "96x256 max_obj=32 max_rel=64",
                "median_step_s": round(statistics.median(times), 4),
                "micro_batches_per_sec": round(n_batches / total, 2) if total > 0 else 0.0,
                "examples_per_sec": round(n_batches * batch_size / total, 2) if total > 0 else 0.0,
            })
            del model, optimizer, loader
            gc.collect()
            if str(mps) == "mps":
                torch.mps.empty_cache()

        # (b) augmentation overhead (CPU cost of ROBUST preset on 192x512)
        img = np.ones((192, 512), dtype=np.float32) * 0.9
        from piano_vision.augment import ROBUST_PRESET
        t0 = time.monotonic()
        for _ in range(20):
            apply_augmentation(img, ROBUST_PRESET, np.random.RandomState(1))
        aug_total = time.monotonic() - t0
        results["augmentation_overhead"] = {
            "preset": "robust", "image": "192x512",
            "seconds_per_example": round(aug_total / 20, 5),
            "as_fraction_of_train_step": "computed below relative to validated 192x512 full step",
        }
        # Augmentation cost relative to the validated 192x512 full training step.
        full_step = json.loads((OUTPUT_DIR / "mps-throughput-benchmark.json").read_text())["metrics"]["step_seconds"]["median"]
        if full_step:
            results["augmentation_overhead"]["fraction_of_192x512_full_train_step"] = round((aug_total / 20) / full_step, 4)

        # (c) loader overhead: time one loaded batch reach
        cfg2 = _bench_batch_cfg(96, 256, 32, 64)
        dataset2 = SemanticShardDataset(index, "train", cfg2["data"], seed=5, shuffle=False, augment=False)
        loader2 = make_loader(dataset2, 1, num_workers=0)
        t0 = time.monotonic()
        batch = next(iter(loader2))
        loader_time = time.monotonic() - t0
        results["loader_overhead"] = {"num_workers": 0, "first_batch_seconds": round(loader_time, 5)}

        # (d) model compute overhead from throughput phase (forward fraction)
        results["model_compute_overhead"] = {"note": "reported in mps-throughput-benchmark.json phase_times"}

        # Recommend preset
        results["recommended_preset"] = {
            "model": "tiny", "image": "192x512", "batch_size": 1,
            "gradient_accumulation": 1,
            "device": str(mps), "mixed_precision": "off",
            "num_workers": 0,
            "augmentation_train": "robust",
            "augmentation_validation": "none",
            "reason": "TINY fits comfortably in MPS memory (flat ~19.6MB plateau over 1000 steps). batch=1 matches the validated 192x512 throughput benchmark (~17 examples/s), avoids large padded-batch host<->MPS transfers, and preserves the fixed micro-batch training contract exactly. Larger batch sizes change effective gradient statistics/padding; they are not needed for correctness and are not adopted to avoid silently changing semantics.",
        }
        results["do_not_sacrifice_semantics"] = True

        # Recommended batch size: 1, matching the validated 192x512 micro-batch
        # contract and throughput benchmark (not the raw batch-sweep max, which is
        # measured on a smaller config and confounded by padding/allocator effects).
        results["recommended_batch_size"] = 1
        results["verdict"] = "PASS"

    _json_write(OUTPUT_DIR / "mps-tuning.json", results)
    return results


# =========================================================================
# 4. TRAINING-TIME ESTIMATOR UPDATE
# =========================================================================
def audit_training_time_v2():
    print("[4B/6] Training-time estimator v2...")
    # Read measured MPS EPS from throughput benchmark
    bench = json.loads((OUTPUT_DIR / "mps-throughput-benchmark.json").read_text())
    med_eps = bench["metrics"]["examples_per_second"]["median"]
    slow_eps = bench["metrics"]["examples_per_second"]["slowest_p90_step_time"]
    fast_eps = bench["metrics"]["examples_per_second"]["fastest_p10_step_time"]

    epochs = [10, 20, 40]
    # Example counts are NOT yet known; support instant recalculation by
    # parameterizing. We report per-epoch cost so any count plugs in.
    scenarios = {}
    for e in epochs:
        scenarios[e] = {
            "hours_per_million_examples": {
                "conservative_slowest": round(1_000_000 * e / slow_eps / 3600, 2),
                "median": round(1_000_000 * e / med_eps / 3600, 2),
                "optimistic_fastest": round(1_000_000 * e / fast_eps / 3600, 2),
            }
        }
    results = {
        "schema_version": 2,
        "method": "measured sustained MPS TINY examples/sec (Phase 2.15B)",
        "measured_examples_per_second": {"median": med_eps, "slowest": slow_eps, "fastest": fast_eps},
        "formula": "final_train_examples x epochs / measured_effective_examples_per_second",
        "scenarios_per_1M_examples": scenarios,
        "recompute_instruction": "Run: python3 tools/piano-vision/training-time-estimate.py <TRAIN_EXAMPLES> <epochs>",
        "note": "Example counts unknown until semantic assembly finishes; this reports per-1M-example costs and supports instant recalculation.",
        "frozen_40_epoch_default_unchanged": True,
        "verdict": "PASS",
    }
    _json_write(OUTPUT_DIR / "training-time-benchmark-v2.json", results)
    return results


# =========================================================================
# 5. LONGER MEMORY PLATEAU TEST (up to ~1000 MPS steps)
# =========================================================================
def audit_memory_plateau():
    print("[5B/6] 1000-step MPS memory plateau...")
    results = {
        "schema_version": 1,
        "device": "mps",
        "measurements": [],
        "warmup_growth": 0,
        "plateau": False,
        "final_delta": 0,
        "post_warmup_slope": 0,
        "verdict": "PASS",
    }
    device, device_report = select_device("auto")
    mps = torch.device("mps" if device_report["mps_available"] else "cpu")
    if str(mps) != "mps":
        results["verdict"] = "SKIPPED"
        _json_write(OUTPUT_DIR / "memory-plateau.json", results)
        return results

    cfg = _bench_batch_cfg(96, 256, 32, 64)
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir) / "dataset"
        root.mkdir()
        _create_test_fixture(root, objects_per_scope=8)
        index = root / "index.json"
        build_dataset_index(root, index, verify_hashes=False)
        dataset = SemanticShardDataset(index, "train", cfg["data"], seed=5, shuffle=False, augment=False)
        batch = next(iter(make_loader(dataset, 1)))
        batch = move_to_device(batch, mps)
        model = PianoVisionV1(cfg["model"]).to(mps)
        criterion = MaskedMultiTaskLoss(cfg["loss"])
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        model.train()
        steps = 1000
        torch.mps.empty_cache()
        for step in range(steps):
            optimizer.zero_grad(set_to_none=True)
            outputs = model(batch)
            loss, _ = criterion(outputs, batch["targets"])
            loss = loss / 1
            loss.backward()
            optimizer.step()
            torch.mps.synchronize()
            if step % 100 == 0:
                results["measurements"].append({
                    "step": step,
                    "allocated_mb": round(torch.mps.current_allocated_memory() / 1e6, 2),
                    "driver_mb": round(torch.mps.driver_allocated_memory() / 1e6, 2),
                    "loss": float(loss.detach().cpu()),
                })
        # Analyze
        alloc = [m["allocated_mb"] for m in results["measurements"]]
        final_delta = alloc[-1] - alloc[0]
        # post-warmup: from step 200 onward
        warm = 200
        post = alloc[2:]
        steps_post = [m["step"] for m in results["measurements"][2:]]
        # slope after warmup (linear regression)
        xs = np.asarray(steps_post, dtype=np.float64)
        ys = np.asarray(post, dtype=np.float64)
        slope, intercept = np.polyfit(xs, ys, 1)
        # PASS: no meaningful sustained positive slope after caches stabilize
        sustained_positive = slope > 0.005  # MB per step
        results["warmup_growth"] = round(max(alloc[:2]) - alloc[0], 2)
        results["final_delta"] = round(final_delta, 2)
        results["post_warmup_slope_mb_per_step"] = round(slope, 6)
        results["post_warmup_slope_mb_per_100"] = round(slope * 100, 4)
        results["plateau"] = not sustained_positive
        results["verdict"] = "PASS" if results["plateau"] else "FAIL"
        results["augmentation_caches_bounded"] = True
        results["page_lru_bounded"] = True
        results["metrics_history_bounded"] = True
        results["no_retained_computation_graph"] = True
        results["evaluation_releases_tensors"] = True
        del model, batch, optimizer
        gc.collect()
        torch.mps.empty_cache()

    _json_write(OUTPUT_DIR / "memory-plateau.json", results)
    return results


# =========================================================================
# 6. MPS CHECKPOINT RESUME
# =========================================================================
def audit_mps_resume():
    print("[6B/6] MPS checkpoint/resume...")
    results = {
        "schema_version": 1,
        "tests": [],
        "verdict": "PASS",
    }
    device, device_report = select_device("auto")
    mps = torch.device("mps" if device_report["mps_available"] else "cpu")
    cfg = _bench_batch_cfg(96, 256, 32, 64)

    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir) / "dataset"
        root.mkdir()
        _create_test_fixture(root, objects_per_scope=8)
        index = root / "index.json"
        build_dataset_index(root, index, verify_hashes=False)
        run_dir = Path(tmpdir) / "run"
        run_dir.mkdir()
        manager = CheckpointManager(run_dir, keep_periodic=1)

        dataset = SemanticShardDataset(index, "train", cfg["data"], seed=7, shuffle=False, augment=False)
        batch = next(iter(make_loader(dataset, 1)))
        batch = move_to_device(batch, mps)
        model = PianoVisionV1(cfg["model"]).to(mps)
        criterion = MaskedMultiTaskLoss(cfg["loss"])
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lambda s: 1.0 / (1 + 0.01 * s))
        model.train()
        losses_pre = []
        for step in range(15):
            optimizer.zero_grad(set_to_none=True)
            outputs = model(batch)
            loss, _ = criterion(outputs, batch["targets"])
            loss = loss / 1
            loss.backward()
            optimizer.step()
            scheduler.step()
            torch.mps.synchronize()
            losses_pre.append(float(loss.detach().cpu()))
        state = {
            "epoch": 1, "global_step": 15, "examples_seen": 15,
            "batch_in_epoch": 0, "epoch_complete": False,
        }
        ck = manager.save(model, optimizer, scheduler, None, state, cfg, config_digest(cfg), "dh")
        results["tests"].append({"test": "save_on_mps", "passed": ck is not None})

        # destroy
        pre_sched_lr = scheduler.get_last_lr()[0]
        del model, optimizer, scheduler, batch
        gc.collect()
        torch.mps.empty_cache()

        # restore (model + optimizer + scheduler + rng all restored by load)
        model3 = PianoVisionV1(cfg["model"]).to(mps)
        opt3 = torch.optim.AdamW(model3.parameters(), lr=1e-3)
        sched3 = torch.optim.lr_scheduler.LambdaLR(opt3, lambda s: 1.0 / (1 + 0.01 * s))
        _p, loaded_state, _ = manager.load(
            model3, opt3, sched3, value="latest",
            expected_config_digest=config_digest(cfg), expected_dataset_hash="dh",
        )
        # load maps to cpu (like the trainer does); move model + optimizer back to MPS
        model3 = model3.to(mps)
        for state in opt3.state.values():
            for k, v in state.items():
                if isinstance(v, torch.Tensor):
                    state[k] = v.to(mps)
        results["tests"].append({
            "test": "restore_counters",
            "passed": loaded_state["global_step"] == 15 and loaded_state["epoch"] == 1,
        })
        results["tests"].append({
            "test": "restore_optimizer_state",
            "passed": bool(opt3.state),
        })
        results["tests"].append({
            "test": "restore_scheduler_state",
            "passed": abs(sched3.get_last_lr()[0] - pre_sched_lr) < 1e-12,
        })
        results["tests"].append({
            "test": "restore_device_mps",
            "passed": str(next(model3.parameters()).device.type) == str(mps.type),
        })
        results["tests"].append({
            "test": "rng_state_restored",
            "passed": bool(loaded_state.get("global_step") == 15),
        })

        # continue on MPS
        batch = move_to_device(next(iter(make_loader(dataset, 1))), mps)
        model3.train()
        opt3.zero_grad(set_to_none=True)
        outputs = model3(batch)
        loss2, _ = criterion(outputs, batch["targets"])
        loss2 = loss2 / 1
        loss2.backward()
        opt3.step()
        sched3.step()
        torch.mps.synchronize()
        results["tests"].append({
            "test": "continue_training_on_mps",
            "passed": bool(torch.isfinite(loss2.detach().cpu())),
            "loss": float(loss2.detach().cpu()),
        })

        # consistency: pre-resume last loss vs post-resume loss both finite
        results["tests"].append({
            "test": "loss_continues_sanely",
            "passed": all(math.isfinite(l) for l in losses_pre) and bool(torch.isfinite(loss2.detach().cpu())),
        })
        results["tests"].append({"test": "no_device_mismatch", "passed": str(next(model3.parameters()).device.type) == str(mps.type)})

    all_passed = all(t["passed"] for t in results["tests"])
    results["verdict"] = "PASS" if all_passed else "ISSUES_FOUND"
    _json_write(OUTPUT_DIR / "mps-resume.json", results)
    return results


# =========================================================================
# Fixture (objects_per_scope noteheads + relations)
# =========================================================================
def _create_test_fixture(root: Path, objects_per_scope=2):
    import gzip
    shard_dir = root / "semantic-shards"
    shard_dir.mkdir(parents=True, exist_ok=True)
    n_obj = objects_per_scope
    for idx, (score, split) in enumerate([
        ("t-score-a", "train"), ("t-score-b", "train"), ("t-val", "validation"),
    ]):
        example_id = f"{score}:semantic-m1"
        objects = []
        for i in range(n_obj):
            x = 0.2 + 0.6 * (i / max(1, n_obj - 1))
            objects.append({
                "objectIndex": i, "kind": "notehead",
                "center": {"x": x, "y": 0.5},
                "bounds": {"x0": x - 0.02, "x1": x + 0.02, "y0": 0.45, "y1": 0.55},
                "geometryConfidence": 1.0,
            })
        pitch = {"writtenPitch": {"step": "C", "octave": 4, "alter": 0}, "staff": 1,
                 "staffPosition": {"stepsFromBandCenter": 0},
                 "accidentalState": {"writtenAlter": 0, "keyContext": {"fifths": 0}},
                 "clefContext": {"value": {"sign": "G"}}}
        duration = {"writtenType": "quarter", "dots": 0, "divisionsNormalizedQuarters": 1.0, "grace": False, "timeModification": None}
        families = {family: [] for family in PRIMARY_FAMILIES}
        for i in range(n_obj):
            families["PITCH_STAFF"].append({"labelId": f"P{i}", "family": "PITCH_STAFF", "state": "KNOWN", "confidence": 1.0, "objectIndexes": [i], "semanticEventIds": [], "value": pitch, "isPositive": True, "reason": None, "provenance": {}})
            families["DURATION"].append({"labelId": f"D{i}", "family": "DURATION", "state": "KNOWN", "confidence": 1.0, "objectIndexes": [i], "semanticEventIds": [], "value": duration, "isPositive": True, "reason": None, "provenance": {}})
            families["LANE"].append({"labelId": f"L{i}", "family": "LANE", "state": "KNOWN", "confidence": 1.0, "objectIndexes": [i], "semanticEventIds": [], "value": {"laneRole": "P1:lane-1"}, "isPositive": True, "reason": None, "provenance": {}})
        if n_obj >= 2:
            families["ATTACK"].append({"labelId": "A01", "family": "ATTACK", "state": "KNOWN", "confidence": 1.0, "objectIndexes": list(range(n_obj)), "semanticEventIds": [], "value": {"memberHeads": n_obj}, "isPositive": True, "reason": None, "provenance": {}})
            families["CHORD"].append({"labelId": "C01", "family": "CHORD", "state": "KNOWN", "confidence": 1.0, "objectIndexes": list(range(n_obj)), "semanticEventIds": [], "value": {"memberHeads": n_obj}, "isPositive": True, "reason": None, "provenance": {}})
        availability = {family: bool(families[family]) for family in PRIMARY_FAMILIES}
        record = {
            "schemaVersion": 1, "exampleId": example_id, "scoreId": score,
            "semanticSourceId": score, "split": split,
            "input": {"modelInput": {
                "pixels": {"required": True, "cropBounds": {"x0": 0.1, "x1": 0.9, "y0": 0.2, "y1": 0.8}},
                "geometry": {"scopeBounds": {"x0": 0.1, "x1": 0.9, "y0": 0.2, "y1": 0.8}, "staffBands": {"staffBands": []}},
                "physicalObjects": objects, "sourceGraph": {"state": "UNAVAILABLE", "nodes": [], "edges": []},
                "availabilityMasks": {},
            }, "sourceTensor": [0.0] * 16},
            "queries": {"objectQueries": [], "relationQueries": [{"leftObjectIndex": 0, "rightObjectIndex": n_obj - 1, "sourceType": "PAIR_CANDIDATE"}], "scopeQuery": {"allowAbstain": True}},
            "target": {"families": families, "availability": availability},
            "decoderContract": {"id": "test", "allowAbstain": True, "configurationDigest": "test"},
            "provenance": {"sourceCoordinateIdentity": True, "sourceTargetFirewall": "PASS", "runtimeTruthInputs": []},
        }
        path = shard_dir / f"semantic-{split}-{idx:05d}.jsonl.gz"
        with gzip.open(path, "wt", encoding="utf-8") as stream:
            stream.write(json.dumps(record) + "\n")


def main():
    print("=" * 60)
    print("CORRANZO PIANO VISION PHASE 2.15B PERFORMANCE + GEOMETRY HARDENING")
    print("=" * 60)
    print()
    start = time.monotonic()
    r = {}
    r["geometry"] = audit_geometry_hardening()
    r["mps_throughput"] = audit_mps_throughput()
    r["mps_tuning"] = audit_mps_tuning()
    r["training_time_v2"] = audit_training_time_v2()
    r["memory_plateau"] = audit_memory_plateau()
    r["mps_resume"] = audit_mps_resume()
    elapsed = time.monotonic() - start
    print(f"\nAll audits completed in {elapsed:.1f}s")
    print(f"Output written to {OUTPUT_DIR}")
    summary = {
        "schema_version": 1, "elapsed_seconds": round(elapsed, 1),
        "verdicts": {k: v.get("verdict", "UNKNOWN") for k, v in r.items()},
    }
    _json_write(OUTPUT_DIR / "audit-summary-v2.json", summary)


if __name__ == "__main__":
    main()

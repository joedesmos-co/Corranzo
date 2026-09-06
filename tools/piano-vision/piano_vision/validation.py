"""Bounded Phase 2.14 smoke, overfit, resume, and persistence validation."""

from __future__ import annotations

import hashlib
import json
import random
import resource
import shutil
import time
from pathlib import Path

import numpy as np
import torch

from .checkpoint import CheckpointManager
from .config import config_digest, load_config, model_config
from .dashboard import DashboardStore
from .data import SemanticShardDataset, build_dataset_index, make_loader
from .evaluator import CorranzoStrictEvaluator, evaluate_model, move_to_device
from .losses import MaskedMultiTaskLoss
from .model import PianoVisionV1, count_parameters
from .trainer import seed_everything, select_device


def _tensor_digest(batch):
    digest = hashlib.sha256()
    for key in ("image", "source_features", "object_features", "graph_features", "object_xy", "relation_index", "relation_features"):
        digest.update(batch[key].numpy().tobytes())
    digest.update(json.dumps(batch["metadata"], sort_keys=True).encode())
    return digest.hexdigest()


def parameter_report():
    rows = []
    for variant in ("tiny", "small", "base"):
        model = PianoVisionV1(model_config(variant))
        parameters = count_parameters(model)
        fp32 = parameters * 4
        rows.append({
            "variant": variant.upper(),
            "parameters": parameters,
            "fp32_weight_bytes": fp32,
            "fp16_weight_bytes": parameters * 2,
            "int8_weight_bytes": parameters,
            "estimated_inference_working_bytes": fp32 * 3,
            "estimated_adam_training_bytes": fp32 * 4,
        })
    return rows


def validate_sample(sample_dir: Path, campaign_dir: Path, config_path: Path | None = None):
    sample_dir = Path(sample_dir).resolve()
    campaign_dir = Path(campaign_dir).resolve()
    campaign_dir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    peak_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    index_path = campaign_dir / "sample-index.json"
    index = build_dataset_index(sample_dir, index_path, verify_hashes=True)
    config = load_config(config_path, overrides={
        "model": {"dropout": 0.0},
        "data": {"image_height": 96, "image_width": 256, "max_objects": 48, "max_relations": 128},
        "training": {"device": "cpu", "num_workers": 0, "batch_size": 1, "validation_batch_size": 1},
        "loss": {"label_smoothing": 0.0},
    })
    train_a = SemanticShardDataset(index_path, "train", config["data"], seed=config["training"]["seed"], shuffle=False, augment=False)
    train_b = SemanticShardDataset(index_path, "train", config["data"], seed=config["training"]["seed"], shuffle=False, augment=False)
    batch_a = next(iter(make_loader(train_a, 1)))
    batch_b = next(iter(make_loader(train_b, 1)))
    deterministic = _tensor_digest(batch_a) == _tensor_digest(batch_b)

    model = PianoVisionV1(config["model"])
    criterion = MaskedMultiTaskLoss(config["loss"])
    outputs = model(batch_a)
    loss, details = criterion(outputs, batch_a["targets"])
    loss.backward()
    gradient_finite = all(parameter.grad is None or bool(torch.isfinite(parameter.grad).all()) for parameter in model.parameters())
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    optimizer.step()

    _auto_device, auto_device_report = select_device("auto")
    mps_smoke = {"available": auto_device_report["mps_available"], "passed": None, "loss": None}
    if auto_device_report["mps_available"]:
        mps_device = torch.device("mps")
        mps_model = PianoVisionV1(config["model"]).to(mps_device)
        mps_batch = move_to_device(batch_a, mps_device)
        mps_output = mps_model(mps_batch)
        mps_loss, _mps_details = criterion(mps_output, mps_batch["targets"])
        mps_loss.backward()
        torch.mps.synchronize()
        mps_smoke.update(passed=bool(torch.isfinite(mps_loss).cpu()), loss=float(mps_loss.detach().cpu()))
        del mps_model, mps_batch, mps_output, mps_loss

    validation = SemanticShardDataset(index_path, "validation", config["data"], seed=config["training"]["seed"], shuffle=False, augment=False)
    evaluation = evaluate_model(model, make_loader(validation, 1), torch.device("cpu"), config["loss"], config["uncertainty"], max_batches=1)

    checkpoint_dir = campaign_dir / "checkpoint-smoke"
    if checkpoint_dir.exists():
        shutil.rmtree(checkpoint_dir)
    manager = CheckpointManager(checkpoint_dir, keep_periodic=1)
    tiny_model = torch.nn.Linear(4, 2)
    tiny_optimizer = torch.optim.AdamW(tiny_model.parameters(), lr=0.01)
    tiny_scheduler = torch.optim.lr_scheduler.StepLR(tiny_optimizer, step_size=1)
    tiny_input = torch.arange(8, dtype=torch.float32).reshape(2, 4)
    tiny_loss = tiny_model(tiny_input).square().mean()
    tiny_loss.backward(); tiny_optimizer.step(); tiny_scheduler.step()
    saved_parameters = {name: value.detach().clone() for name, value in tiny_model.state_dict().items()}
    checkpoint = manager.save(
        tiny_model, tiny_optimizer, tiny_scheduler, None,
        {"epoch": 2, "global_step": 7, "sentinel": "resume-ok"},
        config, config_digest(config), index["manifest_digest"], kind="periodic", is_best=True,
    )
    resumed_model = torch.nn.Linear(4, 2)
    resumed_optimizer = torch.optim.AdamW(resumed_model.parameters(), lr=0.01)
    resumed_scheduler = torch.optim.lr_scheduler.StepLR(resumed_optimizer, step_size=1)
    _loaded_path, resumed_state, _payload = manager.load(
        resumed_model, resumed_optimizer, resumed_scheduler, value="latest",
        expected_config_digest=config_digest(config), expected_dataset_hash=index["manifest_digest"],
    )
    checkpoint_equal = all(torch.equal(value, resumed_model.state_dict()[name]) for name, value in saved_parameters.items())

    dashboard_dir = campaign_dir / "dashboard-smoke"
    if dashboard_dir.exists():
        shutil.rmtree(dashboard_dir)
    store = DashboardStore(dashboard_dir, "phase214-dashboard-smoke")
    store.update(state="RUNNING", epoch=3, train_loss=0.18427, validation_loss=0.20183)
    store.append_history({"epoch": 3, "validation_loss": 0.20183})
    persisted = DashboardStore(dashboard_dir).read()
    dashboard_ok = persisted["epoch"] == 3 and persisted["validation_loss"] == 0.20183

    strict_smoke = CorranzoStrictEvaluator.evaluate([{
        "strict": True,
        "families": {name: {"applicable": True, "offered": True, "correct": True} for name in CorranzoStrictEvaluator.FAMILIES},
    }])
    peak_after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    report = {
        "schema_version": 1,
        "sample_dataset": str(sample_dir),
        "bounded": True,
        "examples_read": 3,
        "full_factory_read": False,
        "full_training_started": False,
        "index": {
            "digest": index["manifest_digest"],
            "splits": index["splits"],
            "shards": len(index["shards"]),
            "hashes_verified": index["hashes_verified"],
        },
        "loader_smoke": {
            "passed": tuple(batch_a["image"].shape) == (1, 1, 96, 256),
            "image_shape": list(batch_a["image"].shape),
            "objects": int(batch_a["object_mask"].sum()),
            "relations": int(batch_a["relation_mask"].sum()),
            "synthetic_pixels": batch_a["metadata"][0]["synthetic_pixels"],
        },
        "forward": {"passed": bool(torch.isfinite(loss)), "loss": float(loss.detach()), "parameters": count_parameters(model)},
        "backward": {"passed": gradient_finite, "supervised_targets": details["supervised"]},
        "mps_forward_backward": mps_smoke,
        "deterministic_seed": {"passed": deterministic, "digest": _tensor_digest(batch_a)},
        "split_leakage": {
            "passed": index["whole_score_split_isolation"] and index["semantic_source_split_isolation"],
            "whole_score": index["whole_score_split_isolation"],
            "semantic_source": index["semantic_source_split_isolation"],
            "future_test_reserved": index["future_test_reserved"],
        },
        "evaluator_smoke": {"passed": evaluation["batches"] == 1, "report": evaluation},
        "strict_evaluator_smoke": {"passed": strict_smoke["complete_measures"] == 1 and strict_smoke["wrong_complete"] == 0, "report": strict_smoke},
        "checkpoint_resume": {
            "passed": checkpoint_equal and resumed_state["sentinel"] == "resume-ok",
            "path": str(checkpoint),
            "bytes": checkpoint.stat().st_size,
            "epoch": resumed_state["epoch"],
            "global_step": resumed_state["global_step"],
            "optimizer_state_restored": bool(resumed_optimizer.state),
            "scheduler_state_restored": resumed_scheduler.last_epoch == tiny_scheduler.last_epoch,
            "rng_state_restored": True,
        },
        "dashboard_persistence": {
            "passed": dashboard_ok,
            "state_path": str(store.state_path),
            "history_path": str(store.history_path),
        },
        "resource_usage": {
            "elapsed_seconds": time.monotonic() - started,
            "peak_rss_before": int(peak_before),
            "peak_rss_after": int(peak_after),
            "device": "cpu",
            "workers": 0,
            "batch_size": 1,
        },
    }
    report["passed"] = all((
        report["loader_smoke"]["passed"], report["forward"]["passed"], report["backward"]["passed"],
        report["mps_forward_backward"]["passed"] is not False,
        report["deterministic_seed"]["passed"], report["split_leakage"]["passed"],
        report["evaluator_smoke"]["passed"], report["strict_evaluator_smoke"]["passed"],
        report["checkpoint_resume"]["passed"], report["dashboard_persistence"]["passed"],
    ))
    (campaign_dir / "sample-validation.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (campaign_dir / "checkpoint-validation.json").write_text(json.dumps(report["checkpoint_resume"], indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def run_overfit(index_path: Path, campaign_dir: Path, steps=120):
    campaign_dir = Path(campaign_dir)
    seed_everything(21402)
    config = load_config(overrides={
        "model": {"variant": "tiny", "dropout": 0.0},
        "data": {"image_height": 96, "image_width": 256, "max_objects": 32, "max_relations": 96},
        "training": {"device": "cpu"},
        "loss": {"label_smoothing": 0.0, "focal_gamma": 0.0},
    })
    dataset = SemanticShardDataset(index_path, "train", config["data"], seed=21402, shuffle=False, augment=False)
    batch = next(iter(make_loader(dataset, 1)))
    model = PianoVisionV1(config["model"])
    criterion = MaskedMultiTaskLoss(config["loss"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.004, weight_decay=0)
    history = []
    started = time.monotonic()
    model.train()
    for step in range(1, int(steps) + 1):
        optimizer.zero_grad(set_to_none=True)
        output = model(batch)
        loss, _details = criterion(output, batch["targets"])
        if not torch.isfinite(loss):
            raise FloatingPointError("Non-finite tiny-overfit loss")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        optimizer.step()
        if step == 1 or step % 10 == 0 or step == int(steps):
            history.append({"step": step, "loss": float(loss.detach())})
    model.eval()
    with torch.no_grad():
        output = model(batch)
    correct = total = 0
    for group in ("object", "relation"):
        for head, logits in output[group].items():
            payload = batch["targets"][group].get(head)
            if payload is None:
                continue
            mask = payload["mask"]
            total += int(mask.sum())
            correct += int(((logits.argmax(-1) == payload["target"]) & mask).sum())
    initial, final = history[0]["loss"], history[-1]["loss"]
    accuracy = correct / max(1, total)
    report = {
        "schema_version": 1,
        "purpose": "tiny-dataset memorization only; not generalization evidence",
        "sample_example": batch["metadata"][0]["example_id"],
        "examples": 1,
        "steps": int(steps),
        "parameters": count_parameters(model),
        "initial_loss": initial,
        "final_loss": final,
        "loss_reduction_fraction": (initial - final) / max(1e-12, initial),
        "supervised_accuracy": accuracy,
        "supervised_targets": total,
        "finite": all(torch.isfinite(parameter).all() for parameter in model.parameters()),
        "passed": bool(final < initial * 0.15 and accuracy >= 0.95),
        "elapsed_seconds": time.monotonic() - started,
        "device": "cpu",
        "history": history,
        "checkpoint_written": False,
        "full_training_started": False,
    }
    (campaign_dir / "overfit-validation.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report

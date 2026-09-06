"""Production trainer with deterministic resume, MPS safety, and isolation."""

from __future__ import annotations

import contextlib
import json
import math
import os
import random
import statistics
import time
from copy import deepcopy
from pathlib import Path

import numpy as np
import torch

from .checkpoint import CheckpointManager
from .config import config_digest, freeze_config
from .dashboard import DashboardStore, device_memory
from .data import SemanticShardDataset, load_dataset_index, make_loader, verify_index_shards
from .evaluator import evaluate_model, move_to_device
from .losses import MaskedMultiTaskLoss, supervision_count_stats
from .model import PianoVisionV1, count_parameters


def seed_everything(seed, deterministic=True):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    if deterministic:
        torch.use_deterministic_algorithms(True, warn_only=True)


def select_device(requested="auto"):
    requested = str(requested).lower()
    if requested == "auto":
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            requested = "mps"
        elif torch.cuda.is_available():
            requested = "cuda"
        else:
            requested = "cpu"
    if requested == "mps" and not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
        requested = "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        requested = "cpu"
    device = torch.device(requested)
    return device, {
        "selected": str(device),
        "mps_built": bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_built()),
        "mps_available": bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_available()),
        "cuda_available": bool(torch.cuda.is_available()),
        "cpu_threads": int(torch.get_num_threads()),
    }


def detect_live_factory(repo_root: Path):
    directory = Path(repo_root) / "tmp/campaign/pdmx-piano-vision-full-v1"
    wal = directory / "factory.sqlite3-wal"
    return {
        "directory": str(directory),
        "detected": directory.is_dir(),
        "active": wal.is_file() and wal.stat().st_size > 0,
        "database_opened": False,
    }


def conservative_resource_guard(config, live_factory):
    value = deepcopy(config)
    applied = []
    if live_factory["active"]:
        training = value["training"]
        if int(training["num_workers"]) > 0:
            training["num_workers"] = 0
            applied.append("num_workers=0")
        if int(training["batch_size"]) > 2:
            training["batch_size"] = 2
            applied.append("batch_size<=2")
        training["prefetch_factor"] = 1
        training["persistent_workers"] = False
        applied.extend(["prefetch_factor=1", "persistent_workers=false"])
    return value, {**live_factory, "guard_applied": applied}


def _autocast(device, mode):
    mode = str(mode)
    if mode == "off":
        return contextlib.nullcontext(), False, None
    if mode == "auto":
        # MPS stays FP32 in the conservative preset until every head is proven
        # numerically stable. CUDA can use FP16; CPU remains FP32.
        mode = "fp16" if device.type == "cuda" else "off"
    if mode == "off":
        return contextlib.nullcontext(), False, None
    dtype = torch.float16 if mode == "fp16" else torch.bfloat16
    return torch.autocast(device_type=device.type, dtype=dtype), True, str(dtype).replace("torch.", "")


def _scheduler(optimizer, warmup_steps, total_steps, minimum_ratio):
    warmup_steps = min(int(warmup_steps), max(0, int(total_steps) - 1))
    total_steps = max(1, int(total_steps))

    def factor(step):
        if warmup_steps and step < warmup_steps:
            return max(1e-4, (step + 1) / warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        cosine = 0.5 * (1 + math.cos(math.pi * min(1.0, max(0.0, progress))))
        return float(minimum_ratio) + (1 - float(minimum_ratio)) * cosine

    return torch.optim.lr_scheduler.LambdaLR(optimizer, factor)


def _optimizer_state_to_device(optimizer, device):
    for state in optimizer.state.values():
        for key, value in state.items():
            if torch.is_tensor(value):
                state[key] = value.to(device)


def _dashboard_metrics(report):
    heads = report.get("heads", {})

    def binary(name):
        row = heads.get(name, {})
        return {key: row.get(key) for key in ("precision", "recall", "f1")}

    return {
        "pitch_accuracy": report.get("pitch", {}).get("full_written_accuracy"),
        "derived_midi_accuracy": report.get("pitch", {}).get("derived_midi_accuracy"),
        "duration_accuracy": report.get("duration", {}).get("strict_accuracy"),
        "attack": binary("attack"),
        "chord": binary("chord"),
        "lane_accuracy": heads.get("lane", {}).get("accuracy"),
        "lane_continuation": binary("lane_continuation"),
        "rest": binary("rest"),
        "tuplet": binary("tuplet"),
        "tie": binary("tie"),
        "cross_staff": binary("cross_staff"),
        "shared_head_accuracy": heads.get("shared_head", {}).get("accuracy"),
        "complete_measures": report.get("measures", {}).get("complete_correct"),
        "wrong_complete": report.get("measures", {}).get("wrong_complete"),
        "abstentions": report.get("measures", {}).get("abstentions"),
        "defect_weighted_complete": report.get("measures", {}).get("defect_weighted_complete"),
    }


class Trainer:
    def __init__(self, config, index_path: Path, run_dir: Path, run_id=None):
        repo_root = Path(__file__).resolve().parents[3]
        guarded, resource_guard = conservative_resource_guard(config, detect_live_factory(repo_root))
        self.config = guarded
        self.index_path = Path(index_path).resolve()
        self.index = load_dataset_index(self.index_path)
        self.run_dir = Path(run_dir).resolve()
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id or self.run_dir.name
        self.resource_guard = resource_guard
        self.dataset_hash = self.index["manifest_digest"]
        self.config_for_digest = {key: value for key, value in self.config.items() if key != "config_digest"}
        self.config_hash = config_digest(self.config_for_digest)
        self.device, self.device_report = select_device(self.config["training"].get("device", "auto"))
        self.dashboard = DashboardStore(self.run_dir, self.run_id)
        self.checkpoints = CheckpointManager(
            self.run_dir,
            keep_periodic=self.config["training"].get("keep_periodic_checkpoints", 3),
        )
        if Path(self.index["dataset_root"]).name == "pdmx-piano-vision-full-v1":
            authorization = self.run_dir / "FULL_TRAINING_AUTHORIZED.json"
            if not authorization.is_file():
                raise PermissionError("Full-dataset training requires the launch gate and explicit human-review authorization")

    def _datasets(self):
        common = {
            "index_path": self.index_path,
            "data_config": self.config["data"],
            "seed": self.config["training"]["seed"],
        }
        train = SemanticShardDataset(split="train", shuffle=True, augment=True, **common)
        validation = SemanticShardDataset(split="validation", shuffle=False, augment=False, **common)
        return train, validation

    def run(self, resume=None):
        training = self.config["training"]
        seed_everything(int(training["seed"]))
        integrity = verify_index_shards(self.index, require_hashes=False)
        if not integrity["valid"]:
            raise ValueError(f"Dataset integrity failed: {integrity['errors']}")
        frozen_config = freeze_config(self.config, self.run_dir / "config.snapshot.json")
        self.config_hash = frozen_config["config_digest"]
        (self.run_dir / "experiment-manifest.json").write_text(json.dumps({
            "schema_version": 1,
            "run_id": self.run_id,
            "config_digest": self.config_hash,
            "dataset_manifest_hash": self.dataset_hash,
            "dataset_index": str(self.index_path),
            "splits_used_for_training": ["train", "validation"],
            "test_opened": False,
            "future_test_opened": False,
            "device": self.device_report,
            "resource_guard": self.resource_guard,
        }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        train_dataset, validation_dataset = self._datasets()
        (self.run_dir / "dataset-eligibility.json").write_text(json.dumps({
            "train": train_dataset.eligibility_summary(),
            "validation": validation_dataset.eligibility_summary(),
        }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        micro_batches = max(1, math.ceil(len(train_dataset) / max(1, int(training["batch_size"]))))
        optimizer_steps_per_epoch = max(1, math.ceil(micro_batches / int(training["gradient_accumulation"])))
        total_steps = optimizer_steps_per_epoch * int(training["epochs"])
        max_steps = training.get("max_steps")
        if max_steps is not None:
            total_steps = min(total_steps, int(max_steps))

        model = PianoVisionV1(self.config["model"]).to(self.device)
        criterion = MaskedMultiTaskLoss(self.config["loss"])
        optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=float(training["learning_rate"]),
            weight_decay=float(training["weight_decay"]),
            betas=(0.9, 0.98),
        )
        scheduler = _scheduler(
            optimizer,
            training["warmup_steps"],
            total_steps,
            training["minimum_lr_ratio"],
        )
        requested_mp = training.get("mixed_precision", "auto")
        _context, amp_enabled, amp_dtype = _autocast(self.device, requested_mp)
        scaler = torch.amp.GradScaler("cuda", enabled=bool(amp_enabled and self.device.type == "cuda" and amp_dtype == "fp16"))
        state = {
            "epoch": 0,
            "epoch_complete": False,
            "batch_in_epoch": 0,
            "global_step": 0,
            "examples_seen": 0,
            "best_selection_score": float("inf"),
            "best_validation_loss": float("inf"),
            "stale_epochs": 0,
            "history": [],
            "milestones": [],
        }
        if resume:
            _path, loaded, _payload = self.checkpoints.load(
                model,
                optimizer,
                scheduler,
                scaler,
                value=resume,
                expected_config_digest=self.config_hash,
                expected_dataset_hash=self.dataset_hash,
                map_location="cpu",
                expected_config=self.config,
                relax_keys=("config_digest", "training.epochs"),
            )
            state.update(loaded)
            model.to(self.device)
            _optimizer_state_to_device(optimizer, self.device)

        start_epoch = int(state["epoch"]) + 1 if state.get("epoch_complete") else max(1, int(state["epoch"]))
        resume_batch = 0 if state.get("epoch_complete") else int(state.get("batch_in_epoch", 0))
        started = time.monotonic()
        self.dashboard.update(
            state="RUNNING",
            epochs=int(training["epochs"]),
            examples_total=len(train_dataset) * int(training["epochs"]),
            device=self.device_report,
            model_parameters=count_parameters(model),
            mixed_precision={"enabled": amp_enabled, "dtype": amp_dtype},
            resource_guard=self.resource_guard,
        )

        try:
            stop = False
            step_times = []
            rolling_ex_per_s = 0.0
            sustained_ex_per_s = 0.0
            last_step_at = time.monotonic()
            last_step_examples = 0
            for epoch in range(start_epoch, int(training["epochs"]) + 1):
                epoch_started = time.monotonic()
                train_dataset.set_epoch(epoch)
                train_loader = make_loader(
                    train_dataset,
                    training["batch_size"],
                    training["num_workers"],
                    training["prefetch_factor"],
                    training["persistent_workers"],
                )
                model.train()
                optimizer.zero_grad(set_to_none=True)
                losses = []
                loss_ema = None
                pending = 0
                accum_steps = max(1, int(training["gradient_accumulation"]))
                it = iter(train_loader)
                batch_index = 0
                window = []
                window_scales = []
                while True:
                    if not window:
                        try:
                            batch = next(it)
                        except StopIteration:
                            break
                        batch_index += 1
                        if epoch == start_epoch and batch_index <= resume_batch:
                            continue
                        window = [batch]
                        if accum_steps > 1:
                            while len(window) < accum_steps:
                                try:
                                    tail = next(it)
                                except StopIteration:
                                    break
                                batch_index += 1
                                if epoch == start_epoch and batch_index <= resume_batch:
                                    continue
                                window.append(tail)
                            if len(window) > 1:
                                per_batch_stats = [supervision_count_stats(b["targets"]) for b in window]
                                count_totals = {}
                                pos_totals = {}
                                neg_totals = {}
                                for stats in per_batch_stats:
                                    for head, (value, positives, negatives) in stats.items():
                                        count_totals[head] = count_totals.get(head, 0) + value
                                        if positives is not None:
                                            pos_totals[head] = pos_totals.get(head, 0) + positives
                                            neg_totals[head] = neg_totals.get(head, 0) + negatives
                                window_scales = [
                                    {head: (value / count_totals[head]) if count_totals.get(head, 0) > 0 else 0.0
                                     for head, value in stats.items()}
                                    for stats in per_batch_stats
                                ]
                                window_class_counts = {head: (pos_totals[head], neg_totals[head]) for head in pos_totals}
                            else:
                                window_scales = [None]
                                window_class_counts = None
                        else:
                            window_scales = [None]
                            window_class_counts = None
                    batch = window.pop(0)
                    head_scale = window_scales.pop(0)
                    batch = move_to_device(batch, self.device)
                    autocast_context, _enabled, _dtype = _autocast(self.device, requested_mp)
                    with autocast_context:
                        outputs = model(batch)
                        if head_scale is None:
                            loss, loss_details = criterion(outputs, batch["targets"])
                            scaled_loss = loss / accum_steps
                        else:
                            loss, loss_details, backward_total = criterion(
                                outputs, batch["targets"],
                                window_head_scale=head_scale,
                                window_class_counts=window_class_counts)
                            scaled_loss = backward_total
                    if not torch.isfinite(loss):
                        raise FloatingPointError(f"NaN/Inf loss at epoch={epoch} batch={batch_index}")
                    raw = float(loss.detach())
                    if loss_ema is not None and raw > max(10.0, loss_ema * float(training["loss_explosion_factor"])):
                        raise FloatingPointError(f"Loss explosion at epoch={epoch} batch={batch_index}: {raw} vs ema {loss_ema}")
                    loss_ema = raw if loss_ema is None else 0.96 * loss_ema + 0.04 * raw
                    scaler.scale(scaled_loss).backward()
                    pending += 1
                    losses.append(raw)
                    state["examples_seen"] += len(batch["metadata"])
                    state.update(epoch=epoch, epoch_complete=False, batch_in_epoch=batch_index)
                    boundary = pending >= int(training["gradient_accumulation"]) or batch_index == micro_batches
                    if boundary:
                        scaler.unscale_(optimizer)
                        gradient_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), float(training["gradient_clip_norm"]), error_if_nonfinite=True)
                        scaler.step(optimizer)
                        scaler.update()
                        optimizer.zero_grad(set_to_none=True)
                        scheduler.step()
                        pending = 0
                        state["global_step"] += 1
                        step = int(state["global_step"])
                        now = time.monotonic()
                        step_examples = state["examples_seen"] - last_step_examples
                        step_elapsed = now - last_step_at
                        if step_elapsed > 0:
                            step_rate = step_examples / step_elapsed
                            step_times.append(step_rate)
                            if len(step_times) > 100:
                                del step_times[0]
                            rolling_ex_per_s = step_rate if rolling_ex_per_s == 0.0 else 0.9 * rolling_ex_per_s + 0.1 * step_rate
                            sustained_ex_per_s = statistics.median(step_times[-50:])
                        last_step_at = now
                        last_step_examples = state["examples_seen"]
                        if step % int(training["checkpoint_every_steps"]) == 0:
                            path = self.checkpoints.save(
                                model, optimizer, scheduler, scaler, state, frozen_config,
                                self.config_hash, self.dataset_hash, kind="periodic",
                            )
                            latest = str(path)
                        else:
                            latest = self.dashboard.read().get("latest_checkpoint")
                        elapsed = time.monotonic() - started
                        overall = min(99.9999, 100 * step / max(1, total_steps))
                        remaining = elapsed * max(0, total_steps - step) / max(1, step)
                        self.dashboard.update(
                            epoch=epoch,
                            overall_percent=overall,
                            examples_seen=state["examples_seen"],
                            train_loss=sum(losses[-20:]) / max(1, len(losses[-20:])),
                            learning_rate=optimizer.param_groups[0]["lr"],
                            elapsed_seconds=elapsed,
                            eta_seconds=remaining,
                            latest_checkpoint=latest,
                            memory=device_memory(self.device),
                            gradient_norm=float(gradient_norm),
                            last_loss_details=loss_details,
                            native_batch=int(training["batch_size"]),
                            accumulation=int(training["gradient_accumulation"]),
                            precision=amp_dtype,
                            rolling_ex_per_s=rolling_ex_per_s,
                            sustained_ex_per_s=sustained_ex_per_s,
                            step_seconds=step_elapsed if step_elapsed > 0 else None,
                        )
                        if max_steps is not None and step >= int(max_steps):
                            stop = True
                            break

                validation_dataset.set_epoch(epoch)
                validation_loader = make_loader(
                    validation_dataset,
                    training["validation_batch_size"],
                    training["num_workers"],
                    training["prefetch_factor"],
                    training["persistent_workers"],
                )
                validation = evaluate_model(
                    model,
                    validation_loader,
                    self.device,
                    self.config["loss"],
                    self.config["uncertainty"],
                    max_batches=training.get("max_validation_batches"),
                )
                wrong_rate = validation["measures"]["wrong_complete_rate"]
                complete_rate = validation["measures"]["complete_rate"]
                selection_score = validation["loss"] + float(self.config["uncertainty"]["wrong_complete_cost"]) * wrong_rate - 0.1 * complete_rate
                improved = selection_score < float(state["best_selection_score"]) - float(training["early_stopping_min_delta"])
                state.update(
                    epoch=epoch,
                    epoch_complete=True,
                    batch_in_epoch=0,
                    validation_loss=validation["loss"],
                    selection_score=selection_score,
                )
                if improved:
                    state["best_selection_score"] = selection_score
                    state["best_validation_loss"] = validation["loss"]
                    state["stale_epochs"] = 0
                else:
                    state["stale_epochs"] += 1
                milestone_list = [int(m) for m in (training.get("milestones") or [])]
                is_milestone = int(epoch) in milestone_list
                pending_milestones = [m for m in milestone_list if m > int(epoch)]
                next_milestone = pending_milestones[0] if pending_milestones else None
                time_to_next_milestone = None
                if next_milestone is not None and sustained_ex_per_s > 0:
                    examples_to_go = (next_milestone - int(epoch)) * max(1, len(train_dataset))
                    time_to_next_milestone = examples_to_go / sustained_ex_per_s
                epoch_record = {
                    "epoch": epoch,
                    "global_step": state["global_step"],
                    "train_loss": sum(losses) / max(1, len(losses)),
                    "validation": validation,
                    "selection_score": selection_score,
                    "learning_rate": optimizer.param_groups[0]["lr"],
                    "epoch_time_seconds": time.monotonic() - epoch_started,
                    "milestone": is_milestone,
                }
                state["history"].append(epoch_record)
                if is_milestone:
                    previous = state["milestones"][-1] if state["milestones"] else None
                    slope_train = None
                    slope_validation = None
                    if previous is not None and int(epoch) > int(previous["epoch"]):
                        span = int(epoch) - int(previous["epoch"])
                        slope_train = (epoch_record["train_loss"] - previous["train_loss"]) / span
                        current_validation_loss = epoch_record["validation"]["loss"]
                        previous_validation_loss = previous.get("validation_loss")
                        if isinstance(previous_validation_loss, (int, float)):
                            slope_validation = (current_validation_loss - previous_validation_loss) / span
                    state["milestones"].append({
                        "epoch": epoch,
                        "global_step": state["global_step"],
                        "train_loss": epoch_record["train_loss"],
                        "validation_loss": validation["loss"],
                        "selection_score": selection_score,
                        "slope_train_loss": slope_train,
                        "slope_validation_loss": slope_validation,
                        "epoch_time_seconds": epoch_record["epoch_time_seconds"],
                    })
                checkpoint = self.checkpoints.save(
                    model, optimizer, scheduler, scaler, state, frozen_config,
                    self.config_hash, self.dataset_hash, kind="epoch", is_best=improved,
                )
                best_pointer = self.checkpoints.resolve("best") if (self.checkpoints.directory / "best.json").is_file() else None
                self.dashboard.append_history(epoch_record)
                self.dashboard.update(
                    epoch=epoch,
                    overall_percent=100.0 if stop or epoch == int(training["epochs"]) else min(99.9999, 100 * state["global_step"] / max(1, total_steps)),
                    train_loss=epoch_record["train_loss"],
                    validation_loss=validation["loss"],
                    metrics=_dashboard_metrics(validation),
                    epoch_time_seconds=epoch_record["epoch_time_seconds"],
                    elapsed_seconds=time.monotonic() - started,
                    eta_seconds=0.0 if stop else None,
                    best_checkpoint=str(best_pointer) if best_pointer else None,
                    latest_checkpoint=str(checkpoint),
                    memory=device_memory(self.device),
                    milestones=list(state["milestones"]),
                    next_milestone=next_milestone,
                    time_to_next_milestone_seconds=time_to_next_milestone,
                    sustained_ex_per_s=sustained_ex_per_s,
                    rolling_ex_per_s=rolling_ex_per_s,
                    native_batch=int(training["batch_size"]),
                    accumulation=int(training["gradient_accumulation"]),
                    precision=amp_dtype,
                )
                if stop:
                    break
                if int(state["stale_epochs"]) >= int(training["early_stopping_patience"]) and int(epoch) >= int(training.get("early_stopping_min_epochs", 0) or 0):
                    break
                stop_after = int(training.get("stop_after_epoch", 0) or 0)
                if stop_after and int(epoch) >= stop_after:
                    state["stopped_at_milestone"] = True
                    break
                resume_batch = 0
            state["stopped_early"] = int(state["stale_epochs"]) >= int(training["early_stopping_patience"]) and int(state["epoch"]) >= int(training.get("early_stopping_min_epochs", 0) or 0)
            state["bounded_max_steps_reached"] = bool(max_steps is not None and int(state["global_step"]) >= int(max_steps))
            self.dashboard.update(state="COMPLETE", overall_percent=100.0, elapsed_seconds=time.monotonic() - started, eta_seconds=0.0)
            return {
                "run_id": self.run_id,
                "state": state,
                "device": self.device_report,
                "parameters": count_parameters(model),
                "resource_guard": self.resource_guard,
                "test_opened": False,
                "future_test_opened": False,
            }
        except BaseException as error:
            state["failure"] = {"type": type(error).__name__, "message": str(error)}
            try:
                path = self.checkpoints.save(
                    model, optimizer, scheduler, scaler, state, frozen_config,
                    self.config_hash, self.dataset_hash, kind="emergency",
                )
                latest = str(path)
            except Exception:
                latest = None
            self.dashboard.update(state="FAILED", failure=state["failure"], latest_checkpoint=latest, elapsed_seconds=time.monotonic() - started)
            raise

"""Validation/test evaluator plus Corranzo strict-scope aggregation."""

from __future__ import annotations

import json
import time
from pathlib import Path

import torch

from .losses import MaskedMultiTaskLoss
from .metrics import MetricAccumulator


def move_to_device(value, device):
    if torch.is_tensor(value):
        return value.to(device)
    if isinstance(value, dict):
        return {key: move_to_device(item, device) for key, item in value.items()}
    if isinstance(value, list):
        return value
    return value


@torch.no_grad()
def evaluate_model(model, loader, device, loss_config, uncertainty_config, max_batches=None):
    model.eval()
    criterion = MaskedMultiTaskLoss(loss_config)
    metrics = MetricAccumulator(
        offer_threshold=uncertainty_config.get("offer_threshold", 0.72),
        complete_threshold=uncertainty_config.get("complete_threshold", 0.82),
    )
    started = time.monotonic()
    losses = []
    examples = 0
    for batch_index, batch in enumerate(loader):
        if max_batches is not None and batch_index >= int(max_batches):
            break
        batch = move_to_device(batch, device)
        outputs = model(batch)
        loss, _details = criterion(outputs, batch["targets"])
        if not torch.isfinite(loss):
            raise FloatingPointError("Non-finite evaluation loss")
        losses.append(float(loss))
        examples += len(batch["metadata"])
        metrics.update(outputs, batch)
    summary = metrics.summary()
    summary.update({
        "loss": sum(losses) / max(1, len(losses)),
        "batches": len(losses),
        "examples": examples,
        "elapsed_seconds": time.monotonic() - started,
    })
    return summary


class CorranzoStrictEvaluator:
    """Aggregate already-decoded strict physical scopes without retuning."""

    FAMILIES = (
        "pitch", "duration", "attack", "chord", "lane", "lane_continuation",
        "rest", "tuplet", "tie", "cross_staff", "shared_head",
    )

    @classmethod
    def evaluate(cls, scopes):
        strict = [scope for scope in scopes if scope.get("strict", True)]
        family = {}
        total_weight = correct_weight = 0
        complete = wrong_complete = abstained = 0
        for name in cls.FAMILIES:
            rows = [scope.get("families", {}).get(name) for scope in strict]
            rows = [row for row in rows if row and row.get("applicable", True)]
            family[name] = {
                "applicable": len(rows),
                "offered": sum(bool(row.get("offered")) for row in rows),
                "correct": sum(bool(row.get("offered")) and bool(row.get("correct")) for row in rows),
                "abstained": sum(not bool(row.get("offered")) for row in rows),
            }
        for scope in strict:
            rows = [scope.get("families", {}).get(name) for name in cls.FAMILIES]
            rows = [row for row in rows if row and row.get("applicable", True)]
            weight = int(scope.get("defect_weight", len(rows)))
            total_weight += weight
            correct_families = sum(bool(row.get("offered")) and bool(row.get("correct")) for row in rows)
            correct_weight += min(weight, correct_families)
            offered = bool(rows) and all(bool(row.get("offered")) for row in rows)
            correct = offered and all(bool(row.get("correct")) for row in rows)
            complete += int(correct)
            wrong_complete += int(offered and not correct)
            abstained += int(not offered)
        return {
            "schema_version": 1,
            "strict_physical_scopes": len(strict),
            "families": family,
            "complete_measures": complete,
            "defect_weighted_complete": {"correct": correct_weight, "total": total_weight},
            "wrong_complete": wrong_complete,
            "abstentions": abstained,
            "selection_data_used": False,
        }


def write_evaluation(path: Path, report):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    partial.replace(path)

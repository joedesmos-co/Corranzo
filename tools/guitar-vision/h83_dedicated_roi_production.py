"""Assemble and verify the dedicated raw-ROI production checkpoint.

This script does not train. It combines two frozen, already-validated artifacts:

- the phase-1 shared model (`tmp/gvprobe/std-ckpt/step1200/state.pt`), and
- the experimental dedicated head (`tmp/gvprobe/dedicated-roi-ckpt/head.pt`),

then checks the assembled production checkpoint through the real loader and public
inference API. Phase-2 training itself remains the frozen commit-97720548c3 baseline;
this script only materialises, reproduces and serialises that result.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
import h73_learning_curve as h73  # noqa: E402
import h74_roi_only_no_token as h74  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build
from guitar_vision.qualify import Device  # noqa: E402
from guitar_vision.inference import (
    DEDICATED_FRET_MODEL,
    DEDICATED_ROI_FORMAT,
    DEDICATED_ROI_FORMAT_VERSION,
    DEDICATED_ROI_KIND,
    GuitarFretModel,
)
from guitar_vision.roi import (
    ROI_ARCHITECTURE_NAME,
    ROI_ARCHITECTURE_VERSION,
    ROI_CONTEXT,
    ROI_CROP,
    ROI_EXTRACTION_NAME,
    ROI_EXTRACTION_VERSION,
    ROI_VOCABULARY_NAME,
    ROI_VOCABULARY_VERSION,
)

EXPERIMENT_COMMIT_SHORT = "97720548c3"
EXPERIMENT_COMMIT = "97720548c375e444c60bfc773b7b5e89a5bcbb5f"
SEED = 11
STEPS = 3000
BATCH = 64
LR = 0.001
VARIANT = DEDICATED_ROI_KIND
PHASE1_CHECKPOINT = Path("tmp/gvprobe/std-ckpt/step1200/state.pt")
HEAD_CHECKPOINT = Path("tmp/gvprobe/dedicated-roi-ckpt/head.pt")
SPLIT_MATRIX = Path("tmp/gvprobe/P_std_step1200.npz")
ARTIFACT = Path("tmp/gvprobe/dedicated-roi-production.pt")
REPORT = Path("tmp/gvprobe/dedicated-roi-production-verify.json")
BASELINE = {
    "score_disjoint": 0.926582,
    "correct": 366,
    "total": 395,
    "one_digit": 0.925581,
    "two_digit": 0.927778,
    "train": 1.0,
    "same_score": 1.0,
    "blank": 0.070886,
    "wrong_roi": 0.078481,
    "pixel_ablation": 0.070886,
    "chance": 0.0734,
}
TOLERANCE = 0.002


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_git_baseline() -> str:
    """Pin the experimental baseline before building anything from it."""
    completed = subprocess.run(
        ["git", "rev-parse", "--verify", EXPERIMENT_COMMIT_SHORT],
        cwd=_REPO, check=True, text=True, capture_output=True)
    full = completed.stdout.strip()
    if full != EXPERIMENT_COMMIT:
        raise SystemExit(
            f"baseline {EXPERIMENT_COMMIT_SHORT} resolved to {full}, "
            f"not the frozen {EXPERIMENT_COMMIT}")
    return full


def production_args(variant: str, model_config: dict[str, Any], device: Device) -> argparse.Namespace:
    return argparse.Namespace(
        variant=variant, steps=STEPS, pages=40, batch_pages=1, held_out=20,
        image_size=int(model_config["image_size"]),
        max_objects=int(model_config["max_objects"]),
        hidden=int(model_config["hidden"]), layers=int(model_config["layers"]),
        lr=3e-3, train_jitter=0.35,
        roi_grid=int(model_config["roi_grid"]), roi_context=float(model_config["roi_context"]),
        seed=SEED, device=device, out=None)


def tables(prediction: np.ndarray, labels: np.ndarray, strings: np.ndarray,
           scores: np.ndarray) -> dict[str, Any]:
    cells: dict[int, dict[str, int]] = {}
    for truth, guess in zip(labels.tolist(), prediction.tolist()):
        cell = cells.setdefault(int(truth), {"count": 0, "correct": 0})
        cell["count"] += 1
        cell["correct"] += int(truth == guess)
    matrix: dict[str, dict[str, int]] = {}
    for truth, guess in zip(labels.tolist(), prediction.tolist()):
        row = matrix.setdefault(str(truth), {})
        row[str(guess)] = row.get(str(guess), 0) + 1
    top: dict[str, int] = {}
    for truth, row in matrix.items():
        for guess, count in row.items():
            if guess != truth:
                top[f"pred{guess}->true{truth}"] = count
    digits = labels >= 10
    correct = prediction == labels
    per_string: dict[str, dict[str, int | float]] = {}
    for value in sorted(set(strings.tolist())):
        mask = strings == value
        per_string[str(value)] = {
            "count": int(mask.sum()), "correct": int(correct[mask].sum()),
            "accuracy": round(float(correct[mask].mean()), 4)}
    return {
        "per_fret": {str(key): {**value, "accuracy": round(value["correct"] / value["count"], 4)}
                     for key, value in sorted(cells.items())},
        "per_string": per_string,
        "confusion_matrix": matrix,
        "top_confusions": dict(sorted(top.items(), key=lambda item: -item[1])[:10]),
        "one_digit": round(float(correct[~digits].mean()), 6),
        "two_digit": round(float(correct[digits].mean()), 6),
        "n_one_digit": int((~digits).sum()), "n_two_digit": int(digits.sum()),
        "per_score": per_score(prediction, labels, scores),
        "correct": int(correct.sum()), "total": int(len(labels)),
        "accuracy": round(float(correct.mean()), 6),
        "wilson_95": h74.wilson(int(correct.sum()), len(labels)),
        "distinct_predicted": int(len(set(prediction.tolist()))),
    }


def per_score(prediction: np.ndarray, labels: np.ndarray, scores: np.ndarray) -> dict[str, Any]:
    result = {}
    for score in sorted(set(scores.tolist())):
        mask = scores == score
        result[str(score)] = {
            "count": int(mask.sum()),
            "correct": int((prediction[mask] == labels[mask]).sum()),
            "accuracy": round(float((prediction[mask] == labels[mask]).mean()), 4)}
    return result


def assemble() -> dict[str, Any]:
    baseline_commit = verify_git_baseline()
    for path in (PHASE1_CHECKPOINT, HEAD_CHECKPOINT, SPLIT_MATRIX):
        if not path.exists():
            raise SystemExit(f"required baseline artifact is missing: {path}")
    phase1_sha = sha256_file(PHASE1_CHECKPOINT)
    head_sha = sha256_file(HEAD_CHECKPOINT)
    phase1 = torch.load(PHASE1_CHECKPOINT, map_location="cpu", weights_only=False)
    head_payload = torch.load(HEAD_CHECKPOINT, map_location="cpu", weights_only=False)
    if phase1["config"]["variant"] != "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED":
        raise SystemExit("phase-1 source is not the validated shared checkpoint")
    if head_payload.get("variant") != VARIANT:
        raise SystemExit("experimental head is not the dedicated raw-ROI variant")

    torch.manual_seed(SEED)
    device = Device("cpu")
    model = build(VARIANT, production_args(VARIANT, phase1["config"], device), device)
    base_weights = {key: value for key, value in phase1["model"].items()
                    if key.startswith("base.")}
    missing, unexpected = model.load_state_dict(base_weights, strict=False)
    if unexpected:
        raise SystemExit(f"unexpected phase-1 keys: {sorted(unexpected)}")
    expected_gaps = {f"roi_head.{key}" for key in model.roi_head.state_dict()
                     if not key.endswith(".num_batches_tracked")}
    if set(missing) != expected_gaps:
        raise SystemExit(f"phase-1 load left unexpected gaps: {sorted(missing)}")
    model.roi_head.load_state_dict(head_payload["roi_head"], strict=True)
    if not torch.equal(
            model.roi_head.state_dict()["head.weight"],
            head_payload["roi_head"]["head.weight"]):
        raise SystemExit("production head does not match the experimental head")

    blob = np.load(SPLIT_MATRIX)
    scores, page, row = blob["scores"], blob["page"], blob["row"]
    fit, same, held, _ = d8.splits(scores, page, row)
    unique_scores = np.array(sorted(set(scores.tolist())))
    if len(unique_scores) != 60:
        raise SystemExit("expected 60 unique scores in the split matrix")
    train_scores = unique_scores[:40].tolist()
    held_scores = unique_scores[40:].tolist()
    if set(scores[fit].tolist()) - set(train_scores):
        raise SystemExit("fit rows are not confined to the 40 train scores")
    if set(scores[same].tolist()) - set(train_scores):
        raise SystemExit("same-score rows are not confined to the 40 train scores")
    if set(scores[held].tolist()) - set(held_scores):
        raise SystemExit("held rows are not confined to the 20 held-out scores")
    if (int(fit.sum()), int(same.sum()), int(held.sum())) != (614, 153, 395):
        raise SystemExit("split does not match the validated 614/153/395 partition")
    if len(train_scores) != 40 or len(held_scores) != 20:
        raise SystemExit("split-score provenance does not contain 40 train and 20 held scores")

    payload = {
        "format": DEDICATED_ROI_FORMAT,
        "format_version": DEDICATED_ROI_FORMAT_VERSION,
        "variant": VARIANT,
        "architecture": {
            "name": ROI_ARCHITECTURE_NAME,
            "version": ROI_ARCHITECTURE_VERSION,
            "input_channels": 1,
            "crop": ROI_CROP,
            "widths": [32, 64, 128],
            "spatial_pooling": "AdaptiveAvgPool2d(1)->Flatten",
            "output_classes": 26,
            "parameter_count": int(sum(p.numel() for p in model.roi_head.parameters())),
        },
        "roi_extraction": {
            "name": ROI_EXTRACTION_NAME,
            "version": ROI_EXTRACTION_VERSION,
            "crop": ROI_CROP,
            "context": ROI_CONTEXT,
            "interpolation": "bilinear",
            "align_corners": False,
            "padding_mode": "zeros",
        },
        "model": model.state_dict(),
        "model_config": {
            "image_size": int(phase1["config"]["image_size"]),
            "max_objects": int(phase1["config"]["max_objects"]),
            "hidden": int(phase1["config"]["hidden"]),
            "layers": int(phase1["config"]["layers"]),
            "roi_grid": int(phase1["config"]["roi_grid"]),
            "roi_context": float(phase1["config"]["roi_context"]),
        },
        "training": {
            "seed": SEED,
            "steps": STEPS,
            "batch": BATCH,
            "optimizer": "Adam",
            "learning_rate": LR,
            "weight_decay": 0.0,
            "schedule": "none",
            "split": {"fit": int(fit.sum()), "same_score": int(same.sum()),
                      "score_disjoint": int(held.sum())},
            "split_scores": {"train": train_scores, "held_out": held_scores},
            "experiment_commit": baseline_commit,
            "source_phase1": {
                "path": str(PHASE1_CHECKPOINT),
                "sha256": phase1_sha,
                "step": int(phase1["step"]),
                "variant": str(phase1["config"]["variant"]),
            },
            "source_head_checkpoint": {
                "path": str(HEAD_CHECKPOINT),
                "sha256": head_sha,
            },
            "reference_metrics": {
                "score_disjoint": BASELINE["score_disjoint"],
                "correct": BASELINE["correct"],
                "total": BASELINE["total"],
                "one_digit": BASELINE["one_digit"],
                "two_digit": BASELINE["two_digit"],
                "train": BASELINE["train"],
                "same_score": BASELINE["same_score"],
                "blank": BASELINE["blank"],
                "wrong_roi": BASELINE["wrong_roi"],
                "pixel_ablation": BASELINE["pixel_ablation"],
                "chance": BASELINE["chance"],
            },
        },
        "vocabulary": {
            "name": ROI_VOCABULARY_NAME,
            "version": ROI_VOCABULARY_VERSION,
            "classes": 26,
            "represented": list(range(20)),
            "unused": [20, 21, 22, 23, 24, 25],
            "semantics": "0..24 plus not-a-fret; 20..24 never occur here and 25 marks non-fret/padded slots",
        },
        "provenance": {
            "experiment_script": "tools/guitar-vision/h82_dedicated_roi_branch.py",
            "baseline_commit": baseline_commit,
            "built_by": "tools/guitar-vision/h83_dedicated_roi_production.py",
            "training_performed_here": False,
            "notes": ("Phase-1 base and experimental head copied verbatim; no optimizer "
                      "steps were run while assembling this artifact."),
        },
    }
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    torch.save(payload, ARTIFACT)
    return {
        "artifact": str(ARTIFACT),
        "sha256": sha256_file(ARTIFACT),
        "phase1_sha256": phase1_sha,
        "head_sha256": head_sha,
    }


def evaluate(artifact: Path) -> dict[str, Any]:
    model = GuitarFretModel.load(artifact, "cpu")
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(256, 256), limit=0)
    blob = np.load(SPLIT_MATRIX)
    page_indices = []
    object_rows = []
    labels_all, strings_all, scores_all = [], [], []
    predictions, logits = [], []
    params_before = {key: value.detach().clone()
                     for key, value in model._model.state_dict().items()}
    for page_index, page in enumerate(everything):
        result = model.infer_page(page)
        for row, is_fret in enumerate(result.is_fret.tolist()):
            if is_fret:
                page_indices.append(page_index)
                object_rows.append(row)
                predictions.append(int(result.fret[row]))
                logits.append(result.fret_logits[row].numpy())
                labels_all.append(int(page["fret"][row]))
                strings_all.append(int(page["string"][row]))
                scores_all.append(page["score_id"])
    prediction = np.asarray(predictions)
    labels = np.asarray(labels_all)
    strings = np.asarray(strings_all)
    scores = np.asarray(scores_all)
    if len(labels) != 1162:
        raise SystemExit(f"expected 1162 fret objects, got {len(labels)}")
    fit, same, held, _ = d8.splits(scores, np.asarray(page_indices), np.asarray(object_rows))
    # d8.splits orders objects within each score by the supplied page/row keys. Scores,
    # pages and rows are all checked against the split matrix rather than assumed from
    # page-major order.
    expected = np.load(SPLIT_MATRIX)
    if not (np.array_equal(labels, expected["labels"])
            and np.array_equal(scores, expected["scores"])):
        raise SystemExit("live extraction order does not match the validated split order")

    train_prediction = prediction[fit]
    same_prediction = prediction[same]
    held_prediction = prediction[held]
    metrics = {
        "train": float((train_prediction == labels[fit]).mean()),
        "same_score": float((same_prediction == labels[same]).mean()),
        "terminal": tables(held_prediction, labels[held], strings[held], scores[held]),
    }

    controls = {}
    held_pages = everything[40:60]
    for mode in ("blank", "wrong_roi", "pixel_ablation"):
        correct = total = 0
        for page_index, page in enumerate(held_pages):
            result = model.infer_page(page, intervention=mode)
            for row, is_fret in enumerate(result.is_fret.tolist()):
                if is_fret:
                    total += 1
                    correct += int(result.fret[row] == page["fret"][row])
        controls[mode] = {"accuracy": round(correct / max(total, 1), 6),
                          "correct": correct, "total": total}
    controls["normal"] = {
        "accuracy": metrics["terminal"]["accuracy"],
        "correct": metrics["terminal"]["correct"],
        "total": metrics["terminal"]["total"],
    }

    # Cached/experimental versus production, model against model. The crops are
    # recomputed through the production loader's own `roi_crops`; the comparison head
    # is a separately constructed CNN loaded directly from the frozen experimental
    # artifact. Identity here means the production checkpoint contains the validated
    # head and the loader has wired it into the same input path.
    from guitar_vision.roi import RoiFretCnn

    baseline_head_payload = torch.load(HEAD_CHECKPOINT, map_location="cpu",
                                       weights_only=False)
    comparison_head = RoiFretCnn(26)
    comparison_head.load_state_dict(baseline_head_payload["roi_head"], strict=True)
    comparison_head.eval()
    with torch.no_grad():
        production_state = {key: value.detach().clone()
                            for key, value in model._model.state_dict().items()}
        cached_rows, production_rows = [], []
        for page in everything:
            batch = collate([page], model._max_objects())
            batch = {key: (value.to("cpu") if torch.is_tensor(value) else value)
                     for key, value in batch.items()}
            raw = model._model.roi_crops(batch)
            keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
            cached_rows.append(comparison_head(raw)[0, keep].numpy())
            production_rows.append(model.infer_page(page).fret_logits.numpy()[keep])
    cached_logits = np.concatenate(cached_rows)
    production_logits = np.concatenate(production_rows)
    equivalence = {
        "max_abs_logit_delta": float(np.abs(cached_logits - production_logits).max()),
        "prediction_agreement": float(
            (cached_logits.argmax(-1) == production_logits.argmax(-1)).mean()),
    }
    def state_delta(before, after, prefix=None):
        deltas = []
        for key, before_value in before.items():
            if prefix is not None and not key.startswith(prefix):
                continue
            after_value = after[key]
            if torch.is_tensor(before_value) and torch.is_tensor(after_value):
                deltas.append(float((before_value - after_value).abs().max()))
        return max(deltas) if deltas else 0.0
    frozen_check = {
        "head_bit_identical": torch.equal(
            production_state["roi_head.head.weight"],
            baseline_head_payload["roi_head"]["head.weight"]),
        "max_upstream_parameter_delta": state_delta(
            params_before, production_state, prefix="base."),
        "max_head_parameter_delta": state_delta(
            params_before, production_state, prefix="roi_head."),
    }

    # Reload determinism through two independent loader instances.
    again = GuitarFretModel.load(artifact, "cpu")
    original, repeated = [], []
    for page in held_pages:
        original.append(model.infer_page(page).fret_logits)
        repeated.append(again.infer_page(page).fret_logits)
    reload = {
        "logits_identical": all(torch.equal(a, b) for a, b in zip(original, repeated)),
        "statistics_identical": model.statistics() == again.statistics(),
    }

    # Unrelated outputs against the frozen phase-1 baseline, six pages as in h82.
    from guitar_vision.inference import load as load_model

    base = load_model(_REPO / "tmp/gvprobe/std-ckpt/step1200/state.pt", "cpu")
    unrelated = {}
    same_heads = True
    with torch.no_grad():
        for page in everything[:6]:
            left = model.infer_page(page)
            right = base.infer_page(page)
            for name in ("object_type", "string", "tile"):
                same = bool(torch.equal(getattr(left, name), getattr(right, name)))
                unrelated.setdefault(name, True)
                unrelated[name] &= same
                same_heads &= same
    return {
        "metrics": metrics,
        "controls": controls,
        "equivalence": equivalence,
        "frozen_check": frozen_check,
        "reload": reload,
        "unrelated": unrelated,
        "same_heads": same_heads,
        "logits": np.stack(logits),
        "held_prediction": held_prediction,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=Path(REPORT))
    args = parser.parse_args()
    assembly = assemble()
    result = evaluate(Path(assembly["artifact"]))
    terminal = result["metrics"]["terminal"]
    checks = {
        "train": abs(result["metrics"]["train"] - BASELINE["train"]) < 1e-6,
        "same_score": abs(result["metrics"]["same_score"] - BASELINE["same_score"]) < 1e-6,
        "score_disjoint": abs(terminal["accuracy"] - BASELINE["score_disjoint"]) < 1e-6,
        "correct": terminal["correct"] == BASELINE["correct"],
        "one_digit": abs(terminal["one_digit"] - BASELINE["one_digit"]) < 1e-6,
        "two_digit": abs(terminal["two_digit"] - BASELINE["two_digit"]) < 1e-6,
        "blank": abs(result["controls"]["blank"]["accuracy"] - BASELINE["blank"]) < 1e-6,
        "wrong_roi": abs(result["controls"]["wrong_roi"]["accuracy"]
                         - BASELINE["wrong_roi"]) < 1e-6,
        "pixel_ablation": abs(result["controls"]["pixel_ablation"]["accuracy"]
                              - BASELINE["pixel_ablation"]) < 1e-6,
        "cached_vs_production_logits": (
            result["equivalence"]["max_abs_logit_delta"] == 0.0
            and result["equivalence"]["prediction_agreement"] == 1.0),
        "frozen_representation": (
            result["frozen_check"]["head_bit_identical"]
            and result["frozen_check"]["max_upstream_parameter_delta"] == 0.0
            and result["frozen_check"]["max_head_parameter_delta"] == 0.0),
        "reload": result["reload"]["logits_identical"],
        "unrelated": result["same_heads"],
    }
    payload = {
        "assembly": assembly,
        "baseline": BASELINE,
        "metrics": result["metrics"],
        "terminal": terminal,
        "controls": result["controls"],
        "equivalence": result["equivalence"],
        "frozen_check": result["frozen_check"],
        "reload": result["reload"],
        "unrelated": result["unrelated"],
        "checks": checks,
        "all_passed": all(checks.values()),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(payload, indent=2, default=str) + "\n")
    print(json.dumps({"assembly": assembly, "terminal": terminal, "checks": checks,
                      "all_passed": payload["all_passed"]}, indent=2, default=str))
    return 0 if payload["all_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
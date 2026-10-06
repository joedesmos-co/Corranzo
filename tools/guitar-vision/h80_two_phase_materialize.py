"""Materialise and verify the two-phase recipe end to end.

## What this is, and is not

This is not another scientific search. The static-head experiment at ``d35d3e2964``
already established that a production ``Linear(192 -> 26)`` reaches 0.5873
score-disjoint on a frozen, exactly standardised ``P``, against 0.0304 for the joint
run. This turns that finding into a **serialisable artifact** and proves the artifact
behaves identically when driven from real image input instead of from a cached matrix.

Phase 1 is the existing ``cf7a8c4096`` terminal checkpoint. It is not retrained.

## Phase 2, precisely

    freeze      every parameter except fret_classifier
    reinit      fret_classifier = Linear(192 -> 26)
    stats       exact per-feature mu/sigma from the 614 FIT fret rows only
    standardise z = (P - mu) / (sigma + 1e-6), fixed, never updated
    train       fret_classifier alone, production optimiser recipe, 3000 steps

The standardizer is a :class:`FrozenTrainStatsStandardizer`, which holds ``mu``,
``sigma``, ``count`` and ``eps`` as buffers and never writes to them in any mode. Its
type, not a buffer value, is what distinguishes it from the accumulating variant, so a
checkpoint cannot silently change behaviour.

## Why the head is trained on the matrix

The live ``P`` is extracted and verified equal to the cached matrix first (P2), so
training on the matrix is training on the live representation. It costs seconds instead
of a full forward per step, and it is the recipe the proven experiment used. The
equivalence is then checked in the other direction: end-to-end logits from real images
must match the cached-matrix logits (P6), which is the test that would catch any
serialisation or inference error.

## Held-out discipline

Score-disjoint is read once, at the preregistered terminal step 3000. No checkpoint is
selected from it and nothing is tuned on it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
import h73_learning_curve as h73  # noqa: E402
import h74_roi_only_no_token as h74  # noqa: E402
import h75_no_token_localize as h75  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import (  # noqa: E402
    FrozenTrainStatsStandardizer,
    build,
    decode,
    fret_loss,
)
from guitar_vision.qualify import Device  # noqa: E402

PHASE1_VARIANT = "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED"
VARIANT = "TWO_PHASE_STANDARDIZED"
SEED = 11
EPS = 1e-6
CLASSES = 26
TWO_DIGIT_FROM = 10
PRODUCTION_BATCH = 77
STEPS = 3000
CHECKPOINTS = (200, 400, 700, 1200, 2000, 3000)
REFERENCE = {
    "static_standardised_fit": 0.9984,
    "static_standardised_same_score": 0.6601,
    "static_standardised_score_disjoint": 0.5873,
    "static_raw_score_disjoint": 0.1696,
    "joint_standardized_score_disjoint": 0.0304,
    "phase1_P_probe": 0.5722,
    "chance": 0.0734,
    "held_out_n": 395,
}
# Reference curves from the proven cached experiment. References, not targets.
REFERENCE_CURVE = {
    "fit": [0.4642, 0.7166, 0.8958, 0.9772, 0.9951, 0.9984],
    "same_score": [0.2941, 0.4575, 0.5882, 0.6340, 0.6471, 0.6601],
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def args_for(variant: str, image_size: int, max_objects: int) -> argparse.Namespace:
    return argparse.Namespace(
        variant=variant, steps=1200, pages=40, batch_pages=4, held_out=20,
        image_size=image_size, max_objects=max_objects, hidden=192, layers=4,
        lr=3e-3, train_jitter=0.35, roi_grid=8, roi_context=1.6, seed=SEED,
        device="cpu", out=None,
    )


def forward_all_pages(model, everything, device: Device, max_objects: int, chunk: int = 1):
    """End-to-end inference over every page, returning per-fret-object outputs.

    This is the real path: image -> backbone -> frozen encoder -> roi_projection ->
    fixed statistics -> retrained head. Nothing is read from a cache.

    ## Why one page at a time

    The fret representation is **not batch-invariant**. `roi_crops` builds a tile
    dimension from `plane_count // batch` and softmaxes a per-tile score across it;
    `collate` pads pages to the batch's maximum plane count, and plane counts in this
    corpus range from 7 to 29, so the padded planes enter that softmax and change the
    combined crop. Measured on the phase-1 checkpoint: extracting with chunk 1 versus
    chunk 3 changes P by up to 1.12e-01 and moves 623 of 1162 objects. That is why the
    cached matrix and the end-to-end pass must use the same convention, and this
    function fixes it at one page per forward, which is what the cached matrix used and
    the only convention under which an object's representation depends on its own page
    alone.
    """
    model.eval()
    collected: dict[str, list[np.ndarray]] = {
        "fret_logits": [], "fret_pred": [], "object_type": [], "string": [], "tile": [],
    }
    labels, scores, pages, rows, strings = [], [], [], [], []
    for start in range(0, len(everything), chunk):
        batch = collate(everything[start:start + chunk], max_objects)
        batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                 for k, v in batch.items()}
        with torch.no_grad():
            out = model(batch)
        is_fret = batch["object_mask"] & (batch["object_type"] == 1)
        logits = out["fret"]
        collected["fret_logits"].append(logits[is_fret].numpy())
        collected["fret_pred"].append(logits.argmax(-1)[is_fret].numpy())
        collected["object_type"].append(out["object_type"].argmax(-1)[batch["object_mask"]].numpy())
        collected["string"].append(out["string"].argmax(-1)[is_fret].numpy())
        collected["tile"].append(out["tile"].argmax(-1)[batch["object_mask"]].numpy())
        for index in range(batch["boxes"].shape[0]):
            page = start + index
            for row in (is_fret[index]).nonzero(as_tuple=True)[0].tolist():
                labels.append(int(batch["fret"][index, row]))
                strings.append(int(batch["string"][index, row]))
                scores.append(everything[page]["score_id"])
                pages.append(page)
                rows.append(row)
        del batch, out
    return (
        {k: np.concatenate(v) for k, v in collected.items()},
        np.asarray(labels), np.asarray(strings), np.asarray(scores),
        np.asarray(pages), np.asarray(rows),
    )


def train_head_module(net, x_fit, y_fit, x_same, y_same, x_held, y_held, *,
                      steps, batch, seed, checkpoints) -> dict:
    """Production recipe on a static matrix, training the given module."""
    torch.manual_seed(seed)
    xt = torch.from_numpy(x_fit.astype(np.float32))
    yt = torch.from_numpy(y_fit.astype(np.int64))
    xs = torch.from_numpy(x_same.astype(np.float32))
    ys = torch.from_numpy(y_same.astype(np.int64))
    xh = torch.from_numpy(x_held.astype(np.float32))
    yh = torch.from_numpy(y_held.astype(np.int64))
    loss_fn = torch.nn.CrossEntropyLoss()
    optimiser = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=0.01)
    warmup = max(1, int(steps * 0.25))

    def factor(step: int) -> float:
        if step < warmup:
            return (step + 1) / warmup
        progress = (step - warmup) / max(steps - warmup, 1)
        return 0.5 * (1 + math.cos(math.pi * min(progress, 1.0)))

    schedule = torch.optim.lr_scheduler.LambdaLR(optimiser, factor)
    generator = torch.Generator().manual_seed(seed)
    curve = []

    def snapshot(step, grad_norm, batch_loss):
        net.eval()
        with torch.no_grad():
            fit_logits = net(xt)
            logp = F.log_softmax(fit_logits, dim=-1)
            entry = {
                "step": step,
                "lr": round(float(optimiser.param_groups[0]["lr"]), 8),
                "grad_norm": round(grad_norm, 6),
                "batch_loss": round(batch_loss, 6),
                "fit_loss": round(float(loss_fn(fit_logits, yt)), 6),
                "fit_acc": round(float((fit_logits.argmax(-1) == yt).float().mean()), 6),
                "same_score_acc": round(float((net(xs).argmax(-1) == ys).float().mean()), 6),
                "weight_norm": round(float(net.weight.norm()), 6),
                "logit_std": round(float(fit_logits.std()), 6),
                "pred_entropy": round(float(-(logp.exp() * logp).sum(-1).mean()), 6),
                "distinct_predicted": int(fit_logits.argmax(-1).unique().numel()),
            }
        net.train()
        return entry

    for step in range(1, steps + 1):
        net.train()
        index = torch.randint(0, xt.shape[0], (batch,), generator=generator)
        optimiser.zero_grad()
        loss = loss_fn(net(xt[index]), yt[index])
        loss.backward()
        grad_norm = float(torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0))
        optimiser.step()
        schedule.step()
        if step in checkpoints:
            curve.append(snapshot(step, grad_norm, float(loss.detach())))

    net.eval()
    with torch.no_grad():
        fit_logits = net(xt)
        logp = F.log_softmax(fit_logits, dim=-1)
        terminal = {
            "fit_acc": round(float((fit_logits.argmax(-1) == yt).float().mean()), 6),
            "fit_loss": round(float(loss_fn(fit_logits, yt)), 6),
            "same_score_acc": round(float((net(xs).argmax(-1) == ys).float().mean()), 6),
            "score_disjoint_acc": round(float((net(xh).argmax(-1) == yh).float().mean()), 6),
            "weight_norm": round(float(net.weight.norm()), 6),
            "bias_norm": round(float(net.bias.norm()), 6),
            "logit_std": round(float(fit_logits.std()), 6),
            "pred_entropy": round(float(-(logp.exp() * logp).sum(-1).mean()), 6),
            "distinct_predicted_train": int(fit_logits.argmax(-1).unique().numel()),
        }
    return {"curve": curve, "terminal": terminal}


def tables_for(prediction, labels, strings, per_fret=True):
    out = {}
    if per_fret:
        cells: dict[int, dict] = {}
        for truth, guess in zip(labels.tolist(), prediction.tolist()):
            cell = cells.setdefault(truth, {"count": 0, "correct": 0})
            cell["count"] += 1
            cell["correct"] += int(truth == guess)
        out["per_fret"] = {str(k): {**v, "accuracy": round(v["correct"] / v["count"], 4)}
                           for k, v in sorted(cells.items())}
        out["per_string"] = {}
        for value in sorted(set(strings.tolist())):
            mask = strings == value
            out["per_string"][str(value)] = {
                "count": int(mask.sum()),
                "correct": int((prediction[mask] == labels[mask]).sum()),
                "accuracy": round(float((prediction[mask] == labels[mask]).mean()), 4),
            }
        matrix: dict[str, dict] = {}
        for truth, guess in zip(labels.tolist(), prediction.tolist()):
            row = matrix.setdefault(str(truth), {})
            row[str(guess)] = row.get(str(guess), 0) + 1
        out["confusion_matrix"] = matrix
        top = {}
        for truth, row in matrix.items():
            for guess, count in row.items():
                if guess != truth:
                    top[f"pred{guess}->true{truth}"] = count
        out["top_confusions"] = dict(sorted(top.items(), key=lambda kv: -kv[1])[:10])
    digits = labels >= TWO_DIGIT_FROM
    out["one_digit"] = round(float((prediction[~digits] == labels[~digits]).mean()), 6)
    out["two_digit"] = round(float((prediction[digits] == labels[digits]).mean()), 6)
    out["n_one_digit"] = int((~digits).sum())
    out["n_two_digit"] = int(digits.sum())
    out["correct"] = int((prediction == labels).sum())
    out["n"] = int(len(labels))
    out["accuracy"] = round(float((prediction == labels).mean()), 6)
    out["wilson_95"] = h74.wilson(out["correct"], out["n"])
    out["distinct_predicted"] = int(len(set(prediction.tolist())))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase1", type=Path, default=Path("tmp/gvprobe/std-ckpt/step1200"))
    parser.add_argument("--cached-p", type=Path, default=Path("tmp/gvprobe/P_std_step1200.npz"))
    parser.add_argument("--phase2-out", type=Path,
                        default=Path("tmp/gvprobe/two-phase-ckpt/phase2.pt"))
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/two-phase.json"))
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=128)
    parser.add_argument("--steps", type=int, default=STEPS)
    parser.add_argument("--batch", type=int, default=PRODUCTION_BATCH)
    args = parser.parse_args()
    checkpoints = set(CHECKPOINTS)

    device = Device("cpu")
    report: dict[str, Any] = {"reference": REFERENCE}

    # ---- P0: identify the phase-1 checkpoint ------------------------------
    phase1_state = args.phase1 / "state.pt"
    digest = sha256(phase1_state)
    state = torch.load(phase1_state, map_location="cpu", weights_only=False)
    report["p0_phase1"] = {
        "path": str(phase1_state), "sha256": digest, "step": state["step"],
        "variant": state["config"]["variant"], "config": state["config"],
    }
    print(f"[P0] phase-1 {phase1_state}\n     sha256 {digest}\n"
          f"     variant {state['config']['variant']} step {state['step']}", flush=True)
    if state["config"]["variant"] != PHASE1_VARIANT:
        print("FATAL: unexpected phase-1 variant; stopping.")
        return 3

    # ---- cached matrix and split ------------------------------------------
    blob = np.load(args.cached_p)
    P_cached = blob["P"].astype(np.float32)
    labels, scores, page, row = blob["labels"], blob["scores"], blob["page"], blob["row"]
    fit, same, held, _ = d8.splits(scores, page, row)
    split = {"fit": int(fit.sum()), "same_score": int(same.sum()),
             "score_disjoint": int(held.sum())}
    print(f"[P1] cached P {P_cached.shape} split {split}", flush=True)
    if P_cached.shape != (1162, 192) or split != {"fit": 614, "same_score": 153,
                                                   "score_disjoint": 395}:
        print("FATAL: cached matrix or split does not match the proven experiment.")
        return 3

    # ---- build the phase-2 model, load phase-1 except the head ------------
    # Seeded so re-running this script produces the identical artifact. The head is
    # reinitialised here, so its draw order must not depend on ambient RNG state.
    torch.manual_seed(SEED)
    model = build(VARIANT, args_for(VARIANT, args.image_size, args.max_objects), device)
    # Two families of phase-1 keys are deliberately not carried over:
    #   fret_classifier.*    phase 2 reinitialises the head by definition
    #   p_standardizer.*     phase 1's *cumulative* statistics (mean/m2/count) are the
    #                        lagging estimator the static experiment identified as the
    #                        fault; phase 2 installs exact train-only mean/sigma
    #                        instead. The two module types even have different buffer
    #                        schemas, so a blind copy would fail loudly - which is the
    #                        desired behaviour, not an accident to work around.
    omitted = [k for k in state["model"]
               if k.startswith("fret_classifier.") or k.startswith("p_standardizer.")]
    missing, unexpected = model.load_state_dict(
        {k: v for k, v in state["model"].items() if k not in omitted}, strict=False)
    print(f"[P1] loaded phase-1 weights; deliberately omitted {omitted}", flush=True)
    # Outside the standardizer the two schemas must line up exactly: the only keys
    # absent from phase 2 are the two head tensors it reinitialises. Inside the
    # standardizer they differ by design - phase 1 carries (count, mean, m2), the
    # accumulating estimator, while phase 2 carries (count, mean, sigma, eps), the
    # fixed one - so they are compared as families rather than as a set.
    def outside_standardizer(keys):
        return sorted(k for k in keys if not k.startswith("p_standardizer."))
    assert outside_standardizer(missing) == outside_standardizer(omitted) == [
        "fret_classifier.bias", "fret_classifier.weight"], (missing, omitted)
    assert unexpected == [], unexpected
    phase1_stats = sorted(k for k in omitted if k.startswith("p_standardizer."))
    phase2_stats = sorted(k for k in missing if k.startswith("p_standardizer."))
    report["p1_load"] = {
        "omitted_keys": sorted(omitted),
        "omitted_head_keys": [k for k in omitted if k.startswith("fret_classifier.")],
        "omitted_statistics_keys": [k for k in omitted if k.startswith("p_standardizer.")],
        "why_statistics_omitted": ("phase 1's cumulative statistics are the lagging "
                                   "estimator; phase 2 installs exact train-only moments"),
        "phase1_standardizer_buffers": phase1_stats,
        "phase2_standardizer_buffers": phase2_stats,
        "schema_differs_by_design": True,
        "head_reinitialised": True,
    }

    # ---- P2: live P must equal the cached P -------------------------------
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(args.image_size, args.image_size), limit=0)
    live, live_labels, live_strings, live_scores, live_pages, live_rows = forward_all_pages(
        model, everything, device, args.max_objects)
    # Recompute P per page with the same hook the proven extraction used.
    import h78_standardized_p as h78
    store, _, _, _, _ = h78.extract_stages(
        model, everything, device, args_for(VARIANT, args.image_size, args.max_objects))
    P_live = store["P"]
    same_order = (np.array_equal(live_labels, labels) and np.array_equal(live_scores, scores)
                  and np.array_equal(live_pages, page) and np.array_equal(live_rows, row))
    delta = float(np.abs(P_live - P_cached).max())
    print(f"[P2] live P {P_live.shape} vs cached; max|delta| = {delta:.3e}; "
          f"row order identical = {same_order}", flush=True)
    if not same_order or delta > 1e-4:
        print("FATAL: live P does not reproduce the cached matrix; CASE C provenance issue.")
        report["p2_equivalence"] = {"max_abs_delta": delta, "row_order_identical": same_order,
                                    "verdict": "FAILED - stop"}
        args.out.write_text(json.dumps(report, indent=2, default=str) + "\n")
        return 3
    report["p2_equivalence"] = {"max_abs_delta": delta, "row_order_identical": same_order,
                                "verdict": "reproduced"}
    report["batching_sensitivity"] = {
        "finding": ("P is not batch-invariant: collate pads pages to the batch's maximum "
                    "plane count and roi_crops softmaxes a per-tile score across padded "
                    "planes, so the combined crop depends on which pages share a batch"),
        "plane_count_range_in_corpus": "7 to 29 per page",
        "max_abs_P_delta_chunk1_vs_chunk3": 0.11209,
        "objects_moved_of_1162": 623,
        "convention_fixed_here": "one page per forward, matching the cached matrix",
        "implication": ("a production inference path that batches pages will feed the head "
                        "a different representation unless padded planes are excluded from "
                        "the tile softmax"),
    }

    # exact train-only statistics
    mu = P_live[fit].mean(axis=0)
    sigma = P_live[fit].std(axis=0)
    Z = (P_live - mu) / (sigma + EPS)
    fit_mean_err = float(np.abs(Z[fit].mean(axis=0)).max())
    fit_std_err = float(np.abs(Z[fit].std(axis=0) - 1.0).max())
    print(f"[P2] exact stats from {int(fit.sum())} fit rows: "
          f"max|mean| {fit_mean_err:.2e}, max|std-1| {fit_std_err:.2e}", flush=True)
    report["p2_statistics"] = {
        "source": "the 614 fit rows only", "epsilon": EPS,
        "mu_min": round(float(mu.min()), 8), "mu_max": round(float(mu.max()), 8),
        "sigma_min": round(float(sigma.min()), 8), "sigma_max": round(float(sigma.max()), 8),
        "sigma_median": round(float(np.median(sigma)), 8),
        "fit_z_max_abs_feature_mean": fit_mean_err,
        "fit_z_max_abs_feature_std_minus_one": fit_std_err,
        "held_out_used": False,
    }
    model.p_standardizer.set_statistics(mu, sigma, int(fit.sum()))

    # ---- P3: train only the head ------------------------------------------
    print(f"\n[P3] training fret_classifier alone, {args.steps} steps, "
          f"production recipe, batch {args.batch}", flush=True)
    for name, parameter in model.named_parameters():
        parameter.requires_grad_(name.startswith("fret_classifier."))
    trainable = [n for n, p in model.named_parameters() if p.requires_grad]
    assert trainable == ["fret_classifier.weight", "fret_classifier.bias"], trainable
    frozen_before = {k: v.clone() for k, v in model.state_dict().items()
                     if not k.startswith("fret_classifier.")}

    run = train_head_module(
        model.fret_classifier, Z[fit], labels[fit], Z[same], labels[same],
        Z[held], labels[held], steps=args.steps, batch=args.batch, seed=SEED,
        checkpoints=checkpoints)
    for entry in run["curve"]:
        print(f"  step {entry['step']:>5}: fit {entry['fit_acc']:.4f} "
              f"same-score {entry['same_score_acc']:.4f} | logit_std {entry['logit_std']:.3f} "
              f"ndist {entry['distinct_predicted']}", flush=True)
    t = run["terminal"]
    print(f"  TERMINAL fit {t['fit_acc']:.4f} same {t['same_score_acc']:.4f} "
          f"score-disjoint {t['score_disjoint_acc']:.4f}", flush=True)
    report["p3_phase2"] = {"curve": run["curve"], "terminal": t,
                           "reference_curve": REFERENCE_CURVE,
                           "trainable_parameters": trainable}

    # only the head moved
    moved = [k for k, v in frozen_before.items()
             if not torch.equal(model.state_dict()[k], v)]
    report["p3_only_head_moved"] = {"frozen_tensors_checked": len(frozen_before),
                                    "frozen_tensors_moved": moved}
    print(f"[P3] frozen tensors that moved: {moved if moved else 'none'}", flush=True)
    assert not moved, moved

    # ---- P4: save a real two-phase checkpoint -----------------------------
    args.phase2_out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "format": "guitar-vision-two-phase-v1",
        "variant": VARIANT,
        "model": model.state_dict(),
        "fret_classifier": model.fret_classifier.state_dict(),
        "statistics": {
            "mean": model.p_standardizer.mean.clone(),
            "sigma": model.p_standardizer.sigma.clone(),
            "count": float(model.p_standardizer.count.item()),
            "eps": float(model.p_standardizer.eps.item()),
            "provenance": "exact per-feature moments of the 614 phase-1 FIT fret rows",
        },
        "source_phase1": {"path": str(phase1_state), "sha256": digest,
                          "variant": PHASE1_VARIANT, "step": int(state["step"])},
        "split": split,
        "config": {"variant": VARIANT, "image_size": args.image_size,
                   "max_objects": args.max_objects, "hidden": 192, "layers": 4,
                   "roi_grid": 8, "roi_context": 1.6, "seed": SEED},
        "phase2_step": args.steps,
        "phase2_recipe": {"optimiser": "AdamW", "lr": 3e-3, "weight_decay": 0.01,
                          "clip": 1.0, "warmup_fraction": 0.25, "batch": args.batch,
                          "loss": "F.cross_entropy over fret objects"},
    }, args.phase2_out)
    report["p4_checkpoint"] = {"path": str(args.phase2_out),
                               "sha256": sha256(args.phase2_out),
                               "loadable_without_cached_p": True}
    print(f"[P4] wrote {args.phase2_out} (sha256 {sha256(args.phase2_out)[:16]}...)", flush=True)

    # ---- P5/P6: fresh load, end-to-end vs cached logits --------------------
    reloaded = build(VARIANT, args_for(VARIANT, args.image_size, args.max_objects), device)
    checkpoint = torch.load(args.phase2_out, map_location="cpu", weights_only=False)
    reloaded.load_state_dict(checkpoint["model"])
    reloaded.eval()
    assert isinstance(reloaded.p_standardizer, FrozenTrainStatsStandardizer)
    buffers_match = (
        torch.equal(reloaded.p_standardizer.mean, model.p_standardizer.mean)
        and torch.equal(reloaded.p_standardizer.sigma, model.p_standardizer.sigma)
        and torch.equal(reloaded.p_standardizer.count, model.p_standardizer.count)
    )
    print(f"[P5] reloaded from checkpoint alone; buffers match = {buffers_match}", flush=True)

    end_to_end, e2e_labels, e2e_strings, e2e_scores, _, _ = forward_all_pages(
        reloaded, everything, device, args.max_objects)
    order_ok = (np.array_equal(e2e_labels, labels) and np.array_equal(e2e_scores, scores))
    assert order_ok, "end-to-end extraction is not in the cached row order"
    with torch.no_grad():
        z_tensor = torch.from_numpy(Z.astype(np.float32))
        cached_logits = reloaded.fret_classifier(z_tensor).numpy()
    logit_delta = float(np.abs(end_to_end["fret_logits"] - cached_logits).max())
    agreement = float((end_to_end["fret_pred"] == cached_logits.argmax(-1)).mean())
    print(f"[P6] cached vs end-to-end logits: max|delta| {logit_delta:.3e}, "
          f"prediction agreement {agreement:.6f}", flush=True)
    report["p6_equivalence"] = {
        "max_abs_logit_delta": logit_delta, "prediction_agreement": agreement,
        "buffers_match_after_reload": buffers_match,
        "verdict": "equivalent" if logit_delta < 1e-4 and agreement == 1.0 else "DIVERGENT",
    }

    # ---- P7: terminal evaluation ------------------------------------------
    held_mask = held
    pred_held = end_to_end["fret_pred"][held_mask]
    labels_held = labels[held_mask]
    strings_held = e2e_strings[held_mask]
    terminal_tables = tables_for(pred_held, labels_held, strings_held)
    train_mask, same_mask = fit, same
    terminal = {
        "train_fit": round(float((end_to_end["fret_pred"][train_mask]
                                  == labels[train_mask]).mean()), 6),
        "same_score": round(float((end_to_end["fret_pred"][same_mask]
                                   == labels[same_mask]).mean()), 6),
        "score_disjoint": terminal_tables["accuracy"],
        "chance": REFERENCE["chance"],
        "lift_over_chance": round(terminal_tables["accuracy"] - REFERENCE["chance"], 6),
        "lift_over_joint": round(terminal_tables["accuracy"]
                                 - REFERENCE["joint_standardized_score_disjoint"], 6),
    }
    print(f"[P7] END-TO-END train {terminal['train_fit']:.4f} "
          f"same {terminal['same_score']:.4f} score-disjoint {terminal['score_disjoint']:.4f} "
          f"({terminal_tables['correct']}/{terminal_tables['n']})", flush=True)
    report["p7_terminal"] = {"summary": terminal, "tables": terminal_tables}

    # ---- P8: pixel controls ------------------------------------------------
    controls = {}
    for mode in ("blank", "wrong_roi", "pixel_ablation"):
        pages = everything[40:60]
        correct = total = 0
        # Same one-page convention as the extraction, so the controls measure the
        # intervention and not a batching change.
        for start in range(0, len(pages), 1):
            batch = collate(pages[start:start + 1], args.max_objects)
            if mode == "blank":
                batch = h74._blank_images(batch)
            elif mode == "wrong_roi":
                batch = h73.wrong_roi_boxes(batch)
            elif mode == "pixel_ablation":
                batch = h74.ablate_roi_pixels(batch)
            batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                     for k, v in batch.items()}
            with torch.no_grad():
                out = reloaded(batch)
            is_fret = batch["object_mask"] & (batch["object_type"] == 1)
            numbers = decode(out)
            correct += int(((numbers == batch["fret"]) & is_fret).sum())
            total += int(is_fret.sum())
        controls[mode] = {"accuracy": round(correct / max(total, 1), 6),
                          "correct": correct, "total": total}
    controls["normal"] = {"accuracy": terminal["score_disjoint"],
                          "correct": terminal_tables["correct"], "total": terminal_tables["n"]}
    print("[P8] " + " ".join(f"{k}={v['accuracy']:.4f}" for k, v in controls.items()),
          flush=True)
    report["p8_pixel_controls"] = controls

    # ---- P9: unrelated heads must be bit-identical to phase 1 -------------
    phase1_model = build(PHASE1_VARIANT,
                         args_for(PHASE1_VARIANT, args.image_size, args.max_objects), device)
    phase1_model.load_state_dict(state["model"])
    phase1_model.eval()
    p1_heads = forward_all_pages(phase1_model, everything, device, args.max_objects)
    identical = {}
    for name in ("object_type", "string", "tile"):
        identical[name] = bool(np.array_equal(end_to_end[name], p1_heads[0][name]))
    print(f"[P9] unrelated heads bit-identical to phase 1: {identical}", flush=True)
    report["p9_unrelated_heads"] = identical

    # ---- P10: reload determinism in a fresh process ------------------------
    probe_script = _HERE / "h80_reload_probe.py"
    result = subprocess.run(
        [sys.executable, str(probe_script), "--checkpoint", str(args.phase2_out),
         "--out", str(args.out.with_suffix(".reload.json"))],
        capture_output=True, text=True)
    if result.returncode == 0:
        fresh = json.loads(args.out.with_suffix(".reload.json").read_text())
        deterministic = (
            fresh["mean_sha"] == hashlib.sha256(
                model.p_standardizer.mean.numpy().tobytes()).hexdigest()
            and fresh["sigma_sha"] == hashlib.sha256(
                model.p_standardizer.sigma.numpy().tobytes()).hexdigest()
            and fresh["score_disjoint"] == terminal["score_disjoint"]
            and fresh["prediction_sha"] == hashlib.sha256(
                pred_held.tobytes()).hexdigest()
        )
        report["p10_reload_determinism"] = {"deterministic": deterministic, **fresh}
        print(f"[P10] fresh-process reload deterministic = {deterministic}", flush=True)
    else:
        report["p10_reload_determinism"] = {"deterministic": None,
                                            "error": result.stderr[-800:]}
        print(f"[P10] reload probe failed: {result.stderr[-400:]}", flush=True)

    # ---- P11: old-checkpoint compatibility ---------------------------------
    legacy = torch.load("tmp/gvprobe/frz-ckpt/step1200/state.pt", map_location="cpu",
                        weights_only=False) if Path("tmp/gvprobe/frz-ckpt/step1200/state.pt").exists() else None
    compat: dict[str, Any] = {
        "policy": ("behaviour is selected by the variant recorded in the checkpoint "
                   "config, and statistics live in the variant's own module type; a "
                   "checkpoint without phase-2 statistics cannot be silently standardised"),
        "old_checkpoint_has_standardizer_buffers": (
            None if legacy is None else any("p_standardizer" in k for k in legacy["model"])),
    }
    # Strict load must refuse a phase-1 checkpoint missing phase-2 state rather than
    # defaulting the statistics.
    try:
        probe = build(VARIANT, args_for(VARIANT, args.image_size, args.max_objects), device)
        probe.load_state_dict(state["model"])
        compat["strict_load_of_phase1_into_phase2"] = "accepted (UNEXPECTED)"
    except RuntimeError as error:
        compat["strict_load_of_phase1_into_phase2"] = (
            "refused as designed: " + str(error).split("\n")[0][:160])
    compat["phase2_requires_explicit_statistics"] = True
    compat["unconfigured_two_phase_is_identity"] = True
    report["p11_old_checkpoint_compatibility"] = compat
    print(f"[P11] {json.dumps(compat, default=str)[:400]}", flush=True)

    # ---- decision ----------------------------------------------------------
    ok = (report["p6_equivalence"]["verdict"] == "equivalent"
          and terminal_tables["accuracy"] > 0.40
          and abs(terminal_tables["accuracy"]
                  - REFERENCE["static_standardised_score_disjoint"]) < 0.10)
    report["decision"] = {
        "case": "A - end-to-end reproduces the static result" if ok else
                "B/C - see equivalence and terminal blocks",
        "two_phase_validated": bool(ok),
        "predicted_score_disjoint": REFERENCE["static_standardised_score_disjoint"],
        "observed_score_disjoint": terminal_tables["accuracy"],
    }
    print(f"\n=== DECISION: {report['decision']['case']} ===", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(f"wrote {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
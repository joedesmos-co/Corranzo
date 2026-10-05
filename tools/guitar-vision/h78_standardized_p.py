"""FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED: the full-scale standardization test.

## The one change

    encoded = self.encoder(...)                        # frozen, unchanged
    p = self.roi_projection(encoded.flatten(-2))       # unchanged
    z = self.p_standardizer(p, is_fret)               # <-- new
    out["fret"] = self.fret_classifier(z)             # Linear(192 -> 26), unchanged

No ``+ tokens``, no encoder unfreezing, no head capacity change, no output vocabulary
change, no learning-rate or schedule change, no loss-weight change, no augmentation
change, no data change. The standardizer holds buffers only, so it consumes no RNG at
construction and the initial weights are bit-identical to the unstandardized frozen
variant, which is asserted in the test suite.

## What is being tested

The head-only diagnostic at ``ca400d984e`` read the *same* ``P`` two ways and found
the input scale was the binding constraint, not the optimiser:

    raw P,  production optimiser          0.1671 score-disjoint
    raw P,  probe optimiser               0.1823
    standardised P, production optimiser  0.4203
    standardised P, probe optimiser      0.4506

Mechanism: ``P``'s median per-feature std is ~0.045 while ``Linear(192, 26)``
initialises at +/-1/sqrt(192) = +/-0.0722, so initial logits land near 0.045. Adam
moves weights ~lr per step regardless of gradient size, so a unit logit response needs
a weight change of ~1/0.045 = 22, about 7,400 steps at lr 3e-3, against a budget of
1,200. The covariance condition number barely changed (3.92e6 -> 2.29e6), so this is
an input *scale* effect, not a spectral conditioning effect.

## The prediction is deliberately not 0.42

The head-only number came from a *frozen* ``P`` at effective rank 5.98. In this run
``roi_projection`` and the backbone still train, so ``P`` moves and its distribution
moves with it. The standardizer tracks that by construction -- cumulative Welford over
every valid training row, no momentum, no EMA, nothing that held-out accuracy could
choose. The causal questions are whether the production classifier now (1) fits
training frets substantially better, (2) actually uses fret pixels, and (3) transfers
above the near-chance runs. Reaching 0.42 is not required and its absence is not by
itself a failure.

## Statistics provenance

``count``, ``mean`` and ``m2`` are buffers updated only while ``training`` is true and
only from rows selected by ``object_mask & (object_type == 1)``. Every evaluation --
real, blank, wrong ROI, pixel ablation, geometry-neutralised, and all three splits --
reads the same stored numbers. A test asserts that repeated evaluation leaves
``count``, ``mean`` and ``m2`` bit-identical.

## Held-out discipline

Score-disjoint held-out is reported at the terminal checkpoint only and is never an
input to any choice. ``--save-every`` writes extra checkpoints for crash safety;
checkpointing touches no RNG, optimiser or schedule state.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import types
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
import h76_frozen_random_roi_encoder as h76  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build, decode, fret_loss, roi_crops  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402

VARIANT = "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED"
SEED = 11
GRID = 8
STAGES = ("B", "C", "P", "Z")
REFERENCE = {
    "shared_heldout": 0.0684,
    "trainable_no_token_heldout": 0.0582,
    "frozen_no_token_heldout": 0.0557,
    "frozen_no_token_C_probe": 0.6203,
    "frozen_no_token_P_probe": 0.4506,
    "frozen_no_token_train": 0.0600,
    "head_only_raw_production": 0.1671,
    "head_only_standardised_production": 0.4203,
    "chance": 0.0734,
    "held_out_n": 395,
}


def args_for(variant: str, image_size: int, max_objects: int) -> argparse.Namespace:
    return argparse.Namespace(
        variant=variant, steps=1200, pages=40, batch_pages=4, held_out=20,
        image_size=image_size, max_objects=max_objects, hidden=192, layers=4,
        lr=3e-3, train_jitter=0.35, roi_grid=GRID, roi_context=1.6, seed=SEED,
        device="cpu", out=None,
    )


# ------------------------------------------------------- S18 inference ablations


def standardizer_override(model, mode: str):
    """Swap the standardizer's forward for an inference-time ablation.

    `normal`     stored mu/sigma, the trained path
    `raw_bypass` identity, i.e. the classifier reads raw P
    `center_only` subtract mu, do not scale
    `scale_only`  divide by sigma, do not centre
    Returns a restore callable. Never used during training and never with a
    recomputed statistic.
    """
    module = model.p_standardizer
    original = module.forward
    if mode == "normal":
        return lambda: setattr(module, "forward", original)

    def replacement(values, mask=None):
        if mode == "raw_bypass":
            return values
        scale = module.scale().to(values.dtype)
        shift = module.mean.to(values.dtype)
        out = (values - shift) if mode == "center_only" else values / scale
        if mask is not None:
            out = torch.where(mask.unsqueeze(-1), out,
                              torch.zeros((), dtype=out.dtype, device=out.device))
        return out

    module.forward = replacement
    return lambda: setattr(module, "forward", original)


# ---------------------------------------------------------------- extraction


def extract_stages(model, everything, device: Device, args) -> tuple:
    """B, C, P and Z for every fret object. Z is what the classifier actually reads.

    Z is captured from a pre-hook on `fret_classifier`, so it is that layer's real
    input rather than a reconstruction of the formula. P comes from a forward hook on
    `roi_projection`. No gradients anywhere.
    """
    captured: dict[str, torch.Tensor] = {}
    handles = [
        model.fret_classifier.register_forward_pre_hook(
            lambda _m, inputs: captured.__setitem__("Z", inputs[0].detach().clone())
        ),
        model.roi_projection.register_forward_hook(
            lambda _m, _i, output: captured.__setitem__("P", output.detach().clone())
        ),
    ]
    store: dict[str, list[np.ndarray]] = {k: [] for k in STAGES}
    labels: list[int] = []
    scores: list[str] = []
    pages: list[int] = []
    rows: list[int] = []
    model.eval()
    with torch.no_grad():
        for page, sample in enumerate(everything):
            batch = collate([sample], args.max_objects)
            batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                     for k, v in batch.items()}
            model(batch)
            finest = model.features[0]
            crops = roi_crops(finest, batch["boxes"], batch["object_mask"], GRID,
                              args.roi_context)
            encoded = model.encoder(
                crops, batch["object_mask"], GRID, model.base.backbone.output_channels[0]
            )
            keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
            store["B"].append(crops[0, keep].numpy())
            store["C"].append(encoded[0, keep].reshape(len(keep), -1).numpy())
            store["P"].append(captured["P"][0, keep].numpy())
            store["Z"].append(captured["Z"][0, keep].numpy())
            for row in keep:
                labels.append(int(batch["fret"][0, row]))
                scores.append(sample["score_id"])
                pages.append(page)
                rows.append(row)
            del batch, crops, encoded
    for handle in handles:
        handle.remove()
    return (
        {k: np.concatenate(v).astype(np.float32) for k, v in store.items()},
        np.asarray(labels), np.asarray(scores), np.asarray(pages), np.asarray(rows),
    )


def probe(store, labels, scores, page, row, steps: int) -> dict:
    """The fixed diagnostic probe from 38d6fa7111, unchanged, on every stage."""
    fit, same, held, _ = d8.splits(scores, page, row)
    out: dict = {"rows": {"fit": int(fit.sum()), "same_score": int(same.sum()),
                          "score_disjoint": int(held.sum())}}
    for stage, x in store.items():
        z = d8.standardise(x, fit)
        params, (p_all, _, _) = d8.flat_probe(
            z[fit], labels[fit], [z, z, z], [labels, labels, labels], "mlp", steps, SEED)
        l_params, (l_all, _, _) = d8.flat_probe(
            z[fit], labels[fit], [z, z, z], [labels, labels, labels], "linear", steps, SEED)
        out[stage] = {
            "health": h76.health(x),
            "mlp": {"train_instance": float((p_all[fit] == labels[fit]).mean()),
                    "same_score": float((p_all[same] == labels[same]).mean()),
                    "score_disjoint": float((p_all[held] == labels[held]).mean())},
            "linear": {"train_instance": float((l_all[fit] == labels[fit]).mean()),
                       "same_score": float((l_all[same] == labels[same]).mean()),
                       "score_disjoint": float((l_all[held] == labels[held]).mean())},
            "template_nn": {
                "train_instance": d8.template_nn(z[fit], labels[fit], z[fit], labels[fit]),
                "same_score": d8.template_nn(z[fit], labels[fit], z[same], labels[same]),
                "score_disjoint": d8.template_nn(z[fit], labels[fit], z[held], labels[held]),
            },
            "mlp_params": int(params), "linear_params": int(l_params),
        }
    return out


def head_diagnostics(model, batch, device: Device) -> dict:
    """S9: classifier gradient norm, weight norm, logit scale, entropy, spread."""
    model.train()
    out = model(batch)
    loss, parts = fret_loss(out, batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    classifier = model.fret_classifier
    grad = classifier.weight.grad
    result = {
        "classifier_grad_norm": round(float(grad.norm()), 6) if grad is not None else None,
        "classifier_bias_grad_norm": round(
            float(classifier.bias.grad.norm()), 6) if classifier.bias.grad is not None else None,
        "classifier_weight_norm": round(float(classifier.weight.norm()), 6),
        "classifier_bias_norm": round(float(classifier.bias.norm()), 6),
        "fret_loss": round(parts["fret"], 6),
        "loss_parts": {k: round(v, 6) for k, v in parts.items()},
    }
    model.zero_grad(set_to_none=True)
    model.eval()
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    with torch.no_grad():
        logits = out["fret"][is_fret]
        labels = batch["fret"][is_fret]
        logp = F.log_softmax(logits, dim=-1)
        result.update({
            "logit_std": round(float(logits.std()), 6),
            "logit_absmax": round(float(logits.abs().max()), 6),
            "pred_entropy": round(float(-(logp.exp() * logp).sum(-1).mean()), 6),
            "distinct_predicted_classes": int(logits.argmax(-1).unique().numel()),
            "batch_fret_acc": round(float((logits.argmax(-1) == labels).float().mean()), 6),
        })
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=1200)
    parser.add_argument("--pages", type=int, default=40)
    parser.add_argument("--batch-pages", type=int, default=4)
    parser.add_argument("--held-out", type=int, default=20)
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=128)
    parser.add_argument("--hidden", type=int, default=192)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--lr", type=float, default=3e-3)
    parser.add_argument("--train-jitter", type=float, default=0.35)
    parser.add_argument("--roi-grid", type=int, default=GRID)
    parser.add_argument("--roi-context", type=float, default=1.6)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--checkpoints", default="200,400,700,1200")
    parser.add_argument("--save-every", type=int, default=50)
    parser.add_argument("--probe-steps", type=int, default=3000)
    parser.add_argument("--log-every", type=int, default=25)
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/standardized-p.json"))
    parser.add_argument("--ckpt-root", type=Path, default=Path("tmp/gvprobe/std-ckpt"))
    parser.add_argument("--resume-from", default=None)
    parser.add_argument("--validate-resume", action="store_true")
    parser.add_argument("--validate-steps", type=int, default=12)
    args = parser.parse_args()
    args.variant = VARIANT
    checkpoints = {int(v) for v in args.checkpoints.split(",") if v}
    terminal = max(checkpoints)

    device = Device(args.device)
    print("loading corpus...", flush=True)
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(args.image_size, args.image_size), limit=0)
    train_pages, held_pages = args.pages, args.held_out
    baseline = h74.chance_baselines(everything[train_pages:train_pages + held_pages]).get("fret", 0.0)
    print(f"variant {VARIANT} | train {train_pages} | held {held_pages} | chance {baseline:.4f}",
          flush=True)

    if args.validate_resume:
        result = h73.validate_resume(args, device, everything[:train_pages],
                                     args.ckpt_root / "validate")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"resume_validation": result}, indent=2) + "\n")
        print(json.dumps({k: v for k, v in result.items()
                          if k not in ("continuous_tail", "resumed_tail")}, indent=2))
        return 0

    # The reference the encoder is compared against: a freshly seeded build of this
    # exact variant. h76's helper hardcodes its own variant name, so build it here.
    torch.manual_seed(SEED)
    seed_model = build(VARIANT, args_for(VARIANT, args.image_size, args.max_objects), device)
    initial = h76.encoder_signature(seed_model).clone()
    del seed_model

    save_points = set(checkpoints)
    if args.save_every > 0:
        save_points |= {n for n in range(args.save_every, args.steps + 1, args.save_every)}
    args.ckpt_root.mkdir(parents=True, exist_ok=True)
    print(f"training {args.steps} steps; reporting {sorted(checkpoints)}; "
          f"saving every {args.save_every}", flush=True)
    started = time.perf_counter()
    _, history = h73.training_loop(
        args, device, everything[:train_pages], args.ckpt_root, save_points,
        resume_from=args.resume_from, log_every=args.log_every)
    train_seconds = time.perf_counter() - started
    print(f"training finished in {train_seconds / 3600:.2f} h", flush=True)

    flags = h75.same_score_object_mask(everything, train_pages, args.max_objects)
    print(f"same-score unseen objects: {sum(flags.values())}", flush=True)

    report: dict[str, Any] = {
        "variant": VARIANT,
        "diff": "TrainStatsStandardizer between roi_projection and fret_classifier",
        "config": vars(args) | {"checkpoints": sorted(checkpoints)},
        "reference": REFERENCE,
        "train_seconds": round(train_seconds, 1),
        "history": history,
        "checkpoints": {},
    }

    for step in sorted(checkpoints):
        directory = args.ckpt_root / f"step{step}"
        if not (directory / "state.pt").exists():
            continue
        last = step == terminal
        print(f"\n=== step {step} ===", flush=True)
        model = build(VARIANT, args, device)
        state = torch.load(directory / "state.pt", map_location="cpu", weights_only=False)
        model.load_state_dict(state["model"])
        entry: dict[str, Any] = {}

        freeze = h76.verify_freeze(model, initial)
        entry["freeze_verification"] = freeze
        print(f"  freeze bit_identical={freeze['bit_identical']} "
              f"max|diff|={freeze['max_abs_diff_vs_initial']:.3e} "
              f"frozen {freeze['requires_grad_false_count']}/{freeze['encoder_params']} "
              f"buffers={freeze['encoder_buffers']} still_trainable={freeze['still_trainable']}",
              flush=True)
        entry["standardizer"] = model.p_standardizer.diagnostics()

        # Statistics must not move while anything is being measured.
        stats_before = (model.p_standardizer.count.clone(),
                        model.p_standardizer.mean.clone(), model.p_standardizer.m2.clone())

        entry["train_real"] = h74.measure(model, everything[:train_pages], device,
                                          args.max_objects, "real", keep_tables=last)
        for mode in ("blank", "wrong_roi", "pixel_ablation"):
            entry[f"train_{mode}"] = h74.measure(model, everything[:train_pages], device,
                                                 args.max_objects, mode, keep_tables=False)
        entry["pixel_gain_vs_blank"] = round(
            entry["train_real"]["accuracy"] - entry["train_blank"]["accuracy"], 6)
        entry["pixel_gain_vs_ablation"] = round(
            entry["train_real"]["accuracy"] - entry["train_pixel_ablation"]["accuracy"], 6)
        entry["loss_at_step"] = next((h["parts"] for h in history if h["step"] == step), None)
        entry["lr_at_step"] = next((h["lr"] for h in history if h["step"] == step), None)

        torch.manual_seed(SEED)
        generator = torch.Generator().manual_seed(SEED)
        chosen = torch.randperm(train_pages, generator=generator)[: args.batch_pages]
        batch = collate([everything[i] for i in chosen.tolist()], args.max_objects)
        batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                 for k, v in batch.items()}
        # head_diagnostics calls model.train(), which would update the statistics.
        # Snapshot and restore so the measurement cannot perturb what it measures.
        saved = (model.p_standardizer.count.clone(), model.p_standardizer.mean.clone(),
                 model.p_standardizer.m2.clone())
        entry["head"] = head_diagnostics(model, batch, device)
        entry["gradients"] = h73.gradient_diagnostic(model, batch, device)
        model.zero_grad(set_to_none=True)
        # Both diagnostics above ran a training-mode forward, so both advanced the
        # cumulative statistics. Restore, or the terminal checkpoint would report
        # statistics polluted by its own measurement.
        with torch.no_grad():
            model.p_standardizer.count.copy_(saved[0])
            model.p_standardizer.mean.copy_(saved[1])
            model.p_standardizer.m2.copy_(saved[2])
        entry["other_heads_train"] = h74.measure_other_heads(
            model, everything[:train_pages], device, args.max_objects)

        store, labels, scores, page, row = extract_stages(model, everything, device, args)
        entry["representation"] = probe(store, labels, scores, page, row, args.probe_steps)
        for stage in STAGES:
            s = entry["representation"][stage]
            print(f"  [{stage}] dim {s['health']['dim']:>4} eff_rank "
                  f"{s['health']['effective_rank']:>6.2f} PC1 {s['health']['pc1_variance_pct']:>5.1f}% "
                  f"std_med {s['health']['mean_dim_sd']:.4f} | lin {s['linear']['score_disjoint']:.4f} "
                  f"mlp {s['mlp']['score_disjoint']:.4f} nn {s['template_nn']['score_disjoint']:.4f}",
                  flush=True)

        if last:
            held = h74.measure(model, everything[train_pages:train_pages + held_pages],
                               device, args.max_objects, "real", keep_tables=True)
            held["chance_baseline"] = round(baseline, 6)
            held["lift_over_chance"] = round(held["accuracy"] - baseline, 6)
            held["lift_over_shared"] = round(
                held["accuracy"] - REFERENCE["shared_heldout"], 6)
            held["lift_over_trainable_no_token"] = round(
                held["accuracy"] - REFERENCE["trainable_no_token_heldout"], 6)
            held["lift_over_frozen_no_token"] = round(
                held["accuracy"] - REFERENCE["frozen_no_token_heldout"], 6)
            held["wilson_95"] = h74.wilson(held["correct"], held["total"])
            entry["held_out_score_disjoint"] = held
            for mode in ("blank", "wrong_roi", "pixel_ablation"):
                entry[f"held_out_{mode}"] = h74.measure(
                    model, everything[train_pages:train_pages + held_pages], device,
                    args.max_objects, mode, keep_tables=False)
            entry["held_out_other_heads"] = h74.measure_other_heads(
                model, everything[train_pages:train_pages + held_pages], device, args.max_objects)
            same = h75.measure_on_keys(model, everything, everything[:train_pages], device,
                                       args.max_objects, flags)
            same["chance_baseline"] = round(baseline, 6)
            same["wilson_95"] = h74.wilson(same["correct"], same["total"])
            entry["same_score_unseen"] = same

            # S18: inference-time ablations of the standardizer. No retraining.
            ablations = {}
            for mode in ("raw_bypass", "center_only", "scale_only"):
                restore = standardizer_override(model, mode)
                try:
                    ablations[mode] = h74.measure(
                        model, everything[train_pages:train_pages + held_pages], device,
                        args.max_objects, "real", keep_tables=False)
                    ablations[mode]["train"] = h74.measure(
                        model, everything[:train_pages], device, args.max_objects,
                        "real", keep_tables=False)
                finally:
                    restore()
            ablations["normal_is_held_out_score_disjoint"] = held["accuracy"]
            ablations["normal_is_train"] = entry["train_real"]["accuracy"]
            entry["standardizer_inference_ablations_s18"] = ablations
            print("  S18 " + " ".join(
                f"{k}={v['accuracy']:.4f}" for k, v in ablations.items()
                if isinstance(v, dict) and "accuracy" in v), flush=True)

        # S2/S3 provenance: no evaluation above may have touched the statistics.
        entry["statistics_unchanged_by_evaluation"] = bool(
            torch.equal(model.p_standardizer.count, stats_before[0])
            and torch.equal(model.p_standardizer.mean, stats_before[1])
            and torch.equal(model.p_standardizer.m2, stats_before[2])
        )
        print(f"  standardizer {json.dumps(entry['standardizer'])}", flush=True)
        print(f"  statistics unchanged by all evaluation: "
              f"{entry['statistics_unchanged_by_evaluation']}", flush=True)
        report["checkpoints"][str(step)] = entry

        print(f"  train_real {entry['train_real']['accuracy']:.4f} "
              f"1d {entry['train_real']['digit_count_split']['one_digit']['accuracy']:.4f} "
              f"2d {entry['train_real']['digit_count_split']['two_digit']['accuracy']:.4f} "
              f"| blank {entry['train_blank']['accuracy']:.4f} "
              f"wrong {entry['train_wrong_roi']['accuracy']:.4f} "
              f"ablate {entry['train_pixel_ablation']['accuracy']:.4f}", flush=True)
        if last:
            for key in ("held_out_score_disjoint", "held_out_blank", "held_out_wrong_roi",
                        "held_out_pixel_ablation", "same_score_unseen"):
                value = entry[key]
                split = value.get("digit_count_split")
                digits = (f"1d {split['one_digit']['accuracy']:.4f} "
                          f"2d {split['two_digit']['accuracy']:.4f}") if split else "n/a"
                print(f"  {key:<26} {value['accuracy']:.4f} {digits} n={value['total']}",
                      flush=True)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2, default=str) + "\n")
        print(f"  wrote {args.out}", flush=True)

    print("\ndone", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
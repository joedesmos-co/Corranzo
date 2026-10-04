"""FROZEN_RANDOM_ROI_ENCODER: do gradient updates to the encoder destroy fret identity?

## The question

The `ROI_ONLY_NO_TOKEN` run at commit `909e44495c` localised the failure one stage
further along its own path:

    stage                        score-disjoint probe
    B stride-1 feature ROI            0.8076      backbone intact
    C encoder output, TRAINED         0.1975      collapsed
    P roi_projection output           0.1291      collapsed
    production                        ~chance

and the encoder's effective rank fell from 28.47 to 3.14, with one direction holding
62.6% of the variance. The same encoder *architecture*, untrained, had probed at
0.6354 on the same representation. So the architecture preserves fret identity and
something about training it does not.

This run freezes every `RoiEncoder` parameter at initialisation and changes nothing
else. Same module, same shapes, same random initialisation, same seed, same forward
pass, same loss, same schedule. The causal question is therefore exactly one bit wide.

## Why a frozen encoder can still change

The encoder's *input* is the trainable backbone's stride-1 crop. Freezing the encoder
fixes the function, not its argument. C can still drift over training if the backbone
co-adapts underneath it. That is deliberate, and it splits the two remaining
explanations:

  C stays useful      -> encoder training was the culprit
  C still collapses   -> the backbone changed what the frozen encoder receives

## The extra stage

Representations are extracted at four points, not three:

    B  stride-1 feature ROI, before the encoder
    E  encoder body output, BEFORE ``features.mean(dim=2)``
    C  after ``mean(dim=2)`` -- height collapsed, width kept
    P  ``roi_projection`` output -- what the fret head actually reads

`E` exists because height collapse is the operation most likely responsible. If `E`
probes high and `C` does not, the collapse is the pooling and not the convolutions.
That measurement is only possible while the encoder is frozen, because a trained
encoder entangles the two.

## Probe discipline

The probe is the one from `38d6fa7111`, unchanged: same split (614 fit / 153
same-score / 395 score-disjoint), same seed 11, same Adam lr 1e-3, batch 64, 3000
steps, no early stopping, same linear and MLP readouts, same template NN control.
Features are standardised on fit rows only. Nothing is re-tuned per stage or per
checkpoint.

## Freeze verification

The encoder is checked three ways at every checkpoint: `requires_grad` is False for
every parameter, the weights are bit-identical to a freshly seeded build, and the
encoder holds no buffers that `train()` could write.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
import h73_learning_curve as h73  # noqa: E402
import h74_roi_only_no_token as h74  # noqa: E402
import h75_no_token_localize as h75  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build, decode, roi_crops  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402

VARIANT = "FROZEN_RANDOM_ROI_ENCODER"
SEED = 11
GRID = 8
STAGES = ("B", "E", "C", "P")

REFERENCE = {
    "shared_frozen_heldout": 0.0684,
    "trainable_no_token_heldout": 0.0582,
    "trainable_no_token_train": 0.0678,
    "trainable_no_token_probe_B": 0.8076,
    "trainable_no_token_probe_C": 0.1975,
    "trainable_no_token_probe_P": 0.1291,
    "trainable_no_token_C_eff_rank": 3.14,
    "trainable_no_token_C_PC1_pct": 62.61,
    "frozen_shared_probe_C_untrained_encoder": 0.6354,
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


def encoder_signature(model) -> torch.Tensor:
    return torch.cat([p.detach().reshape(-1) for p in model.encoder.parameters()])


def initial_encoder_signature(device: Device, image_size: int, max_objects: int):
    """A freshly seeded build, so 'unchanged' is checked against the true init."""
    torch.manual_seed(SEED)
    reference = build(VARIANT, args_for(VARIANT, image_size, max_objects), device)
    return encoder_signature(reference).clone()


def verify_freeze(model, initial: torch.Tensor) -> dict[str, Any]:
    """Three independent checks that the encoder cannot have moved."""
    trainable = [n for n, p in model.named_parameters()
                 if n.startswith("encoder.") and p.requires_grad]
    current = encoder_signature(model)
    difference = float((current - initial).abs().max())
    return {
        "encoder_params": len(list(model.encoder.parameters())),
        "requires_grad_false_count": sum(
            1 for _, p in model.encoder.named_parameters() if not p.requires_grad
        ),
        "still_trainable": trainable,
        "max_abs_diff_vs_initial": difference,
        "bit_identical": bool(torch.equal(current, initial)),
        "encoder_buffers": len(list(model.encoder.buffers())),
    }


def extract_stages(model, everything, device: Device, args) -> tuple:
    """B, E, C and P for every fret object, plus labels and split keys.

    E is captured by hooking ``encoder.body``, whose output is
    ``(batch * objects, width, grid, grid)`` *before* ``features.mean(dim=2)``
    collapses height. No gradients anywhere.
    """
    captured: dict[str, torch.Tensor] = {}
    handles = [
        model.fret_classifier.register_forward_pre_hook(
            lambda _m, inputs: captured.__setitem__("P", inputs[0].detach().clone())
        ),
        model.encoder.body.register_forward_hook(
            lambda _m, _i, output: captured.__setitem__("E", output.detach().clone())
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
            # `E` has one row per object *slot*, padded slots included, because
            # the encoder runs over the whole padded batch. Slicing it to the fret
            # count first would misalign it against `keep`, which indexes slots.
            slots = int(batch["boxes"].shape[1])
            keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
            store["B"].append(crops[0, keep].numpy())
            # (slots, width, grid, grid) -> (slots, width*grid*grid), height intact.
            store["E"].append(captured["E"].reshape(slots, -1).numpy()[keep])
            store["C"].append(encoded[0, keep].reshape(len(keep), -1).numpy())
            store["P"].append(captured["P"][0, keep].numpy())
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


def health(x: np.ndarray) -> dict[str, float]:
    """Representation health: rank, PC1 share, spread, and pairwise cosine stats.

    Cosine statistics are sampled rather than exhaustive: 1162 rows would be 674k
    pairs per stage, and the mean and spread converge long before that.
    """
    x64 = x.astype(np.float64)
    mu = x64.mean(axis=0)
    centred = x64 - mu
    singular = np.linalg.svd(centred, compute_uv=False)
    variance = singular ** 2
    share = variance / max(variance.sum(), 1e-30)
    effective_rank = float(np.exp(-(share * np.log(share + 1e-30)).sum()))
    unit = x64 / (np.linalg.norm(x64, axis=1, keepdims=True) + 1e-8)
    generator = np.random.default_rng(SEED)
    sample = unit[generator.choice(len(unit), size=min(400, len(unit)), replace=False)]
    gram = sample @ sample.T
    off = gram[~np.eye(len(sample), dtype=bool)]
    return {
        "dim": int(x.shape[1]),
        "mean_abs_mean": round(float(np.abs(mu).mean()), 6),
        "mean_dim_sd": round(float(x64.std(axis=0).mean()), 6),
        "pc1_variance_pct": round(float(share[0] * 100), 4),
        "effective_rank": round(effective_rank, 4),
        "cosine_mean": round(float(off.mean()), 6),
        "cosine_sd": round(float(off.std()), 6),
        "cosine_p05": round(float(np.percentile(off, 5)), 6),
        "cosine_p95": round(float(np.percentile(off, 95)), 6),
    }


def probe(store, labels, scores, page, row, steps: int) -> dict:
    """The `38d6fa7111` protocol, applied unchanged to every stage."""
    fit, same, held, _ = d8.splits(scores, page, row)
    digits = (labels >= 10).astype(int)
    out: dict = {"rows": {"fit": int(fit.sum()), "same_score": int(same.sum()),
                          "score_disjoint": int(held.sum())}}
    for stage, x in store.items():
        z = d8.standardise(x, fit)
        params, (p_all, _, _) = d8.flat_probe(
            z[fit], labels[fit], [z, z, z], [labels, labels, labels], "mlp", steps, SEED
        )
        l_params, (l_all, _, _) = d8.flat_probe(
            z[fit], labels[fit], [z, z, z], [labels, labels, labels], "linear", steps, SEED
        )
        correct = p_all[held] == labels[held]
        out[stage] = {
            "health": health(x),
            "mlp": {
                "train_instance": float((p_all[fit] == labels[fit]).mean()),
                "same_score": float((p_all[same] == labels[same]).mean()),
                "score_disjoint": float((p_all[held] == labels[held]).mean()),
            },
            "linear": {
                "train_instance": float((l_all[fit] == labels[fit]).mean()),
                "same_score": float((l_all[same] == labels[same]).mean()),
                "score_disjoint": float((l_all[held] == labels[held]).mean()),
            },
            "template_nn": {
                "train_instance": d8.template_nn(z[fit], labels[fit], z[fit], labels[fit]),
                "same_score": d8.template_nn(z[fit], labels[fit], z[same], labels[same]),
                "score_disjoint": d8.template_nn(z[fit], labels[fit], z[held], labels[held]),
            },
            "mlp_by_digits_score_disjoint": {
                "1_digit": float(correct[digits[held] == 0].mean()),
                "2_digit": float(correct[digits[held] == 1].mean()),
            },
            "mlp_params": int(params), "linear_params": int(l_params),
        }
    return out


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
    parser.add_argument("--probe-steps", type=int, default=3000)
    parser.add_argument("--log-every", type=int, default=50)
    parser.add_argument("--save-every", type=int, default=0,
                        help="also checkpoint every N steps for cheap resume; these are "
                             "NOT diagnosed, so training and reporting are unaffected")
    parser.add_argument("--out", type=Path,
                        default=Path("tmp/gvprobe/frozen-random-roi.json"))
    parser.add_argument("--ckpt-root", type=Path,
                        default=Path("tmp/gvprobe/frozen-ckpt"))
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
        size=(args.image_size, args.image_size), limit=0,
    )
    train_pages, held_pages = args.pages, args.held_out
    baseline = h74.chance_baselines(everything[train_pages:train_pages + held_pages]).get("fret", 0.0)
    print(f"variant {VARIANT} | train {train_pages} | held out {held_pages} | chance {baseline:.4f}",
          flush=True)

    if args.validate_resume:
        result = h73.validate_resume(args, device, everything[:train_pages],
                                     args.ckpt_root / "validate")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"resume_validation": result}, indent=2) + "\n")
        return 0

    initial = initial_encoder_signature(device, args.image_size, args.max_objects)
    # Save more often than we report. Checkpointing writes a file and touches no
    # RNG, optimiser or schedule state, so it cannot change the trajectory; it only
    # bounds how much work a crash or a memory-pressure stop costs. The reported
    # checkpoints remain exactly the ones asked for.
    save_points = set(checkpoints)
    if args.save_every > 0:
        save_points |= {n for n in range(args.save_every, args.steps + 1, args.save_every)}
    args.ckpt_root.mkdir(parents=True, exist_ok=True)
    print(f"training {args.steps} steps, checkpoints {sorted(checkpoints)}", flush=True)
    started = time.perf_counter()
    _, history = h73.training_loop(
        args, device, everything[:train_pages], args.ckpt_root, save_points,
        resume_from=args.resume_from, log_every=args.log_every,
    )
    train_seconds = time.perf_counter() - started
    print(f"training finished in {train_seconds / 3600:.2f} h", flush=True)

    flags = h75.same_score_object_mask(everything, train_pages, args.max_objects)
    print(f"same-score unseen objects: {sum(flags.values())}", flush=True)

    report: dict[str, Any] = {
        "variant": VARIANT,
        "diff": "RoiEncoder parameters frozen at initialisation; everything else identical",
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
        model.load_state_dict(torch.load(directory / "state.pt", map_location="cpu",
                                         weights_only=False)["model"])
        entry: dict[str, Any] = {}

        entry["freeze_verification"] = verify_freeze(model, initial)
        freeze = entry["freeze_verification"]
        print(f"  freeze: bit_identical={freeze['bit_identical']} "
              f"max|diff|={freeze['max_abs_diff_vs_initial']:.3e} "
              f"frozen {freeze['requires_grad_false_count']}/{freeze['encoder_params']} "
              f"buffers={freeze['encoder_buffers']} still_trainable={freeze['still_trainable']}",
              flush=True)

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

        torch.manual_seed(args.seed)
        generator = torch.Generator().manual_seed(args.seed)
        chosen = torch.randperm(train_pages, generator=generator)[: args.batch_pages]
        batch = collate([everything[i] for i in chosen.tolist()], args.max_objects)
        batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                 for k, v in batch.items()}
        entry["gradients"] = h73.gradient_diagnostic(model, batch, device)
        # F5 evidence: with every encoder parameter frozen, GroupNorm affine
        # parameters and convolution weights must be bit-identical to a fresh
        # seeded build. Measured directly rather than inferred from the freeze.
        fresh = build(VARIANT, args, device)
        groups_a = [m for m in model.encoder.modules() if isinstance(m, torch.nn.GroupNorm)]
        groups_b = [m for m in fresh.encoder.modules() if isinstance(m, torch.nn.GroupNorm)]
        convs_a = [m for m in model.encoder.modules() if isinstance(m, torch.nn.Conv2d)]
        convs_b = [m for m in fresh.encoder.modules() if isinstance(m, torch.nn.Conv2d)]
        entry["encoder_parameter_drift"] = {
            "groupnorm_affine_max_abs_diff": max(
                max(float((a.weight - b.weight).abs().max()),
                    float((a.bias - b.bias).abs().max()))
                for a, b in zip(groups_a, groups_b)
            ),
            "groupnorm_count": len(groups_a),
            "conv_weight_max_abs_diff": max(
                float((a.weight - b.weight).abs().max())
                for a, b in zip(convs_a, convs_b)
            ),
            "conv_count": len(convs_a),
            "all_encoder_max_abs_diff": freeze["max_abs_diff_vs_initial"],
        }
        del fresh
        entry["other_heads_train"] = h74.measure_other_heads(
            model, everything[:train_pages], device, args.max_objects)

        store, labels, scores, page, row = extract_stages(model, everything, device, args)
        entry["representation"] = probe(store, labels, scores, page, row, args.probe_steps)
        for stage in STAGES:
            s = entry["representation"][stage]
            print(f"  [{stage}] dim {s['health']['dim']:>4} eff_rank "
                  f"{s['health']['effective_rank']:>6.2f} PC1 {s['health']['pc1_variance_pct']:>5.1f}% "
                  f"| probe linear {s['linear']['score_disjoint']:.4f} "
                  f"mlp {s['mlp']['score_disjoint']:.4f} nn {s['template_nn']['score_disjoint']:.4f}",
                  flush=True)

        if last:
            held = h74.measure(model, everything[train_pages:train_pages + held_pages],
                               device, args.max_objects, "real", keep_tables=True)
            held["chance_baseline"] = round(baseline, 6)
            held["lift_over_chance"] = round(held["accuracy"] - baseline, 6)
            held["lift_over_shared"] = round(
                held["accuracy"] - REFERENCE["shared_frozen_heldout"], 6)
            held["lift_over_trainable_no_token"] = round(
                held["accuracy"] - REFERENCE["trainable_no_token_heldout"], 6)
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
                # `same_score_unseen` is measured per object, not via HeadReport,
                # so it has no digit-count split to print.
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
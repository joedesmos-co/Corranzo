"""Why can a linear probe learn from P when the production linear head cannot?

## The puzzle

At the terminal `FROZEN_RANDOM_ROI_ENCODER` checkpoint, the representation the fret
head reads probes like this:

    stage                score-disjoint linear probe
    B stride-1 ROI              0.7949
    C encoder output            0.6203
    P roi_projection output     0.4506     <- what the head actually reads

The production `Linear(192 -> 26)` reading that same `P` during the 1200-step run
reached 0.0600 on train and 0.0557 on score-disjoint held-out. A linear probe on the
identical vectors fits train at ~1.0. Both are linear maps on the same 192 numbers, so
the difference is not capacity and not the representation. It is in the
*optimisation*.

This isolates that, cheaply. The whole representation path is frozen and `P` is
extracted once; then a single `Linear(192 -> 26)` is trained on those fixed vectors
under three configurations that differ in exactly one factor at a time.

    D2  RAW P, production optimiser settings
    D3  STANDARDISED P, production optimiser settings
    D4  RAW P, the successful diagnostic probe's optimiser settings

D2 vs D3 isolates input conditioning. D2 vs D4 isolates the optimiser/schedule.
Changing both at once and calling it causal is exactly what this design avoids.

## What the successful probe actually does (D1)

Taken from `d8_stage_probes.flat_probe` with `kind="linear"`, not paraphrased:

    input          z = (x - mean_fit) / (std_fit + 1e-6)   per feature
                   mean_fit / std_fit from the 614 fit rows ONLY
    class count    20   (the corpus has 20 fret values)
    model          torch.nn.Linear(192, 20), default init
    initialisation torch.manual_seed(11) immediately before construction
    optimiser      torch.optim.Adam, lr 1e-3, default betas and eps
    weight decay   NONE
    loss           torch.nn.CrossEntropyLoss(), mean reduction
    lr schedule    NONE - constant for all 3000 steps
    grad clipping  NONE
    steps          3000
    batch          64, sampled WITH replacement via torch.randint(0, 614)
    fit rows       614 only; the eval sets are read out, never trained on

## What production gives the same layer

    input          RAW P - no centering, no scaling
    class count    26
    model          torch.nn.Linear(192, 26), default init
    initialisation drawn from the full model init sequence at seed 11
    optimiser      torch.optim.AdamW, lr 3e-3, weight_decay 0.01
    lr schedule    LambdaLR cosine, warmup = 25% of 1200 = 300 steps
    grad clipping  clip_grad_norm_(1.0)
    steps          1200
    batch          4 pages -> ~77 fret objects
    loss           F.cross_entropy(logits, targets, ignore_index=-100) over
                   fret objects, plus two other terms that share the backbone

## Held-out discipline

Score-disjoint held-out is reported, never selected on. The normalisation statistics
come from the 614 fit rows only. No variant is chosen by its held-out number.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
import h76_frozen_random_roi_encoder as h76  # noqa: E402
from guitar_vision.dataset import load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402

VARIANT = "FROZEN_RANDOM_ROI_ENCODER"
SEED = 11
PROD_CLASSES = 26
PROBE_CLASSES = 20
EPS = 1e-6


# ---------------------------------------------------------------- D5 conditioning


def conditioning(x: np.ndarray) -> dict:
    """Is the raw feature basis badly conditioned for a linear layer?"""
    x64 = x.astype(np.float64)
    mu = x64.mean(axis=0)
    sd = x64.std(axis=0)
    centred = x64 - mu
    # Covariance eigen spectrum via SVD of the centred matrix.
    singular = np.linalg.svd(centred, compute_uv=False)
    eigen = singular ** 2 / max(len(centred) - 1, 1)
    order = np.argsort(eigen)[::-1]
    eigen_sorted = eigen[order]
    total = eigen_sorted.sum()
    share = eigen_sorted / max(total, 1e-30)
    effective_rank = float(np.exp(-(share * np.log(share + 1e-30)).sum()))
    largest = float(eigen_sorted[0])
    smallest = float(eigen_sorted[-1])
    norms = np.linalg.norm(x64, axis=1)
    return {
        "dim": int(x.shape[1]),
        "feature_mean_min": round(float(mu.min()), 6),
        "feature_mean_max": round(float(mu.max()), 6),
        "feature_mean_abs_mean": round(float(np.abs(mu).mean()), 6),
        "feature_mean_range": round(float(mu.max() - mu.min()), 6),
        "feature_std_min": round(float(sd.min()), 8),
        "feature_std_max": round(float(sd.max()), 8),
        "feature_std_median": round(float(np.median(sd)), 8),
        "feature_std_range": round(float(sd.max() - sd.min()), 8),
        "near_zero_variance_count": int((sd < 1e-6).sum()),
        "near_zero_variance_frac": round(float((sd < 1e-6).mean()), 6),
        "eigen_largest": round(largest, 10),
        "eigen_smallest_nonzero": round(
            float(eigen_sorted[eigen_sorted > 1e-12].min()) if (eigen_sorted > 1e-12).any() else 0.0, 12),
        "condition_number_2norm": round(largest / max(smallest, 1e-30), 4),
        "effective_rank": round(effective_rank, 4),
        "pc1_variance_pct": round(float(share[0] * 100), 4),
        "pc10_variance_pct": round(float(share[:10].sum() * 100), 4),
        "feature_norm_min": round(float(norms.min()), 6),
        "feature_norm_median": round(float(np.median(norms)), 6),
        "feature_norm_max": round(float(norms.max()), 6),
        "snr_median": round(float(np.median(sd / (np.abs(mu) + 1e-12))), 6),
    }


# ---------------------------------------------------------------- head training


def accuracy(logits: torch.Tensor, labels: torch.Tensor) -> float:
    return float((logits.argmax(-1) == labels).float().mean())


def entropy_of(logits: torch.Tensor) -> float:
    logp = F.log_softmax(logits, dim=-1)
    return float(-(logp.exp() * logp).sum(-1).mean())


def train_head(
    x_fit, y_fit, eval_sets, mode: str, steps: int, batch: int, seed: int,
) -> dict:
    """Train one Linear on fixed vectors. `mode` selects the optimiser recipe.

    `production` reproduces what `fret_classifier` actually receives: AdamW at 3e-3
    with weight decay 0.01, a cosine schedule warmed up over the first 25% of the
    1200-step horizon, and gradient clipping at 1.0. `probe` reproduces the recipe
    that worked: plain Adam at 1e-3, constant, no decay, no clipping.
    """
    torch.manual_seed(seed)
    classes = PROD_CLASSES if mode in ("production",) else PROBE_CLASSES
    net = torch.nn.Linear(x_fit.shape[1], classes)
    xt = torch.from_numpy(x_fit.astype(np.float32))
    yt = torch.from_numpy(y_fit.astype(np.int64))
    generator = torch.Generator().manual_seed(seed)
    loss_fn = torch.nn.CrossEntropyLoss()

    if mode == "production":
        optimiser = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=0.01)
        warmup = max(1, int(steps * 0.25))

        def factor(step: int) -> float:
            if step < warmup:
                return (step + 1) / warmup
            progress = (step - warmup) / max(steps - warmup, 1)
            return 0.5 * (1 + math.cos(math.pi * min(progress, 1.0)))

        schedule = torch.optim.lr_scheduler.LambdaLR(optimiser, factor)
        clip = 1.0
    elif mode == "probe":
        optimiser = torch.optim.Adam(net.parameters(), lr=1e-3)
        schedule = None
        clip = None
    else:
        raise ValueError(mode)

    tensors = [(torch.from_numpy(x.astype(np.float32)),
                torch.from_numpy(y.astype(np.int64))) for x, y in eval_sets]
    curve: list[dict] = []
    for step in range(1, steps + 1):
        net.train()
        index = torch.randint(0, xt.shape[0], (batch,), generator=generator)
        optimiser.zero_grad()
        loss = loss_fn(net(xt[index]), yt[index])
        loss.backward()
        grad_norm = float(torch.nn.utils.clip_grad_norm_(net.parameters(), clip)
                          if clip is not None
                          else torch.sqrt(sum((p.grad ** 2).sum() for p in net.parameters())))
        optimiser.step()
        if schedule is not None:
            schedule.step()
        if step == 1 or step % max(1, steps // 20) == 0 or step == steps:
            net.eval()
            with torch.no_grad():
                fit_logits = net(xt)
                entry = {
                    "step": step,
                    "lr": round(float(optimiser.param_groups[0]["lr"]), 8),
                    "batch_loss": round(float(loss), 6),
                    "grad_norm": round(grad_norm, 6),
                    "train_loss": round(float(loss_fn(fit_logits, yt)), 6),
                    "train_acc": round(accuracy(fit_logits, yt), 6),
                    "weight_norm": round(float(net.weight.norm()), 6),
                    "bias_norm": round(float(net.bias.norm()), 6),
                    "logit_std": round(float(fit_logits.std()), 6),
                    "logit_absmax": round(float(fit_logits.abs().max()), 6),
                    "pred_entropy": round(entropy_of(fit_logits), 6),
                    "distinct_predicted": int(fit_logits.argmax(-1).unique().numel()),
                }
                for name, (xe, ye) in zip(("same_score", "score_disjoint"), tensors[1:]):
                    logits = net(xe)
                    entry[f"{name}_acc"] = round(accuracy(logits, ye), 6)
                curve.append(entry)
    net.eval()
    with torch.no_grad():
        fit_logits = net(xt)
        final = {
            "train_acc": round(accuracy(fit_logits, yt), 6),
            "train_loss": round(float(loss_fn(fit_logits, yt)), 6),
            "weight_norm": round(float(net.weight.norm()), 6),
            "bias_norm": round(float(net.bias.norm()), 6),
            "logit_std": round(float(fit_logits.std()), 6),
            "logit_absmax": round(float(fit_logits.abs().max()), 6),
            "pred_entropy": round(entropy_of(fit_logits), 6),
            "distinct_predicted": int(fit_logits.argmax(-1).unique().numel()),
        }
        for name, (xe, ye) in zip(("same_score", "score_disjoint"), tensors[1:]):
            final[f"{name}_acc"] = round(accuracy(net(xe), ye), 6)
    return {"config": {"mode": mode, "classes": classes, "steps": steps, "batch": batch,
                       "seed": seed, "weight_decay": 0.01 if mode == "production" else 0.0,
                       "clip": clip, "schedule": "cosine+warmup" if schedule else "none"},
            "curve": curve, "final": final}


# ---------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ckpt", type=Path, default=Path("tmp/gvprobe/frz-ckpt/step1200"))
    parser.add_argument("--dataset", type=Path, default=Path("tmp/gvprobe/P_frozen_step1200.npz"))
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/head-only-p.json"))
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=128)
    parser.add_argument("--steps", type=int, default=1200)
    parser.add_argument("--probe-steps", type=int, default=3000)
    args = parser.parse_args()

    device = Device("cpu")

    # ---- D0: extract and persist P, verify the probe reproduces -----------
    if args.dataset.exists():
        blob = np.load(args.dataset)
        print(f"loaded cached P from {args.dataset}", flush=True)
    else:
        print("extracting P from the frozen checkpoint...", flush=True)
        model = build(VARIANT, h76.args_for(VARIANT, args.image_size, args.max_objects), device)
        model.load_state_dict(torch.load(args.ckpt / "state.pt", map_location="cpu",
                                         weights_only=False)["model"])
        model.eval()
        for parameter in model.parameters():
            parameter.requires_grad_(False)
        everything = load_dataset(
            _REPO / "datasets/guitar-vision/synthetic/train/records",
            _REPO / "datasets/guitar-vision/synthetic/train/views",
            size=(args.image_size, args.image_size), limit=0)
        store, labels, scores, page, row = h76.extract_stages(model, everything, device,
                                                              h76.args_for(VARIANT, args.image_size,
                                                                           args.max_objects))
        args.dataset.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(args.dataset, P=store["P"], labels=labels, scores=scores,
                            page=page, row=row)
        blob = np.load(args.dataset)
        print(f"  wrote {args.dataset}", flush=True)

    P = blob["P"].astype(np.float32)
    labels = blob["labels"]
    scores = blob["scores"]
    page, row = blob["page"], blob["row"]
    fit, same, held, _ = d8.splits(scores, page, row)
    print(f"  P {P.shape} | fit {fit.sum()} same {same.sum()} held {held.sum()}", flush=True)

    z = d8.standardise(P, fit)
    params, (p_all, _, _) = d8.flat_probe(
        z[fit], labels[fit], [z, z, z], [labels, labels, labels], "linear",
        args.probe_steps, SEED)
    reproduced = float((p_all[held] == labels[held]).mean())
    print(f"  [D0] reproduced linear probe score-disjoint = {reproduced:.4f} "
          f"(expected ~0.4506)", flush=True)
    if abs(reproduced - 0.4506) > 0.03:
        print("FATAL: extraction did not reproduce the probe; stopping.")
        return 3

    report: dict = {
        "p_extraction": {
            "checkpoint": str(args.ckpt), "shape": list(P.shape),
            "probe_reproduced_score_disjoint": round(reproduced, 6),
            "probe_expected": 0.4506, "probe_params": int(params),
        },
        "probe_recipe_d1": {
            "input": "z = (x - mean_fit) / (std_fit + 1e-6), stats from 614 fit rows only",
            "classes": PROBE_CLASSES, "init": "torch.nn.Linear default, manual_seed(11)",
            "optimiser": "Adam(lr=1e-3), default betas/eps",
            "weight_decay": 0.0, "loss": "CrossEntropyLoss mean",
            "schedule": "none, constant", "grad_clip": None,
            "steps": args.probe_steps, "batch": 64, "sampling": "randint with replacement",
            "train_rows": int(fit.sum()),
        },
        "production_recipe": {
            "input": "raw P", "classes": PROD_CLASSES,
            "optimiser": "AdamW(lr=3e-3, weight_decay=0.01)",
            "schedule": "LambdaLR cosine, warmup 25% of 1200 = 300",
            "grad_clip": 1.0, "steps": args.steps, "batch": "4 pages ~ 77 fret objects",
            "loss": "F.cross_entropy(ignore_index=-100) over fret objects",
        },
    }

    # ---- D5: conditioning, raw and standardised --------------------------
    mean_fit = P[fit].mean(axis=0, keepdims=True)
    std_fit = P[fit].std(axis=0, keepdims=True) + EPS
    Z = (P - mean_fit) / std_fit
    report["conditioning_d5"] = {"raw_P": conditioning(P[fit]), "standardised_P": conditioning(Z[fit])}
    print("\n=== D5 conditioning (fit rows) ===", flush=True)
    for name, block in report["conditioning_d5"].items():
        print(f"  {name:<16} |mu| {block['feature_mean_abs_mean']:.5f} "
              f"std med {block['feature_std_median']:.6f} std max {block['feature_std_max']:.6f} "
              f"near-zero-var {block['near_zero_variance_count']} "
              f"eff_rank {block['effective_rank']:.2f} PC1 {block['pc1_variance_pct']:.2f}% "
              f"cond {block['condition_number_2norm']:.3e}", flush=True)

    # ---- D2 / D3 / D4 ---------------------------------------------------
    # Production's fret objects per 4-page batch, measured on the real corpus, so
    # the head-only batch size matches what the head actually saw.
    corpus = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(args.image_size, args.image_size), limit=0)
    page_counts = [int((corpus[i]["object_type"] == 1).sum()) for i in range(40)]
    per_batch = float(np.mean([sum(page_counts[i:i + 4]) for i in range(0, 40, 4)]))
    print(f"\n  production batch size measured from the corpus: {per_batch:.1f} "
          f"fret objects per 4-page batch", flush=True)
    report["production_batch_measured"] = round(per_batch, 2)

    runs: dict = {}
    print("\n=== D2 RAW P, production optimiser ===", flush=True)
    runs["D2_raw_production"] = train_head(
        P[fit], labels[fit],
        [(P[fit], labels[fit]), (P[same], labels[same]), (P[held], labels[held])],
        "production", args.steps, int(round(per_batch)), SEED)
    f = runs["D2_raw_production"]["final"]
    print(f"  train {f['train_acc']:.4f} (loss {f['train_loss']:.4f}) "
          f"same {f['same_score_acc']:.4f} held {f['score_disjoint_acc']:.4f} "
          f"| logit_std {f['logit_std']:.4f} distinct {f['distinct_predicted']}", flush=True)

    print("\n=== D3 STANDARDISED P, production optimiser ===", flush=True)
    runs["D3_standardised_production"] = train_head(
        Z[fit], labels[fit],
        [(Z[fit], labels[fit]), (Z[same], labels[same]), (Z[held], labels[held])],
        "production", args.steps, int(round(per_batch)), SEED)
    f = runs["D3_standardised_production"]["final"]
    print(f"  train {f['train_acc']:.4f} (loss {f['train_loss']:.4f}) "
          f"same {f['same_score_acc']:.4f} held {f['score_disjoint_acc']:.4f} "
          f"| logit_std {f['logit_std']:.4f} distinct {f['distinct_predicted']}", flush=True)

    print("\n=== D4 RAW P, diagnostic-probe optimiser ===", flush=True)
    runs["D4_raw_probe_optim"] = train_head(
        P[fit], labels[fit],
        [(P[fit], labels[fit]), (P[same], labels[same]), (P[held], labels[held])],
        "probe", args.probe_steps, 64, SEED)
    f = runs["D4_raw_probe_optim"]["final"]
    print(f"  train {f['train_acc']:.4f} (loss {f['train_loss']:.4f}) "
          f"same {f['same_score_acc']:.4f} held {f['score_disjoint_acc']:.4f} "
          f"| logit_std {f['logit_std']:.4f} distinct {f['distinct_predicted']}", flush=True)

    # Fourth cell of the 2x2. Without it the design confounds conditioning with
    # optimiser: the successful probe used standardised inputs AND the probe
    # optimiser, so only this cell can confirm the probe is reproduced by
    # conditioning alone rather than by the optimiser recipe.
    print("\n=== D5-cell STANDARDISED P, diagnostic-probe optimiser ===", flush=True)
    runs["D5_standardised_probe_optim"] = train_head(
        Z[fit], labels[fit],
        [(Z[fit], labels[fit]), (Z[same], labels[same]), (Z[held], labels[held])],
        "probe", args.probe_steps, 64, SEED)
    f = runs["D5_standardised_probe_optim"]["final"]
    print(f"  train {f['train_acc']:.4f} (loss {f['train_loss']:.4f}) "
          f"same {f['same_score_acc']:.4f} held {f['score_disjoint_acc']:.4f} "
          f"| logit_std {f['logit_std']:.4f} distinct {f['distinct_predicted']}", flush=True)
    report["runs"] = runs
    report["two_by_two"] = {
        name: {"train": r["final"]["train_acc"], "same_score": r["final"]["same_score_acc"],
               "score_disjoint": r["final"]["score_disjoint_acc"]}
        for name, r in runs.items()
    }

    # ---- D7: decision ----------------------------------------------------
    d2 = runs["D2_raw_production"]["final"]
    d3 = runs["D3_standardised_production"]["final"]
    d4 = runs["D4_raw_probe_optim"]["final"]
    d5 = runs["D5_standardised_probe_optim"]["final"]
    verdict = {
        "probe_reference_score_disjoint": round(reproduced, 6),
        "real_run_train_fret": 0.0600,
        "real_run_score_disjoint": 0.0557,
        "grid": {
            "raw_production_optim": {"train": d2["train_acc"],
                                     "same_score": d2["same_score_acc"],
                                     "score_disjoint": d2["score_disjoint_acc"]},
            "raw_probe_optim": {"train": d4["train_acc"],
                                "same_score": d4["same_score_acc"],
                                "score_disjoint": d4["score_disjoint_acc"]},
            "standardised_production_optim": {"train": d3["train_acc"],
                                              "same_score": d3["same_score_acc"],
                                              "score_disjoint": d3["score_disjoint_acc"]},
            "standardised_probe_optim": {"train": d5["train_acc"],
                                         "same_score": d5["same_score_acc"],
                                         "score_disjoint": d5["score_disjoint_acc"]},
        },
    }
    verdict["conditioning_effect_same_optimizer_production"] = round(
        d3["score_disjoint_acc"] - d2["score_disjoint_acc"], 6)
    verdict["optimizer_effect_same_input_raw"] = round(
        d4["score_disjoint_acc"] - d2["score_disjoint_acc"], 6)
    verdict["optimizer_effect_same_input_standardised"] = round(
        d5["score_disjoint_acc"] - d3["score_disjoint_acc"], 6)
    verdict["nonstationarity_effect_frozen_vs_real_train"] = round(
        d2["train_acc"] - 0.0600, 6)
    verdict["nonstationarity_effect_frozen_vs_real_held"] = round(
        d2["score_disjoint_acc"] - 0.0557, 6)
    # CASE B is the call when conditioning moves held-out far more than the optimiser
    # does, and the standardised cell lands near the reproduced probe.
    conditioning_wins = (abs(verdict["conditioning_effect_same_optimizer_production"])
                         > max(abs(verdict["optimizer_effect_same_input_raw"]),
                               abs(verdict["optimizer_effect_same_input_standardised"])))
    if conditioning_wins and d3["score_disjoint_acc"] > d2["score_disjoint_acc"]:
        verdict["case"] = "B - input conditioning is binding, not the optimiser"
    elif d2["score_disjoint_acc"] > 0.40:
        verdict["case"] = "A - production Linear is capable on frozen raw P; the real run failed on non-stationary P"
    else:
        verdict["case"] = "C/D - neither factor explains the probe; audit further"
    report["verdict"] = verdict
    print("\n=== 2x2 (train / same / held) ===", flush=True)
    for name, cell in verdict["grid"].items():
        print(f"  {name:<32} {cell['train']:.4f} / {cell['same_score']:.4f} / "
              f"{cell['score_disjoint']:.4f}", flush=True)
    print(f"  conditioning effect (same optim): {verdict['conditioning_effect_same_optimizer_production']:+.4f}")
    print(f"  optimizer effect (raw input):     {verdict['optimizer_effect_same_input_raw']:+.4f}")
    print(f"  optimizer effect (standardised):   {verdict['optimizer_effect_same_input_standardised']:+.4f}")
    print(f"  non-stationarity (frozen vs real): train {verdict['nonstationarity_effect_frozen_vs_real_train']:+.4f}, "
          f"held {verdict['nonstationarity_effect_frozen_vs_real_held']:+.4f}")
    print(f"\n=== D7 VERDICT: {verdict['case']} ===", flush=True)

    # ---- D7b: which normalisation? selected WITHOUT held-out -------------
    # Selection rule, fixed before looking at any of these numbers:
    #   primary   same-score unseen accuracy  (in-split generalisation)
    #   tie-break train accuracy
    # Score-disjoint is recorded for every candidate but is NOT an input to the
    # choice, per D8.
    print("\n=== D7b normalisation candidates (selection: same-score, then train) ===",
          flush=True)

    def apply_ln(x, affine_scale, affine_bias, eps=1e-5):
        mu = x.mean(axis=1, keepdims=True)
        sd = x.std(axis=1, keepdims=True) + eps
        return (x - mu) / sd * affine_scale + affine_bias

    candidates = {
        "raw": P,
        "train_stat_standardised": Z,
        "global_scale_only": P / float(np.median(P[fit].std(axis=0))),
        "layernorm_affine": apply_ln(P, np.ones(P.shape[1]), np.zeros(P.shape[1])),
        "layernorm_non_affine": apply_ln(P, 1.0, 0.0),
    }
    selection = {}
    for name, matrix in candidates.items():
        run = train_head(
            matrix[fit], labels[fit],
            [(matrix[fit], labels[fit]), (matrix[same], labels[same]), (matrix[held], labels[held])],
            "production", args.steps, int(round(per_batch)), SEED)
        f = run["final"]
        selection[name] = {
            "train_acc": f["train_acc"], "same_score_acc": f["same_score_acc"],
            "score_disjoint_REPORTED_ONLY": f["score_disjoint_acc"],
            "train_loss": f["train_loss"], "gnorm": run["curve"][-1]["grad_norm"],
            "logit_std": f["logit_std"], "entropy": f["pred_entropy"],
            "effective_rank": conditioning(matrix[fit])["effective_rank"],
        }
        print(f"  {name:<24} same {f['same_score_acc']:.4f}  train {f['train_acc']:.4f}  "
              f"[held reported only {f['score_disjoint_acc']:.4f}]", flush=True)
    chosen = max(selection, key=lambda k: (selection[k]["same_score_acc"],
                                           selection[k]["train_acc"]))
    print(f"  SELECTED (same-score first): {chosen}", flush=True)
    report["normalisation_selection_d7b"] = {
        "selection_rule": "max same_score_acc, tie-break train_acc; held-out NOT used",
        "candidates": selection, "selected": chosen,
        "selected_score_disjoint_REPORTED_ONLY": selection[chosen]["score_disjoint_REPORTED_ONLY"],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"wrote {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
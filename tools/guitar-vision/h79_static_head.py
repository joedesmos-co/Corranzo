"""Post-hoc static-representation fret head: is the head's problem that P moves?

## The question

The cumulative-standardization run at ``cf7a8c4096`` left two stacked suspects for why
a production ``Linear(192 -> 26)`` cannot fit the fret task:

1. **Cumulative statistics lagged the moving target** by 2.74x -> 4.56x -> 3.69x, so the
   head's input was delivered ~3.7x under-scaled even after standardisation.
2. **The representation itself was non-stationary.** The head-only diagnostic on a
   *frozen* ``P`` reached 0.4203; the same recipe on the moving ``P`` of the previous run
   reached 0.1671.

Both are eliminated here by construction rather than by argument. ``P`` is extracted once
from the terminal checkpoint into a matrix, so it is mathematically impossible for it to
move. Train-only statistics are computed exactly from the 614 fit rows, so there is no
lag of any kind. Then a freshly initialised ``Linear(192 -> 26)`` is trained on that
static matrix under the production optimiser recipe.

Everything upstream is frozen: backbone, ``RoiEncoder``, ``roi_projection``, the trained
standardizer and the unrelated heads are all read once and never updated. The only
parameters that move are the 192x26 classifier's.

## Preregistration

Terminal step is **3000**, chosen before the run and not from any held-out number. The
successful diagnostic probe was already defined at 3000 steps, so this is the matched
budget, not an extension granted because results looked promising. The score-disjoint set
is evaluated **once**, at the terminal step. Between checkpoints only FIT and same-score
are inspected, both of which are training-side quantities.

Learning-curve checkpoints 200 / 400 / 700 / 1200 / 2000 / 3000. The cosine schedule is
built for the 3000-step horizon with the production shape (25% warmup), i.e. the same
recipe at the new budget.

## Matched control

The identical head, data, optimiser and budget with **raw** ``P`` and no standardisation.
That is the causal comparison: everything except input scale is held fixed.
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
import h74_roi_only_no_token as h74  # noqa: E402
import h75_no_token_localize as h75  # noqa: E402
import h78_standardized_p as h78  # noqa: E402
from guitar_vision.dataset import load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402

VARIANT = "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED"
SEED = 11
PROD_CLASSES = 26
PROBE_CLASSES = 20
EPS = 1e-6
CHECKPOINTS = (200, 400, 700, 1200, 2000, 3000)
TERMINAL = 3000
PRODUCTION_BATCH = 77  # measured: 76.7 fret objects per 4-page batch
REFERENCE = {
    "standardized_joint_run_train": 0.0587,
    "standardized_joint_run_same_score": 0.0654,
    "standardized_joint_run_score_disjoint": 0.0304,
    "frozen_no_token_joint_train": 0.0600,
    "frozen_no_token_joint_score_disjoint": 0.0557,
    "shared_joint_score_disjoint": 0.0684,
    "head_only_frozenP_raw_production": 0.1671,
    "head_only_frozenP_standardised_production": 0.4203,
    "P_probe_score_disjoint_at_1200": 0.5722,
    "chance": 0.0734,
    "held_out_n": 395,
}


def extract_raw_p(checkpoint: Path, device: Device, cache: Path, image_size: int,
                  max_objects: int):
    """RAW roi_projection output for every fret object, cached so it cannot move."""
    if cache.exists():
        blob = np.load(cache)
        print(f"loaded cached raw P from {cache}", flush=True)
        return blob["P"].astype(np.float32), blob["labels"], blob["scores"], blob["page"], blob["row"]
    args = h78.args_for(VARIANT, image_size, max_objects)
    model = build(VARIANT, args, device)
    model.load_state_dict(torch.load(checkpoint / "state.pt", map_location="cpu",
                                     weights_only=False)["model"])
    model.eval()
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(image_size, image_size), limit=0)
    store, labels, scores, page, row = h78.extract_stages(model, everything, device, args)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, P=store["P"], labels=labels, scores=scores, page=page, row=row)
    print(f"wrote {cache}", flush=True)
    return store["P"], labels, scores, page, row


def train_static_head(x_fit, y_fit, x_same, y_same, x_held, y_held, *, steps, batch,
                      seed, classes, checkpoints) -> dict:
    """The production optimiser recipe, on a static matrix.

    Same LR, weight decay, clipping and cosine shape as production, built for the
    preregistered 3000-step horizon. Score-disjoint is touched once, at `steps`.
    """
    torch.manual_seed(seed)
    net = torch.nn.Linear(x_fit.shape[1], classes)
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

    def snapshot(step: int, grad_norm: float, batch_loss: float) -> dict:
        net.eval()
        with torch.no_grad():
            fit_logits = net(xt)
            same_logits = net(xs)
            logp = F.log_softmax(fit_logits, dim=-1)
            entry = {
                "step": step,
                "lr": round(float(optimiser.param_groups[0]["lr"]), 8),
                "batch_loss": round(batch_loss, 6),
                "grad_norm": round(grad_norm, 6),
                "fit_loss": round(float(loss_fn(fit_logits, yt)), 6),
                "fit_acc": round(float((fit_logits.argmax(-1) == yt).float().mean()), 6),
                "same_score_acc": round(float((same_logits.argmax(-1) == ys).float().mean()), 6),
                "weight_norm": round(float(net.weight.norm()), 6),
                "bias_norm": round(float(net.bias.norm()), 6),
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
        fit_logits, same_logits, held_logits = net(xt), net(xs), net(xh)
        logp = F.log_softmax(fit_logits, dim=-1)
        terminal = {
            "fit_acc": round(float((fit_logits.argmax(-1) == yt).float().mean()), 6),
            "fit_loss": round(float(loss_fn(fit_logits, yt)), 6),
            "same_score_acc": round(float((same_logits.argmax(-1) == ys).float().mean()), 6),
            "score_disjoint_acc": round(float((held_logits.argmax(-1) == yh).float().mean()), 6),
            "weight_norm": round(float(net.weight.norm()), 6),
            "bias_norm": round(float(net.bias.norm()), 6),
            "logit_std": round(float(fit_logits.std()), 6),
            "logit_absmax": round(float(fit_logits.abs().max()), 6),
            "pred_entropy": round(float(-(logp.exp() * logp).sum(-1).mean()), 6),
            "distinct_predicted_train": int(fit_logits.argmax(-1).unique().numel()),
            "distinct_predicted_held": int(held_logits.argmax(-1).unique().numel()),
        }
        prediction = held_logits.argmax(-1).numpy()
    return {"config": {"steps": steps, "batch": batch, "seed": seed, "classes": classes,
                       "lr": 3e-3, "weight_decay": 0.01, "clip": 1.0,
                       "warmup": warmup, "schedule": "cosine over the terminal horizon"},
            "curve": curve, "terminal": terminal, "held_prediction": prediction}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ckpt", type=Path, default=Path("tmp/gvprobe/std-ckpt/step1200"))
    parser.add_argument("--cache", type=Path, default=Path("tmp/gvprobe/P_std_step1200.npz"))
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/static-head.json"))
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=128)
    parser.add_argument("--steps", type=int, default=TERMINAL)
    parser.add_argument("--batch", type=int, default=PRODUCTION_BATCH)
    parser.add_argument("--probe-steps", type=int, default=3000)
    parser.add_argument("--twenty-class", action="store_true", default=True)
    args = parser.parse_args()
    checkpoints = set(CHECKPOINTS)

    device = Device("cpu")
    report: dict = {"reference": REFERENCE}

    # ---- H1: extract raw P, verify the probe reproduces ------------------
    P, labels, scores, page, row = extract_raw_p(
        args.ckpt, device, args.cache, args.image_size, args.max_objects)
    fit, same, held, _ = d8.splits(scores, page, row)
    print(f"P {P.shape} | fit {fit.sum()} same {same.sum()} held {held.sum()}", flush=True)
    if (int(fit.sum()), int(same.sum()), int(held.sum())) != (614, 153, 395):
        print("FATAL: split sizes changed; stopping.")
        return 3
    z_probe = d8.standardise(P, fit)
    _, (p_all, _, _) = d8.flat_probe(
        z_probe[fit], labels[fit], [z_probe, z_probe, z_probe],
        [labels, labels, labels], "linear", args.probe_steps, SEED)
    reproduced = float((p_all[held] == labels[held]).mean())
    print(f"[H1] raw-P diagnostic probe score-disjoint = {reproduced:.4f} "
          f"(expected ~{REFERENCE['P_probe_score_disjoint_at_1200']})", flush=True)
    if abs(reproduced - REFERENCE["P_probe_score_disjoint_at_1200"]) > 0.03:
        print("FATAL: extraction did not reproduce the probe; stopping.")
        return 3
    report["h1_extraction"] = {
        "checkpoint": str(args.ckpt), "shape": list(P.shape),
        "split": {"fit": int(fit.sum()), "same_score": int(same.sum()),
                  "score_disjoint": int(held.sum())},
        "probe_reproduced_score_disjoint": round(reproduced, 6),
        "probe_expected": REFERENCE["P_probe_score_disjoint_at_1200"],
    }

    # ---- H2: exact train-only statistics ---------------------------------
    mu = P[fit].mean(axis=0)
    sigma = P[fit].std(axis=0)
    Z = (P - mu) / (sigma + EPS)
    fit_mean_abs = float(np.abs(Z[fit].mean(axis=0)).max())
    fit_std_dev = float(np.abs(Z[fit].std(axis=0) - 1.0).max())
    print(f"[H2] exact train-only mu/sigma from {int(fit.sum())} rows", flush=True)
    print(f"     FIT Z: max |per-feature mean| = {fit_mean_abs:.2e}, "
          f"max |per-feature std - 1| = {fit_std_dev:.2e}", flush=True)
    print(f"     mu range [{mu.min():.5f}, {mu.max():.5f}]  "
          f"sigma range [{sigma.min():.5f}, {sigma.max():.5f}]", flush=True)
    report["h2_statistics"] = {
        "computed_from": "the 614 fit rows only",
        "mu_min": round(float(mu.min()), 8), "mu_max": round(float(mu.max()), 8),
        "sigma_min": round(float(sigma.min()), 8), "sigma_max": round(float(sigma.max()), 8),
        "sigma_median": round(float(np.median(sigma)), 8),
        "fit_z_max_abs_feature_mean": fit_mean_abs,
        "fit_z_max_abs_feature_std_minus_one": fit_std_dev,
        "near_zero_variance_features": int((sigma < 1e-6).sum()),
        "epsilon": EPS,
        "held_out_used": False,
    }

    held_labels = labels[held]
    held_strings = None

    # ---- H3/H5: raw vs standardised, one head each -----------------------
    runs = {}
    for name, matrix in (("raw", P), ("standardised", Z)):
        print(f"\n=== H3/H5 {name.upper()} P, production Linear(192 -> {PROD_CLASSES}) ===",
              flush=True)
        run = train_static_head(
            matrix[fit], labels[fit], matrix[same], labels[same], matrix[held], held_labels,
            steps=args.steps, batch=args.batch, seed=SEED, classes=PROD_CLASSES,
            checkpoints=checkpoints)
        runs[name] = run
        for entry in run["curve"]:
            print(f"  step {entry['step']:>5}: fit {entry['fit_acc']:.4f} "
                  f"(loss {entry['fit_loss']:.4f}) same-score {entry['same_score_acc']:.4f} "
                  f"| logit_std {entry['logit_std']:.3f} ndist {entry['distinct_predicted']}",
                  flush=True)
        t = run["terminal"]
        print(f"  TERMINAL fit {t['fit_acc']:.4f} same {t['same_score_acc']:.4f} "
              f"score-disjoint {t['score_disjoint_acc']:.4f}", flush=True)
    report["runs"] = {k: {"config": v["config"], "curve": v["curve"], "terminal": v["terminal"]}
                      for k, v in runs.items()}

    # ---- H6: terminal tables for both ------------------------------------
    tables = {}
    for name, run in runs.items():
        prediction = run["held_prediction"]
        per_fret: dict[int, dict] = {}
        for truth, guess in zip(held_labels.tolist(), prediction.tolist()):
            cell = per_fret.setdefault(truth, {"count": 0, "correct": 0})
            cell["count"] += 1
            cell["correct"] += int(truth == guess)
        matrix = {}
        for truth, guess in zip(held_labels.tolist(), prediction.tolist()):
            row_ = matrix.setdefault(str(truth), {})
            row_[str(guess)] = row_.get(str(guess), 0) + 1
        digits = (held_labels >= 10)
        tables[name] = {
            "per_fret": {str(k): {**v, "accuracy": round(v["correct"] / v["count"], 4)}
                         for k, v in sorted(per_fret.items())},
            "confusion_matrix": matrix,
            "one_digit": round(float((prediction[~digits] == held_labels[~digits]).mean()), 6),
            "two_digit": round(float((prediction[digits] == held_labels[digits]).mean()), 6),
            "n_one_digit": int((~digits).sum()), "n_two_digit": int(digits.sum()),
            "correct": int((prediction == held_labels).sum()), "n": int(len(held_labels)),
            "wilson_95": h74.wilson(int((prediction == held_labels).sum()), len(held_labels)),
        }
    report["tables"] = tables

    # ---- H10 audit --------------------------------------------------------
    present = sorted(set(labels.tolist()))
    report["h10_vocabulary_audit"] = {
        "production_classes": PROD_CLASSES,
        "production_semantics": "0..24 are fret numbers, index 25 is NO_FRET",
        "probe_classes": PROBE_CLASSES,
        "fret_values_present_in_corpus": present,
        "classes_never_positive": [c for c in range(PROD_CLASSES) if c not in present],
        "note": ("20..24 are valid fret numbers that never occur in this corpus; 25 is "
                 "NO_FRET and is a target only for non-fret or padded slots, which the "
                 "fret loss masks out. So 6 of 26 logits are always negative."),
        "target_encoding": "F.cross_entropy(logits, fret, ignore_index=-100), fret objects only",
        "labels_are_raw_fret_values": True,
    }

    # ---- H11: 20-class diagnostic (only after the main runs) --------------
    if args.twenty_class:
        print(f"\n=== H11 20-class diagnostic, standardised P, same recipe ===", flush=True)
        twenty = train_static_head(
            Z[fit], labels[fit], Z[same], labels[same], Z[held], held_labels,
            steps=args.steps, batch=args.batch, seed=SEED, classes=PROBE_CLASSES,
            checkpoints=checkpoints)
        t = twenty["terminal"]
        print(f"  TERMINAL fit {t['fit_acc']:.4f} same {t['same_score_acc']:.4f} "
              f"score-disjoint {t['score_disjoint_acc']:.4f}", flush=True)
        report["h11_twenty_class"] = {"terminal": t,
                                      "curve": twenty["curve"]}
        report["h11_penalty"] = {
            "standardised_26_fit": runs["standardised"]["terminal"]["fit_acc"],
            "standardised_20_fit": t["fit_acc"],
            "standardised_26_score_disjoint": runs["standardised"]["terminal"]["score_disjoint_acc"],
            "standardised_20_score_disjoint": t["score_disjoint_acc"],
        }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(f"\nwrote {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
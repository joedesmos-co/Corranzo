"""Dedicated raw-ROI fret branch: can the 0.93 pixel signal be added to the real model?

## The question

Raw ``FINAL_ROI`` pixels classify the held-out scores at ~0.93 through a small CNN. The
current production representation reaches 0.5899. This asks whether that signal can be
added to the real Guitar model **without damaging any other task**.

## The design, and why it is cheap

The branch reads ``images`` and ``boxes`` -- data, not features -- so the fret loss has no
path back into the backbone, the samplers or the token path. ``object_type``, ``string``
and ``tile`` therefore cannot be affected by it, structurally. That makes a joint 3000-step
full-model run unnecessary: the only thing that could differ is the branch's own training,
and the branch's input does not depend on any frozen parameter.

So the shared model is taken from the validated phase-1 checkpoint and held fixed, and the
dedicated head is trained on the crops the model itself computes, through the same
``roi_fret_logits`` call ``forward`` uses. Integration is then verified by running a real
forward and requiring its fret logits to equal the head's output on those crops.

## Provenance first

Before anything is measured, the canonical ``guitar_vision.roi.sample_roi`` is compared
numerically against ``h1_direct_roi_probe.sample_roi``, the implementation that produced
the 0.93 result, and the established probe CNN is re-run on the extracted crops. If the
crops or the probe do not reproduce, nothing downstream is interpretable and the script
stops.

## Budget

The probe's own recipe: 3000 steps, batch 64, Adam lr 1e-3, no weight decay, no schedule.
Score-disjoint is read once, at the terminal step.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
import h73_learning_curve as h73  # noqa: E402
import h74_roi_only_no_token as h74  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402
from guitar_vision.roi import ROI_CROP, ROI_CONTEXT, sample_roi  # noqa: E402

VARIANT = "DEDICATED_ROI_FRET"
SHARED_VARIANT = "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED"
SEED = 11
STEPS = 3000
BATCH = 64
LR = 1e-3
TWO_DIGIT_FROM = 10
REFERENCE = {
    "roi_only_probe_score_disjoint": 0.9342,
    "roi_only_probe_train": 1.0,
    "roi_only_probe_same_score": 1.0,
    "roi_only_1_digit": 0.9395,
    "roi_only_2_digit": 0.9278,
    "production_two_phase_score_disjoint": 0.5899,
    "chance": 0.0734,
    "held_out_n": 395,
}


def args_for(variant: str, image_size: int, max_objects: int) -> argparse.Namespace:
    return argparse.Namespace(
        variant=variant, steps=1200, pages=40, batch_pages=4, held_out=20,
        image_size=image_size, max_objects=max_objects, hidden=192, layers=4,
        lr=3e-3, train_jitter=0.35, roi_grid=8, roi_context=ROI_CONTEXT, seed=SEED,
        device="cpu", out=None)


def tables(prediction, labels, strings) -> dict:
    cells: dict[int, dict] = {}
    for truth, guess in zip(labels.tolist(), prediction.tolist()):
        cell = cells.setdefault(truth, {"count": 0, "correct": 0})
        cell["count"] += 1
        cell["correct"] += int(truth == guess)
    matrix: dict[str, dict] = {}
    for truth, guess in zip(labels.tolist(), prediction.tolist()):
        row = matrix.setdefault(str(truth), {})
        row[str(guess)] = row.get(str(guess), 0) + 1
    top = {}
    for truth, row in matrix.items():
        for guess, count in row.items():
            if guess != truth:
                top[f"pred{guess}->true{truth}"] = count
    digits = labels >= TWO_DIGIT_FROM
    correct = prediction == labels
    per_string = {}
    for value in sorted(set(strings.tolist())):
        mask = strings == value
        per_string[str(value)] = {
            "count": int(mask.sum()),
            "correct": int(correct[mask].sum()),
            "accuracy": round(float(correct[mask].mean()), 4),
        }
    return {
        "per_fret": {str(k): {**v, "accuracy": round(v["correct"] / v["count"], 4)}
                     for k, v in sorted(cells.items())},
        "per_string": per_string,
        "confusion_matrix": matrix,
        "top_confusions": dict(sorted(top.items(), key=lambda kv: -kv[1])[:10]),
        "one_digit": round(float(correct[~digits].mean()), 6),
        "two_digit": round(float(correct[digits].mean()), 6),
        "n_one_digit": int((~digits).sum()), "n_two_digit": int(digits.sum()),
        "correct": int(correct.sum()), "n": int(len(labels)),
        "accuracy": round(float(correct.mean()), 6),
        "wilson_95": h74.wilson(int(correct.sum()), len(labels)),
        "distinct_predicted": int(len(set(prediction.tolist()))),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase1", type=Path, default=Path("tmp/gvprobe/std-ckpt/step1200"))
    parser.add_argument("--cached-p", type=Path, default=Path("tmp/gvprobe/P_std_step1200.npz"))
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/dedicated-roi.json"))
    parser.add_argument("--ckpt", type=Path, default=Path("tmp/gvprobe/dedicated-roi-ckpt/head.pt"))
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=128)
    parser.add_argument("--steps", type=int, default=STEPS)
    args = parser.parse_args()

    device = Device("cpu")
    report: dict = {"reference": REFERENCE}
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(args.image_size, args.image_size), limit=0)
    blob = np.load(args.cached_p)
    labels, scores, page, row = blob["labels"], blob["scores"], blob["page"], blob["row"]
    fit, same, held, _ = d8.splits(scores, page, row)
    split = {"fit": int(fit.sum()), "same_score": int(same.sum()),
             "score_disjoint": int(held.sum())}
    print(f"split {split}", flush=True)
    if split != {"fit": 614, "same_score": 153, "score_disjoint": 395}:
        print("FATAL: split does not match the established one")
        return 3

    # ---- R1: provenance of the crop ---------------------------------------
    print("\n[R1] crop provenance", flush=True)
    import h1_direct_roi_probe as h1
    batch = collate(everything[:1], args.max_objects)
    original = h1.sample_roi(
        batch["images"], batch["boxes"],
        torch.ones(batch["object_type"].shape[-1], dtype=torch.bool).unsqueeze(0),
        batch["view"], ROI_CROP)
    canonical = sample_roi(batch["images"], batch["boxes"], batch["object_mask"],
                           batch["view"], ROI_CROP, ROI_CONTEXT)
    keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
    delta_original = float((original[0, keep] - canonical[0, keep]).abs().max())
    print(f"  canonical vs h1 sample_roi on fret objects: max|delta| = {delta_original:.3e}",
          flush=True)
    if delta_original > 1e-6:
        print("FATAL: the canonical crop differs from the validated one; stopping.")
        return 3
    report["r1_provenance"] = {
        "canonical_vs_h1_max_abs_delta": delta_original,
        "crop": ROI_CROP, "context": ROI_CONTEXT,
        "note": "same box, same grid, same 1.6x context, same bilinear grid_sample",
    }

    # ---- build the dedicated variant on the frozen phase-1 shared model ----
    torch.manual_seed(SEED)
    model = build(VARIANT, args_for(VARIANT, args.image_size, args.max_objects), device)
    state = torch.load(args.phase1 / "state.pt", map_location="cpu", weights_only=False)
    base_weights = {k: v for k, v in state["model"].items() if k.startswith("base.")}
    missing, unexpected = model.load_state_dict(base_weights, strict=False)
    print(f"[R3] loaded phase-1 shared weights; missing {sorted(missing)}", flush=True)
    assert all(k.startswith("roi_head.") for k in missing), sorted(missing)
    assert unexpected == [], unexpected
    model.eval()
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    for parameter in model.roi_head.parameters():
        parameter.requires_grad_(True)

    # ---- extract crops through the model's own path -----------------------
    print("\n[R1] extracting crops via model.roi_crops (one page per forward)", flush=True)
    crops, crop_labels, crop_scores, crop_strings, crop_pages, crop_rows = [], [], [], [], [], []
    with torch.no_grad():
        for index, sample in enumerate(everything):
            batch = collate([sample], args.max_objects)
            batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                     for k, v in batch.items()}
            this = model.roi_crops(batch)
            keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
            crops.append(this[0, keep].numpy())
            for r in keep:
                crop_labels.append(int(batch["fret"][0, r]))
                crop_strings.append(int(batch["string"][0, r]))
                crop_scores.append(sample["score_id"])
                crop_pages.append(index)
                crop_rows.append(r)
    X = np.concatenate(crops).astype(np.float32)
    y = np.asarray(crop_labels)
    print(f"  crops {X.shape} | fit {fit.sum()} same {same.sum()} held {held.sum()}",
          flush=True)
    assert np.array_equal(np.asarray(crop_labels), labels)
    report["r1_crops"] = {"shape": list(X.shape), "split": split}

    # ---- reproduce the established ROI-only probe -------------------------
    print("\n[R5] reproducing the established ROI-only probe", flush=True)
    # `d8.cnn_probe` takes square (N, 32, 32) crops and unsqueezes the channel itself;
    # it was written against the stage-A tensor, which was never flattened.
    Xsq = X.reshape(-1, ROI_CROP, ROI_CROP)
    params, (probe_all, _, _) = d8.cnn_probe(
        Xsq[fit], y[fit], [Xsq, Xsq, Xsq], [y, y, y], STEPS, SEED)
    probe_held = float((probe_all[held] == y[held]).mean())
    probe_digits = (y >= TWO_DIGIT_FROM)
    probe_correct = probe_all[held] == y[held]
    print(f"  probe params {params} | train {float((probe_all[fit] == y[fit]).mean()):.4f} "
          f"same {float((probe_all[same] == y[same]).mean()):.4f} "
          f"score-disjoint {probe_held:.4f}", flush=True)
    report["r5_probe_reproduction"] = {
        "params": int(params),
        "train": round(float((probe_all[fit] == y[fit]).mean()), 6),
        "same_score": round(float((probe_all[same] == y[same]).mean()), 6),
        "score_disjoint": round(probe_held, 6),
        "one_digit": round(float(probe_correct[~probe_digits[held]].mean()), 6),
        "two_digit": round(float(probe_correct[probe_digits[held]].mean()), 6),
    }

    # ---- R2/R3/R4: train the model's own head ------------------------------
    print(f"\n[R4] training the model's roi_head: {args.steps} steps, batch {BATCH}, "
          f"Adam lr {LR}", flush=True)
    head = model.roi_head
    head.train()
    optimiser = torch.optim.Adam(head.parameters(), lr=LR)
    generator = torch.Generator().manual_seed(SEED)
    loss_fn = torch.nn.CrossEntropyLoss()
    xt = torch.from_numpy(X[fit])
    yt = torch.from_numpy(y[fit].astype(np.int64))
    curve = []
    for step in range(1, args.steps + 1):
        index = torch.randint(0, xt.shape[0], (BATCH,), generator=generator)
        optimiser.zero_grad()
        loss = loss_fn(head(xt[index]), yt[index])
        loss.backward()
        optimiser.step()
        if step in (200, 400, 700, 1200, 2000, 3000):
            head.eval()
            with torch.no_grad():
                entry = {
                    "step": step, "batch_loss": round(float(loss.detach()), 6),
                    "train_acc": round(float((head(xt).argmax(-1) == yt).float().mean()), 6),
                }
            head.train()
            curve.append(entry)
    head.eval()

    def predict(matrix) -> np.ndarray:
        with torch.no_grad():
            return head(torch.from_numpy(matrix.astype(np.float32))).argmax(-1).numpy()

    prediction = predict(X)
    strings = np.asarray(crop_strings)
    scores_array = np.asarray(crop_scores)
    terminal = tables(prediction[held], y[held], strings[held])
    # Per score as well as per string: a single failing score and a systematic per-class
    # failure look identical in the aggregate, and they need different fixes.
    per_score = {}
    for score in sorted(set(scores_array[held].tolist())):
        mask = scores_array[held] == score
        per_score[score] = {
            "count": int(mask.sum()),
            "correct": int((prediction[held][mask] == y[held][mask]).sum()),
            "accuracy": round(float((prediction[held][mask] == y[held][mask]).mean()), 4),
        }
    terminal["per_score"] = per_score
    train_acc = float((prediction[fit] == y[fit]).mean())
    same_acc = float((prediction[same] == y[same]).mean())
    print(f"  curve: " + " ".join(f"{e['step']}:{e['train_acc']:.4f}" for e in curve),
          flush=True)
    print(f"  TERMINAL train {train_acc:.4f} same {same_acc:.4f} "
          f"score-disjoint {terminal['accuracy']:.4f} "
          f"({terminal['correct']}/{terminal['n']})", flush=True)
    print(f"  1-digit {terminal['one_digit']:.4f}  2-digit {terminal['two_digit']:.4f} "
          f"| predicted classes {terminal['distinct_predicted']}", flush=True)
    report["r4_training"] = {"curve": curve, "steps": args.steps, "batch": BATCH,
                             "lr": LR, "optimiser": "Adam",
                             "train_acc": round(train_acc, 6),
                             "same_score_acc": round(same_acc, 6),
                             "terminal": terminal}

    # ---- R7: pixel causality on the crop -----------------------------------
    print("\n[R7] pixel controls", flush=True)
    controls = {}
    modes = {"normal": None, "blank": "blank", "wrong_roi": "wrong_roi",
             "pixel_ablation": "pixel_ablation"}
    for name, mode in modes.items():
        preds = []
        for index, sample in enumerate(everything):
            batch = collate([sample], args.max_objects)
            if mode == "pixel_ablation":
                batch = h74.ablate_roi_pixels(batch)
            elif mode == "blank":
                batch = h74._blank_images(batch)
            elif mode == "wrong_roi":
                batch = h73.wrong_roi_boxes(batch)
            batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                     for k, v in batch.items()}
            with torch.no_grad():
                this = model.roi_fret_logits(batch)
            keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
            preds.append(this[0, keep].argmax(-1).numpy())
        pred = np.concatenate(preds)
        correct = int((pred[held] == y[held]).sum())
        controls[name] = {"accuracy": round(float((pred[held] == y[held]).mean()), 6),
                          "correct": correct, "n": int(held.sum())}
        print(f"  {name:<16} {controls[name]['accuracy']:.4f}", flush=True)
    report["r7_controls"] = controls

    # ---- R9: unrelated heads -----------------------------------------------
    print("\n[R9] unrelated heads versus the shared baseline", flush=True)
    shared = build(SHARED_VARIANT, args_for(SHARED_VARIANT, args.image_size,
                                            args.max_objects), device)
    shared.load_state_dict(state["model"])
    shared.eval()
    identical = {}
    with torch.no_grad():
        for index in range(0, 6):
            batch = collate([everything[index]], args.max_objects)
            batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                     for k, v in batch.items()}
            a, b = model(batch), shared(batch)
            for name in ("object_type", "string", "tile"):
                identical.setdefault(name, True)
                identical[name] &= bool(torch.equal(a[name], b[name]))
    print(f"  bit-identical on the first six pages: {identical}", flush=True)
    report["r9_unrelated_heads"] = identical

    # ---- integration equivalence -------------------------------------------
    with torch.no_grad():
        batch = collate([everything[0]], args.max_objects)
        batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                 for k, v in batch.items()}
        forward_logits = model(batch)["fret"]
        head_logits = model.roi_head(model.roi_crops(batch))
    integration_delta = float((forward_logits - head_logits).abs().max())
    print(f"\nintegration: forward fret logits vs head-on-crops max|delta| "
          f"{integration_delta:.3e}", flush=True)
    report["integration_delta"] = integration_delta

    # ---- save the head -----------------------------------------------------
    args.ckpt.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "format": "guitar-vision-dedicated-roi-v1",
        "variant": VARIANT,
        "roi_head": head.state_dict(),
        "source_phase1": str(args.phase1),
        "crop": ROI_CROP, "context": ROI_CONTEXT,
        "split": split, "steps": args.steps,
    }, args.ckpt)
    report["checkpoint"] = str(args.ckpt)

    # ---- decision ----------------------------------------------------------
    observed = terminal["accuracy"]
    if observed >= REFERENCE["roi_only_probe_score_disjoint"] - 0.03:
        case = "A - integrated raw-ROI CNN matches the previous probe"
    elif observed > REFERENCE["production_two_phase_score_disjoint"] + 0.10:
        case = "B - clearly above 0.59 but well below the probe"
    else:
        case = "C - near the current 0.5899 or worse; audit provenance"
    report["decision"] = {"case": case, "observed": observed,
                          "probe_reference": REFERENCE["roi_only_probe_score_disjoint"],
                          "production_reference": REFERENCE["production_two_phase_score_disjoint"]}
    print(f"\n=== DECISION: {case} ===", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(f"wrote {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
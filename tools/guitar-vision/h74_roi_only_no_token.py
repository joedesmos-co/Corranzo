"""`ROI_ONLY_NO_TOKEN`: the causal test of the shared-token fusion bottleneck.

## The experiment

`fret_experiments.FretVariantModel` computes the `roi26` fret path as::

    fused = self.roi_projection(encoded.flatten(-2)) + tokens
    out["fret"] = self.fret_classifier(fused)

The representation localisation at commit 38d6fa7111 measured, on the frozen 1200-step
`shared` checkpoint and with no gradients anywhere:

    stage                          train-inst  same-score  score-disjoint
    A raw FINAL_ROI pixels (CNN)      1.0000      1.0000        0.9342
    B stride-1 feature ROI (linear)   0.9984      0.8954        0.7899
    C RoiEncoder output               0.9984      0.6797        0.6354
    D fused token                     0.9821      0.1765        0.0633

D -- the term `roi26` adds -- is the first stage at chance, and it fails even on
same-score unseen instances. So `roi26` reads a good representation and then adds a
collapsed one. This run removes that term and changes nothing else:

    fused = self.roi_projection(encoded.flatten(-2))

Everything else is the already-validated full-scale configuration, imported from
`fret_experiments` rather than re-derived: 40 train scores, 20 score-disjoint held-out
scores, 256px, 128 objects, hidden 192, 4 layers, lr 3e-3 AdamW, cosine with 25% warmup
built for the 1200-step terminal budget, grad clip 1.0, jitter 0.35, roi grid 8,
context 1.6, seed 11, CPU.

## What is reused and what is added

The training loop, the cosine schedule, the checkpoint format and the resume
validation are **imported from h73 unmodified**. That harness already proves a resumed
trajectory is bit-identical to an uninterrupted one, and re-deriving any of it here
would risk silently changing the experiment. Only the *reporting* is new.

## Held-out discipline

Held-out is evaluated at the terminal checkpoint only. Intermediate checkpoints get
train-side diagnostics exclusively. Nothing in this file reads a held-out number and
then changes a knob, and there is no post-hoc tuning.

## Controls at the terminal step

    NORMAL          the model's real input
    BLANK           the whole page whited out, boxes kept
    WRONG ROI       every fret box moved onto another fret's glyph
    PIXEL ABLATION  only the pixels *inside* each fret box removed, page intact
    NO GEOMETRY     geometry projection zeroed, all weights intact

Pixel ablation is the sharpest of these. Blank destroys the staff, the tab lines and
the noteheads along with the glyph, so a drop under blank does not by itself prove the
fret pixels were what mattered. Ablating only the box interior leaves the rest of the
page untouched, so accuracy can only fall if the glyph pixels specifically were load
bearing.
"""
from __future__ import annotations

import argparse
import json
import math
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

import h73_learning_curve as h73  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build, decode, fret_loss, _blank_images  # noqa: E402
from guitar_vision.qualify import HeadReport, chance_baselines, Device  # noqa: E402

VARIANT = "ROI_ONLY_NO_TOKEN"
FRET_CLASSES = 26
# Frozen `shared` @1200, for reference only. Not re-measured: the run is expensive
# and these numbers are already recorded at commit 7de63f525d / 2020669fdb.
SHARED_REFERENCE = {
    "train_fret": 0.4172,
    "score_disjoint": 0.0684,
    "blank": 0.1643,
    "wrong_roi": 0.0600,
    "one_digit_train": 0.5286,
    "two_digit_train": 0.3150,
    "held_out_n": 395,
    "chance": 0.0734,
}


def wilson(correct: int, total: int, z: float = 1.96) -> dict[str, float]:
    """Wilson score interval. A rescue has to clear chance, so the interval matters."""
    if total == 0:
        return {"low": 0.0, "high": 0.0, "point": 0.0}
    p = correct / total
    denominator = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denominator
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return {
        "point": round(p, 6),
        "low": round(max(0.0, centre - half), 6),
        "high": round(min(1.0, centre + half), 6),
    }


def ablate_roi_pixels(batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Remove only the pixels inside each fret box. Page, staff and boxes survive.

    Written with index assignment rather than a meshgrid mask so it is exact at the
    box edges and cheap. Only fret objects are ablated; other objects keep their
    pixels, so this cannot be satisfied by destroying the page.
    """
    out = dict(batch)
    images = batch["images"].clone()
    boxes = batch["boxes"]
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    height, width = images.shape[-2:]
    for page in range(images.shape[0]):
        rows = is_fret[page].nonzero(as_tuple=True)[0]
        for row in rows.tolist():
            x0, y0, x1, y1 = boxes[page, row].tolist()
            lo_x, hi_x = max(0, int(math.floor(x0))), min(width, int(math.ceil(x1)))
            lo_y, hi_y = max(0, int(math.floor(y0))), min(height, int(math.ceil(y1)))
            if hi_x > lo_x and hi_y > lo_y:
                images[page, :, :, lo_y:hi_y, lo_x:hi_x] = 1.0
    out["images"] = images
    return out


def measure(
    model,
    pages: list[dict[str, torch.Tensor]],
    device: Device,
    max_objects: int,
    mode: str,
    keep_tables: bool,
    chunk: int = 3,
) -> dict[str, Any]:
    """Fret accuracy under one intervention, with per-fret/per-string tables."""
    model.eval()
    detail = HeadReport(name="fret")
    per_string: dict[int, dict[str, int]] = {}
    matrix: dict[str, dict[str, int]] = {}
    correct = total = 0

    def to_device(batch):
        return {k: (v.to(device.torch) if torch.is_tensor(v) else v) for k, v in batch.items()}

    for start in range(0, len(pages), chunk):
        batch = collate(pages[start : start + chunk], max_objects)
        if mode == "blank":
            batch = _blank_images(batch)
        elif mode == "wrong_roi":
            batch = h73.wrong_roi_boxes(batch)
        elif mode == "pixel_ablation":
            batch = ablate_roi_pixels(batch)
        batch = to_device(batch)
        with torch.no_grad():
            out = model(batch)
            is_fret = batch["object_mask"] & (batch["object_type"] == 1)
            numbers = decode(out)
            ok = (numbers == batch["fret"]) & is_fret
            correct += int(ok.sum())
            total += int(is_fret.sum())
            for truth, prediction, right, string in zip(
                batch["fret"][is_fret].tolist(),
                numbers[is_fret].tolist(),
                ok[is_fret].tolist(),
                batch["string"][is_fret].tolist(),
            ):
                detail.record(truth, truth if right else prediction)
                cell = per_string.setdefault(string, {"count": 0, "correct": 0})
                cell["count"] += 1
                cell["correct"] += int(right)
                row = matrix.setdefault(str(truth), {})
                row[str(prediction)] = row.get(str(prediction), 0) + 1
        del batch, out

    result: dict[str, Any] = {
        "accuracy": round(correct / max(total, 1), 6),
        "correct": correct,
        "total": total,
        "digit_count_split": detail.digit_count_split(),
    }
    if keep_tables:
        result["per_fret"] = detail.class_accuracy()
        result["per_string"] = {
            str(k): {
                "count": v["count"],
                "correct": v["correct"],
                "accuracy": round(v["correct"] / v["count"], 6) if v["count"] else 0.0,
            }
            for k, v in sorted(per_string.items())
        }
        result["confusion_matrix"] = matrix
        result["top_confusions"] = dict(
            sorted(detail.confusion.items(), key=lambda i: -i[1])[:10]
        )
    return result


def measure_other_heads(
    model, pages, device: Device, max_objects: int, chunk: int = 3
) -> dict[str, Any]:
    """G7: the change is fret-local, so every other head must be reported too."""
    model.eval()
    tally = {
        name: {"correct": 0, "total": 0}
        for name in ("object_type", "string", "tile")
    }
    for start in range(0, len(pages), chunk):
        batch = collate(pages[start : start + chunk], max_objects)
        batch = {
            k: (v.to(device.torch) if torch.is_tensor(v) else v) for k, v in batch.items()
        }
        with torch.no_grad():
            out = model(batch)
        is_fret = batch["object_mask"] & (batch["object_type"] == 1)
        tally["object_type"]["correct"] += int((out["object_type"].argmax(-1) == batch["object_type"])[batch["object_mask"]].sum())
        tally["object_type"]["total"] += int(batch["object_mask"].sum())
        for name in ("string",):
            tally[name]["correct"] += int((out[name].argmax(-1) == batch["string"])[is_fret].sum())
            tally[name]["total"] += int(is_fret.sum())
        view = batch["view"]
        valid = batch["object_mask"] & (view < out["tile"].shape[-1])
        tally["tile"]["correct"] += int((out["tile"].argmax(-1) == view)[valid].sum())
        tally["tile"]["total"] += int(valid.sum())
        del batch, out
    return {
        name: {
            "accuracy": round(v["correct"] / max(v["total"], 1), 6),
            "correct": v["correct"],
            "total": v["total"],
        }
        for name, v in tally.items()
    }


def same_score_split(everything, train_pages: int) -> list[bool]:
    """Per page: is it in the same-score unseen-instance split?

    Within each train score, objects are ordered by (page, row) and the last 20% are
    held out. Those pages' objects are the "unseen instance, seen score" split used
    throughout the ROI diagnostics, so this number is comparable to stage D's 0.1765.
    """
    by_score: dict[str, list[int]] = {}
    for index, sample in enumerate(everything[:train_pages]):
        by_score.setdefault(sample["score_id"], []).append(index)
    flags = [False] * train_pages
    for indices in by_score.values():
        ordered = sorted(indices)
        counts = [int((everything[i]["object_type"] == 1).sum()) for i in ordered]
        total = sum(counts)
        seen = 0
        cut = int(round(total * 0.8))
        for position, index in enumerate(ordered):
            seen += counts[position]
            flags[index] = seen > cut
    return flags


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
    parser.add_argument("--roi-grid", type=int, default=8)
    parser.add_argument("--roi-context", type=float, default=1.6)
    parser.add_argument("--seed", type=int, default=11)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--checkpoints", default="200,400,700,1200")
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/roi-only-no-token.json"))
    parser.add_argument("--ckpt-root", type=Path, default=Path("tmp/gvprobe/roi-only-ckpt"))
    parser.add_argument("--resume-from", default=None)
    parser.add_argument("--validate-resume", action="store_true")
    parser.add_argument("--validate-steps", type=int, default=12)
    parser.add_argument("--log-every", type=int, default=25)
    args = parser.parse_args()
    args.variant = VARIANT
    checkpoints = {int(v) for v in args.checkpoints.split(",") if v}
    terminal = max(checkpoints) if checkpoints else args.steps

    device = Device(args.device)
    records = _REPO / "datasets/guitar-vision/synthetic/train/records"
    views = _REPO / "datasets/guitar-vision/synthetic/train/views"
    print("loading corpus...", flush=True)
    everything = load_dataset(records, views, size=(args.image_size, args.image_size), limit=0)
    train_samples = everything[: args.pages]
    held_samples = everything[args.pages : args.pages + args.held_out]
    baseline = chance_baselines(held_samples).get("fret", 0.0)
    print(
        f"device {device.name} | variant {VARIANT} | train {len(train_samples)} "
        f"| held out {len(held_samples)} | fret chance {baseline:.4f}",
        flush=True,
    )

    if args.validate_resume:
        result = h73.validate_resume(args, device, train_samples, args.ckpt_root / "validate")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"resume_validation": result}, indent=2) + "\n")
        return 0

    args.ckpt_root.mkdir(parents=True, exist_ok=True)
    print(f"training {args.steps} steps; checkpoints at {sorted(checkpoints)}", flush=True)
    started = time.perf_counter()
    _, history = h73.training_loop(
        args, device, train_samples, args.ckpt_root, checkpoints,
        resume_from=args.resume_from, log_every=args.log_every,
    )
    train_seconds = time.perf_counter() - started
    print(f"training finished in {train_seconds / 60:.1f} min", flush=True)

    flags = same_score_split(everything, args.pages)
    same_pages = [everything[i] for i in range(args.pages) if flags[i]]
    print(f"same-score unseen-instance pages: {len(same_pages)}", flush=True)

    reports: dict[str, Any] = {}
    for step in sorted(checkpoints):
        directory = args.ckpt_root / f"step{step}"
        if not (directory / "state.pt").exists():
            continue
        last = step == terminal
        print(f"\n=== diagnostics at step {step} ===", flush=True)
        fresh = build(VARIANT, args, device)
        state = torch.load(directory / "state.pt", map_location="cpu", weights_only=False)
        fresh.load_state_dict(state["model"])

        entry: dict[str, Any] = {"terminal": last}
        entry["train_real"] = measure(fresh, train_samples, device, args.max_objects,
                                      "real", keep_tables=last)
        entry["train_blank"] = measure(fresh, train_samples, device, args.max_objects,
                                       "blank", keep_tables=False)
        entry["train_wrong_roi"] = measure(fresh, train_samples, device, args.max_objects,
                                           "wrong_roi", keep_tables=False)
        entry["pixel_gain_vs_blank"] = round(
            entry["train_real"]["accuracy"] - entry["train_blank"]["accuracy"], 6)
        entry["pixel_gain_vs_wrong_roi"] = round(
            entry["train_real"]["accuracy"] - entry["train_wrong_roi"]["accuracy"], 6)
        restore = h73.neutralise_geometry(fresh, None)
        try:
            entry["train_no_geometry"] = measure(fresh, train_samples, device,
                                                 args.max_objects, "no_geometry",
                                                 keep_tables=False)
        finally:
            restore()
        entry["geometry_gain"] = round(
            entry["train_real"]["accuracy"] - entry["train_no_geometry"]["accuracy"], 6)

        torch.manual_seed(args.seed)
        generator = torch.Generator().manual_seed(args.seed)
        chosen = torch.randperm(len(train_samples), generator=generator)[: args.batch_pages]
        batch = collate([train_samples[i] for i in chosen.tolist()], args.max_objects)
        batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                 for k, v in batch.items()}
        entry["gradients"] = h73.gradient_diagnostic(fresh, batch, device)
        entry["lr_at_step"] = next((h["lr"] for h in history if h["step"] == step), None)
        entry["loss_at_step"] = next((h["parts"] for h in history if h["step"] == step), None)
        entry["other_heads_train"] = measure_other_heads(
            fresh, train_samples, device, args.max_objects)

        if last:
            held = measure(fresh, held_samples, device, args.max_objects, "real",
                           keep_tables=True)
            held["chance_baseline"] = round(baseline, 6)
            held["lift_over_chance"] = round(held["accuracy"] - baseline, 6)
            held["lift_over_shared"] = round(
                held["accuracy"] - SHARED_REFERENCE["score_disjoint"], 6)
            held["wilson_95"] = wilson(held["correct"], held["total"])
            entry["held_out_score_disjoint"] = held
            entry["held_out_blank"] = measure(fresh, held_samples, device,
                                              args.max_objects, "blank", keep_tables=False)
            entry["held_out_wrong_roi"] = measure(fresh, held_samples, device,
                                                  args.max_objects, "wrong_roi",
                                                  keep_tables=False)
            entry["held_out_pixel_ablation"] = measure(fresh, held_samples, device,
                                                       args.max_objects, "pixel_ablation",
                                                       keep_tables=False)
            entry["held_out_other_heads"] = measure_other_heads(
                fresh, held_samples, device, args.max_objects)
            entry["held_out_geometry_gain"] = round(
                held["accuracy"] - entry["held_out_blank"]["accuracy"], 6)
            same = measure(fresh, same_pages, device, args.max_objects, "real",
                           keep_tables=True)
            same["chance_baseline"] = round(baseline, 6)
            same["wilson_95"] = wilson(same["correct"], same["total"])
            same["comparison_stage_D_same_score"] = 0.1765
            entry["same_score_unseen"] = same

        reports[str(step)] = entry
        print(
            f"  train_real {entry['train_real']['accuracy']:.4f} "
            f"1d {entry['train_real']['digit_count_split']['one_digit']['accuracy']:.4f} "
            f"2d {entry['train_real']['digit_count_split']['two_digit']['accuracy']:.4f} "
            f"| blank {entry['train_blank']['accuracy']:.4f} "
            f"| wrong {entry['train_wrong_roi']['accuracy']:.4f} "
            f"| no_geom {entry['train_no_geometry']['accuracy']:.4f}",
            flush=True,
        )
        if last:
            for key in ("held_out_score_disjoint", "held_out_blank",
                        "held_out_wrong_roi", "held_out_pixel_ablation",
                        "same_score_unseen"):
                value = entry[key]
                print(
                    f"  {key:<26} {value['accuracy']:.4f} "
                    f"1d {value['digit_count_split']['one_digit']['accuracy']:.4f} "
                    f"2d {value['digit_count_split']['two_digit']['accuracy']:.4f} "
                    f"n={value['total']}",
                    flush=True,
                )
            print(f"  gradients {entry['gradients']}", flush=True)
            print(f"  other heads (held) {entry['held_out_other_heads']}", flush=True)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(
                {
                    "variant": VARIANT,
                    "diff": "fret path omits `+ tokens`; every other term identical",
                    "config": vars(args) | {"checkpoints": sorted(checkpoints)},
                    "shared_reference_frozen": SHARED_REFERENCE,
                    "train_seconds": round(train_seconds, 1),
                    "history": history,
                    "checkpoints": reports,
                },
                indent=2, default=str,
            )
            + "\n"
        )
        print(f"  wrote {args.out}", flush=True)

    print("\ndone", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
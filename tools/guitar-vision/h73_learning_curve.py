"""Learning curve for the frozen `shared` variant, with checkpoint/resume.

## The question

The frozen 200-step run answered nothing about capacity: all three variants sat
within noise of the 7.34% chance line on held-out, and the blank-image control
scored almost the same as real pixels. Meanwhile the *unchanged* calibration probe
memorised 100% of real pixels at 1200 steps with blank flat at 19.3%.

Those two facts are only compatible if 200 steps is simply too few. So: does the
full 40-score training regime start using ROI pixels given enough optimisation?

Nothing here changes the experiment. Pages, splits, image size, max objects,
hidden, layers, lr, jitter, roi grid, context, seed, optimiser, schedule shape and
gradient clipping are all taken from `fret_experiments` and imported rather than
re-derived, so this is the same run with more steps.

The schedule is built for the **terminal** budget (1200), not per checkpoint. A
200-step checkpoint here is therefore *not* the frozen 200-step run: it is the
200-step point of a 1200-step cosine, and it will differ from the frozen run. That
is the point of a learning curve - it must be one continuous optimisation, not
four runs that each restart their own schedule.

## Held-out discipline

Held-out is measured at the terminal checkpoint only. Every intermediate decision
that could be made is made from **train** diagnostics. There is no selection
anywhere in this file: nothing reads a held-out number and then changes a knob.

## Instrumentation

Losses and gradient norms are *observed*, never reweighted. Gradient norms come
from one extra forward/backward on a fixed batch with the RNG state saved and
restored around it, so the diagnostic cannot perturb the trajectory it measures.

## Checkpoints

A checkpoint carries model, optimiser, scheduler, both generator states, the
global torch/numpy/python RNG states, the step counter and the config. `--validate-
resume` proves a resumed trajectory is bit-identical to an uninterrupted one
before the long run is trusted.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
# _HERE is <repo>/tools/guitar-vision, so the repository root is its first parent.
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import (  # noqa: E402
    build,
    decode,
    fret_loss,
    _blank_images,
)
from guitar_vision.qualify import (  # noqa: E402
    HeadReport,
    _jitter,
    chance_baselines,
    Device,
)

# Gradient-norm groups, by parameter-name prefix. `shared` has no dedicated ROI
# encoder - its two samplers *are* the ROI read - so the pixel path is the
# samplers, the projection that mixes them, and the backbone underneath.
GRADIENT_GROUPS: dict[str, tuple[str, ...]] = {
    "roi_samplers": ("base.sampler.", "base.tab_sampler."),
    "visual_projection": ("base.visual_projection.",),
    "backbone": ("base.backbone.",),
    "geometry": ("base.geometry_projection.",),
    "source": ("base.source_projection.",),
    "context": ("base.context.", "base.final_norm."),
    "heads": ("base.heads.",),
}


def group_of(name: str) -> str:
    for group, prefixes in GRADIENT_GROUPS.items():
        if any(name.startswith(prefix) for prefix in prefixes):
            return group
    return "other"


def wrong_roi_boxes(batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Give every fret object another fret object's box on the same page.

    Labels and labels-with-geometry survive; the pixels under a box become
    another glyph's. A model reading pixels collapses; a model reading coordinates
    does not. Deterministic - it is a cyclic roll, not a shuffle.
    """
    out = dict(batch)
    boxes = batch["boxes"].clone()
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    for index in range(boxes.shape[0]):
        rows = is_fret[index].nonzero(as_tuple=True)[0]
        if rows.numel() < 2:
            continue
        rolled = torch.roll(torch.arange(rows.numel()), 1)
        boxes[index, rows] = boxes[index, rows][rolled]
    out["boxes"] = boxes
    return out


def neutralise_geometry(model, batch):
    """Zero the coordinate branch, leaving everything else and all weights intact.

    Diagnostic only, and only for `shared`, where the geometry vector is added to
    the token as one term and can be detached without touching the graph the rest
    of the model depends on.
    """
    import types

    projection = model.base.geometry_projection
    # Bound method of the instance, not of the class: `geometry_projection` is an
    # instance attribute assigned in __init__, so the class does not carry it.
    original = projection.forward

    def blanked(_module, boxes, _original=original):
        return _original(boxes) * 0.0

    projection.forward = types.MethodType(blanked, projection)
    return lambda: setattr(projection, "forward", original)


def measure_fret(
    model,
    pages: list[dict[str, torch.Tensor]],
    device,
    max_objects: int,
    chunk: int = 3,
    mode: str = "real",
) -> dict[str, Any]:
    """Fret accuracy on a set of pages under one input intervention."""
    model.eval()
    detail = HeadReport(name="fret")
    correct = total = 0

    def to_device(batch):
        return {k: (v.to(device.torch) if torch.is_tensor(v) else v) for k, v in batch.items()}

    for start in range(0, len(pages), chunk):
        batch = collate(pages[start : start + chunk], max_objects)
        if mode == "blank":
            batch = _blank_images(batch)
        elif mode == "wrong_roi":
            batch = wrong_roi_boxes(batch)
        elif mode == "no_geometry":
            pass  # the geometry forward is patched for the whole call
        batch = to_device(batch)
        with torch.no_grad():
            out = model(batch)
            is_fret = batch["object_mask"] & (batch["object_type"] == 1)
            numbers = decode(out)
            ok = (numbers == batch["fret"]) & is_fret
            correct += int(ok.sum())
            total += int(is_fret.sum())
            for truth, prediction, right in zip(
                batch["fret"][is_fret].tolist(), numbers[is_fret].tolist(), ok[is_fret].tolist()
            ):
                detail.record(truth, truth if right else prediction)
        del batch, out
    return {
        "accuracy": round(correct / max(total, 1), 6),
        "correct": correct,
        "total": total,
        "digit_count_split": detail.digit_count_split(),
        "top_confusions": dict(sorted(detail.confusion.items(), key=lambda i: -i[1])[:6]),
    }


def gradient_diagnostic(model, batch, device) -> dict[str, float]:
    """Per-group gradient norms from one forward/backward on a fixed batch.

    The RNG state is saved and restored so this cannot perturb the trajectory it
    is measuring, and it runs after `optimiser.step()`, so it never contributes
    gradients to the run.
    """
    saved = torch.get_rng_state()
    model.train()
    out = model(batch)
    loss, parts = fret_loss(out, batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    norms: dict[str, float] = {}
    for name, parameter in model.named_parameters():
        if parameter.grad is None:
            continue
        key = group_of(name)
        norms[key] = norms.get(key, 0.0) + float(parameter.grad.detach().norm()) ** 2
    total = sum(float(p.grad.detach().norm()) ** 2 for p in model.parameters() if p.grad is not None)
    result = {k: round(math.sqrt(v), 6) for k, v in sorted(norms.items())}
    result["total"] = round(math.sqrt(total), 6)
    result["loss_parts"] = {k: round(v, 6) for k, v in parts.items()}
    # Loss weighting is explicit: `fret_loss` sums the parts, so every weight is 1.
    result["loss_weights"] = {k: 1.0 for k in parts}
    result["loss_share"] = {
        k: round(v / max(float(loss.detach()), 1e-9), 6) for k, v in parts.items()
    }
    model.zero_grad(set_to_none=True)
    del out, loss
    torch.set_rng_state(saved)
    return result


def make_ckpt_dir(root: Path, step: int) -> Path:
    path = root / f"step{step}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_checkpoint(path: Path, model, optimiser, schedule, generator, order, step, args):
    torch.save(
        {
            "model": model.state_dict(),
            "optimiser": optimiser.state_dict(),
            "schedule": schedule.state_dict(),
            "generator": generator.get_state(),
            "order": order.get_state(),
            "torch_rng": torch.get_rng_state(),
            "numpy_rng": np.random.get_state(),
            "python_rng": random.getstate(),
            "step": step,
            "config": {
                "steps": args.steps,
                "pages": args.pages,
                "batch_pages": args.batch_pages,
                "lr": args.lr,
                "jitter": args.train_jitter,
                "seed": args.seed,
                "variant": args.variant,
                "image_size": args.image_size,
                "max_objects": args.max_objects,
                "hidden": args.hidden,
                "layers": args.layers,
                "roi_grid": args.roi_grid,
                "roi_context": args.roi_context,
            },
        },
        path / "state.pt",
    )


def load_checkpoint(path: Path, model, optimiser, schedule, generator, order):
    state = torch.load(path / "state.pt", map_location="cpu", weights_only=False)
    model.load_state_dict(state["model"])
    optimiser.load_state_dict(state["optimiser"])
    schedule.load_state_dict(state["schedule"])
    generator.set_state(state["generator"])
    order.set_state(state["order"])
    torch.set_rng_state(state["torch_rng"])
    np.random.set_state(state["numpy_rng"])
    random.setstate(state["python_rng"])
    return state


def training_loop(
    args, device, samples, out_dir, checkpoints, resume_from=None, log_every=25,
    schedule_steps=None,
):
    """One continuous optimisation with checkpoints. Returns the loss history.

    ``schedule_steps`` is the budget the cosine is built for, which is the
    *terminal* budget and not the number of steps this call runs. A run resumed
    into a longer schedule must therefore build the longer schedule, which is the
    whole reason resume exists rather than four independent runs.
    """
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    random.seed(args.seed)
    model = build(args.variant, args, device)
    horizon = args.steps if schedule_steps is None else schedule_steps
    optimiser = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    warmup = max(1, int(horizon * 0.25))

    def factor(step: int) -> float:
        if step < warmup:
            return (step + 1) / warmup
        progress = (step - warmup) / max(horizon - warmup, 1)
        return 0.5 * (1 + math.cos(math.pi * min(progress, 1.0)))

    schedule = torch.optim.lr_scheduler.LambdaLR(optimiser, factor)
    generator = torch.Generator().manual_seed(args.seed)
    order = torch.Generator().manual_seed(args.seed)
    print(
        f"=== {args.variant} === params {sum(p.numel() for p in model.parameters()):,} "
        f"| steps {args.steps} | warmup {warmup} | lr {args.lr} | seed {args.seed}"
    )

    start_step = 1
    if resume_from is not None:
        state = load_checkpoint(Path(resume_from), model, optimiser, schedule, generator, order)
        start_step = state["step"] + 1
        print(f"resumed from {resume_from} at step {state['step']} -> next {start_step}")

    def to_device(batch):
        return {k: (v.to(device.torch) if torch.is_tensor(v) else v) for k, v in batch.items()}

    history: list[dict[str, Any]] = []
    started = time.perf_counter()
    for step in range(start_step, args.steps + 1):
        model.train()
        chosen = torch.randperm(len(samples), generator=order)[: args.batch_pages]
        batch = to_device(collate([samples[i] for i in chosen.tolist()], args.max_objects))
        batch["boxes"] = _jitter(
            batch["boxes"], args.train_jitter, generator, batch["object_mask"]
        )
        out = model(batch)
        loss, parts = fret_loss(out, batch)
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimiser.step()
        schedule.step()
        lr_now = optimiser.param_groups[0]["lr"]
        entry = {
            "step": step,
            "loss": round(float(loss.detach()), 6),
            "parts": {k: round(v, 6) for k, v in parts.items()},
            "lr": round(lr_now, 8),
            "elapsed": round(time.perf_counter() - started, 1),
        }
        history.append(entry)
        del out, loss, batch
        if step % log_every == 0 or step == 1 or step == args.steps:
            print(
                f"  step {step:>5}/{args.steps} loss {entry['loss']:.4f} lr {lr_now:.2e} "
                + " ".join(f"{k} {v:.3f}" for k, v in entry["parts"].items())
                + f" {entry['elapsed']:7.1f}s",
                flush=True,
            )
        if step in checkpoints:
            directory = make_ckpt_dir(out_dir, step)
            save_checkpoint(directory, model, optimiser, schedule, generator, order, step, args)
            (directory / "history.json").write_text(json.dumps(history, indent=2) + "\n")
            print(f"  [checkpoint] saved at step {step}", flush=True)
    return model, history


def checkpoint_report(model, args, device, everything, train_count, held_out, offset, held_index):
    """Train-side diagnostics now, held-out only if this is the terminal step."""
    train_pages = everything[:train_count]
    held_pages = everything[offset : offset + held_out]
    report: dict[str, Any] = {}
    report["train_real"] = measure_fret(model, train_pages, device, args.max_objects, mode="real")
    report["train_blank"] = measure_fret(model, train_pages, device, args.max_objects, mode="blank")
    report["train_wrong_roi"] = measure_fret(
        model, train_pages, device, args.max_objects, mode="wrong_roi"
    )
    report["pixel_gain_vs_blank"] = round(
        report["train_real"]["accuracy"] - report["train_blank"]["accuracy"], 6
    )
    report["pixel_gain_vs_wrong_roi"] = round(
        report["train_real"]["accuracy"] - report["train_wrong_roi"]["accuracy"], 6
    )
    restore = neutralise_geometry(model, None)
    try:
        report["train_no_geometry"] = measure_fret(
            model, train_pages, device, args.max_objects, mode="no_geometry"
        )
    finally:
        restore()
    report["geometry_gain"] = round(
        report["train_real"]["accuracy"] - report["train_no_geometry"]["accuracy"], 6
    )
    return report


def held_report(model, args, device, pages, baseline):
    out = measure_fret(model, pages, device, args.max_objects, mode="real")
    out["chance_baseline"] = round(baseline, 6)
    out["lift_over_chance"] = round(out["accuracy"] - baseline, 6)
    return out


def validate_resume(args, device, samples, work: Path) -> dict[str, Any]:
    """Prove a resumed trajectory is bit-identical to an uninterrupted one.

    Three phases, all against the *same* ``schedule_steps`` so the cosine is the
    one a real resume would inherit:

    1. run the whole span continuously, recording every loss;
    2. run the first half under the same schedule, saving a checkpoint;
    3. resume that checkpoint and run the second half.

    Phases 2 and 3 must reproduce phase 1's tail exactly. If they do, the long run
    can be trusted to be one optimisation rather than a chain of restarts.
    """
    steps = args.validate_steps
    split = steps // 2
    work.mkdir(parents=True, exist_ok=True)
    checkpoints = {split}
    # Validation must not inherit the terminal budget: it runs its own short span.
    args = argparse.Namespace(**vars(args))
    args.steps = steps

    _, continuous = training_loop(
        args, device, samples, work / "continuous", set(), log_every=10**9
    )
    training_loop(
        args, device, samples, work / "half", checkpoints,
        log_every=10**9, schedule_steps=steps,
    )
    _, resumed = training_loop(
        args, device, samples, work / "resumed", set(),
        resume_from=work / "half" / f"step{split}", log_every=10**9,
        schedule_steps=steps,
    )

    # `resumed` starts at split+1 already, so it is not sliced again.
    tail_c = continuous[split:]
    tail_r = list(resumed)
    deltas = [abs(a["loss"] - b["loss"]) for a, b in zip(tail_c, tail_r)]
    identical = (
        len(tail_c) == len(tail_r)
        and all(a["parts"] == b["parts"] for a, b in zip(tail_c, tail_r))
        and all(d == 0.0 for d in deltas)
    )
    result = {
        "steps": steps,
        "split_at": split,
        "schedule_steps": steps,
        "resumed_losses_match_exactly": identical,
        "max_abs_loss_delta": max(deltas) if deltas else None,
        "continuous_tail": [e["loss"] for e in tail_c],
        "resumed_tail": [e["loss"] for e in tail_r],
    }
    print(
        f"  resume validation: identical={identical} "
        f"max|delta|={result['max_abs_loss_delta']}",
        flush=True,
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", default="shared", choices=["shared"])
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
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/learning-curve.json"))
    parser.add_argument("--ckpt-root", type=Path, default=Path("tmp/gvprobe/lc-ckpt"))
    parser.add_argument("--checkpoints", default="200,400,700,1200")
    parser.add_argument("--validate-resume", action="store_true")
    parser.add_argument("--validate-steps", type=int, default=12)
    parser.add_argument("--resume-from", default=None)
    args = parser.parse_args()
    checkpoints = {int(v) for v in args.checkpoints.split(",") if v}

    device = Device(args.device)
    records = _REPO / "datasets/guitar-vision/synthetic/train/records"
    views = _REPO / "datasets/guitar-vision/synthetic/train/views"
    everything = load_dataset(records, views, size=(args.image_size, args.image_size), limit=0)
    train_samples = everything[: args.pages]
    held_samples = everything[args.pages : args.pages + args.held_out]
    baseline = chance_baselines(held_samples).get("fret", 0.0)
    print(
        f"device {device.name} | train {len(train_samples)} | held out {len(held_samples)} "
        f"| fret chance {baseline:.4f}",
        flush=True,
    )

    if args.validate_resume:
        result = validate_resume(args, device, train_samples, args.ckpt_root / "validate")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"resume_validation": result}, indent=2) + "\n")
        print(f"wrote {args.out}")
        return 0

    args.ckpt_root.mkdir(parents=True, exist_ok=True)
    model, history = training_loop(
        args, device, train_samples, args.ckpt_root, checkpoints,
        resume_from=args.resume_from,
    )

    # Diagnostics per checkpoint, in a second pass so training is never interrupted.
    reports: dict[str, Any] = {}
    for step in sorted(checkpoints):
        directory = args.ckpt_root / f"step{step}"
        if not (directory / "state.pt").exists():
            continue
        print(f"\n=== diagnostics at step {step} ===", flush=True)
        from guitar_vision.fret_experiments import build as _build
        fresh = _build(args.variant, args, device)
        state = torch.load(directory / "state.pt", map_location="cpu", weights_only=False)
        fresh.load_state_dict(state["model"])
        entry = checkpoint_report(
            fresh, args, device, everything, args.pages, args.held_out, args.pages,
            list(held_samples),
        )
        # Gradient norms on one fixed batch, RNG restored around it.
        torch.manual_seed(args.seed)
        g = torch.Generator().manual_seed(args.seed)
        chosen = torch.randperm(len(train_samples), generator=g)[: args.batch_pages]
        batch = collate([train_samples[i] for i in chosen.tolist()], args.max_objects)
        batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v) for k, v in batch.items()}
        entry["gradients"] = gradient_diagnostic(fresh, batch, device)
        entry["lr_at_step"] = next(
            (h["lr"] for h in history if h["step"] == step), None
        )
        if step == max(checkpoints):
            entry["held_out"] = held_report(fresh, args, device, held_samples, baseline)
        reports[str(step)] = entry
        for key in ("train_real", "train_blank", "train_wrong_roi"):
            print(
                f"  {key:<16} {entry[key]['accuracy']:.4f} "
                f"1-digit {entry[key]['digit_count_split']['one_digit']['accuracy']:.4f} "
                f"2-digit {entry[key]['digit_count_split']['two_digit']['accuracy']:.4f}"
            )
        print(
            f"  pixel_gain vs blank {entry['pixel_gain_vs_blank']:+.4f} "
            f"| vs wrong_roi {entry['pixel_gain_vs_wrong_roi']:+.4f} "
            f"| geometry_gain {entry['geometry_gain']:+.4f}"
        )
        print(f"  gradient norms: {entry['gradients']}")
        if "held_out" in entry:
            print(
                f"  held-out {entry['held_out']['accuracy']:.4f} "
                f"(chance {baseline:.4f}, lift {entry['held_out']['lift_over_chance']:+.4f}) "
                f"n={entry['held_out']['total']}"
            )
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(
                {"config": vars(args) | {"checkpoints": sorted(checkpoints)},
                 "history": history, "checkpoints": reports},
                indent=2, default=str,
            )
            + "\n"
        )
        print(f"  wrote {args.out}", flush=True)

    print("\ndone", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
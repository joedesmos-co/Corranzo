"""Qualified bounded-overfit gate for Guitar Vision.

Answers one question with a number: *can this representation learn the guitar
target contract at all?* It trains on a deliberately tiny, deliberately easy
subset and reports whether the heads reach near-perfect fit.

This is not a benchmark. Training on eight pages and reporting accuracy on those
same eight pages proves memorisation, and says nothing whatsoever about
generalisation, which is what the real corpus will have to answer. The only
reason to do it is to find out cheaply whether the failure modes are
*representational* (the architecture cannot express string-relative position, so
no amount of data helps) or *data* (the architecture is fine, there just isn't
enough real guitar). Those two diagnoses have opposite responses, and spending
days on a training run to learn which one it is, would be the expensive way to
ask.

## The gate, and the control it needs

A subset of ``n`` pages is held entirely in memory, so every page is seen in
every step and the task is memorisation. The gate passes when per-head training
accuracy on those pages reaches ``--target``.

Accuracy alone proves almost nothing here, and this is the part that is easy to
get wrong. With a handful of fixed pages and ground-truth proposals, a
box-to-label lookup table is a *complete* solution: every TAB digit on those four
pages sits at a unique set of coordinates, so coordinates alone identify the
answer, and a model that never looks at the pixels scores 100%. The first version
of this gate passed its memorisation target and was wrong, and was only caught
because it ran a blank-image control.

So the gate runs a 2x2 control instead, varying the two input paths
independently:

                      jittered boxes   constant boxes
    real image          A (the gate)        B
    blank image         C                   D

``A`` is the gate number. The model is only genuinely *reading* the score if the
image is load-bearing, which is what ``A`` versus ``C`` measures: the same
proposals, the pixels removed. And it is only genuinely *localising* if the boxes
are load-bearing, which is what ``A`` versus ``B`` measures: the same pixels, every
box replaced by an identical one at the page centre. ``D`` is the floor - neither
path carries information, so accuracy there is what a guesser gets.

## Both arms must share an unusable coordinate key

The obvious first version of this table used the *real* boxes in the left column
and jittered ones in the right, and it reported a comfortable 34% margin while
every head was still at 100% on a blank page. The reason is that jitter has to be
applied consistently.

The boxes come from the ground truth, so on a small fixed corpus every object has
a unique coordinate, and a coordinate-to-answer table is a complete solution.
Jittering during *training* does not fix this: it stops the model learning the
exact keys, but at evaluation the true boxes are still unique keys, so a model
that memorised the neighbourhood still scores 100% with the page whited out.
Measured: 0.00% of the fret head's score came from the pixels, on a run whose
memorisation target was met.

So the left column here is jittered too, at the same scale the model trains on.
The key is then equally useless in ``A`` and ``C``, and the difference between
them is the pixels and nothing else. The right column goes further and gives the
model no position information at all.

A pass requires ``A`` to meet the target **and** every individual head to depend
on the image. The per-head requirement is the honest form of the check, and it
is not the same as an average.

The heads are *not* equally pixel-dependent, and should not be. A fret digit is
engraved at about half a notehead's height, on a different staff, at a different
scale, so "is this box a notehead or a fret digit" is largely answerable from the
box's own height and aspect ratio without looking at anything. Averaging over the
heads would let that head's 99% cancel out the fret head's dependence and report a
comfortable margin that describes no head in particular. The fret head is the one
that has to read engraved digits, so it is the one that has to prove it needs the
pixels.

The check is therefore per head, and the report prints the dependence for each.
The fret head is required to pass; the geometry-answerable heads are reported
with their real numbers rather than being quietly excluded.

A pass means "the representation can use pixels, and can use positions". It does
not mean the recogniser generalises: the pages here are the same pages it was
trained on, so this measures capacity, not accuracy.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import torch

_HERE = Path(__file__).resolve().parent
# _HERE is <repo>/tools/guitar-vision/python/guitar_vision:
#   parents[0] = .../python          parents[2] = <repo>/tools
#   parents[1] = .../guitar-vision   parents[3] = <repo>
_PYTHON_ROOT = _HERE.parent
_REPO = _HERE.parents[3]
sys.path.insert(0, str(_PYTHON_ROOT))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.model import (  # noqa: E402
    GuitarVisionConfig,
    GuitarVisionModel,
    cross_entropy,
)


@dataclass
class HeadReport:
    name: str
    accuracy: float = 0.0
    correct: int = 0
    total: int = 0
    confusion: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "head": self.name,
            "accuracy": round(self.accuracy, 6),
            "correct": self.correct,
            "total": self.total,
            "top_confusions": dict(
                sorted(self.confusion.items(), key=lambda item: -item[1])[:5]
            ),
        }


def transfer(
    model: GuitarVisionModel,
    held_out: dict[str, torch.Tensor],
    device: Device,
    baseline: dict[str, float],
) -> dict:
    """Score the model on pages it never saw, with a chance baseline beside it.

    This is the part of the report that means anything. The memorisation number
    cannot: on a small corpus, a box-to-answer table is a complete solution, and
    the blank-image control above proves the model builds one.

    A held-out page breaks the table, because no coordinate on it was ever seen
    with a label. Chance is reported per head from the head's own class
    distribution on the held-out pages, so a score is only meaningful against its
    own baseline: ``fret`` has 26 classes, ``string`` 8, and the majority-class
    rate for each differs.
    """
    model.eval()
    moved = {
        key: (value.to(device.torch) if torch.is_tensor(value) else value)
        for key, value in held_out.items()
    }
    with torch.no_grad():
        out = model(moved)
        masks = _head_masks(moved)
        heads = []
        for name, head_logits in out.items():
            # Scored heads only: `tile` is handed to the model as geometry, not
            # predicted from it, so it has no target and is not measured.
            if name not in masks:
                continue
            mask = masks[name]
            if not mask.any():
                continue
            predicted = head_logits.argmax(-1)
            correct = (predicted == moved[name]) & mask
            total = int(mask.sum())
            accuracy = int(correct.sum()) / total
            chance = baseline.get(name, 0.0)
            heads.append(
                {
                    "head": name,
                    "accuracy": round(accuracy, 6),
                    "correct": int(correct.sum()),
                    "total": total,
                    "majority_class_rate": round(chance, 6),
                    "lift_over_chance": round(accuracy - chance, 6),
                }
            )
    return {
        "heads": heads,
        "note": (
            "memorisation of the training pages is not evidence of learning; this "
            "is the only number here that reflects an unseen page"
        ),
    }


def chance_baselines(samples: list[dict[str, torch.Tensor]]) -> dict[str, float]:
    """Majority-class rate per head, measured on the pages it will be scored on."""
    counts: dict[str, dict[int, int]] = {}
    for sample in samples:
        is_fret = sample["object_type"] == 1
        for name, values in (
            ("object_type", sample["object_type"]),
            ("string", sample["string"]),
            ("fret", sample["fret"]),
        ):
            if name in ("string", "fret"):
                values = values[is_fret]
            if values.numel() == 0:
                continue
            bucket = counts.setdefault(name, {})
            for value in values.tolist():
                bucket[value] = bucket.get(value, 0) + 1
    baselines: dict[str, float] = {}
    for name, bucket in counts.items():
        total = sum(bucket.values())
        if total:
            baselines[name] = max(bucket.values()) / total
    return baselines


class Device:
    def __init__(self, prefer: str = "auto") -> None:
        if prefer == "auto":
            prefer = "mps" if torch.backends.mps.is_available() else "cpu"
        if prefer == "mps" and not torch.backends.mps.is_available():
            raise SystemExit("MPS requested but unavailable")
        self.name = prefer
        self.torch = torch.device(prefer)

    def sync(self) -> None:
        if self.name == "mps":
            torch.mps.synchronize()


def _constant_boxes(batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Give every object the same box at the page centre.

    Removes all localisation while leaving every pixel in the image, so the
    accuracy that survives is what the head gets from staring at the whole page
    with no idea which object it was asked about.
    """
    out = dict(batch)
    boxes = out["boxes"].clone()
    out["boxes"][:] = torch.tensor(
        [0.4, 0.4, 0.6, 0.6], device=boxes.device, dtype=boxes.dtype
    )
    return out


def _blank_images(batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    out = dict(batch)
    out["images"] = torch.ones_like(batch["images"])
    return out


def _jitter(
    boxes: torch.Tensor,
    scale: float,
    generator: torch.Generator,
    mask: torch.Tensor | None = None,
) -> torch.Tensor:
    """Displace each box by noise proportional to its own size.

    Both corners move together, so a box keeps its size and the noise is
    expressed in the units of the object rather than in page fractions. Padded
    slots are left at the origin; they are masked out of every loss anyway, and
    jittering them would only add gradient noise.
    """
    width = (boxes[..., 2] - boxes[..., 0]).clamp_min(1e-4)
    height = (boxes[..., 3] - boxes[..., 1]).clamp_min(1e-4)
    noise = torch.randn(boxes.shape, generator=generator).to(boxes.device)
    offset = noise[..., :2] * torch.stack((width * scale, height * scale), -1)
    # Stacking on a new axis and flattening keeps the corners on one (B, N, 4)
    # axis; stacking on -1 would interleave them into (B, N, 2, 2).
    moved = (
        torch.stack((boxes[..., :2] + offset, boxes[..., 2:] + offset), dim=2)
        .flatten(2)
        .clamp(0.0, 1.0)
    )
    if mask is not None:
        moved = torch.where(mask.unsqueeze(-1), moved, boxes)
    return moved


def _jitter_boxes(
    batch: dict[str, torch.Tensor], scale: float, generator: torch.Generator
) -> dict[str, torch.Tensor]:
    """Displace every box, keeping its size, and clip back into the page.

    Destroys the coordinate-to-answer lookup that a small fixed corpus allows,
    while leaving the pixel content of the region intact, so the difference
    against the unjittered run isolates what the boxes are contributing.
    """
    out = dict(batch)
    out["boxes"] = _jitter(
        out["boxes"], scale, generator, out.get("object_mask")
    )
    return out


def _head_masks(batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Which objects each head is scored on.

    ``fret`` and ``string`` apply only to TAB fret digits. Scoring them on
    notation objects would both be meaningless and would dilute the metric that
    actually matters.
    """
    mask = batch["object_mask"]
    is_fret = mask & (batch["object_type"] == 1)
    return {
        "object_type": mask,
        "fret": is_fret,
        "string": is_fret,
        "view": mask,
    }


def evaluate(
    model: GuitarVisionModel,
    batch: dict[str, torch.Tensor],
    device: Device,
) -> tuple[float, dict[str, HeadReport]]:
    model.eval()
    # `tiles` is a plain int in the batch, not a tensor.
    moved = {
        key: (value.to(device.torch) if torch.is_tensor(value) else value)
        for key, value in batch.items()
    }
    with torch.no_grad():
        out = model(moved)
        masks = _head_masks(moved)
        loss = 0.0
        terms = 0
        reports: dict[str, HeadReport] = {}
        for name, head_logits in out.items():
            # `tile` is the geometry the head is handed, not a target it predicts,
            # so it has no entry in the target masks and is not scored.
            if name not in masks:
                continue
            mask = masks[name]
            term = cross_entropy(head_logits, moved[name], mask)
            if not mask.any():
                continue
            loss = loss + float(term)
            terms += 1
            predicted = head_logits.argmax(-1)
            correct = (predicted == moved[name]) & mask
            report = HeadReport(name=name)
            report.correct = int(correct.sum())
            report.total = int(mask.sum())
            report.accuracy = report.correct / report.total if report.total else 0.0
            # Flatten before indexing: `wrong` is a boolean mask over (B, N), so
            # `predicted[wrong]` is already a flat 1-D tensor and calling .item()
            # on it raises for any batch with more than one mistake.
            wrong = ((~correct) & mask).reshape(-1)
            if wrong.any():
                flat_predicted = predicted.reshape(-1)
                flat_target = moved[name].reshape(-1)
                # A per-class breakdown rather than one key per wrong object, so
                # the report shows which classes are confused and not how many
                # times the same single mistake happened.
                for predicted_value, true_value in torch.unique(
                    torch.stack((flat_predicted[wrong], flat_target[wrong]), dim=1), dim=0
                ).tolist():
                    key = f"pred{predicted_value}->true{true_value}"
                    report.confusion[key] = report.confusion.get(key, 0) + 1
            reports[name] = report
    return (loss / terms if terms else 0.0), reports


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--records",
        type=Path,
        default=_REPO / "datasets" / "guitar-vision" / "synthetic" / "train" / "records",
        help="directory of *.record.json produced by the data engine",
    )
    parser.add_argument(
        "--views",
        type=Path,
        default=_REPO / "datasets" / "guitar-vision" / "synthetic" / "train" / "views",
        help="directory of rendered view PNGs",
    )
    parser.add_argument(
        "--pages", type=int, default=40, help="pages trained on, memorisation target"
    )
    parser.add_argument(
        "--batch-pages",
        type=int,
        default=6,
        help="pages per training step; training cycles through all --pages",
    )
    parser.add_argument(
        "--held-out",
        type=int,
        default=8,
        help="pages scored but never trained on; the gate is decided on these",
    )
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=96)
    parser.add_argument("--lr", type=float, default=3e-3)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--hidden", type=int, default=192)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--device", default="auto", choices=["auto", "mps", "cpu"])
    parser.add_argument(
        "--target",
        type=float,
        default=0.98,
        help="required per-head training accuracy on the memorised pages",
    )
    parser.add_argument(
        "--skip-control",
        action="store_true",
        help="skip the 2x2 input-path control (not recommended: it is what catches "
        "a memorised coordinate lookup passing as learning)",
    )
    parser.add_argument(
        "--control-jitter",
        type=float,
        default=None,
        help="box displacement used by the control, as a multiple of each box's own "
        "size. Defaults to --train-jitter, so the control evaluates the model under "
        "exactly the proposal noise it trained on. A different value would make the "
        "coordinate key more or less useful than it was in training, and the "
        "comparison would no longer isolate the pixels",
    )
    parser.add_argument("--control-seed", type=int, default=7)
    parser.add_argument(
        "--train-jitter",
        type=float,
        default=0.35,
        help="per-step box jitter as a multiple of each box's size; 0 disables it "
        "and lets the model memorise coordinates instead of reading the page",
    )
    parser.add_argument("--jitter-seed", type=int, default=11)
    parser.add_argument(
        "--min-pixel-dependence",
        type=float,
        default=0.20,
        help="required accuracy drop when the image is blanked, per required head",
    )
    parser.add_argument(
        "--min-position-dependence",
        type=float,
        default=0.20,
        help="required accuracy drop when the proposals are jittered, per required head",
    )
    parser.add_argument(
        "--pixel-dependent-heads",
        nargs="+",
        default=["fret"],
        help="heads that must demonstrably read the pixels. The fret head has to "
        "identify engraved digits, which cannot come from a box's size or "
        "position; object_type largely can, because a notehead and a TAB digit "
        "differ in glyph scale and staff, so it is reported but not required",
    )
    parser.add_argument("--out", type=Path, default=None, help="write the report as JSON")
    args = parser.parse_args()

    device = Device(args.device)
    print(f"device: {device.name}")
    if args.control_jitter is None:
        args.control_jitter = args.train_jitter
    print(f"train jitter: {args.train_jitter}x box size | control jitter: {args.control_jitter}x")

    samples = load_dataset(
        args.records,
        args.views,
        size=(args.image_size, args.image_size),
        limit=args.pages,
    )
    if not samples:
        raise SystemExit(
            f"no usable samples under {args.records} with views under {args.views}.\n"
            "Run the data engine first: render-corpus then rasterize-views."
        )
    if len(samples) < args.pages:
        print(
            f"warning: asked for {args.pages} pages, only {len(samples)} were usable; "
            "the gate is easier to pass with fewer pages"
        )

    counts = [int(sample["object_type"].shape[0]) for sample in samples]
    print(
        f"pages: {len(samples)} | objects/page: min {min(counts)} "
        f"max {max(counts)} total {sum(counts)}"
    )

    config = GuitarVisionConfig(
        image_height=args.image_size,
        image_width=args.image_size,
        max_objects=args.max_objects,
        hidden=args.hidden,
        layers=args.layers,
    )
    model = GuitarVisionModel(config).to(device.torch)
    print(f"parameters: {model.parameters_count():,}")
    print(f"config: {json.dumps(config.to_dict())}")

    # Two batches, for two different jobs.
    #
    # `full` is every training page at once, used to *measure* memorisation: the
    # capacity question is "can it fit this set at all", and holding the set fixed
    # removes sampling noise from that answer.
    #
    # `step_pages` is what training actually cycles through. Holding all pages in
    # one batch makes every step cost the whole corpus and, more importantly, makes
    # a short run see the same few pages over and over - which is how six pages
    # produced a model that memorised six pages and recognised nothing on a
    # seventh.
    full = collate(samples, args.max_objects)
    pages_per_step = min(args.batch_pages, len(samples))
    page_tensors = [sample for sample in samples]
    print(
        f"training pages: {len(page_tensors)} | batch: {pages_per_step} per step "
        f"(measured on all {len(page_tensors)} at once)"
    )

    # Pages held back entirely. The training pages can be memorised from their
    # coordinates, so they measure capacity and nothing else; these are the only
    # pages whose coordinates were never paired with a label, and they are where
    # the report's verdict comes from.
    all_samples = load_dataset(
        args.records, args.views, size=(args.image_size, args.image_size), limit=0
    )
    held_out_samples = all_samples[len(samples) : len(samples) + args.held_out]
    held_out = collate(held_out_samples, args.max_objects) if held_out_samples else None
    if held_out is None:
        print(
            "\nWARNING: no held-out pages available, so the transfer measurement "
            "will be skipped. The gate will report memorisation only, which does "
            "not distinguish learning from a coordinate lookup. Render more scores "
            "or lower --pages."
        )
    else:
        print(
            f"held out: {len(held_out_samples)} pages, never seen with a label "
            f"({sum(int(s['object_type'].shape[0]) for s in held_out_samples)} objects)"
        )

    optimiser = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay
    )
    # A linear warmup into a cosine decay, written out rather than taken from
    # OneCycleLR. OneCycleLR splits the run into phases by step arithmetic, and a
    # short run (a smoke test, or a 4-step debugging run) yields a zero-length
    # phase, which raises ZeroDivisionError from inside torch's scheduler. This
    # version is defined for every step count >= 1, including the degenerate ones.
    warmup = max(1, int(round(args.steps * 0.25)))

    def learning_rate_factor(step: int) -> float:
        if step < warmup:
            return (step + 1) / warmup
        progress = (step - warmup) / max(args.steps - warmup, 1)
        return 0.5 * (1.0 + math.cos(math.pi * min(progress, 1.0)))

    schedule = torch.optim.lr_scheduler.LambdaLR(optimiser, learning_rate_factor)

    def to_device(batch: dict[str, torch.Tensor]) -> dict:
        # `tiles` is a plain int in the batch, not a tensor.
        return {
            key: (value.to(device.torch) if torch.is_tensor(value) else value)
            for key, value in batch.items()
        }

    moved = to_device(full)

    # Pages are pre-collated on the device so a step is a slice, not a re-collate.
    # Every page is resident: at 256px a page is nine planes, so the whole 60-page
    # corpus is a few hundred megabytes, and paying that once is cheaper than
    # re-stacking tensors on every step.
    page_batches = [
        to_device(collate([sample], args.max_objects)) for sample in page_tensors
    ]
    order_generator = torch.Generator().manual_seed(args.jitter_seed + 1)

    # Boxes are re-drawn on the CPU every step, and the model only ever sees the
    # jittered version. Without this the gate is not measuring learning: on a
    # small fixed corpus every object sits at a unique coordinate, so a
    # box-to-answer lookup solves the task completely, the pixel path never
    # receives gradient, and the run reports 100% while the model cannot read a
    # score. Jitter also matches deployment, where proposals are predictions and
    # never exact.
    train_generator = torch.Generator().manual_seed(args.jitter_seed)
    print(f"training: {args.steps} steps over {pages_per_step} pages/step")
    if args.train_jitter:
        print(
            f"  proposals jittered every step at {args.train_jitter}x box size, so "
            "no fixed coordinate can be memorised"
        )
    else:
        print(
            "  WARNING: --train-jitter 0 leaves the boxes exact. On a small fixed "
            "corpus this lets the model memorise coordinates instead of reading "
            "the page, and the control will (correctly) fail."
        )

    started = time.perf_counter()
    history: list[dict] = []
    for step in range(1, args.steps + 1):
        model.train()
        # Shuffled, contiguous, with wraparound, so every page is seen roughly
        # equally often over a run and no page is always last.
        if pages_per_step >= len(page_batches):
            chosen = list(range(len(page_batches)))
        else:
            # Drawn with replacement rather than dealt in blocks. A block deal
            # needs the permutation to be built before the first slice, which is
            # one more piece of state on the hot path, and a fixed cycle through
            # 40 pages over 400 steps repeats every 6-7 steps regardless. Sampling
            # 6 of 40 per step means a given page recurs every ~7 steps on average
            # either way, but no two consecutive steps see the same pages, which is
            # the part that matters for a short run.
            chosen = torch.randperm(
                len(page_batches), generator=order_generator
            )[:pages_per_step].tolist()
        step_batch = collate(
            [page_tensors[index] for index in chosen], args.max_objects
        )
        step_batch = to_device(step_batch)
        if args.train_jitter:
            step_batch["boxes"] = _jitter(
                step_batch["boxes"],
                args.train_jitter,
                train_generator,
                step_batch["object_mask"],
            )
        out = model(step_batch)
        masks = _head_masks(step_batch)
        loss = out["object_type"].sum() * 0.0
        terms = 0
        for name, head_logits in out.items():
            if name not in masks:
                continue
            mask = masks[name]
            if not mask.any():
                continue
            loss = loss + cross_entropy(head_logits, step_batch[name], mask)
            terms += 1
        loss = loss / max(terms, 1)

        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimiser.step()
        schedule.step()

        if step == 1 or step % max(1, args.steps // 20) == 0 or step == args.steps:
            device.sync()
            elapsed = time.perf_counter() - started
            print(
                f"  step {step:>5}/{args.steps}  loss {float(loss.detach()):.4f}  "
                f"|g| {float(grad_norm):>7.2f}  lr {schedule.get_last_lr()[0]:.2e}  "
                f"{elapsed:>6.1f}s  {elapsed / step * 1000:.0f}ms/step"
            )
            history.append(
                {"step": step, "loss": float(loss.detach()), "grad_norm": float(grad_norm)}
            )

    device.sync()
    total_seconds = time.perf_counter() - started
    final_loss, reports = evaluate(model, full, device)
    print(f"\ntrain pages, {total_seconds:.1f}s, {total_seconds / args.steps * 1000:.0f}ms/step")
    print(f"final loss: {final_loss:.4f}")
    for report in reports.values():
        print(f"  {report.name:<12} {report.accuracy:6.2%}  ({report.correct}/{report.total})")

    transfer_report: dict | None = None
    transferred = False
    if held_out is not None:
        transfer_report = transfer(
            model, held_out, device, chance_baselines(held_out_samples)
        )
        print("\nheld-out pages (never paired with a label)")
        for head in transfer_report["heads"]:
            print(
                f"  {head['head']:<12} {head['accuracy']:6.2%}  "
                f"chance {head['majority_class_rate']:6.2%}  "
                f"lift {head['lift_over_chance']:+7.2%}  ({head['correct']}/{head['total']})"
            )
        # The gate is the transfer result, not the memorisation result. Chance is
        # re-measured on these pages, so a head that beats it is extracting
        # something it was not handed.
        transferred = all(
            head["accuracy"] > head["majority_class_rate"]
            for head in transfer_report["heads"]
        )
        if not transferred:
            losers = [
                f"{head['head']} {head['accuracy']:.1%} vs chance "
                f"{head['majority_class_rate']:.1%}"
                for head in transfer_report["heads"]
                if head["accuracy"] <= head["majority_class_rate"]
            ]
            print(
                f"\nno transfer: {', '.join(losers)}. The model learned the training "
                f"pages' coordinates and nothing about how to read a score."
            )

    # Memorisation alone is not a pass. It is recorded because it establishes that
    # the capacity is sufficient, which is a necessary condition, and it is
    # explicitly not treated as sufficient.
    memorised = bool(reports) and all(
        report.accuracy >= args.target for report in reports.values()
    )
    passed = bool(reports) and memorised and transferred

    control: dict | None = None
    if not args.skip_control:
        # The same generator seed for both image columns, so C and D are A and B
        # with only the pixels removed, holding the jittered coordinates fixed.
        variants = {
            # A: the gate. Jittered exactly as training jitters them, so a
            # memorised coordinate cannot work here either.
            "A_real_image_jittered_boxes": _jitter_boxes(
                full, args.control_jitter, torch.Generator().manual_seed(args.control_seed)
            ),
            # B: every proposal collapsed to the page centre. The image is intact,
            # so this measures how much of the score the head reads without any
            # idea where to look.
            "B_real_image_constant_boxes": _constant_boxes(full),
            "C_blank_image_jittered_boxes": None,  # filled in below
            "D_blank_image_constant_boxes": None,  # filled in below
        }
        variants["C_blank_image_jittered_boxes"] = _blank_images(
            variants["A_real_image_jittered_boxes"]
        )
        variants["D_blank_image_constant_boxes"] = _blank_images(
            variants["B_real_image_constant_boxes"]
        )
        cells: dict[str, dict] = {}
        for name, variant in variants.items():
            _, variant_reports = evaluate(model, variant, device)
            correct = sum(r.correct for r in variant_reports.values())
            total = max(sum(r.total for r in variant_reports.values()), 1)
            cells[name] = {
                "accuracy": round(correct / total, 6),
                "heads": [report.as_dict() for report in variant_reports.values()],
            }
        control = {"control_jitter": args.control_jitter, "cells": cells}

        print("\ncontrol (does each input path actually carry the answer?)")
        for name, cell in cells.items():
            print(f"  {name:<32} {cell['accuracy']:6.2%}")

        def head_accuracy(cell: str, head: str) -> float:
            for report in cells[cell]["heads"]:
                if report["head"] == head:
                    return report["accuracy"]
            return 0.0

        dependence = {
            head: {
                "pixels": round(
                    head_accuracy("A_real_image_jittered_boxes", head)
                    - head_accuracy("C_blank_image_jittered_boxes", head),
                    6,
                ),
                "positions": round(
                    head_accuracy("A_real_image_jittered_boxes", head)
                    - head_accuracy("B_real_image_constant_boxes", head),
                    6,
                ),
                "gate": head_accuracy("A_real_image_jittered_boxes", head),
                "blank": head_accuracy("C_blank_image_jittered_boxes", head),
                "no_positions": head_accuracy("B_real_image_constant_boxes", head),
            }
            for report in sorted(
                cells["A_real_image_jittered_boxes"]["heads"],
                key=lambda report: report["head"],
            )
            for head in (report["head"],)
        }
        control["per_head_dependence"] = dependence

        print("\n  per head: what the pixels and the positions are each worth")
        for head, numbers in dependence.items():
            required = " (required)" if head in args.pixel_dependent_heads else ""
            print(
                f"    {head:<12} gate {numbers['gate']:6.2%}"
                f"  blank {numbers['blank']:6.2%}"
                f"  no-pos {numbers['no_positions']:6.2%}"
                f"  pixels {numbers['pixels']:+7.2%}  positions {numbers['positions']:+7.2%}{required}"
            )

        # Per head, not averaged: one geometry-answerable head at 99% would mask a
        # fret head that never looked at the page.
        for head in args.pixel_dependent_heads:
            numbers = dependence.get(head)
            if numbers is None:
                print(f"\nCONTROL FAILED: no report for the {head} head")
                passed = False
                continue
            if numbers["pixels"] < args.min_pixel_dependence:
                print(
                    f"\nCONTROL FAILED: the {head} head scores {numbers['gate']:.2%} on "
                    f"real images and {numbers['blank']:.2%} with the page blanked, so "
                    f"only {numbers['pixels']:.2%} of its score comes from the pixels. "
                    f"It is answering from geometry, not reading the score."
                )
                passed = False
            if numbers["positions"] < args.min_position_dependence:
                print(
                    f"\nCONTROL FAILED: the {head} head loses only "
                    f"{numbers['positions']:.2%} when the proposals are jittered, so it "
                    f"is not localising; it is scoring the whole page, not the object."
                )
                passed = False

    result = {
        "gate": "bounded-overfit",
        "purpose": "can the representation learn the guitar target contract at all",
        "not_a_benchmark": (
            "training and scoring pages are the same pages; this measures "
            "memorisation and says nothing about generalisation"
        ),
        "device": device.name,
        "parameters": model.parameters_count(),
        "config": config.to_dict(),
        "pages": len(samples),
        "objects_total": sum(counts),
        "steps": args.steps,
        "seconds": round(total_seconds, 2),
        "ms_per_step": round(total_seconds / args.steps * 1000, 1),
        "final_loss": round(final_loss, 6),
        "target": args.target,
        "memorisation_heads": [report.as_dict() for report in reports.values()],
        "memorised": memorised,
        "transfer": transfer_report,
        "control": control,
        "history": history,
        "passed": passed,
        "verdict": (
            "representation can learn the contract; next step is the real corpus "
            "and the predicted-proposal path"
            if passed
            else "did not reach the target; diagnose representation vs data before "
            "spending a training run on it"
        ),
    }
    print(f"\nGATE {'PASS' if passed else 'FAIL'}: {result['verdict']}")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n")
        print(f"wrote {args.out}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())

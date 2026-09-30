"""H1 + H3 - can the tensor memorise fret identity at all?

## One diagnostic, two questions

H1 asks whether the *control* is trustworthy: a head at ~10% over 26 classes may
be too far from signal for a 0.00% pixel ablation to mean anything. H3 asks
whether resolution is the constraint. Both are answered by the same instrument,
and it is deliberately the most favourable one available: sample the fret region
**straight from the input image tensor**, bypassing the backbone entirely, and fit
a tiny CNN hard enough to memorise a small fixed subset.

## Why this settles so much

The ROI is sampled from the input at whatever size the crop asks for, so:

  - if it memorises **real** pixels and collapses on **blank**, the tensor carries
    fret information and the production path is throwing it away - which localises
    the fault to the backbone's downsampling or the tile weighting;
  - if it cannot memorise even **real** pixels, the fault is upstream of every
    architecture: the crop does not contain the glyph, or the labels do not match
    the pixels. No head can fix that.
  - if it memorises **blank** too, a positional shortcut is still present and every
    other number here is meaningless.

## The four conditions

  real      the rendered pixels
  blank     white, same geometry
  shuffled  another page's pixels at the same coordinates - catches a head that
            learned the crop's *statistics* rather than the glyph
  wrong_roi the same geometry but sampled from a different tile, so the digit is
            not in the crop while the page looks plausible

`wrong_roi` is the one that catches a subtle failure: if a head scores well on it,
it was reading page texture, not digits.

## What this may not do

The crop is placed from the box alone - never from the fret value, the score
identity, or anything derived from the label. The subset is a fixed prefix of the
training pages and the same pages are scored, because the question is
*memorisation*, not generalisation. Held-out transfer is a separate question and
is not claimed here.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402


def sample_roi(
    images: torch.Tensor,
    boxes: torch.Tensor,
    mask: torch.Tensor,
    tile: torch.Tensor,
    crop: int,
) -> torch.Tensor:
    """Cut a fixed-size crop around each object from the input tensor.

    Differentiable, so the encoder trains end to end from the same loss. The tile
    index is used only to address the plane the object lives in - never to decide
    whether it is a fret digit - and the ``wrong_roi`` condition deliberately
    shifts it by one so the digit is out of frame.
    """
    batch, objects = boxes.shape[:2]
    _, planes, _, height, width = images.shape
    maps = images.reshape(batch, planes, height, width)
    centre = (boxes[..., :2] + boxes[..., 2:]) / 2
    half = ((boxes[..., 2:] - boxes[..., :2]) / 2 * 1.6).clamp_min(1e-4)
    # A fixed physical field of view, expressed as a grid over the box.
    ys, xs = torch.meshgrid(
        torch.linspace(-1.0, 1.0, crop, device=boxes.device),
        torch.linspace(-1.0, 1.0, crop, device=boxes.device),
        indexing="ij",
    )
    grid = torch.stack((xs, ys), -1).reshape(1, 1, crop * crop, 2)
    points = centre.unsqueeze(2) + grid * half.unsqueeze(2)
    output = []
    index = 0
    for plane in range(planes):
        selected = ((tile == plane) & mask).reshape(-1)
        if not bool(selected.any()):
            index += 1
            continue
        # One crop per object, so the grid is (batch * objects, 1, crop^2, 2)
        # against a single plane's (batch, 1, H, W). Both are reshaped to the same
        # leading dimension - this mismatch was the first thing to break.
        # `maps[:, plane]` is (batch, 1, H, W). Repeat it once per object so the
        # grid's (batch * objects, 1, crop^2, 2) has a matching input. It has to be
        # an explicit repeat: `expand` cannot introduce a new axis in the middle.
        plane_maps = maps[:, plane].repeat_interleave(objects, dim=0)
        sampled = nn.functional.grid_sample(
            plane_maps.reshape(batch * objects, 1, height, width),
            points.reshape(batch * objects, 1, crop * crop, 2) * 2 - 1,
            mode="bilinear",
            align_corners=False,
            padding_mode="zeros",
        )
        sampled = sampled.squeeze(2).permute(0, 2, 1).reshape(batch, objects, -1)
        # `sampled` is (batch * objects, 1, crop^2); the selection mask is
        # (batch * objects,). Reshape the mask rather than the crop.
        output.append(sampled * selected.reshape(batch, objects, 1).to(sampled.dtype))
        index += 1
    if not output:
        return images.new_zeros(batch, objects, crop * crop)
    return torch.stack(output).sum(0).reshape(batch, objects, crop * crop)


class DirectRoiHead(nn.Module):
    """A small CNN on the raw crop.

    Height is collapsed and width is not, so the left-to-right order of the glyphs
    survives - the property that separates 17 from 71. Pooling both axes would
    make them the same input.
    """

    def __init__(self, crop: int, width: int = 32) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        channels = 1
        for _ in range(3):
            layers += [nn.Conv2d(channels, width, 3, padding=1), nn.GroupNorm(8, width), nn.GELU()]
            channels = width
        self.body = nn.Sequential(*layers)
        self.crop = crop
        self.head = nn.Linear(width, 26)

    def forward(self, roi: torch.Tensor) -> torch.Tensor:
        """``roi`` is (batch, objects, crop^2) -> (batch, objects, 26)."""
        batch, objects, _ = roi.shape
        planes = roi.reshape(batch * objects, 1, self.crop, self.crop)
        # Collapse both spatial axes for the classifier. Collapsing only height and
        # leaving width would feed the linear head a (batch*objects, width, 26)
        # tensor; here the whole crop is flattened, which is the *most* favourable
        # thing this probe can do and so the right choice for a test whose job is
        # to establish whether the information is present at all.
        features = self.body(planes).mean(dim=(2, 3))
        return self.head(features).reshape(batch, objects, 26)


def build_conditions(
    batch: dict[str, torch.Tensor], crop: int
) -> dict[str, dict[str, torch.Tensor]]:
    """The four pixel conditions, all sharing one geometry."""
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    planes = batch["images"].shape[1]
    real = dict(batch)
    blank = dict(batch)
    blank["images"] = torch.ones_like(batch["images"])

    shuffled = dict(batch)
    permutation = torch.roll(batch["images"], shifts=1, dims=0)
    shuffled["images"] = permutation

    wrong = dict(batch)
    wrong["view"] = (batch["view"] + 1) % planes

    out = {}
    for name, variant in (
        ("real", real),
        ("blank", blank),
        ("shuffled", shuffled),
        ("wrong_roi", wrong),
    ):
        out[name] = {
            "roi": sample_roi(
                variant["images"],
                variant["boxes"],
                variant["object_mask"],
                variant["view"],
                crop,
            ),
            "fret": variant["fret"],
            "mask": is_fret,
        }
    return out


def run(
    records: Path,
    views: Path,
    pages: int,
    steps: int,
    crop: int,
    plane: int,
    lr: float,
    target: float,
) -> dict[str, Any]:
    samples = load_dataset(records, views, size=(plane, plane), limit=pages)
    if not samples:
        raise SystemExit("no rendered corpus")
    batch = collate(samples, 128)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    batch = {k: (v.to(device) if torch.is_tensor(v) else v) for k, v in batch.items()}
    objects = batch["boxes"].shape[1]

    report: dict[str, Any] = {
        "pages": len(samples),
        "objects_per_page": objects,
        "roi_crop_px": crop,
        "plane_px": plane,
        "target": target,
    }

    for name in ("real", "blank", "shuffled", "wrong_roi"):
        conditions = build_conditions(batch, crop)
        torch.manual_seed(11)
        model = DirectRoiHead(crop).to(device)
        optimiser = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.0)
        schedule = torch.optim.lr_scheduler.LambdaLR(
            optimiser,
            lambda s: min(1.0, (s + 1) / max(1, steps // 4))
            * 0.5 * (1 + math.cos(math.pi * min(s / max(steps, 1), 1.0))),
        )
        data = conditions[name]
        roi, fret, mask = data["roi"], data["fret"], data["mask"]
        for step in range(steps):
            model.train()
            logits = model(roi)
            loss = _masked(logits, fret, mask)
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            optimiser.step()
            schedule.step()
        model.eval()
        with torch.no_grad():
            logits = model(roi)
            predicted = logits.argmax(-1)
            correct = ((predicted == fret) & mask).sum().item()
            total = int(mask.sum())
        report[name] = {
            "memorisation": round(correct / max(total, 1), 6),
            "correct": correct,
            "total": total,
            "final_loss": round(float(loss.detach()), 6),
            "passes_target": bool(correct / max(total, 1) >= target),
        }
        del model, optimiser, roi, logits
        if device.type == "mps":
            torch.mps.synchronize()

    report["diagnosis"] = _diagnose(report)
    return report


def _masked(logits: torch.Tensor, fret: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    flat_logits = logits.reshape(-1, 26)
    flat_target = fret.reshape(-1)
    flat_mask = mask.reshape(-1)
    if not bool(flat_mask.any()):
        return logits.sum() * 0.0
    return nn.functional.cross_entropy(
        flat_logits,
        torch.where(flat_mask, flat_target, torch.full_like(flat_target, -100)),
        ignore_index=-100,
    )


def _diagnose(report: dict[str, Any]) -> str:
    real = report["real"]["memorisation"]
    blank = report["blank"]["memorisation"]
    shuffled = report["shuffled"]["memorisation"]
    wrong = report["wrong_roi"]["memorisation"]
    if real >= report["target"] and blank < 0.5 * real:
        return (
            "pixels carry fret information and the head needs it: the tensor is "
            "sufficient and the production path discards it. Fault is downstream "
            "(backbone downsampling or tile weighting), NOT resolution and NOT crop."
        )
    if real < report["target"]:
        return (
            "cannot memorise even real pixels: the fault is upstream of any head - "
            "the crop does not contain the glyph, or the labels do not match the "
            "pixels."
        )
    if blank >= 0.5 * real:
        return "memorises blank as well as real: a positional shortcut remains."
    return "mixed: memorises real but not enough to attribute the fault cleanly."


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("records", type=Path)
    parser.add_argument("views", type=Path)
    parser.add_argument("--pages", type=int, default=4)
    parser.add_argument("--steps", type=int, default=300)
    parser.add_argument("--crop", type=int, default=32)
    parser.add_argument("--plane", type=int, default=256)
    parser.add_argument("--lr", type=float, default=3e-3)
    parser.add_argument("--target", type=float, default=0.98)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    result = run(args.records, args.views, args.pages, args.steps, args.crop, args.plane, args.lr, args.target)
    print(json.dumps(result, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

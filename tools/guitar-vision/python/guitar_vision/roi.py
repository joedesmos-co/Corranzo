"""The raw-ROI fret signal: canonical crop sampler and the validated probe CNN.

## Why this is a package module

``sample_roi`` and the probe CNN used to live only in experiment scripts
(``h1_direct_roi_probe``, ``d3_roi_probe``, ``d8_stage_probes``). The raw-ROI signal is
the strongest fret signal this project has measured -- 0.934 score-disjoint from pixels
alone, against 0.5899 for the current production representation -- so it needs a
canonical home that a model variant and a production path can both import, rather than
three copies that can drift.

The mathematics here is a faithful copy of ``h1_direct_roi_probe.sample_roi``, which is
the extraction that produced the 0.934 result. Any change to it invalidates that number.
``tools/guitar-vision/h82_dedicated_roi_branch.py`` asserts numerical equality against the
original before it measures anything.
"""
from __future__ import annotations

import torch
import torch.nn as nn

#: Crop size and context the validated probe used. Not tunable here.
ROI_CROP = 32
ROI_CONTEXT = 1.6


def sample_roi(
    images: torch.Tensor,
    boxes: torch.Tensor,
    mask: torch.Tensor,
    tile: torch.Tensor,
    crop: int = ROI_CROP,
    context: float = ROI_CONTEXT,
) -> torch.Tensor:
    """Cut a fixed-size crop around each object from the input planes.

    Differentiable with respect to ``images``, so a branch on top can train end to end.
    The tile index is used only to address the plane an object lives in -- never to
    decide whether it is a fret digit -- and the ``wrong_roi`` control deliberately
    shifts it so the digit leaves the frame.

    Returns ``(batch, objects, crop * crop)`` in page-normalised coordinates, so the
    crop is a function of the box and the pixels, not of any ground-truth attribute.
    """
    batch, objects = boxes.shape[:2]
    _, planes, _, height, width = images.shape
    maps = images.reshape(batch, planes, height, width)
    centre = (boxes[..., :2] + boxes[..., 2:]) / 2
    half = ((boxes[..., 2:] - boxes[..., :2]) / 2 * context).clamp_min(1e-4)
    # A fixed physical field of view, expressed as a grid over the box.
    ys, xs = torch.meshgrid(
        torch.linspace(-1.0, 1.0, crop, device=boxes.device),
        torch.linspace(-1.0, 1.0, crop, device=boxes.device),
        indexing="ij",
    )
    grid = torch.stack((xs, ys), -1).reshape(1, 1, crop * crop, 2)
    points = centre.unsqueeze(2) + grid * half.unsqueeze(2)
    output = []
    for plane in range(planes):
        selected = ((tile == plane) & mask).reshape(-1)
        if not bool(selected.any()):
            continue
        # One crop per object, so the grid is (batch * objects, 1, crop^2, 2) against
        # a single plane's (batch, 1, H, W). Both are reshaped to the same leading
        # dimension. `maps[:, plane]` is (batch, 1, H, W) and is repeated once per
        # object: `expand` cannot introduce a new axis in the middle, so this has to
        # be an explicit repeat.
        plane_maps = maps[:, plane].repeat_interleave(objects, dim=0)
        sampled = nn.functional.grid_sample(
            plane_maps.reshape(batch * objects, 1, height, width),
            points.reshape(batch * objects, 1, crop * crop, 2) * 2 - 1,
            mode="bilinear",
            align_corners=False,
            padding_mode="zeros",
        )
        sampled = sampled.squeeze(2).permute(0, 2, 1).reshape(batch, objects, -1)
        output.append(sampled * selected.reshape(batch, objects, 1).to(sampled.dtype))
    if not output:
        return images.new_zeros(batch, objects, crop * crop)
    return torch.stack(output).sum(0).reshape(batch, objects, crop * crop)


class RoiFretCnn(nn.Module):
    """The validated ROI-only probe architecture, as a model component.

    Three ``conv3x3 -> BatchNorm -> ReLU`` blocks at widths 32, 64 and 128, then global
    average pooling and a linear classifier. This is reproduced **exactly** from
    ``d3_roi_probe.RoiProbe`` and ``d8_stage_probes.cnn_probe``, which both measured
    ~0.93 score-disjoint on the raw crop. It is deliberately not enlarged: the point of
    this branch is to reproduce a measured capability, not to explore capacity.

    Global average pooling over *both* axes is kept even though it discards the
    left-to-right order of a two-glyph fret. It is what the validated probe did, and the
    two-digit class still scored 0.9278 with it, so changing it here would break the
    comparison for no measured reason.

    Parameter count is 96,474 at 26 classes, 95,700 at 20 -- both inside the 0.1M budget.
    """

    def __init__(self, classes: int = 26, widths: tuple[int, int, int] = (32, 64, 128)) -> None:
        super().__init__()
        first, second, third = widths
        self.body = nn.Sequential(
            nn.Conv2d(1, first, 3, padding=1), nn.BatchNorm2d(first), nn.ReLU(),
            nn.Conv2d(first, second, 3, padding=1), nn.BatchNorm2d(second), nn.ReLU(),
            nn.Conv2d(second, third, 3, padding=1), nn.BatchNorm2d(third), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1), nn.Flatten(),
        )
        self.head = nn.Linear(third, classes)
        self.classes = classes

    def forward(self, crops: torch.Tensor) -> torch.Tensor:
        """Classify crops given as ``(batch, objects, crop * crop)`` or ``(objects, crop * crop)``.

        The two forms are both used in practice: a model forward passes the batched
        layout, and a training loop working from a cached matrix passes the flat one.
        Supporting both in one place is what lets ``forward`` and the harness share a
        single implementation rather than two that can drift.
        """
        if crops.dim() == 3:
            batch, objects, pixels = crops.shape
            leading: tuple[int, ...] = (batch, objects)
            flat = crops.reshape(batch * objects, pixels)
        elif crops.dim() == 2:
            objects, pixels = crops.shape
            leading = (objects,)
            flat = crops
        else:
            raise ValueError(f"expected 2-D or 3-D crops, got {crops.dim()}-D")
        side = int(round(pixels ** 0.5))
        if side * side != pixels:
            raise ValueError(f"crop of {pixels} values is not square")
        planes = flat.reshape(flat.shape[0], 1, side, side)
        return self.head(self.body(planes)).reshape(*leading, self.classes)


__all__ = ["ROI_CROP", "ROI_CONTEXT", "sample_roi", "RoiFretCnn"]
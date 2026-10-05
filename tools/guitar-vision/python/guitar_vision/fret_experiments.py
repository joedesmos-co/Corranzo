"""Fret-representation experiments, under the frozen Phase 4 gate.

## Why a separate harness

The full gate run costs ~40 minutes: a fine price for a decision, far too high a
price for *looking at something*. This harness answers narrow questions about one
head quickly. Every number it produces is computed the way the gate computes it:

- the same load path, so the boxes land on the same pixels;
- the same partitions — training pages, held-out pages, no overlap;
- the same proposal jitter, at the same scale, during training *and* evaluation,
  so the coordinate key is equally useless in both arms of any comparison;
- the same blank-image control, which is the only thing that has caught a label
  leaking into the input;
- the same majority-class chance baseline, re-measured per head on the held-out
  pages.

It does **not** claim a gate result. Only ``qualify.py`` does. A positive result
here means "run the full gate", and that run decides.

## The invariant this file exists to protect

Every variant is checked for the same failure: a fret head that scores well
without ever looking at a digit. The blank-image control runs on every variant
without exception, and a variant that cannot survive it is discarded regardless
of how good its accuracy looks. This codebase has produced three real leaks that
way, so the control is treated as a gate rather than a diagnostic.

## What is held fixed

The backbone, both samplers, the pair features, the relation attention, and the
`object_type` and `string` heads are untouched. Only the path from the final token
to the fret number changes. `object_type` and `string` are therefore the
regression check: they work, and this is a fret-only investigation.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from torch import nn

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[3]
sys.path.insert(0, str(_HERE.parent))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.model import (  # noqa: E402
    GuitarVisionConfig,
    GuitarVisionModel,
    _tab_anchors,
    cross_entropy,
    guitar_pairs,
)
from guitar_vision.qualify import (  # noqa: E402
    Device,
    HeadReport,
    _blank_images,
    _jitter,
    chance_baselines,
)

NO_DIGIT = 10  # the "no digit in this slot" class


# --------------------------------------------------------------------------
# Experiment 1 — dedicated high-resolution ROI crops for frets
# --------------------------------------------------------------------------


def roi_crops(
    finest: torch.Tensor,
    boxes: torch.Tensor,
    mask: torch.Tensor,
    grid: int,
    context: float,
) -> torch.Tensor:
    """Sample a dense grid around every proposal from the stride-1 feature map.

    ## Why

    A fret digit is about 11 pixels tall in a 256-pixel plane. The shared
    backbone's five scales run at strides 1, 2, 4, 8 and 16, so at the two
    coarsest scales the digit is 1.4 and 0.7 pixels — smaller than a convolution's
    receptive field. No head on top of that signal can recover a two-glyph number,
    because the information is not in the features to recover.

    ## Why the crop is larger than the digit

    A fret is read against its TAB line: the line says which string, and the
    neighbouring digits give the hand its shape. Cropping tight to the glyph would
    raise digit resolution and discard the thing that makes the glyph
    interpretable. `string` is the regression check for that, and it is scored on
    exactly this path.

    ## Why it is differentiable

    ``grid_sample`` over the finest map, so the branch trains end to end from the
    same loss. Nothing new is written to disk, and the crop is a function of the
    box the model was already given — including its jitter, so no exact coordinate
    ever reaches the encoder.
    """
    batch, objects = boxes.shape[:2]
    centre = (boxes[..., :2] + boxes[..., 2:]) / 2
    half = (boxes[..., 2:] - boxes[..., :2]) / 2 * context
    half = half.clamp_min(1e-4)
    ys, xs = torch.meshgrid(
        torch.linspace(-0.5, 0.5, grid, device=boxes.device),
        torch.linspace(-0.5, 0.5, grid, device=boxes.device),
        indexing="ij",
    )
    offsets = torch.stack((xs, ys), -1).reshape(1, 1, -1, 2)
    positions = centre.unsqueeze(2) + offsets * half.unsqueeze(2)
    # The finest map comes back as (batch * tiles, C, H, W) — flattened, not
    # split. It has to be reshaped to (batch, tiles, C, H, W) before a tile can
    # be addressed, which is the same reshuffle the shared samplers do.
    plane_count, channels, height, width = finest.shape
    tiles = plane_count // batch
    maps = finest.reshape(batch, tiles, channels, height, width)
    # One sample point set per object, broadcast across the tile dimension. The
    # crop is the same shape for every tile; only the pixel content differs, which
    # is what makes the weighted combination below meaningful.
    sample_points = (positions * 2 - 1).reshape(batch, 1, objects, grid * grid, 2)
    sample_points = sample_points.expand(batch, tiles, objects, grid * grid, 2)
    values = nn.functional.grid_sample(
        maps.reshape(batch * tiles, channels, height, width),
        sample_points.reshape(batch * tiles, objects, grid * grid, 2),
        mode="bilinear",
        align_corners=False,
        padding_mode="zeros",
    )  # (B * tiles, C, N, grid * grid)
    values = values.reshape(batch, tiles, channels, objects, grid * grid)
    values = values.permute(0, 3, 1, 2, 4).reshape(batch, objects, tiles, channels * grid * grid)

    # Which tile to read, learned rather than given.
    #
    # An object sits in exactly one tile, but its tile index is a ground-truth
    # attribute, and "which view is this in" answers "is this a fret digit" - the
    # third leak this project has already produced. So no tile is selected here.
    # Each tile's crop is scored by how much variation it contains and the scores
    # are softmaxed across tiles, which lets the model find the tile holding the
    # glyph from the pixels. A blank tile scores near zero and is ignored; the tile
    # with the digit wins.
    #
    # The score is the standard deviation across the crop's features, not the mean:
    # a uniform background region has near-zero mean *and* near-zero variation,
    # while a glyph raises the variation, and on grayscale engraving the background
    # dominates the area so the mean alone is a poor discriminator.
    score = values.std(dim=-1, keepdim=True)
    weights = torch.softmax(score * 8.0, dim=2)
    combined = (values * weights).sum(dim=2)
    return combined * mask.unsqueeze(-1)


class RoiEncoder(nn.Module):
    """A small convolutional encoder over the dense crop grid.

    The crop is treated as a 2-D image, not a bag of samples, so the convolutions
    can see the digit's shape. Height is collapsed; **width is not**, because the
    left-to-right order of the glyphs is the label — "1" then "7" is not "7" then
    "1". Collapsing both axes is exactly the mistake that makes 17 and 71 the same
    prediction, and it is what the digit decoder is for.
    """

    def __init__(self, in_channels: int, width: int = 32, depth: int = 3) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        channels = in_channels
        for _ in range(depth):
            layers += [
                nn.Conv2d(channels, width, 3, padding=1),
                nn.GroupNorm(8, width),
                nn.GELU(),
            ]
            channels = width
        self.body = nn.Sequential(*layers)
        self.out_channels = width

    def forward(
        self, grid: torch.Tensor, mask: torch.Tensor, grid_size: int, channels: int
    ) -> torch.Tensor:
        batch, objects, _ = grid.shape
        # The crop arrives as a flat (channels * grid * grid) vector and has to be
        # restored to a 2-D image per object. Flattening it as (1, grid, grid)
        # instead would silently treat the feature channels as pixels and throw
        # away the convolutions' whole reason to exist.
        planes = grid.reshape(batch * objects, channels, grid_size, grid_size)
        features = self.body(planes)
        # Collapse height, keep the horizontal axis. Returned as
        # (batch, objects, width, grid) so the decoder can group columns into digit
        # slots. Keeping that axis named is the whole point - collapsing it too is
        # what makes 17 and 71 the same prediction. The mask is broadcast over
        # both trailing axes, since it is per object, not per pixel.
        features = features.mean(dim=2).reshape(
            batch, objects, self.out_channels, grid_size
        )
        return features * mask.reshape(batch, objects, 1, 1)


# --------------------------------------------------------------------------
# Experiment 2 — digit-structured fret prediction
# --------------------------------------------------------------------------


def decode_fret(output: dict[str, torch.Tensor]) -> torch.Tensor:
    """Compose per-slot digit distributions into one fret number per object.

    The gate is scored on this composed number, not on a per-slot proxy: a variant
    that reads its digits well and assembles them into the wrong number has not
    helped. `max_digits` caps the slots, so a one-digit fret is a single left
    aligned slot and the rest are empty.
    """
    values = output["slots"].argmax(-1)
    base = torch.full_like(values[..., 0], 1)
    for index in range(values.shape[-1]):
        digit = values[..., index].clamp(max=9)
        present = (values[..., index] < NO_DIGIT).to(digit.dtype)
        output_number = torch.where(
            (digit != 0).unsqueeze(-1) | (index == 0).unsqueeze(-1),
            torch.zeros_like(base) + 1,
            base,
        )
        base = base * output_number + digit * present
    return base.round().clamp(0, 24).long()


def decode_fret_simple(
    output: dict[str, torch.Tensor], max_digits: int = 2
) -> torch.Tensor:
    """Left-to-right composition of at most two digit slots.

    Slot 0 is the tens place when it is occupied, so a one-digit fret occupies
    slot 0 and contributes ``digit * 1``; a two-digit fret occupies both and
    contributes ``tens * 10 + units``. A slot reading "no digit" contributes
    nothing rather than a zero, which is why occupancy is a separate head: 0 is a
    real fret, and confusing "absent" with "0" is how 7 turns into 07.
    """
    slots = output["slots"]  # (B, N, max_digits, classes)
    values = slots.argmax(-1)
    presence = output["presence"].argmax(-1)  # 0, 1 or 2 occupied slots
    units = values[..., 1]
    tens = values[..., 0]
    number = torch.zeros_like(tens)
    has_units = (presence >= 1) & (units < NO_DIGIT)
    has_tens = (presence >= 2) & (tens < NO_DIGIT)
    number = torch.where(
        has_units & ~has_tens, units.clamp(max=9), number
    )
    number = torch.where(
        has_tens & ~has_units, tens.clamp(max=9), number
    )
    number = torch.where(
        has_tens & has_units, tens.clamp(max=9) * 10 + units.clamp(max=9), number
    )
    return number.long().clamp(0, 24)


def digit_targets(fret: torch.Tensor, max_digits: int) -> torch.Tensor:
    """Per-slot digit targets, left aligned, padded with the empty class."""
    target = torch.full_like(fret, NO_DIGIT).unsqueeze(-1).expand(-1, -1, max_digits)
    target = target.clone()
    for index in range(max_digits):
        divisor = 10 ** (max_digits - 1 - index)
        digit = (fret // divisor) % 10
        # The units slot is always occupied - including for fret 0, which is a
        # real one-glyph "0" and not an absence. Testing occupancy as
        # `fret >= divisor` would make 0 the only fret with an empty units slot,
        # which is precisely backwards.
        alive = torch.ones_like(fret, dtype=torch.bool) if divisor == 1 else fret >= divisor
        slot = torch.full_like(fret, NO_DIGIT)
        target[:, :, index] = torch.where(alive, digit, slot)
    return target


def digit_losses(
    output: dict[str, torch.Tensor], fret: torch.Tensor, mask: torch.Tensor
) -> tuple[torch.Tensor, torch.Tensor]:
    """Slot loss and occupancy loss, returned separately so each can be reported."""
    max_digits = output["slots"].shape[-2]
    batch, objects = mask.shape
    targets = digit_targets(fret, max_digits)
    slot_mask = mask.unsqueeze(-1).expand(-1, -1, max_digits).reshape(batch, -1)
    slots = output["slots"].permute(0, 1, 3, 2).reshape(batch, -1, output["slots"].shape[-1])
    slot_loss = cross_entropy(slots, targets.reshape(batch, -1), slot_mask)
    # Occupancy: 1 slot for 0-9, 2 for 10-25, and 0 for "not a fret at all".
    occupied = torch.where(
        fret >= 10, torch.full_like(fret, 2), torch.full_like(fret, 1)
    )
    presence_loss = cross_entropy(output["presence"], occupied, mask)
    return slot_loss, presence_loss


# --------------------------------------------------------------------------
# Variants
# --------------------------------------------------------------------------


class TrainStatsStandardizer(nn.Module):
    """Per-feature standardisation from training statistics only.

    ## Why this exists

    The head-only diagnostic at commit ``ca400d984e`` measured the exact same
    representation ``P`` two ways. On raw ``P`` the production ``Linear(192 -> 26)``
    recipe reached 0.1671 score-disjoint; on per-feature standardised ``P`` the same
    recipe reached 0.4203. Changing the optimiser instead was worth 0.0152.

    The mechanism is scale, not spectrum. ``P``'s median per-feature standard
    deviation is about 0.045, while ``Linear(192, 26)`` initialises weights to
    +/-1/sqrt(192) = +/-0.0722, so initial logits land near 0.045 and the classes are
    indistinguishable at that magnitude. Adam moves each weight by roughly ``lr`` per
    step regardless of gradient size, so a unit logit response needs a weight change
    of about 1/0.045 = 22, i.e. roughly 7,400 steps at lr 3e-3. The budget is 1,200.
    The head is not stuck; it is travelling too slowly to arrive. Standardising makes
    the requirement about 333 steps.

    The covariance condition number barely moved under standardisation (3.92e6 to
    2.29e6), so this is deliberately *not* described as a spectral conditioning fix.

    ## No learnable parameters

    ``count``, ``mean`` and ``m2`` are buffers, not parameters. There is no learned
    affine, so nothing here is initialised, nothing is in the optimiser, and the
    module cannot overfit. Buffers ride along in ``state_dict``, which is what makes
    the resume test able to compare them exactly.

    ## Deterministic cumulative statistics

    Welford's algorithm, merged chunk by chunk, accumulated in float64. There is no
    momentum and no exponential moving average, because a momentum would be a
    hyperparameter that could only be chosen by looking at held-out accuracy. After
    ``N`` rows the buffers are a pure function of those rows, so a run and a resumed
    run that see the same batches agree bit for bit.

    ## Population standard deviation

    ``sqrt(m2 / count)``, i.e. ``ddof=0``, because that is what ``numpy.std`` computes
    by default and therefore what the successful diagnostic used. The sample
    convention would rescale every feature by ``sqrt(count / (count - 1))`` relative
    to the measurement this module exists to reproduce.

    ## Train-only, and evaluation never updates

    ``forward`` updates the buffers only when ``self.training`` is true, and only from
    the rows selected by the fret mask. Every evaluation mode -- real, blank, wrong
    ROI, pixel ablation, geometry-neutralised, and all three splits -- reads the same
    stored statistics. No held-out, blank or ablated example can reach ``mu`` or
    ``sigma``: they are never passed to ``update`` while in eval mode.

    ## Not per-row

    Normalising each object by its own statistics is what LayerNorm does, and it
    measured 0.2288 same-score against 0.5033 for this module. Per-row statistics
    inject noise when the informative variation is small relative to the row's norm.
    """

    def __init__(self, dim: int, eps: float = 1e-6) -> None:
        super().__init__()
        self.dim = dim
        self.eps = eps
        self.register_buffer("count", torch.zeros((), dtype=torch.float64))
        self.register_buffer("mean", torch.zeros(dim, dtype=torch.float64))
        self.register_buffer("m2", torch.zeros(dim, dtype=torch.float64))

    @torch.no_grad()
    def update(self, rows: torch.Tensor) -> None:
        """Fold one batch of valid rows into the cumulative moments."""
        if rows.numel() == 0:
            return
        x = rows.detach().to(torch.float64)
        rows_in_batch = x.shape[0]
        batch_mean = x.mean(dim=0)
        batch_m2 = ((x - batch_mean) ** 2).sum(dim=0)
        seen = float(self.count.item())
        delta = batch_mean - self.mean
        total = seen + rows_in_batch
        self.mean += delta * (rows_in_batch / total)
        self.m2 += batch_m2 + (delta ** 2) * (seen * rows_in_batch / total)
        self.count += rows_in_batch

    def scale(self) -> torch.Tensor:
        """Population standard deviation plus epsilon, matching the diagnostic."""
        seen = float(self.count.item())
        if seen <= 0.0:
            return torch.full_like(self.mean, self.eps)
        variance = (self.m2 / seen).clamp_min(0.0)
        return variance.sqrt() + self.eps

    def forward(
        self, values: torch.Tensor, mask: torch.Tensor | None = None
    ) -> torch.Tensor:
        """Standardise the last axis, updating statistics first when training."""
        if mask is None:
            rows = values.reshape(-1, values.shape[-1])
        else:
            rows = values[mask]
        if self.training:
            self.update(rows)
        scale = self.scale().to(values.dtype)
        shift = self.mean.to(values.dtype)
        standardised = (values - shift) / scale
        if mask is not None:
            # Zero the slots the mask excludes so no padding can contribute a
            # gradient or an infinity. Those slots are already excluded from the
            # loss, so this changes no trained quantity.
            keep = mask.unsqueeze(-1)
            standardised = torch.where(
                keep, standardised,
                torch.zeros((), dtype=standardised.dtype, device=standardised.device),
            )
        return standardised

    def diagnostics(self) -> dict[str, Any]:
        """Standardizer state, for the checkpoint reports."""
        scale = self.scale()
        return {
            "count": float(self.count.item()),
            "median_abs_mean": round(float(self.mean.abs().median()), 8),
            "median_std": round(float(scale.median()), 8),
            "min_std": round(float(scale.min()), 8),
            "max_std": round(float(scale.max()), 8),
            "near_zero_variance_features": int((scale < 10 * self.eps).sum()),
        }


class FretVariantModel(nn.Module):
    """The shared model with one of three fret heads, chosen by name.

    ``shared``
        The current 26-way head on the shared token. The baseline every
        experiment is measured against.
    ``roi26``
        A 26-way head, but on a dedicated high-resolution ROI encoding concatenated
        with the shared token. Isolates the resolution effect from the
        factorisation effect.
    ``roidigits``
        Per-slot digit distributions plus an occupancy head, on the same ROI
        encoding. Isolates the factorisation effect at the same resolution.

    ``ROI_ONLY_NO_TOKEN``
        An **experimental** causal variant, not a production change. It is
        ``roi26`` with exactly one term deleted: the shared token is not added to
        the ROI encoding before the fret head.

        It exists because the representation localisation at commit 38d6fa7111
        measured the shared token at 0.0633 score-disjoint and 0.1765 on
        same-score unseen instances, while the ROI encoding feeding the same head
        carried far more. ``roi26`` computes::

            fused = self.roi_projection(encoded.flatten(-2)) + tokens

        so it *adds* the collapsed representation to the good one rather than
        routing around it. Removing the term is the smallest change that can test
        whether that fusion is causal for the transfer failure.

        Modules are constructed in the same order, with the same shapes, as
        ``roi26``, so under an equal seed the initial weights are identical and the
        only difference between the two variants is the term under test.

    ``FROZEN_RANDOM_ROI_ENCODER``
        The **same** ``ROI_ONLY_NO_TOKEN`` model with one further change: every
        ``RoiEncoder`` parameter is frozen at initialisation. Everything else --
        backbone, ``roi_projection``, ``fret_classifier``, the other heads, the
        loss, the schedule -- trains normally.

        This exists because the ``ROI_ONLY_NO_TOKEN`` run localised the failure one
        stage further. Its stride-1 crop probed at 0.8076 score-disjoint, its
        *trained* encoder output at 0.1975, and the projection at 0.1291, with the
        encoder's effective rank falling from 28.5 to 3.1. The same encoder
        architecture, untrained, had probed at 0.6354. So the encoder architecture
        preserves fret identity and something about *training* it destroys that.

        Freezing the parameters is the direct test of that attribution. It is not a
        new architecture: same module, same shapes, same random initialisation, same
        seed, same forward pass.

        Note the encoder's *input* is the trainable backbone's stride-1 crop, so C
        can still change over training even with every encoder weight fixed. That is
        deliberate and is the point: it separates "updates to the encoder destroyed
        the representation" from "the backbone co-adapted and changed what the frozen
        encoder receives".
    ``FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED``
        ``FROZEN_RANDOM_ROI_ENCODER`` with exactly one addition: a
        :class:`TrainStatsStandardizer` between ``roi_projection`` and
        ``fret_classifier``::

            encoded = self.encoder(...)                    # frozen
            p = self.roi_projection(encoded.flatten(-2))
            z = self.p_standardizer(p, is_fret)            # train statistics only
            out["fret"] = self.fret_classifier(z)          # Linear(192 -> 26)

        It exists because the head-only diagnostic showed the same ``P`` is readable at
        0.4506 score-disjoint once standardised and at 0.1671 when raw, under an
        otherwise identical optimiser. The cause is input *scale*: ``P``'s median
        per-feature std is ~0.045 against a head initialised at +/-1/sqrt(192), so
        useful logit growth needs roughly 7,400 steps at lr 3e-3 and the budget is
        1,200.

        The encoder stays frozen, the head stays ``Linear(192 -> 26)``, there is still
        no ``+ tokens``, and the standardizer holds no learnable parameters, so it
        consumes no RNG at construction and the initial weights are bit-identical to
        ``FROZEN_RANDOM_ROI_ENCODER``.
    """

    #: Kinds whose fret head reads the dedicated ROI encoding alone, with no shared
    #: token added. Grouped so the forward pass has a single implementation and the
    #: variants cannot drift apart in any way other than the encoder freezing and the
    #: standardizer.
    ROI_ONLY_KINDS = (
        "ROI_ONLY_NO_TOKEN",
        "FROZEN_RANDOM_ROI_ENCODER",
        "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED",
    )
    #: Kinds whose ``RoiEncoder`` parameters are held at initialisation.
    FROZEN_ENCODER_KINDS = (
        "FROZEN_RANDOM_ROI_ENCODER",
        "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED",
    )

    MAX_DIGITS = 2

    def __init__(self, base: GuitarVisionModel, kind: str, grid: int = 8, context: float = 1.6) -> None:
        super().__init__()
        self.base = base
        self.kind = kind
        self.grid = grid
        self.context = context
        hidden = base.config.hidden
        if kind != "shared":
            self.encoder = RoiEncoder(base.backbone.output_channels[0], width=32)
        if kind == "roi26" or kind in FretVariantModel.ROI_ONLY_KINDS:
            # One vector per object: the crop's columns are flattened, which is
            # what the baseline shared head also does. This variant changes the
            # *resolution* and nothing else, so the comparison against `shared` is
            # about pixels and not about the output parameterisation.
            #
            # `ROI_ONLY_NO_TOKEN` and `FROZEN_RANDOM_ROI_ENCODER` build the
            # identical pair of modules here, in the identical order and shapes, so
            # an equal seed gives them the same initial weights. The only difference
            # between them is the encoder freezing below.
            self.roi_projection = nn.Linear(self.encoder.out_channels * grid, hidden)
            self.fret_classifier = nn.Linear(hidden, 26)
            if kind in FretVariantModel.FROZEN_ENCODER_KINDS:
                # Freeze every encoder parameter at initialisation.
                #
                # Setting `requires_grad` is sufficient and not merely conventional:
                # `RoiEncoder` is Conv2d + GroupNorm + GELU, and GroupNorm keeps no
                # running statistics, so it behaves identically in train() and
                # eval() and there is no buffer that `train()` could update. With no
                # gradient, AdamW skips the parameter (`p.grad is None`), so the
                # weights cannot move by any route.
                for parameter in self.encoder.parameters():
                    parameter.requires_grad_(False)
                self.encoder.eval()
            if kind == "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED":
                # Buffers only: no parameters, so no RNG is consumed here and the
                # initial weights stay bit-identical to the unstandardized variant.
                self.p_standardizer = TrainStatsStandardizer(hidden)
        elif kind == "roidigits":
            # Per column, then grouped into digit slots. The projection is applied
            # along the width axis so each horizontal position keeps its own
            # embedding before the slots are pooled - pooling first and
            # projecting after would average 17 and 71 into the same vector.
            self.column_projection = nn.Linear(self.encoder.out_channels, 64)
            self.roi_projection = nn.Linear(
                self.encoder.out_channels * grid, hidden
            )
            self.position = nn.Parameter(torch.zeros(1, self.MAX_DIGITS, 64))
            nn.init.normal_(self.position, std=0.02)
            self.slot_head = nn.Linear(64, NO_DIGIT + 1)
            self.presence_head = nn.Linear(hidden, self.MAX_DIGITS + 1)

    def group_columns(self, encoded: torch.Tensor) -> torch.Tensor:
        """Group the crop's columns into ``MAX_DIGITS`` digit slots.

        Columns are assigned by equal shares of the crop's width, and the crop is
        wider than the digit, so a slot covers a third of the crop rather than the
        digit's actual extent. That is deliberate slack: a one-glyph fret leaves
        the second slot empty, and the occupancy head has to be able to say so.
        The grouping is fixed, not learned, so the mapping from position to digit
        place cannot drift.
        """
        columns = encoded.shape[-1]
        edges = [
            (columns * index) // self.MAX_DIGITS for index in range(self.MAX_DIGITS + 1)
        ]
        slots = [
            encoded[..., edges[index] : edges[index + 1]].mean(-1)
            for index in range(self.MAX_DIGITS)
            if edges[index + 1] > edges[index]
        ]
        while len(slots) < self.MAX_DIGITS:
            slots.append(slots[-1] if slots else encoded.new_zeros(*encoded.shape[:-1], 64))
        return torch.stack(slots[: self.MAX_DIGITS], dim=-2)

    def shared_tokens(self, batch: dict[str, torch.Tensor], finest: torch.Tensor) -> torch.Tensor:
        boxes, mask = batch["boxes"], batch["object_mask"]
        tiles = batch["tiles"]
        box_visual = self.base.sampler(self.features, boxes, mask, tiles)
        anchor_y, staff_gap = _tab_anchors(boxes)
        tab_visual = self.base.tab_sampler(
            self.features, boxes, mask, tiles, anchor_y, staff_gap
        )
        visual = self.base.visual_projection(box_visual + tab_visual)
        source = self.base.source_projection(_source(batch))
        geometry = self.base.geometry_projection(boxes)
        tokens = visual + source[:, None] + geometry
        pairs = guitar_pairs(boxes, mask)
        for layer in self.base.context:
            tokens = layer(tokens, mask, pairs)
        return self.base.final_norm(tokens)

    def forward(self, batch: dict[str, torch.Tensor]) -> dict[str, Any]:
        # One backbone pass, shared by every head. Running it twice — once inside
        # the base forward and once for the ROI crop — would double the cost of
        # every experiment and make the parameter/runtime comparison meaningless.
        self.features = self.base.backbone(batch["images"].flatten(0, 1))
        tokens = self.shared_tokens(batch, self.features[0])
        out = {
            name: head(tokens)
            for name, head in self.base.heads.items()
        }
        if self.kind == "shared":
            return out
        crops = roi_crops(
            self.features[0], batch["boxes"], batch["object_mask"], self.grid, self.context
        )
        encoded = self.encoder(
            crops, batch["object_mask"], self.grid, self.base.backbone.output_channels[0]
        )  # (B, N, width, grid)
        if self.kind == "roi26":
            fused = self.roi_projection(encoded.flatten(-2)) + tokens
            out["fret"] = self.fret_classifier(fused)
        elif self.kind in FretVariantModel.ROI_ONLY_KINDS:
            # The experiment. `roi26` with the `+ tokens` term removed and nothing
            # else changed: same crop, same encoder, same projection, same
            # classifier, same loss, same optimiser, same schedule, same seed.
            # The frozen variants take exactly this path with their encoder
            # parameters held at initialisation.
            #
            # `out` is still built from `tokens` above, so the unrelated heads
            # (`object_type`, `string`, `tile`) keep their existing input and are
            # untouched by this change.
            p = self.roi_projection(encoded.flatten(-2))
            if self.kind == "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED":
                # Only fret rows enter the statistics. Padding slots and non-fret
                # objects would otherwise contribute their own degenerate
                # distributions to mu and sigma.
                p = self.p_standardizer(
                    p, batch["object_mask"] & (batch["object_type"] == 1)
                )
            out["fret"] = self.fret_classifier(p)
        else:
            # Two paths from the same crop: per-slot digits, and a whole-object
            # vector for occupancy. Occupancy genuinely is a whole-object
            # question - "are there two glyphs here" is not asked of one column.
            slots = self.group_columns(encoded)
            embedded = self.column_projection(slots) + self.position
            out["slots"] = self.slot_head(embedded)
            fused = self.roi_projection(encoded.flatten(-2)) + tokens
            out["presence"] = self.presence_head(fused)
        return out


def _source(batch: dict[str, torch.Tensor]) -> torch.Tensor:
    features = batch.get("page_context")
    if features is not None:
        return features
    return batch["images"].new_zeros(batch["images"].shape[0], 12)


# --------------------------------------------------------------------------
# Training and scoring
# --------------------------------------------------------------------------


def fret_loss(
    out: dict[str, Any], batch: dict[str, torch.Tensor]
) -> tuple[torch.Tensor, dict[str, float]]:
    """Shared heads plus whichever fret head this variant carries."""
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    parts = {
        "object_type": cross_entropy(
            out["object_type"], batch["object_type"], batch["object_mask"]
        ),
        "string": cross_entropy(out["string"], batch["string"], is_fret),
    }
    if "slots" in out:
        slot_loss, presence_loss = digit_losses(out, batch["fret"], is_fret)
        parts["fret_slots"] = slot_loss
        parts["fret_presence"] = presence_loss
    else:
        parts["fret"] = cross_entropy(out["fret"], batch["fret"], is_fret)
    total = sum(parts.values())
    return total, {name: float(value.detach()) for name, value in parts.items()}


def decode(out: dict[str, Any]) -> torch.Tensor:
    """The composed fret number for whichever head this variant carries."""
    if "slots" in out:
        return decode_fret_simple(out)
    return out["fret"].argmax(-1)


def score(
    model: FretVariantModel,
    pages: list[dict[str, torch.Tensor]],
    offset: int,
    count: int,
    device: Device,
    baseline: float,
    chunk: int = 3,
    max_objects: int = 128,
    held_out: int = 16,
) -> dict:
    """Score a variant on its train pages and on the held-out pages.

    Scored in chunks of a few pages rather than as one batch. A whole 40-page
    batch is 40 x 16 planes of activations through the backbone at once, and that
    is a few gigabytes; the run was being SIGKILLed by the OS part-way through the
    first variant, with no traceback and no exception to catch, which is
    indistinguishable from a hang. A chunk of three pages costs a fraction of that
    and the metric is identical, because nothing in the model or the loss is
    batch-dependent.
    """
    model.eval()
    report: dict[str, Any] = {
        "variant": model.kind,
        "parameters": sum(p.numel() for p in model.parameters()),
        "device": device.name,
    }

    def to_device(batch):
        return {
            k: (v.to(device.torch) if torch.is_tensor(v) else v)
            for k, v in batch.items()
        }

    def measure(pages, blank: bool) -> dict:
        detail = HeadReport(name="fret")
        fret_correct = fret_total = 0
        other = {"object_type": [0, 0], "string": [0, 0]}
        for start in range(0, len(pages), chunk):
            batch = collate(pages[start : start + chunk], max_objects)
            if blank:
                batch = _blank_images(batch)
            batch = to_device(batch)
            with torch.no_grad():
                out = model(batch)
                is_fret = batch["object_mask"] & (batch["object_type"] == 1)
                numbers = decode(out)
                correct = (numbers == batch["fret"]) & is_fret
                fret_correct += int(correct.sum())
                fret_total += int(is_fret.sum())
                for truth, prediction, right in zip(
                    batch["fret"][is_fret].tolist(),
                    numbers[is_fret].tolist(),
                    correct[is_fret].tolist(),
                ):
                    detail.record(truth, truth if right else prediction)
                for head in other:
                    mask = batch["object_mask"] if head == "object_type" else is_fret
                    predicted = out[head].argmax(-1)
                    other[head][0] += int(((predicted == batch[head]) & mask).sum())
                    other[head][1] += int(mask.sum())
            del batch, out
        return {
            "fret_accuracy": round(fret_correct / max(fret_total, 1), 6),
            "fret_correct": fret_correct,
            "fret_total": fret_total,
            "digit_count_split": detail.digit_count_split(),
            "top_confusions": dict(
                sorted(detail.confusion.items(), key=lambda item: -item[1])[:6]
            ),
            **{
                head: round(correct / max(total, 1), 6)
                for head, (correct, total) in other.items()
            },
        }

    report["train"] = measure(pages[:count], blank=False)
    held = measure(pages[offset : offset + held_out], blank=False)
    held["chance_baseline"] = round(baseline, 6)
    held["lift_over_chance"] = round(held["fret_accuracy"] - baseline, 6)
    report["held_out"] = held
    # The anti-leak control, on every variant without exception.
    report["blank_image_control"] = {
        "fret_accuracy": measure(pages[:count], blank=True)["fret_accuracy"]
    }
    report["pixel_ablation"] = round(
        report["train"]["fret_accuracy"] - report["blank_image_control"]["fret_accuracy"],
        6,
    )
    return report


def build(kind: str, args, device: Device) -> FretVariantModel:
    config = GuitarVisionConfig(
        image_height=args.image_size,
        image_width=args.image_size,
        max_objects=args.max_objects,
        hidden=args.hidden,
        layers=args.layers,
    )
    base = GuitarVisionModel(config).to(device.torch)
    return FretVariantModel(base, kind, grid=args.roi_grid, context=args.roi_context).to(
        device.torch
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--variant",
        default="shared",
        choices=["shared", "roi26", "roidigits", "all"],
        help="which fret head to run; 'all' runs every variant on the same data",
    )
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--pages", type=int, default=40)
    parser.add_argument(
        "--batch-pages",
        type=int,
        default=4,
        help="pages per step; the corpus is larger and sampled from, matching the "
        "full gate's --batch-pages so the two runs are comparable",
    )
    parser.add_argument("--held-out", type=int, default=20)
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=128)
    parser.add_argument("--hidden", type=int, default=192)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--lr", type=float, default=3e-3)
    parser.add_argument("--train-jitter", type=float, default=0.35)
    parser.add_argument("--roi-grid", type=int, default=8)
    parser.add_argument("--roi-context", type=float, default=1.6)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    device = Device(args.device)
    records = _REPO / "datasets/guitar-vision/synthetic/train/records"
    views = _REPO / "datasets/guitar-vision/synthetic/train/views"
    size = (args.image_size, args.image_size)
    # Loaded once and reused by every variant. Reading 40 scores, trimming,
    # tiling and resizing them again per variant is minutes of work that produces
    # identical tensors, and the earlier per-variant reload is what left the
    # process looking hung with no output for most of its life.
    everything = load_dataset(records, views, size=size, limit=0)
    train_samples = everything[: args.pages]
    held_samples = everything[args.pages : args.pages + args.held_out]
    if not train_samples or not held_samples:
        raise SystemExit(
            "need a rendered corpus; run render_corpus.py then rasterize_views.py first"
        )
    baseline = chance_baselines(held_samples).get("fret", 0.0)
    print(
        f"device {device.name} | train pages {len(train_samples)} | held out "
        f"{len(held_samples)} | fret chance {baseline:.1%}"
    )

    def to_device(batch):
        return {
            key: (value.to(device.torch) if torch.is_tensor(value) else value)
            for key, value in batch.items()
        }

    # Each training page is collated once, on the CPU, and the pages stay there.
    # A step assembles a batch from a random handful of them and moves only that.
    #
    # Two reasons, and the first one is a crash. Keeping the whole corpus resident
    # on the accelerator - 40 pages of 9 tiles at 256px, plus the graph, plus the
    # ROI branch's own crop grid - died of an MPS allocation failure at 19.8GB on
    # the first run. The second is that re-collating 40 pages every step spends
    # more time stacking tensors than the model spends on them.
    print(f"loaded {len(everything)} pages | train {args.pages} | held out {args.held_out}")

    kinds = ["shared", "roi26", "roidigits"] if args.variant == "all" else [args.variant]
    results = []
    for kind in kinds:
        torch.manual_seed(11)
        model = build(kind, args, device)
        print(
            f"\n=== {kind} === parameters {sum(p.numel() for p in model.parameters()):,}"
        )
        optimiser = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
        warmup = max(1, int(args.steps * 0.25))

        def factor(step: int) -> float:
            if step < warmup:
                return (step + 1) / warmup
            progress = (step - warmup) / max(args.steps - warmup, 1)
            return 0.5 * (1 + math.cos(math.pi * min(progress, 1.0)))

        schedule = torch.optim.lr_scheduler.LambdaLR(optimiser, factor)
        generator = torch.Generator().manual_seed(11)
        order = torch.Generator().manual_seed(11)
        started = time.perf_counter()
        try:
            for step in range(1, args.steps + 1):
                model.train()
                chosen = torch.randperm(len(train_samples), generator=order)[: args.batch_pages]
                batch = to_device(
                    collate([everything[i] for i in chosen.tolist()], args.max_objects)
                )
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
                # Free the graph as soon as it is no longer needed. The ROI branch's
                # crop grid is (batch, objects, planes, channels * grid^2) and with
                # ~16 planes and ~60 objects it dominates peak memory; holding it
                # until the next step's forward pass has allocated its own graph is
                # what pushed this past the accelerator's ceiling and killed a run
                # without a traceback, part-way through the first variant.
                reporting = step == 1 or step % max(1, args.steps // 4) == 0 or step == args.steps
                summary = {
                    "loss": float(loss.detach()),
                    "parts": parts,
                    "step": step,
                    "elapsed": time.perf_counter() - started,
                }
                del out, loss, batch
                if reporting:
                    device.sync()
                    elapsed = summary["elapsed"]
                    print(
                        f"  step {summary['step']:>4}/{args.steps}  "
                        f"loss {summary['loss']:.4f}  "
                        + "  ".join(f"{k} {v:.3f}" for k, v in summary["parts"].items())
                        + f"  {elapsed:6.1f}s  {elapsed / step * 1000:.0f}ms/step"
                    )
        except RuntimeError as error:
            if "out of memory" not in str(error).lower():
                raise
            # An accelerator allocation failure used to kill the run with no
            # message at all, which reads as "the experiment hung". It is now
            # reported with the lever that actually moves it.
            print(f"\n{type(error).__name__}: {error}")
            print(
                "The accelerator ran out of memory. Lower --batch-pages or "
                "--image-size. The ROI branch's crop grid scales with "
                "batch x objects x planes x grid^2 and is the peak."
            )
            return 1
        device.sync()
        seconds = time.perf_counter() - started
        result = score(
            model,
            everything,
            offset=args.pages,
            count=args.pages,
            device=device,
            baseline=baseline,
            max_objects=args.max_objects,
            held_out=args.held_out,
        )
        result["seconds"] = round(seconds, 1)
        result["ms_per_step"] = round(seconds / args.steps * 1000, 1)
        print(
            f"  fret train {result['train']['fret_accuracy']:.2%}  "
            f"held-out {result['held_out']['fret_accuracy']:.2%} "
            f"(chance {baseline:.2%}, lift {result['held_out']['lift_over_chance']:+.2%})  "
            f"blank {result['blank_image_control']['fret_accuracy']:.2%}  "
            f"pixels {result['pixel_ablation']:+.2%}"
        )
        print(
            f"  one-digit {result['train']['digit_count_split']['one_digit']['accuracy']:.1%} / "
            f"two-digit {result['train']['digit_count_split']['two_digit']['accuracy']:.1%}"
        )
        print(
            f"  regression: object_type {result['train']['object_type']:.2%} "
            f"string {result['train']['string']:.2%}"
        )
        print(f"  top confusions: {result['train']['top_confusions']}")
        results.append(result)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(results, indent=2) + "\n")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

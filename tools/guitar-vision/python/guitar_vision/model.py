"""Guitar Vision — proposal-conditioned recognition model.

The architecture from ``docs/GUITAR_VISION_ARCHITECTURE.md``, in its first
learnable configuration: DETR-style set prediction over *proposals*, where the
proposals come from the data engine's boxes for the qualification run.

## Why proposals are supplied rather than predicted, for now

A detector has two separable failure modes: finding the objects, and
recognising them. Supplying proposals isolates the second, so a qualification run
answers exactly one question — *can the representation and the heads learn the
target contract at all?* — and a failure is attributable.

Predicted proposals are a separate gate. Piano Vision's own readiness list keeps
"predicted proposal evaluation connected" as its own item for the same reason, and
this run does not claim that gate.

## What is reused

``DetailBackbone``, ``RegionSampler`` and ``MusicalAttention`` are imported from
the Piano Vision reference stack. They are instrument-agnostic — multiscale
convolution over grayscale, RoI grid sampling, and relation-aware attention — and
Piano Vision is **not modified**. Only the guitar-specific vocabulary, the
TAB-relative sampler and the heads are new here.

## The guitar-specific parts

``TabRelativeSampler`` samples fret digits in **line-relative** coordinates
rather than box-relative ones, because two digits at the same x, width and height
one string apart are different notes two strings apart and a box feature cannot
tell them apart.
"""
from __future__ import annotations

import functools
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from torch import nn

_ROOT = Path(__file__).resolve().parents[4]
_PIANO = _ROOT / "tools" / "piano-vision"
if str(_PIANO) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(_PIANO))

from piano_vision.v2.config import V2Config  # noqa: E402
from piano_vision.v2.context import MusicalAttention, musical_pairs  # noqa: E402
from piano_vision.v2.visual import DetailBackbone  # noqa: E402

ARCHITECTURE_VERSION = "guitar-vision/1.0"

OBJECT_TYPE_CLASSES = 7  # 6 kinds + "no object"
STRING_CLASSES = 8  # none, 1..6, off-line
FRET_CLASSES = 26  # 0..24 plus "not a fret"
# Tiles per page: 2 full-page + 3 notation + 4 TAB. Fixed so a batch stacks.
MAX_TILES = 9


@dataclass(frozen=True)
class GuitarVisionConfig:
    """Capacity expressed as widths and depths, never as filler parameters."""

    channels: tuple = (24, 48, 96, 192)
    depths: tuple = (1, 2, 3, 2)
    hidden: int = 320
    layers: int = 5
    heads: int = 8
    expansion: int = 3
    dropout: float = 0.05
    image_height: int = 512
    image_width: int = 512
    max_objects: int = 512
    region_grid: int = 3
    source_dropout: float = 0.0

    def __post_init__(self) -> None:
        if self.hidden % self.heads:
            raise ValueError("attention width must divide the head count")
        if len(self.channels) != 4 or len(self.depths) != 4:
            raise ValueError("four visual scales are required")
        if self.layers < 1 or self.max_objects < 2:
            raise ValueError("invalid capacity")

    @property
    def piano_config(self) -> V2Config:
        return V2Config(
            channels=self.channels,
            depths=self.depths,
            hidden=self.hidden,
            layers=self.layers,
            heads=self.heads,
            expansion=self.expansion,
            dropout=self.dropout,
            image_height=self.image_height,
            image_width=self.image_width,
            max_objects=self.max_objects,
            region_grid=self.region_grid,
            source_dropout=self.source_dropout,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "architecture": ARCHITECTURE_VERSION,
            "channels": list(self.channels),
            "depths": list(self.depths),
            "hidden": self.hidden,
            "layers": self.layers,
            "heads": self.heads,
            "image": [self.image_height, self.image_width],
            "max_objects": self.max_objects,
            "region_grid": self.region_grid,
        }


class BoxSampler(nn.Module):
    """Sample a 3x3 grid over each proposal, from every view.

    Every tile is sampled and the results summed, rather than reading only the
    tile the object is known to be on. That tile index is a ground-truth
    attribute, and since a TAB object is by definition a fret digit, telling the
    model which tile to read answers the object_type question before it looks at
    the page. The blank-image control measured 99% on object_type with the image
    whited out, which is what exposed it. At inference the model has no such
    hint, so it has to work this out.
    """

    def __init__(self, grid_size: int = 3) -> None:
        super().__init__()
        ys, xs = torch.meshgrid(
            (torch.arange(grid_size) + 0.5) / grid_size,
            (torch.arange(grid_size) + 0.5) / grid_size,
            indexing="ij",
        )
        self.register_buffer("grid", torch.stack((xs, ys), -1).reshape(-1, 2))

    def forward(
        self,
        features: list[torch.Tensor],
        boxes: torch.Tensor,
        mask: torch.Tensor,
        tiles: int,
    ) -> torch.Tensor:
        batch, objects = boxes.shape[:2]
        positions = boxes[..., :2].unsqueeze(2) + self.grid * (
            boxes[..., 2:] - boxes[..., :2]
        ).unsqueeze(2)
        output = []
        for feature in features:
            _, channels, height, width = feature.shape
            maps = feature.reshape(batch, tiles, channels, height, width)
            accumulated = feature.new_zeros(batch, objects, channels * len(self.grid))
            # Every view is sampled for every object and the results summed. An
            # earlier version was told which view each object was on and read only
            # that one; `view` is a ground-truth attribute, and because a TAB
            # object is by definition a fret digit, that single input answered the
            # object_type question outright - the blank-image control put it at
            # 99% with the page whited out. Sampling every tile makes the
            # representation decide which one carries the object, which is also
            # what it has to do at inference.
            for index in range(tiles):
                values = nn.functional.grid_sample(
                    maps[:, index],
                    positions * 2 - 1,
                    mode="bilinear",
                    align_corners=False,
                    padding_mode="zeros",
                )
                accumulated = accumulated + values.permute(0, 2, 1, 3).flatten(2)
            output.append(accumulated * mask.unsqueeze(-1))
        return torch.cat(output, -1)


class TabRelativeSampler(nn.Module):
    """Sample fret digits relative to their string line.

    The pitch of a TAB note is ``tuning[string] + fret``, and the *string* is
    carried entirely by which of the six lines the digit sits on. A feature
    sampled from the digit's own bounding box throws that away: two digits of
    identical size on adjacent strings are identical vectors, so the model cannot
    represent the thing it is being asked to predict no matter how long it trains.

    Vertical samples straddle the line, so "digit on this line" is
    distinguishable from "digit between lines".
    """

    def __init__(self, grid_size: int = 3) -> None:
        super().__init__()
        offsets = []
        for row in range(grid_size):
            for column in range(grid_size):
                u = (column + 0.5) / grid_size
                v = (row + 0.5) / grid_size
                # The vertical spread is twice the horizontal one, and both are
                # measured in units of the *staff gap* rather than the box. A TAB
                # digit is wide and short, so a grid that scaled with the box
                # would sample mostly the blank space above and below it; scaling
                # with the gap keeps every sample on the six lines, which is where
                # the information is. The gap is derived from the digit's own
                # height, which is proportional to it.
                offsets.append(((u - 0.5) * 1.2, (v - 0.5) * 2.6))
        self.register_buffer("offsets", torch.tensor(offsets, dtype=torch.float32))
        self.grid_size = grid_size

    def forward(
        self,
        features: list[torch.Tensor],
        boxes: torch.Tensor,
        mask: torch.Tensor,
        tiles: int,
        anchor_y: torch.Tensor,
        staff_gap: torch.Tensor,
    ) -> torch.Tensor:
        batch, objects = boxes.shape[:2]
        grid = self.offsets.shape[0]

        # Anchor on the staff line rather than the box centre; horizontal extent
        # still comes from the digit itself.
        centre_x = (boxes[..., 0] + boxes[..., 2]) / 2
        width = (boxes[..., 2] - boxes[..., 0]).clamp_min(1e-6)
        positions = torch.stack(
            (
                anchor_y.unsqueeze(-1) + self.offsets[:, 1].view(1, 1, -1) * staff_gap.unsqueeze(-1),
                centre_x.unsqueeze(-1) + self.offsets[:, 0].view(1, 1, -1) * width.unsqueeze(-1),
            ),
            -1,
        )

        output = []
        for feature in features:
            _, channels, height, width_px = feature.shape
            maps = feature.reshape(batch, tiles, channels, height, width_px)
            accumulated = feature.new_zeros(batch, objects, channels * grid)
            # All tiles sampled and summed, for the same reason as BoxSampler.
            for index in range(tiles):
                values = nn.functional.grid_sample(
                    maps[:, index],
                    positions * 2 - 1,
                    mode="bilinear",
                    align_corners=False,
                    padding_mode="zeros",
                )
                accumulated = accumulated + values.permute(0, 2, 1, 3).flatten(2)
            output.append(accumulated * mask.unsqueeze(-1))
        return torch.cat(output, -1)


@functools.lru_cache(maxsize=4)
def _box_offsets(grid: int) -> torch.Tensor:
    """Cached so the grid lives on the boxes' device, whatever that is.

    Built on each call from a plain list it would always be CPU, and the first
    MPS batch would fail on a device mismatch.
    """
    offsets = []
    for row in range(grid):
        for column in range(grid):
            offsets.append(((column + 0.5) / grid - 0.5, (row + 0.5) / grid - 0.5))
    return torch.tensor(offsets, dtype=torch.float32)


def _box_grid(boxes: torch.Tensor, grid: int = 3) -> torch.Tensor:
    offset = _box_offsets(grid).to(device=boxes.device, dtype=boxes.dtype)
    return (
        boxes[..., :2].unsqueeze(2)
        + offset.view(1, 1, -1, 2) * (boxes[..., 2:] - boxes[..., :2]).unsqueeze(2)
    )


def guitar_pairs(boxes: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Eight pair features per object pair, for the relation-aware attention.

    Written here rather than reused from Piano Vision because the relations that
    matter for guitar are not the piano ones: a notehead and the fret digit
    engraved beneath it are the *same note*, and telling the model that they are
    vertically stacked is most of what lets a fret head read a digit whose note
    is a quarter away.

    ## No label may enter here

    Every feature below is computed from ``boxes`` alone. An earlier version took
    ``string``, ``fret`` and ``view`` as arguments and used them for same-string,
    same-fret and same-view features, on the reasoning that they were "derived
    from engraved geometry". They were not: they were the target tensors. The
    control in ``qualify`` caught it - 100% on the fret head and 99% on
    object_type with the page whited out - because a same-fret feature answers the
    question outright and a same-view feature implies the class. Learning is
    unaffected by whether a relation is stated or reconstructed, so only a control
    that destroys the input can tell the difference.

    Padded slots get zero features rather than being compared, so a padded object
    cannot influence attention.
    """
    centres = (boxes[..., :2] + boxes[..., 2:]) / 2
    delta = centres[:, :, None] - centres[:, None, :]
    distance = delta.square().sum(-1, keepdim=True).clamp_min(1e-12).sqrt()
    pair_valid = (mask[:, :, None] & mask[:, None, :]).to(boxes.dtype)

    # Onset column: two objects share a musical moment if they overlap in x.
    # This is a geometric coincidence, not a label, and it is the single most
    # useful piece of evidence for pairing a notehead with its fret digit.
    left_i, right_i = boxes[..., 0], boxes[..., 2]
    left_j, right_j = left_i[:, None, :], right_i[:, None, :]
    overlap = (torch.minimum(right_i[:, :, None], right_j) - torch.maximum(left_i[:, :, None], left_j)).clamp_min(0)
    widths = ((right_i - left_i)[:, :, None].clamp_min(1e-6)).clamp_min(1e-6)
    same_column = ((overlap / widths > 0.3).to(boxes.dtype) * pair_valid).unsqueeze(-1)

    # Same column, different staff: a notehead and the fret digit engraved under
    # it have overlapping x, and their vertical separation is roughly one staff
    # gap. The gap is compared geometrically, so this is a *relation between
    # proposals*, not a class label.
    top_i, bottom_i = boxes[..., 1], boxes[..., 3]
    top_j, bottom_j = top_i[:, None, :], bottom_i[:, None, :]
    # Positive when the boxes are stacked (j below i) or one above the other.
    stacked = (torch.minimum(bottom_i[:, :, None], bottom_j) - torch.maximum(top_i[:, :, None], top_j))
    height_i = (bottom_i - top_i)[:, :, None].clamp_min(1e-6)
    height_j = (bottom_j - top_j).clamp_min(1e-6)
    # Within a few staff gaps: close enough to be the same musical moment.
    near_stacked = (stacked < (height_i + height_j) * 6.0).to(boxes.dtype) * pair_valid
    same_row = (near_stacked * (overlap > 0).to(boxes.dtype)).unsqueeze(-1)

    # Size ratio. A notehead is roughly twice a TAB digit's height, so a pair with
    # a large height ratio is a notation/TAB pair and a ratio near 1 is two
    # objects of the same kind. This is a measurement, not a class, and it is
    # what lets a digit's features borrow from the notehead it belongs to.
    # height_i / height_j are (B, N, 1), so the ratio needs a trailing axis to be
    # concatenable with the other (B, N, N, 1) features.
    # height_i / height_j are (B, N, 1), so the ratio needs a trailing axis to be
    # concatenable with the other (B, N, N, 1) features.
    height_ratio = (height_i / height_j.clamp_min(1e-6)).clamp(0.1, 10.0).log2().unsqueeze(-1)
    # Width ratio: a two-digit fret is roughly twice as wide as a one-digit fret,
    # so this narrows the fret to a digit count without naming a value.
    width_i = (boxes[..., 2] - boxes[..., 0])[:, :, None].clamp_min(1e-6)
    width_j = (boxes[..., 2] - boxes[..., 0])[:, None, :].clamp_min(1e-6)
    width_ratio = (width_i / width_j.clamp_min(1e-6)).clamp(0.1, 10.0).log2().unsqueeze(-1)

    return torch.cat(
        (
            delta,                       # dx, dy
            distance,                    # euclidean separation
            same_column,                 # same onset column
            same_row,                    # same column, different staff
            height_ratio,                # log height ratio
            width_ratio,                 # log width ratio
            pair_valid.unsqueeze(-1),
        ),
        dim=-1,
    ) * pair_valid.unsqueeze(-1)


class GuitarVisionModel(nn.Module):
    architecture_version = ARCHITECTURE_VERSION

    def __init__(self, config: GuitarVisionConfig | None = None) -> None:
        super().__init__()
        self.config = config or GuitarVisionConfig()
        piano = self.config.piano_config
        self.backbone = DetailBackbone(piano)
        self.sampler = BoxSampler(self.config.region_grid)
        self.tab_sampler = TabRelativeSampler(self.config.region_grid)

        visual_dim = sum(self.backbone.output_channels) * self.config.region_grid ** 2
        self.visual_projection = nn.Linear(visual_dim, self.config.hidden)
        self.source_projection = nn.Linear(12, self.config.hidden)
        self.geometry_projection = nn.Linear(4, self.config.hidden)
        self.context = nn.ModuleList(
            [MusicalAttention(piano) for _ in range(self.config.layers)]
        )
        self.final_norm = nn.LayerNorm(self.config.hidden)

        hidden = self.config.hidden
        # Guitar-specific heads. `string` and `fret` only apply to TAB digits; the
        # class index carries "not applicable" so a notehead is not pushed to
        # predict a string.
        self.heads = nn.ModuleDict(
            {
                "object_type": nn.Linear(hidden, OBJECT_TYPE_CLASSES),
                "string": nn.Linear(hidden, STRING_CLASSES),
                "fret": nn.Linear(hidden, FRET_CLASSES),
                "tile": nn.Linear(hidden, MAX_TILES),
            }
        )

    def parameters_count(self) -> int:
        return sum(parameter.numel() for parameter in self.parameters())

    def forward(self, batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        images = batch["images"]
        boxes = batch["boxes"]
        mask = batch["object_mask"]

        features = self.backbone(images.flatten(0, 1))
        # Tiles, not the three logical views: a wide TAB strip is several planes
        # wide, and an object is indexed by the tile that actually contains it.
        tiles = images.shape[1]

        # Both samplers run for every object, and their outputs are summed. An
        # earlier version switched between them on `object_type`, which is a
        # *target*: it handed the model the answer to "which of these are fret
        # digits" and let a blanked image still score 100% on the fret head.
        # Sampling both and letting the representation decide removes the label
        # from the input path entirely, and costs one extra grid.
        box_visual = self.sampler(features, boxes, mask, tiles)
        anchor_y, staff_gap = _tab_anchors(boxes)
        tab_visual = self.tab_sampler(
            features, boxes, mask, tiles, anchor_y, staff_gap
        )

        visual = box_visual + tab_visual
        visual = self.visual_projection(visual)
        source = self.source_projection(_source_features(batch))
        geometry = self.geometry_projection(boxes)

        tokens = visual + source[:, None] + geometry
        pairs = guitar_pairs(boxes, mask)
        for layer in self.context:
            tokens = layer(tokens, mask, pairs)
        tokens = self.final_norm(tokens)

        return {name: head(tokens) for name, head in self.heads.items()}


def _source_features(batch: dict[str, torch.Tensor]) -> torch.Tensor:
    """Coarse page-level context, per sample.

    Deliberately tiny and deliberately not derived from the labels: a source
    feature that encoded the answer would make the heads look learnable when the
    representation is not.
    """
    batch_size = batch["images"].shape[0]
    features = batch.get("page_context")
    if features is not None:
        return features
    return batch["images"].new_zeros(batch_size, 12)


def _tab_anchors(boxes: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """Anchor y and staff gap for line-relative sampling.

    A digit's own centre is used as the anchor, and the gap is estimated from the
    digit height, which is proportional to the staff gap. Both are derived from
    geometry, never from the string label.
    """
    centre = (boxes[..., 1] + boxes[..., 3]) / 2
    height = (boxes[..., 3] - boxes[..., 1]).clamp_min(1e-4)
    gap = (height / 0.78).clamp_min(1e-4)
    return centre, gap


def cross_entropy(
    logits: torch.Tensor,
    targets: torch.Tensor,
    mask: torch.Tensor,
    ignore_index: int | None = None,
) -> torch.Tensor:
    """Masked cross entropy.

    ``ignore_index`` covers the two different reasons a slot has no answer: padded
    slots, and objects the head does not apply to. Collapsing those into one
    index would mean a fret head is penalised for failing to predict a fret on a
    notehead.
    """
    flat_logits = logits.reshape(-1, logits.shape[-1])
    flat_targets = targets.reshape(-1)
    flat_mask = mask.reshape(-1)
    ignore = -100 if ignore_index is None else ignore_index
    flat_targets = torch.where(
        flat_mask, flat_targets, torch.full_like(flat_targets, ignore)
    )
    if not bool(flat_mask.any()):
        # cross_entropy averages over the unmasked count, which is zero here and
        # returns NaN. NaN propagates through the backward pass into every
        # parameter, so a single page with no TAB digits would silently destroy
        # the run. Return a value that still depends on the graph, so the
        # backward pass stays well-formed.
        return logits.sum() * 0.0
    return nn.functional.cross_entropy(flat_logits, flat_targets, ignore_index=ignore)

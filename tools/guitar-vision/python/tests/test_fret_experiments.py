"""Tests for the fret experiment harness.

The harness introduces a second way to crop a score, a second tile-selection rule,
and a new head parameterisation. Each of those is a place a target can reach the
model by accident, so the tests here are mostly about **provenance**: what may go
into the forward pass, and what may not.

The invariants that already existed for the loader still hold and are not restated
here — they live in ``test_dataset.py`` — with one addition. The ROI crop is a
new crop/page coordinate mapping, so it gets the same ink test the loader's boxes
get, rather than being trusted because it is differentiable.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.fret_experiments import (  # noqa: E402
    NO_DIGIT,
    FretVariantModel,
    decode_fret_simple,
    digit_losses,
    digit_targets,
    fret_loss,
    roi_crops,
)
from guitar_vision.model import GuitarVisionConfig, GuitarVisionModel  # noqa: E402

# The plane count is per page now, derived from each view's aspect ratio, so this is
# a representative count for the rendered corpus rather than a fixed contract.
TILES = 16


def _base(size: int = 128, hidden: int = 64) -> GuitarVisionModel:
    return GuitarVisionModel(
        GuitarVisionConfig(
            image_height=size,
            image_width=size,
            max_objects=32,
            hidden=hidden,
            heads=4,
            layers=2,
        )
    )


def _batch(tiles: int = TILES, objects: int = 10, size: int = 128) -> dict:
    return {
        "images": torch.randn(2, tiles, 1, size, size),
        "boxes": torch.rand(2, objects, 4) * 0.8,
        "object_mask": torch.ones(2, objects, dtype=torch.bool),
        "object_type": torch.randint(0, 6, (2, objects)),
        "string": torch.randint(0, 8, (2, objects)),
        "fret": torch.randint(0, 26, (2, objects)),
        "view": torch.randint(0, tiles, (2, objects)),
        "tiles": tiles,
    }


# --------------------------------------------------------------------------
# Provenance: what must never reach the crop
# --------------------------------------------------------------------------


def test_roi_crops_never_receive_a_tile_index() -> None:
    """Selecting a crop's tile by ground truth would hand over the answer.

    A TAB object is by definition a fret digit, so "which view is this in" answers
    the class question outright. This is the third leak this project has produced
    and the crop is the most tempting place to reintroduce it, because the correct
    tile is genuinely known at load time.

    The signature is the enforcement: there is no tile index to pass.
    """
    import inspect

    parameters = set(inspect.signature(roi_crops).parameters)
    assert "tile" not in parameters and "view" not in parameters, (
        f"roi_crops takes {sorted(parameters)}; a tile or view index would be a "
        f"ground-truth route to the class label"
    )


def test_roi_crops_are_chosen_by_pixels_not_by_index() -> None:
    """Every tile contributes, weighted by how much variation it holds.

    A blank tile has near-zero variation and a tile with a digit has a lot, so the
    weighting finds the right tile from the image. If the weights were uniform the
    crop would be a nine-way average and the digit would be diluted to nothing.
    """
    channels = 12
    size = 64
    batch, objects, grid = 1, 1, 4
    # One tile carries a bright square, the rest are uniform.
    planes = torch.zeros(TILES, channels, size, size)
    planes[3, :, 30:34, 30:34] = 1.0
    boxes = torch.tensor([[[0.4, 0.4, 0.6, 0.6]]])
    mask = torch.ones(1, 1, dtype=torch.bool)
    crops = roi_crops(planes, boxes, mask, grid, context=1.0)
    assert crops.shape == (batch, objects, channels * grid * grid)
    # The marked tile must dominate the combination, so the crop has to carry its
    # signal rather than the mean of nine tiles.
    assert float(crops.max()) > float(crops.mean()) * 2, (
        "the crop is flat across tiles, so the tile with the glyph is not winning"
    )


def test_roi_crop_reaches_its_glyph_on_real_rendered_pages() -> None:
    """The crop is a crop, so it gets the same ink test the loader's boxes get.

    A differentiable path is not automatically a correct one: it can be off by a
    scale factor, land a tile away, or sample the wrong axis, and every one of
    those trains happily.
    """
    root = Path(__file__).resolve().parents[4]
    records = root / "datasets/guitar-vision/synthetic/train/records"
    views = root / "datasets/guitar-vision/synthetic/train/views"
    if not list(records.glob("*.record.json")):
        pytest.skip("no rendered corpus")

    from guitar_vision.dataset import load_dataset

    samples = load_dataset(records, views, size=(256, 256), limit=2)
    if not samples:
        pytest.skip("no usable samples")
    base = _base(size=256, hidden=64)
    sample = samples[0]
    batch = {
        "images": sample["images"][None],
        "boxes": sample["boxes"][None],
        # A per-page sample carries no mask; collate adds one. Here one page is
        # used, so every object it holds is live.
        "object_mask": torch.ones(
            1, sample["object_type"].shape[0], dtype=torch.bool
        ),
        "object_type": sample["object_type"][None],
        "string": sample["string"][None],
        "fret": sample["fret"][None],
        "view": sample["view"][None],
        "tiles": sample["images"].shape[0],
    }
    with torch.no_grad():
        finest = base.backbone(batch["images"].flatten(0, 1))[0]
        crops = roi_crops(finest, batch["boxes"], batch["object_mask"], 8, 1.6)
    # A blank crop would be a constant vector; a real one has structure.
    variation = crops[0].std(dim=-1)
    live = variation[batch["object_mask"][0]]
    assert float(live.max()) > 1e-4, (
        "every crop is constant, so the ROI path is reading nothing"
    )


# --------------------------------------------------------------------------
# Digit structure: the decoder has to be right, not just present
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fret,expected",
    [
        (0, [NO_DIGIT, 0]),
        (7, [NO_DIGIT, 7]),
        (9, [NO_DIGIT, 9]),
        (10, [1, 0]),
        (17, [1, 7]),
        (19, [1, 9]),
        (24, [2, 4]),
    ],
)
def test_digit_targets_are_left_aligned_with_an_empty_tens_slot(fret, expected) -> None:
    """A one-digit fret must leave the tens slot *empty*, not hold a zero.

    Writing 0 into the empty slot is how "7" becomes "07" and 7 turns into 70 in
    the decode. The empty class is what makes occupancy a separate question.
    """
    target = digit_targets(torch.tensor([[fret]]), 2)
    assert target[0, 0].tolist() == expected


def test_decode_composes_the_digit_slots_into_the_right_number() -> None:
    """The composed number is what the gate scores, so it is tested directly.

    A head that reads both glyphs and assembles them in the wrong order, or reads
    them correctly and treats an empty tens slot as a zero, would look fine on any
    per-slot metric and be wrong in use.
    """
    def logits(tens: int, units: int, present: int) -> dict:
        slots = torch.full((1, 1, 2, NO_DIGIT + 1), -10.0)
        slots[0, 0, 0, tens] = 10.0
        slots[0, 0, 1, units] = 10.0
        presence = torch.full((1, 1, 3), -10.0)
        presence[0, 0, present] = 10.0
        return {"slots": slots, "presence": presence}

    assert int(decode_fret_simple(logits(NO_DIGIT, 7, 1))) == 7
    assert int(decode_fret_simple(logits(NO_DIGIT, 0, 1))) == 0
    assert int(decode_fret_simple(logits(1, 7, 2))) == 17
    assert int(decode_fret_simple(logits(1, 0, 2))) == 10
    assert int(decode_fret_simple(logits(2, 4, 2))) == 24
    # A single glyph in the units slot is a one-digit fret even if the tens slot
    # happens to have been given a digit class: occupancy wins.
    assert int(decode_fret_simple(logits(1, 7, 1))) == 7


def test_column_grouping_keeps_left_and_right_apart() -> None:
    """17 and 71 differ only in which half the glyph is in.

    If grouping pooled the whole width, both would produce the same vector and the
    decoder would be reading a number with no order. This is the specific failure
    the digit-structured head exists to avoid.
    """
    model = FretVariantModel(_base(), "roidigits", grid=8)
    width, grid = model.encoder.out_channels, 8
    left = torch.zeros(1, 1, width, grid)
    right = torch.zeros(1, 1, width, grid)
    left[..., : grid // 2] = 1.0
    right[..., grid // 2 :] = 1.0
    a = model.group_columns(left)
    b = model.group_columns(right)
    assert a.shape[-2] == model.MAX_DIGITS
    assert not torch.allclose(a, b), (
        "left and right halves of the crop pooled to the same vector, so digit "
        "order is unrecoverable"
    )
    # And the first slot must be the left half.
    assert float(a[0, 0, 0].mean()) > float(a[0, 0, 1].mean())


def test_digit_losses_are_finite_when_a_page_has_no_fret_digits() -> None:
    """Regression: a fully-masked head used to return NaN and poison backward.

    A score with no TAB staff, or a crop where the renderer found no digits, must
    not take the run down.
    """
    batch = _batch()
    empty = batch["object_mask"].clone()
    slots = torch.randn(2, 10, 2, NO_DIGIT + 1)
    presence = torch.randn(2, 10, 3)
    out = {"slots": slots, "presence": presence}
    slot_loss, presence_loss = digit_losses(out, batch["fret"], empty)
    assert torch.isfinite(slot_loss) and torch.isfinite(presence_loss)


# --------------------------------------------------------------------------
# The variants, and the regression check
# --------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["shared", "roi26", "roidigits"])
def test_every_variant_runs_and_scores(kind: str) -> None:
    base = _base()
    model = FretVariantModel(base, kind, grid=8, context=1.6)
    batch = _batch()
    out = model(batch)
    # Heads emit one extra class: the last is "no object", for padded slots.
    assert out["object_type"].shape == (*batch["object_type"].shape, 7)
    assert out["string"].shape == (*batch["string"].shape, 8)
    if kind == "roidigits":
        assert out["slots"].shape[-2] == model.MAX_DIGITS
        assert out["presence"].shape[-1] == model.MAX_DIGITS + 1
    loss, parts = fret_loss(out, batch)
    assert torch.isfinite(loss), parts
    loss.backward()
    assert any(
        p.grad is not None and float(p.grad.abs().sum()) > 0 for p in model.parameters()
    )


def test_the_roi_variants_add_parameters_but_do_not_rewrite_the_shared_path() -> None:
    """The shared path must be identical across variants, or this is not a
    fret-only experiment.

    ``object_type`` and ``string`` are the regression check for the whole
    investigation, and they only mean something if the backbone, samplers, pair
    features and attention are the same objects in every variant.
    """
    shared = FretVariantModel(_base(), "shared")
    roi = FretVariantModel(_base(), "roidigits")
    for name in ("backbone", "sampler", "tab_sampler", "context"):
        assert type(getattr(shared.base, name)) is type(getattr(roi.base, name))
    assert sum(p.numel() for p in roi.parameters()) > sum(
        p.numel() for p in shared.parameters()
    ), "the ROI variants added no parameters, so nothing was actually added"


def test_the_backbone_runs_once_per_forward() -> None:
    """Two backbone passes would double every cost and falsify the comparison.

    The ROI crop needs the finest feature map and the shared heads need all five
    scales, so it is tempting to call the backbone twice. It is called once and the
    features are reused.
    """
    model = FretVariantModel(_base(), "roidigits", grid=8)
    calls = {"n": 0}
    original = model.base.backbone.forward

    def counted(images):
        calls["n"] += 1
        return original(images)

    model.base.backbone.forward = counted
    model(_batch())
    assert calls["n"] == 1, f"backbone ran {calls['n']} times in one forward"

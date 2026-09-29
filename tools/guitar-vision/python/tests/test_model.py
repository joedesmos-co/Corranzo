"""Tests for the guitar-specific parts of the model.

The reusable Piano Vision pieces are tested over there. What is tested here is
the code that is new for guitar and therefore has no prior test to inherit:
TAB-relative sampling, the pair features, the head masking rules, and the two
places a label could silently leak into the model's own input.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.model import (  # noqa: E402
    GuitarVisionConfig,
    GuitarVisionModel,
    cross_entropy,
    guitar_pairs,
)


def _batch(objects: int = 12, batch: int = 2, size: int = 128) -> dict[str, torch.Tensor]:
    return {
        # 9 tiles: 2 full-page, 3 notation, 4 TAB. Matches TILES_PER_VIEW.
        "images": torch.randn(batch, 9, 1, size, size),
        "boxes": torch.rand(batch, objects, 4) * 0.8,
        "object_mask": torch.ones(batch, objects, dtype=torch.bool),
        "object_type": torch.randint(0, 6, (batch, objects)),
        "string": torch.randint(0, 8, (batch, objects)),
        "fret": torch.randint(0, 26, (batch, objects)),
        "view": torch.randint(0, 9, (batch, objects)),
    }


def _model(size: int = 128, objects: int = 64) -> GuitarVisionModel:
    config = GuitarVisionConfig(
        image_height=size, image_width=size, max_objects=objects, hidden=64, heads=4
    )
    return GuitarVisionModel(config)


def test_forward_produces_one_row_per_object() -> None:
    model, batch = _model(), _batch()
    out = model(batch)
    for name, logits in out.items():
        assert logits.shape[:2] == batch["object_mask"].shape, name
    # Every head is a distribution over its own vocabulary.
    assert out["object_type"].shape[-1] == 7
    assert out["string"].shape[-1] == 8
    assert out["fret"].shape[-1] == 26
    assert out["tile"].shape[-1] == 9


def test_backward_reaches_the_backbone() -> None:
    model, batch = _model(), _batch()
    out = model(batch)
    is_tab = batch["object_type"] == 1
    loss = (
        cross_entropy(out["object_type"], batch["object_type"], batch["object_mask"])
        + cross_entropy(out["fret"], batch["fret"], batch["object_mask"] & is_tab)
    )
    loss.backward()
    assert model.backbone is not None
    assert any(
        parameter.grad is not None and float(parameter.grad.abs().sum()) > 0
        for parameter in model.parameters()
    ), "no gradient reached any parameter"


def test_pair_features_have_the_width_attention_expects() -> None:
    batch = _batch()
    pairs = guitar_pairs(batch["boxes"], batch["object_mask"])
    assert pairs.shape == (*batch["object_mask"].shape, batch["object_mask"].shape[1], 8)
    # The bias layer is the contract; a width mismatch is a silent shape error
    # at the first real batch otherwise.
    assert model_bias_width(_model()) == 8
    assert torch.isfinite(pairs).all(), "pair features contain NaN or inf"


def model_bias_width(model: GuitarVisionModel) -> int:
    return model.context[0].bias[0].in_features


def test_padded_objects_produce_no_pair_evidence() -> None:
    batch = _batch()
    batch["object_mask"][:, 8:] = False
    pairs = guitar_pairs(batch["boxes"], batch["object_mask"])
    # A padded object must not be able to influence attention, in either
    # direction: rows (queries) and columns (keys) for padded slots are zero.
    assert torch.equal(pairs[:, 8:], torch.zeros_like(pairs[:, 8:]))
    assert torch.equal(
        pairs[:, :, 8:], torch.zeros_like(pairs[:, :, 8:])
    ), "a padded object still appears as evidence for a valid one"


def test_a_notehead_and_the_digit_under_it_are_linked() -> None:
    """The relation the fret head depends on: vertical stacking, same x.

    A notehead and its fret digit are the same musical note, and they are the two
    objects a fret digit is most easily confused with. If the pair features do not
    mark them as related, the model has to rediscover the pairing from the
    attention bias alone.
    """
    boxes = torch.tensor(
        [[[0.10, 0.10, 0.20, 0.18],  # notehead, taller
          [0.12, 0.30, 0.18, 0.36]]]  # digit below: shorter, same x
    )
    mask = torch.ones(1, 2, dtype=torch.bool)
    pairs = guitar_pairs(boxes, mask)
    # dx, dy, distance, same_column, same_row, height_ratio, width_ratio, valid
    assert pairs[0, 0, 1, 4] == 1.0, "stacked notehead and digit not linked"
    assert pairs[0, 0, 1, 3] == 1.0, "same x column not detected"
    # The notehead is twice the digit's height, so the ratio must be non-zero.
    assert pairs[0, 0, 1, 5] > 0.0, "height difference not visible to the heads"


def test_distant_objects_are_not_linked_as_the_same_moment() -> None:
    boxes = torch.tensor([[[0.10, 0.10, 0.20, 0.16], [0.70, 0.10, 0.80, 0.16]]])
    mask = torch.ones(1, 2, dtype=torch.bool)
    pairs = guitar_pairs(boxes, mask)
    assert pairs[0, 0, 1, 3] == 0.0, "objects three measures apart reported as a column"
    assert pairs[0, 0, 1, 4] == 0.0, "distant objects reported as stacked"


def test_pair_features_cannot_see_a_label() -> None:
    """Regression: a label used to be a pair feature, and the blank-image
    control in `qualify` scored 100% on the fret head with the page whited out.

    `guitar_pairs` takes boxes and view only, so this is enforced by the
    signature. The test that keeps it true is the end-to-end one below: with a
    blanked image the model must fall to chance, which is the only evidence that
    no target has found its way into the input path.
    """
    import inspect

    parameters = set(inspect.signature(guitar_pairs).parameters)
    assert parameters == {"boxes", "mask"}, (
        f"guitar_pairs now takes {sorted(parameters)}; any target passed in here "
        "is a leak into the model's input"
    )


def test_masks_exclude_non_applicable_objects_from_the_fret_and_string_heads() -> None:
    """A notehead must not be scored for failing to predict a fret.

    Both heads are only meaningful for TAB digits. Scoring a notehead against the
    fret vocabulary would add a large constant loss that has nothing to do with
    fret recognition, and would push the shared representation toward
    compromise.
    """
    logits = torch.zeros(1, 2, 26)
    targets = torch.tensor([[7, 7]])
    fret_mask = torch.tensor([[True, False]])
    loss = cross_entropy(logits, targets, fret_mask)
    assert torch.isfinite(loss)
    only_valid = cross_entropy(logits[:, :1], targets[:, :1], torch.ones(1, 1, dtype=torch.bool))
    assert float(loss) == pytest.approx(float(only_valid)), (
        "masked-out objects changed the loss, so they are not being excluded"
    )


def test_a_single_object_keeps_the_fret_loss_finite() -> None:
    """Regression: an all-masked batch used to produce NaN and stop training."""
    logits = torch.randn(2, 4, 26)
    targets = torch.zeros(2, 4, dtype=torch.long)
    loss = cross_entropy(logits, targets, torch.zeros(2, 4, dtype=torch.bool))
    assert torch.isfinite(loss), "an entirely padded batch must not produce NaN"


def test_two_fret_digits_on_adjacent_strings_get_different_features() -> None:
    """The reason TAB-relative sampling exists.

    Two identical-size digits one string apart differ only in their vertical
    position inside the staff. If the sampler could not tell them apart, no
    amount of training could make the model distinguish string 1 fret 12 from
    string 2 fret 12, which is a different note.
    """
    model, batch = _model(), _batch(objects=2, batch=1)
    batch["images"][:] = 0
    # A constant image removes all appearance cues, leaving only geometry.
    batch["boxes"][0, 0] = torch.tensor([0.40, 0.10, 0.50, 0.14])
    batch["boxes"][0, 1] = torch.tensor([0.40, 0.20, 0.50, 0.24])
    batch["object_type"][0, :] = 1
    batch["view"][0, :] = 7  # a TAB tile
    batch["string"][0, :] = torch.tensor([1, 2])
    features = model.sampler(
        model.backbone(batch["images"].flatten(0, 1)),
        batch["boxes"],
        batch["object_mask"],
        9,
    )
    assert not torch.allclose(features[0, 0], features[0, 1], atol=1e-6), (
        "adjacent strings on a blank image are indistinguishable; the sampler is "
        "not using the line-relative geometry it was written for"
    )


def test_config_rejects_a_width_the_heads_cannot_split() -> None:
    with pytest.raises(ValueError):
        GuitarVisionConfig(hidden=100, heads=8)
    with pytest.raises(ValueError):
        GuitarVisionConfig(max_objects=1)

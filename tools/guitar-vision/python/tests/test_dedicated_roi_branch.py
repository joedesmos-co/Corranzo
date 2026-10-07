"""Tests for the dedicated raw-ROI fret branch.

The branch's value is that raw ROI pixels carry a much stronger fret signal than the
shared representation (0.934 against 0.5899). Two things must therefore be true for it to
be worth integrating, and both are structural rather than empirical:

1. It reads exactly the validated crop, through the one code path that `forward` and any
   training loop share.
2. It cannot affect any other task, because its input is data and not features, so the
   fret loss has no path to the backbone.

These tests pin both. The provenance of the crop against the original experiment script
is checked in ``h82_dedicated_roi_branch.py``, where importing an experiment module is
appropriate.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import (  # noqa: E402
    FretVariantModel,
    build,
    decode,
    fret_loss,
)
from guitar_vision.qualify import Device  # noqa: E402
from guitar_vision.roi import ROI_CROP, RoiFretCnn, sample_roi  # noqa: E402

SEED = 11
VARIANT = "DEDICATED_ROI_FRET"
_SHARED = "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED"
_REPO = Path(__file__).resolve().parents[4]
_RECORDS = _REPO / "datasets/guitar-vision/synthetic/train/records"
_VIEWS = _REPO / "datasets/guitar-vision/synthetic/train/views"


def make_args(variant: str) -> argparse.Namespace:
    return argparse.Namespace(
        variant=variant, steps=1200, pages=40, batch_pages=4, held_out=20,
        image_size=256, max_objects=128, hidden=192, layers=4, lr=3e-3,
        train_jitter=0.35, roi_grid=8, roi_context=1.6, seed=SEED, device="cpu",
        out=None,
    )


@pytest.fixture(scope="module")
def device() -> Device:
    return Device("cpu")


@pytest.fixture(scope="module")
def batch() -> dict[str, torch.Tensor]:
    if not _RECORDS.exists():
        pytest.skip("synthetic corpus not present")
    # One page: the ROI sampler loops planes, so a small batch keeps this quick.
    return collate(load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=1), 128)


# ------------------------------------------------------------------ the CNN


def test_head_is_the_validated_probe_architecture() -> None:
    """Three conv3x3-BN-ReLU blocks at 32/64/128, then GAP and a linear classifier."""
    head = RoiFretCnn(26)
    convs = [m for m in head.body if isinstance(m, torch.nn.Conv2d)]
    norms = [m for m in head.body if isinstance(m, torch.nn.BatchNorm2d)]
    assert [c.out_channels for c in convs] == [32, 64, 128]
    assert all(c.kernel_size == (3, 3) and c.padding == (1, 1) for c in convs)
    assert len(norms) == 3
    assert isinstance(head.body[-2], torch.nn.AdaptiveAvgPool2d)
    assert isinstance(head.head, torch.nn.Linear)
    assert head.head.out_features == 26


def test_parameter_count_matches_the_established_probe_and_the_budget() -> None:
    """96,474 at 26 classes -- the probe's own size, not an enlargement."""
    assert sum(p.numel() for p in RoiFretCnn(26).parameters()) == 96_474
    assert sum(p.numel() for p in RoiFretCnn(20).parameters()) == 95_700
    assert sum(p.numel() for p in RoiFretCnn(26).parameters()) < 100_000


def test_head_accepts_flat_crops_and_rejects_non_square() -> None:
    head = RoiFretCnn(26)
    head.eval()
    with torch.no_grad():
        out = head(torch.rand(2, 5, ROI_CROP * ROI_CROP))
    assert out.shape == (2, 5, 26)
    with pytest.raises(ValueError):
        head(torch.rand(1, 1, 30))


# ------------------------------------------------------------------ variant


def test_variant_registered(device: Device) -> None:
    assert VARIANT in FretVariantModel.DEDICATED_ROI_KINDS
    # It must NOT be an ROI-only kind: those share the encoder/projection path.
    assert VARIANT not in FretVariantModel.ROI_ONLY_KINDS


def test_variant_bypasses_the_shared_visual_path(device: Device) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    assert isinstance(model.roi_head, RoiFretCnn)
    assert not hasattr(model, "encoder")
    assert not hasattr(model, "roi_projection")
    assert not hasattr(model, "p_standardizer")


def test_shared_model_init_is_unchanged(device: Device) -> None:
    """The base model must be bit-identical to another variant's under the same seed.

    Otherwise the dedicated branch would be compared against a differently initialised
    shared model and the comparison would mean nothing.
    """
    torch.manual_seed(SEED)
    dedicated = build(VARIANT, make_args(VARIANT), device)
    torch.manual_seed(SEED)
    other = build(_SHARED, make_args(_SHARED), device)
    dedicated_base = {k: v for k, v in dedicated.state_dict().items()
                      if k.startswith("base.")}
    other_base = {k: v for k, v in other.state_dict().items() if k.startswith("base.")}
    assert set(dedicated_base) == set(other_base)
    for key in dedicated_base:
        assert torch.equal(dedicated_base[key], other_base[key]), key


def test_unrelated_heads_are_bit_identical_given_the_same_base(device: Device, batch) -> None:
    # Seed before each build: torch's RNG is global, so an unseeded second build gets a
    # different base and the comparison would be between two random models.
    torch.manual_seed(SEED)
    dedicated = build(VARIANT, make_args(VARIANT), device)
    torch.manual_seed(SEED)
    other = build(_SHARED, make_args(_SHARED), device)
    dedicated.eval()
    other.eval()
    with torch.no_grad():
        a, b = dedicated(batch), other(batch)
    for name in ("object_type", "string", "tile"):
        assert torch.equal(a[name], b[name]), name


# ------------------------------------------------------- input path


def test_forward_uses_the_same_call_as_training(device: Device, batch) -> None:
    """`forward` and the training helper must not be able to diverge."""
    model = build(VARIANT, make_args(VARIANT), device)
    model.eval()
    with torch.no_grad():
        out = model(batch)
        direct = model.roi_fret_logits(batch)
        crops = model.roi_crops(batch)
        from_head = model.roi_head(crops)
    assert torch.equal(out["fret"], direct)
    assert torch.equal(out["fret"], from_head)
    assert crops.shape == (batch["boxes"].shape[0], batch["boxes"].shape[1],
                           ROI_CROP * ROI_CROP)


def test_crop_shape_and_normalisation() -> None:
    """The crop is square, 32x32, and inside [0, 1] on a white page with one dark box."""
    images = torch.ones(1, 1, 1, 64, 64)
    images[0, 0, 0, 20:40, 20:40] = 0.0
    boxes = torch.tensor([[[0.30, 0.30, 0.62, 0.62]]])
    mask = torch.ones(1, 1, dtype=torch.bool)
    tile = torch.zeros(1, 1, dtype=torch.long)
    crops = sample_roi(images, boxes, mask, tile, 32, 1.6)
    assert crops.shape == (1, 1, 32 * 32)
    assert float(crops.min()) >= 0.0 and float(crops.max()) <= 1.0
    # The dark square is inside the crop, so not everything is white.
    assert float(crops.min()) < 0.5


def test_crop_is_differentiable_in_the_image() -> None:
    """A branch on top could in principle train the image path; assert the graph exists."""
    images = torch.ones(1, 1, 1, 64, 64, requires_grad=True)
    boxes = torch.tensor([[[0.30, 0.30, 0.62, 0.62]]])
    mask = torch.ones(1, 1, dtype=torch.bool)
    tile = torch.zeros(1, 1, dtype=torch.long)
    crops = sample_roi(images, boxes, mask, tile, 32, 1.6)
    crops.sum().backward()
    assert images.grad is not None


# -------------------------------------------------- gradient isolation


def test_fret_loss_reaches_the_head_and_nothing_else(device: Device, batch) -> None:
    """The structural claim: the branch cannot damage any other task.

    Its input is `images` and `boxes`, so the fret loss has no path to the backbone, the
    samplers or the token path. Asserted rather than assumed, because it is the whole
    reason this integration is safe.
    """
    model = build(VARIANT, make_args(VARIANT), device)
    model.train()
    out = model(batch)
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    fret_only = torch.nn.functional.cross_entropy(
        out["fret"][is_fret], batch["fret"][is_fret])
    model.zero_grad(set_to_none=True)
    fret_only.backward()

    assert model.roi_head.head.weight.grad is not None
    assert float(model.roi_head.head.weight.grad.abs().sum()) > 0.0
    reached = [
        name for name, parameter in model.named_parameters()
        if not name.startswith("roi_head.")
        and parameter.grad is not None
        and float(parameter.grad.abs().sum()) > 0.0
    ]
    assert reached == [], f"the fret branch reached {reached}"


def test_shared_model_gradients_come_only_from_the_other_tasks(device: Device, batch) -> None:
    """The other heads still train the shared model exactly as before."""
    model = build(VARIANT, make_args(VARIANT), device)
    model.train()
    out = model(batch)
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    other_only = torch.nn.functional.cross_entropy(
        out["string"][is_fret], batch["string"][is_fret])
    model.zero_grad(set_to_none=True)
    other_only.backward()
    backbone = [n for n, p in model.base.backbone.named_parameters()
                if p.grad is not None and float(p.grad.abs().sum()) > 0.0]
    assert backbone, "the string loss should still train the backbone"
    assert all(p.grad is None or float(p.grad.abs().sum()) == 0.0
               for p in model.roi_head.parameters()), (
        "the string loss must not touch the dedicated fret branch"
    )


# ------------------------------------------------------ loss and routing


def test_loss_and_decode_routing_unchanged(device: Device, batch) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    model.eval()
    with torch.no_grad():
        out = model(batch)
        total, parts = fret_loss(out, batch)
    assert "slots" not in out and "presence" not in out
    assert out["fret"].shape[-1] == 26
    assert torch.equal(decode(out), out["fret"].argmax(-1))
    assert set(parts) == {"object_type", "string", "fret"}
    assert float(total.detach()) == pytest.approx(sum(parts.values()), rel=1e-5)


def test_head_trains_end_to_end(device: Device, batch) -> None:
    torch.manual_seed(SEED)
    model = build(VARIANT, make_args(VARIANT), device)
    model.train()
    optimiser = torch.optim.Adam(model.roi_head.parameters(), lr=1e-3)
    first = None
    for _ in range(5):
        out = model(batch)
        is_fret = batch["object_mask"] & (batch["object_type"] == 1)
        loss = torch.nn.functional.cross_entropy(
            out["fret"][is_fret], batch["fret"][is_fret])
        if first is None:
            first = float(loss.detach())
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        optimiser.step()
    assert float(loss.detach()) < first
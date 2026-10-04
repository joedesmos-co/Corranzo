"""Tests for the `FROZEN_RANDOM_ROI_ENCODER` experimental variant.

The variant asks one question: do gradient updates to `RoiEncoder` destroy
transferable fret identity? Answering it requires that the encoder provably cannot
move, so most of these tests are about the freeze itself rather than about accuracy.

If the encoder could drift by any route -- a stray optimizer state, a buffer updated
by `train()`, a `load_state_dict` side effect -- the experiment would silently become
a partial retrain and its result would be uninterpretable.
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

SEED = 11
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
    samples = load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=2)
    return collate(samples, 128)


def encoder_signature(model) -> torch.Tensor:
    return torch.cat([p.detach().reshape(-1) for p in model.encoder.parameters()])


def test_variant_is_registered_and_shares_the_no_token_path() -> None:
    assert "FROZEN_RANDOM_ROI_ENCODER" in FretVariantModel.ROI_ONLY_KINDS
    assert "ROI_ONLY_NO_TOKEN" in FretVariantModel.ROI_ONLY_KINDS


def test_all_encoder_parameters_are_frozen(device: Device) -> None:
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    assert model.encoder is not None
    assert len(list(model.encoder.parameters())) > 0
    for name, parameter in model.encoder.named_parameters():
        assert parameter.requires_grad is False, f"encoder.{name} is trainable"


def test_everything_outside_the_encoder_is_trainable(device: Device) -> None:
    """A freeze that caught the wrong parameters would prove nothing."""
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    for name, parameter in model.named_parameters():
        if name.startswith("encoder."):
            assert parameter.requires_grad is False, f"{name} should be frozen"
        else:
            assert parameter.requires_grad is True, f"{name} should be trainable"
    for required in ("roi_projection.weight", "fret_classifier.weight"):
        assert dict(model.named_parameters())[required].requires_grad is True


def test_encoder_has_no_buffers_that_train_mode_could_update(device: Device) -> None:
    """`train()` must not be able to change the encoder by writing a buffer.

    GroupNorm keeps no running statistics, which is why freezing parameters alone is
    enough. If that ever changes, this test is what should fail.
    """
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    assert len(list(model.encoder.buffers())) == 0, (
        "encoder has buffers; train() could mutate them and freezing parameters "
        "would no longer pin the encoder"
    )


def test_train_mode_does_not_move_the_encoder(device: Device) -> None:
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    before = encoder_signature(model).clone()
    model.train()
    assert encoder_signature(model).equal(before)


def test_backward_produces_no_encoder_gradient(device: Device, batch) -> None:
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    model.train()
    out = model(batch)
    loss, _ = fret_loss(out, batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    for name, parameter in model.named_parameters():
        if name.startswith("encoder."):
            assert parameter.grad is None, f"{name} received a gradient"
    # The rest of the fret path must still train, or the freeze achieved nothing
    # beyond disabling the branch.
    for name in ("roi_projection.weight", "fret_classifier.weight"):
        parameter = dict(model.named_parameters())[name]
        assert parameter.grad is not None and float(parameter.grad.abs().sum()) > 0.0


def test_optimizer_steps_cannot_move_the_encoder(device: Device, batch) -> None:
    """The decisive freeze test: run real optimiser steps and require bit-identity."""
    torch.manual_seed(SEED)
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    before = encoder_signature(model).clone()
    trainable_before = {
        k: v.detach().clone() for k, v in model.state_dict().items() if not k.startswith("encoder.")
    }
    # Same optimiser construction the harness uses, frozen parameters included.
    optimiser = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
    model.train()
    for _ in range(5):
        out = model(batch)
        loss, _ = fret_loss(out, batch)
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimiser.step()
    after = encoder_signature(model)
    assert torch.equal(before, after), (
        f"encoder moved by {float((before - after).abs().max()):.3e}"
    )
    # Sanity: something else did train, so the equality above is not vacuous.
    moved = [
        k for k, v in model.state_dict().items()
        if not k.startswith("encoder.") and not torch.equal(v, trainable_before[k])
    ]
    assert moved, "no non-encoder parameter changed; the freeze test is vacuous"


def test_encoder_weights_survive_save_and_load_bit_identically(
    device: Device, batch
) -> None:
    """Checkpoint round-trip must not perturb the frozen weights."""
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    model.train()
    # Not under no_grad: the point is to take a real optimiser step, which needs a
    # loss with a grad_fn.
    out = model(batch)
    loss, _ = fret_loss(out, batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    optimiser = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
    optimiser.step()
    before = encoder_signature(model).clone()

    revived = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    revived.load_state_dict(model.state_dict())
    assert torch.equal(encoder_signature(revived), before)
    for name, parameter in revived.named_parameters():
        if name.startswith("encoder."):
            assert parameter.requires_grad is False, f"{name} thawed by load_state_dict"


def test_encoder_init_matches_the_trainable_variant_under_equal_seed(device: Device) -> None:
    """The two variants must start from the identical random encoder.

    Otherwise a difference in results could be a different random draw rather than
    the freeze, and the comparison would not be causal.
    """
    torch.manual_seed(SEED)
    trainable = build("ROI_ONLY_NO_TOKEN", make_args("ROI_ONLY_NO_TOKEN"), device)
    torch.manual_seed(SEED)
    frozen = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    assert torch.equal(encoder_signature(trainable), encoder_signature(frozen))
    for key in trainable.state_dict():
        assert torch.equal(
            trainable.state_dict()[key], frozen.state_dict()[key]
        ), f"init diverges at {key}"


def test_encoder_is_random_not_pretrained(device: Device) -> None:
    """Guard against accidentally freezing a *trained* encoder."""
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    signature = encoder_signature(model)
    assert signature.std() > 0.0
    # A randomly initialised GroupNorm weight is 1 and bias 0; if those look trained
    # then the "frozen random" premise is broken.
    for module in model.encoder.modules():
        if isinstance(module, torch.nn.GroupNorm):
            assert torch.allclose(module.weight, torch.ones_like(module.weight))
            assert torch.allclose(module.bias, torch.zeros_like(module.bias))


def test_fret_path_is_identical_to_the_no_token_variant(device: Device, batch) -> None:
    """Same forward pass. Load the trainable variant's weights into the frozen one:
    if the two compute the same thing, they must agree bit for bit."""
    torch.manual_seed(SEED)
    trainable = build("ROI_ONLY_NO_TOKEN", make_args("ROI_ONLY_NO_TOKEN"), device)
    frozen = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    frozen.load_state_dict(trainable.state_dict())
    trainable.eval()
    frozen.eval()
    with torch.no_grad():
        out_a, out_b = trainable(batch), frozen(batch)
    assert torch.equal(out_a["fret"], out_b["fret"])
    for name in ("object_type", "string", "tile"):
        assert torch.equal(out_a[name], out_b[name])


def test_no_token_term_is_absent(device: Device, batch) -> None:
    """`+ tokens` must still be absent, or this stops being a controlled comparison."""
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    model.eval()
    with torch.no_grad():
        finest = model.features = model.base.backbone(batch["images"].flatten(0, 1))
        from guitar_vision.fret_experiments import roi_crops
        crops = roi_crops(finest[0], batch["boxes"], batch["object_mask"], model.grid,
                          model.context)
        encoded = model.encoder(
            crops, batch["object_mask"], model.grid, model.base.backbone.output_channels[0]
        )
        expected = model.fret_classifier(model.roi_projection(encoded.flatten(-2)))
        assert torch.allclose(model(batch)["fret"], expected, atol=1e-5)
        assert "slots" not in model(batch) and "presence" not in model(batch)


def test_decode_and_loss_routing_unchanged(device: Device, batch) -> None:
    model = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    model.eval()
    with torch.no_grad():
        out = model(batch)
        total, parts = fret_loss(out, batch)
    assert out["fret"].shape[-1] == 26
    assert torch.equal(decode(out), out["fret"].argmax(-1))
    assert set(parts) == {"object_type", "string", "fret"}
    assert float(total) == pytest.approx(sum(parts.values()), rel=1e-5)
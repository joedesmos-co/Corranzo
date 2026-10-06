"""Tests for `FrozenTrainStatsStandardizer` and `TWO_PHASE_STANDARDIZED`.

The two-phase recipe is only valid if phase 2's statistics are genuinely fixed. A module
that accumulated during phase 2 would reintroduce exactly the lag that made the joint run
fail, and a checkpoint loaded without statistics must not be silently standardised. These
tests pin both properties.
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
    FrozenTrainStatsStandardizer,
    TrainStatsStandardizer,
    build,
    decode,
    fret_loss,
)
from guitar_vision.qualify import Device  # noqa: E402

SEED = 11
VARIANT = "TWO_PHASE_STANDARDIZED"
ACCUMULATING = "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED"
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
    return collate(load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=2), 128)


# --------------------------------------------------------------- the module


def test_frozen_module_has_no_parameters() -> None:
    module = FrozenTrainStatsStandardizer(192)
    assert list(module.parameters()) == []
    assert {n for n, _ in module.named_buffers()} == {"count", "mean", "sigma", "eps"}


def test_defaults_are_identity_not_zero() -> None:
    """An unset sigma of zero would divide by eps and blow up silently."""
    module = FrozenTrainStatsStandardizer(4)
    values = torch.tensor([[1.0, 2.0, 3.0, 4.0]])
    assert torch.allclose(module(values), values)


def test_never_updates_in_train_mode() -> None:
    """The defining property: phase 2 must not accumulate."""
    module = FrozenTrainStatsStandardizer(5)
    module.set_statistics(torch.full((5,), 2.0), torch.full((5,), 0.5), 614)
    before = (module.count.clone(), module.mean.clone(), module.sigma.clone())
    module.train()
    for _ in range(3):
        module(torch.randn(40, 5) * 9 + 5)
    assert torch.equal(module.count, before[0])
    assert torch.equal(module.mean, before[1])
    assert torch.equal(module.sigma, before[2])


def test_never_updates_in_eval_mode() -> None:
    module = FrozenTrainStatsStandardizer(5)
    module.set_statistics(torch.full((5,), 2.0), torch.full((5,), 0.5), 614)
    before = module.mean.clone()
    module.eval()
    module(torch.randn(40, 5) * 9 + 5)
    assert torch.equal(module.mean, before)


def test_train_and_eval_agree() -> None:
    """No train/eval discrepancy: `forward` never consults `self.training`."""
    module = FrozenTrainStatsStandardizer(6)
    module.set_statistics(torch.arange(6).double(), torch.ones(6), 100)
    values = torch.randn(3, 6)
    module.train()
    a = module(values).clone()
    module.eval()
    b = module(values)
    assert torch.equal(a, b)


def test_matches_the_diagnostic_formula() -> None:
    """z = (p - mu) / (sigma + eps), the formula the proven experiment used."""
    torch.manual_seed(3)
    module = FrozenTrainStatsStandardizer(4, eps=1e-6)
    mu = torch.tensor([0.1, -0.2, 0.3, 0.0], dtype=torch.float64)
    sigma = torch.tensor([0.02, 0.03, 0.01, 0.05], dtype=torch.float64)
    module.set_statistics(mu, sigma, 614)
    values = torch.randn(5, 4)
    expected = (values.double() - mu) / (sigma + 1e-6)
    assert torch.allclose(module(values).double(), expected, atol=1e-6)


def test_masked_slots_zeroed_and_gradient_free() -> None:
    module = FrozenTrainStatsStandardizer(4)
    module.set_statistics(torch.zeros(4).double(), torch.ones(4), 10)
    values = torch.zeros(1, 3, 4, requires_grad=True)
    mask = torch.tensor([[True, False, False]])
    out = module(values, mask)
    assert torch.equal(out[0, 1:], torch.zeros(2, 4))
    out.sum().backward()
    assert torch.equal(values.grad[0, 1:], torch.zeros(2, 4))
    assert float(values.grad[0, 0].abs().sum()) > 0.0


def test_set_statistics_validates() -> None:
    module = FrozenTrainStatsStandardizer(4)
    with pytest.raises(ValueError):
        module.set_statistics(torch.zeros(3).double(), torch.ones(3), 1)
    with pytest.raises(ValueError):
        module.set_statistics(torch.zeros(4).double(), torch.zeros(4), 1)
    with pytest.raises(ValueError):
        module.set_statistics(torch.tensor([1.0, float("nan"), 0, 0]).double(),
                              torch.ones(4), 1)


def test_statistics_survive_a_state_dict_round_trip() -> None:
    a = FrozenTrainStatsStandardizer(7)
    a.set_statistics(torch.randn(7).double(), torch.rand(7).double() + 0.1, 614)
    b = FrozenTrainStatsStandardizer(7)
    b.load_state_dict(a.state_dict())
    assert torch.equal(a.mean, b.mean)
    assert torch.equal(a.sigma, b.sigma)
    assert torch.equal(a.count, b.count)
    assert torch.equal(a.eps, b.eps)


def test_the_two_module_types_are_distinguishable() -> None:
    """A checkpoint must be able to tell accumulating from fixed by type, not value."""
    assert isinstance(build(VARIANT, make_args(VARIANT), Device("cpu")).p_standardizer,
                      FrozenTrainStatsStandardizer)
    assert isinstance(build(ACCUMULATING, make_args(ACCUMULATING), Device("cpu")).p_standardizer,
                      TrainStatsStandardizer)


# -------------------------------------------------------------- the variant


def test_variant_registered_in_all_three_groups() -> None:
    assert VARIANT in FretVariantModel.ROI_ONLY_KINDS
    assert VARIANT in FretVariantModel.FROZEN_ENCODER_KINDS
    assert VARIANT in FretVariantModel.STANDARDIZED_KINDS
    assert ACCUMULATING in FretVariantModel.STANDARDIZED_KINDS
    # The unstandardized frozen variant must NOT be in the standardized group.
    assert "FROZEN_RANDOM_ROI_ENCODER" not in FretVariantModel.STANDARDIZED_KINDS


def test_encoder_frozen_and_rest_trainable(device: Device) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    for name, parameter in model.named_parameters():
        if name.startswith("encoder."):
            assert parameter.requires_grad is False, name
        else:
            assert parameter.requires_grad is True, name


def test_initial_weights_match_the_unstandardized_variant(device: Device) -> None:
    torch.manual_seed(SEED)
    base = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    torch.manual_seed(SEED)
    two_phase = build(VARIANT, make_args(VARIANT), device)
    for key, value in base.state_dict().items():
        assert torch.equal(two_phase.state_dict()[key], value), key


def test_only_the_fret_path_differs(device: Device, batch) -> None:
    two_phase = build(VARIANT, make_args(VARIANT), device)
    base = build("FROZEN_RANDOM_ROI_ENCODER", make_args("FROZEN_RANDOM_ROI_ENCODER"), device)
    base.load_state_dict({k: v for k, v in two_phase.state_dict().items()
                          if not k.startswith("p_standardizer.")})
    two_phase.eval()
    base.eval()
    with torch.no_grad():
        a, b = two_phase(batch), base(batch)
    for name in ("object_type", "string", "tile"):
        assert torch.equal(a[name], b[name]), name
    # Compatibility property, asserted rather than assumed: an unconfigured
    # two-phase model must not silently standardise. The defaults are mu=0 and
    # sigma=1, so on fret rows the only difference is the always-applied eps, a 1e-6
    # relative rescale, not a mean shift and not a real rescale.
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    assert torch.allclose(a["fret"][is_fret], b["fret"][is_fret], atol=1e-4)
    assert torch.allclose(two_phase.p_standardizer.mean, torch.zeros(192).double())
    assert torch.allclose(two_phase.p_standardizer.sigma, torch.ones(192).double())
    # Non-fret and padding slots are deliberately zeroed by the standardizer, so
    # their fret logits collapse to the bias. Those slots are excluded from the fret
    # loss, so this is a documented behaviour rather than a defect - but it is a
    # difference from the unstandardized variant and is asserted explicitly.
    assert torch.equal(a["fret"][~is_fret], torch.zeros_like(a["fret"][~is_fret]) +
                       two_phase.fret_classifier.bias)


def test_no_tokens_and_routing_unchanged(device: Device, batch) -> None:
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


def test_installed_statistics_change_only_the_fret_path(device: Device, batch) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    model.eval()
    with torch.no_grad():
        before = {k: v.clone() for k, v in model(batch).items()}
    model.p_standardizer.set_statistics(
        torch.full((192,), 0.2).double(), torch.full((192,), 0.02).double(), 614)
    with torch.no_grad():
        after = model(batch)
    for name in ("object_type", "string", "tile"):
        assert torch.equal(before[name], after[name]), name
    assert not torch.equal(before["fret"], after["fret"])


def test_without_freezing_the_fret_loss_reaches_the_backbone(device: Device, batch) -> None:
    """Why phase 2 must freeze explicitly.

    The fret head reads the ROI encoding, which is a function of the backbone's
    stride-1 features. So the fret loss backpropagates all the way into the backbone
    by construction. Freezing is not implied by training only the head's parameters
    in an optimiser; every upstream parameter has to have `requires_grad` cleared.
    Asserted here so the requirement cannot be quietly dropped.
    """
    model = build(VARIANT, make_args(VARIANT), device)
    model.p_standardizer.set_statistics(
        torch.full((192,), 0.1).double(), torch.full((192,), 0.03).double(), 614)
    model.train()
    loss, _ = fret_loss(model(batch), batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    assert model.fret_classifier.weight.grad is not None
    backbone = dict(model.base.backbone.named_parameters())
    reached = [n for n, p in backbone.items()
               if p.grad is not None and float(p.grad.abs().sum()) > 0.0]
    assert reached, "expected the unfrozen fret loss to reach the backbone"
    encoder = [n for n, p in model.encoder.named_parameters()
               if p.grad is not None and float(p.grad.abs().sum()) > 0.0]
    assert encoder == [], "the frozen encoder must never receive a gradient"


def test_freezing_all_but_the_head_leaves_only_the_head_trainable(
    device: Device, batch
) -> None:
    """The actual phase-2 property: with upstream frozen, only the head moves."""
    model = build(VARIANT, make_args(VARIANT), device)
    model.p_standardizer.set_statistics(
        torch.full((192,), 0.1).double(), torch.full((192,), 0.03).double(), 614)
    for name, parameter in model.named_parameters():
        if not name.startswith("fret_classifier."):
            parameter.requires_grad_(False)
    trainable = [n for n, p in model.named_parameters() if p.requires_grad]
    assert trainable == ["fret_classifier.weight", "fret_classifier.bias"]

    model.train()
    loss, _ = fret_loss(model(batch), batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    assert model.fret_classifier.weight.grad is not None
    assert float(model.fret_classifier.weight.grad.abs().sum()) > 0.0
    for name, parameter in model.named_parameters():
        if name.startswith("fret_classifier."):
            continue
        assert parameter.grad is None, f"{name} received a gradient"


def test_optimiser_steps_move_only_the_head(device: Device, batch) -> None:
    torch.manual_seed(SEED)
    model = build(VARIANT, make_args(VARIANT), device)
    model.p_standardizer.set_statistics(
        torch.full((192,), 0.1).double(), torch.full((192,), 0.03).double(), 614)
    frozen_before = {
        k: v.clone() for k, v in model.state_dict().items()
        if not k.startswith("fret_classifier.")
    }
    optimiser = torch.optim.AdamW(model.fret_classifier.parameters(), lr=3e-3,
                                  weight_decay=0.01)
    model.train()
    for _ in range(4):
        loss, _ = fret_loss(model(batch), batch)
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        optimiser.step()
    for key, value in frozen_before.items():
        assert torch.equal(model.state_dict()[key], value), f"{key} moved"
    assert not torch.equal(model.fret_classifier.weight,
                           torch.zeros_like(model.fret_classifier.weight))


def test_statistics_unmoved_by_a_training_step(device: Device, batch) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    model.p_standardizer.set_statistics(
        torch.full((192,), 0.1).double(), torch.full((192,), 0.03).double(), 614)
    before = (model.p_standardizer.mean.clone(), model.p_standardizer.sigma.clone(),
              model.p_standardizer.count.clone())
    model.train()
    loss, _ = fret_loss(model(batch), batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    assert torch.equal(model.p_standardizer.mean, before[0])
    assert torch.equal(model.p_standardizer.sigma, before[1])
    assert torch.equal(model.p_standardizer.count, before[2])
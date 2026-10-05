"""Pre-flight verification for `TrainStatsStandardizer` and the standardized variant.

These are implementation checks, not scientific ones: they establish that the module
keeps training-only statistics, that evaluation cannot update them, that the frozen
encoder is still frozen, and that nothing else in the model moved. The experiment's
meaning depends entirely on those properties, so they are asserted before the run
rather than inspected afterwards.

No scientific parameter is chosen anywhere in this file.
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
    TrainStatsStandardizer,
    build,
    decode,
    fret_loss,
)
from guitar_vision.qualify import Device  # noqa: E402

SEED = 11
VARIANT = "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED"
BASE = "FROZEN_RANDOM_ROI_ENCODER"
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


def encoder_signature(model) -> torch.Tensor:
    return torch.cat([p.detach().reshape(-1) for p in model.encoder.parameters()])


# ------------------------------------------------------- module-level properties


def test_standardizer_has_no_learnable_parameters() -> None:
    module = TrainStatsStandardizer(192)
    assert list(module.parameters()) == []
    names = {name for name, _ in module.named_buffers()}
    assert names == {"count", "mean", "m2"}


def test_buffers_are_float64_and_serialised() -> None:
    module = TrainStatsStandardizer(8)
    for buffer in (module.count, module.mean, module.m2):
        assert buffer.dtype == torch.float64
    state = module.state_dict()
    assert {"count", "mean", "m2"} <= set(state)


def test_welford_matches_a_direct_computation() -> None:
    torch.manual_seed(0)
    data = torch.randn(500, 16) * 3.0 + 7.0
    module = TrainStatsStandardizer(16)
    module.train()
    for start in range(0, 500, 37):
        module.update(data[start : start + 37])
    assert float(module.count) == 500.0
    # ddof=0 throughout, matching numpy.std and the successful diagnostic.
    assert torch.allclose(module.mean, data.mean(0).to(torch.float64), atol=1e-10)
    assert torch.allclose(module.scale() - 1e-6, data.std(0, unbiased=False).to(torch.float64),
                          atol=1e-8)


def test_statistics_are_batch_order_independent() -> None:
    """Cumulative moments must be a function of the rows, not their order.

    This is what makes a momentum-free implementation safe to resume: no hidden
    dependence on how rows were grouped into batches.
    """
    torch.manual_seed(1)
    data = torch.randn(400, 12)
    first, second = TrainStatsStandardizer(12), TrainStatsStandardizer(12)
    first.train()
    second.train()
    for start in range(0, 400, 50):
        first.update(data[start : start + 50])
    for start in range(0, 400, 13):
        second.update(data[start : start + 13])
    assert torch.allclose(first.mean, second.mean, atol=1e-12)
    assert torch.allclose(first.m2, second.m2, atol=1e-9)
    assert float(first.count) == float(second.count)


def test_eval_mode_does_not_update_statistics() -> None:
    module = TrainStatsStandardizer(6)
    module.train()
    module.update(torch.randn(20, 6))
    before = (module.count.clone(), module.mean.clone(), module.m2.clone())
    module.eval()
    module(torch.randn(99, 6))
    assert torch.equal(module.count, before[0])
    assert torch.equal(module.mean, before[1])
    assert torch.equal(module.m2, before[2])


def test_train_mode_does_update_statistics() -> None:
    module = TrainStatsStandardizer(6)
    module.train()
    module(torch.randn(30, 6))
    assert float(module.count) == 30.0


def test_masked_rows_are_excluded_from_statistics() -> None:
    """Padding and non-fret slots must not reach mu or sigma."""
    module = TrainStatsStandardizer(4)
    module.train()
    values = torch.zeros(2, 5, 4)
    values[0, :3] = 5.0
    values[1, :2] = 5.0
    mask = torch.tensor([[True, True, True, False, False], [True, True, False, False, False]])
    module(values, mask)
    assert float(module.count) == 5.0
    assert torch.allclose(module.mean, torch.full((4,), 5.0, dtype=torch.float64))


def test_masked_slots_are_zeroed_and_carry_no_gradient() -> None:
    module = TrainStatsStandardizer(4)
    module.train()
    values = torch.zeros(1, 4, 4, requires_grad=True)
    mask = torch.tensor([[True, False, False, False]])
    out = module(values, mask)
    assert torch.equal(out[0, 1:], torch.zeros(3, 4))
    out.sum().backward()
    assert torch.equal(values.grad[0, 1:], torch.zeros(3, 4))
    assert float(values.grad[0, 0].abs().sum()) > 0.0


def test_standardisation_is_exact_against_the_diagnostic_formula() -> None:
    """z_j = (p_j - mean_j) / (std_j + eps), with population std."""
    torch.manual_seed(2)
    data = torch.randn(200, 5) * 0.045 + 0.11  # P-like scale
    module = TrainStatsStandardizer(5)
    module.train()
    module.update(data)
    got = module(data, torch.ones(len(data), dtype=torch.bool))
    mean = data.mean(0)
    std = data.std(0, unbiased=False)
    expected = (data - mean) / (std + 1e-6)
    assert torch.allclose(got, expected, atol=1e-6)


def test_gradients_flow_through_the_standardizer() -> None:
    module = TrainStatsStandardizer(4)
    module.train()
    values = torch.randn(1, 3, 4, requires_grad=True)
    module(values, torch.tensor([[True, True, True]])).sum().backward()
    assert values.grad is not None and float(values.grad.abs().sum()) > 0.0


def test_statistics_survive_a_state_dict_round_trip() -> None:
    a = TrainStatsStandardizer(7)
    a.train()
    a.update(torch.randn(50, 7))
    b = TrainStatsStandardizer(7)
    b.load_state_dict(a.state_dict())
    assert torch.equal(a.count, b.count)
    assert torch.equal(a.mean, b.mean)
    assert torch.equal(a.m2, b.m2)
    assert torch.equal(a.scale(), b.scale())


# ------------------------------------------------------------- variant-level


def test_variant_is_registered() -> None:
    assert VARIANT in FretVariantModel.ROI_ONLY_KINDS
    assert VARIANT in FretVariantModel.FROZEN_ENCODER_KINDS
    assert BASE in FretVariantModel.FROZEN_ENCODER_KINDS


def test_encoder_is_still_fully_frozen(device: Device) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    for name, parameter in model.named_parameters():
        if name.startswith("encoder."):
            assert parameter.requires_grad is False, name
        else:
            assert parameter.requires_grad is True, name
    assert len(list(model.encoder.parameters())) == 12
    assert len(list(model.encoder.buffers())) == 0


def test_initial_weights_match_the_unstandardized_variant(device: Device) -> None:
    """The standardizer has no parameters, so it must consume no RNG."""
    torch.manual_seed(SEED)
    base = build(BASE, make_args(BASE), device)
    torch.manual_seed(SEED)
    standardized = build(VARIANT, make_args(VARIANT), device)
    for key, value in base.state_dict().items():
        assert torch.equal(standardized.state_dict()[key], value), key
    # And the only extra state is the standardizer buffers, which start at zero.
    extra = set(standardized.state_dict()) - set(base.state_dict())
    assert extra == {"p_standardizer.count", "p_standardizer.mean", "p_standardizer.m2"}


def test_only_the_fret_path_differs_from_the_base_variant(device: Device, batch) -> None:
    standardized = build(VARIANT, make_args(VARIANT), device)
    base = build(BASE, make_args(BASE), device)
    base.load_state_dict(
        {k: v for k, v in standardized.state_dict().items()
         if not k.startswith("p_standardizer.")}
    )
    standardized.eval()
    base.eval()
    with torch.no_grad():
        a, b = standardized(batch), base(batch)
    for name in ("object_type", "string", "tile"):
        assert torch.equal(a[name], b[name]), name
    # The fret logits must differ, or the standardizer is not in the path.
    assert not torch.equal(a["fret"], b["fret"])


def test_no_tokens_in_the_fret_path(device: Device, batch) -> None:
    from guitar_vision.fret_experiments import roi_crops

    model = build(VARIANT, make_args(VARIANT), device)
    model.eval()
    with torch.no_grad():
        finest = model.features = model.base.backbone(batch["images"].flatten(0, 1))
        crops = roi_crops(finest[0], batch["boxes"], batch["object_mask"], model.grid,
                          model.context)
        encoded = model.encoder(crops, batch["object_mask"], model.grid,
                                model.base.backbone.output_channels[0])
        p = model.roi_projection(encoded.flatten(-2))
        is_fret = batch["object_mask"] & (batch["object_type"] == 1)
        z = model.p_standardizer(p, is_fret)
        expected = model.fret_classifier(z)
        assert torch.allclose(model(batch)["fret"], expected, atol=1e-5)
        assert out_has_no_slots(model(batch))
        assert model.fret_classifier.out_features == 26


def out_has_no_slots(out: dict) -> bool:
    return "slots" not in out and "presence" not in out


def test_standardized_features_reach_unit_scale_after_training_data(
    device: Device, batch
) -> None:
    """Smoke: after enough rows, valid features are centred and unit-scaled."""
    model = build(VARIANT, make_args(VARIANT), device)
    model.train()
    for _ in range(20):
        out = model(batch)
        loss, _ = fret_loss(out, batch)
        model.zero_grad(set_to_none=True)
        loss.backward()
    assert float(model.p_standardizer.count) > 0.0
    from guitar_vision.fret_experiments import roi_crops

    with torch.no_grad():
        model.eval()
        finest = model.features = model.base.backbone(batch["images"].flatten(0, 1))
        crops = roi_crops(finest[0], batch["boxes"], batch["object_mask"], model.grid,
                          model.context)
        encoded = model.encoder(crops, batch["object_mask"], model.grid,
                                model.base.backbone.output_channels[0])
        p = model.roi_projection(encoded.flatten(-2))
        is_fret = batch["object_mask"] & (batch["object_type"] == 1)
        z = model.p_standardizer(p, is_fret)
    rows = z[is_fret]
    assert abs(float(rows.mean())) < 0.5
    assert 0.2 < float(rows.std()) < 5.0
    scale = model.p_standardizer.scale()
    assert float(scale.min()) > 0.0


def test_gradients_reach_the_roi_path_and_not_the_encoder(device: Device, batch) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    model.train()
    out = model(batch)
    loss, _ = fret_loss(out, batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    for name in ("roi_projection.weight", "fret_classifier.weight"):
        parameter = dict(model.named_parameters())[name]
        assert parameter.grad is not None and float(parameter.grad.abs().sum()) > 0.0
    for name, parameter in model.named_parameters():
        if name.startswith("encoder."):
            assert parameter.grad is None, name


def test_standardizer_buffers_are_not_in_the_optimizer(device: Device, batch) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    optimiser = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
    tracked = {id(p) for group in optimiser.param_groups for p in group["params"]}
    for buffer in model.p_standardizer.buffers():
        assert id(buffer) not in tracked


def test_optimiser_steps_do_not_move_the_encoder(device: Device, batch) -> None:
    torch.manual_seed(SEED)
    model = build(VARIANT, make_args(VARIANT), device)
    before = encoder_signature(model).clone()
    optimiser = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
    model.train()
    for _ in range(4):
        out = model(batch)
        loss, _ = fret_loss(out, batch)
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimiser.step()
    assert torch.equal(encoder_signature(model), before)


def test_training_step_is_finite_and_routing_unchanged(device: Device, batch) -> None:
    model = build(VARIANT, make_args(VARIANT), device)
    model.train()
    out = model(batch)
    total, parts = fret_loss(out, batch)
    assert torch.isfinite(total)
    assert set(parts) == {"object_type", "string", "fret"}
    assert float(total.detach()) == pytest.approx(sum(parts.values()), rel=1e-5)
    model.eval()
    with torch.no_grad():
        assert torch.equal(decode(model(batch)), model(batch)["fret"].argmax(-1))


def test_evaluation_after_training_uses_stored_statistics_only(
    device: Device, batch
) -> None:
    """The decisive leakage guard: repeated eval cannot move mu or sigma."""
    model = build(VARIANT, make_args(VARIANT), device)
    model.train()
    model(batch)
    model.eval()
    before = (model.p_standardizer.count.clone(), model.p_standardizer.mean.clone(),
              model.p_standardizer.m2.clone())
    with torch.no_grad():
        for _ in range(5):
            model(batch)
    assert torch.equal(model.p_standardizer.count, before[0])
    assert torch.equal(model.p_standardizer.mean, before[1])
    assert torch.equal(model.p_standardizer.m2, before[2])
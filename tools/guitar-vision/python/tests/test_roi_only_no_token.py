"""Tests for the `ROI_ONLY_NO_TOKEN` experimental variant.

This variant exists to test one causal claim: that adding the shared token to the
ROI encoding is what prevents fret transfer. A one-term deletion is only evidence if
it *is* a one-term deletion, so these tests are almost entirely about provenance --
they assert that everything except the `+ tokens` term is identical to `roi26`.

If any of these fail, the experiment is no longer measuring what it claims to
measure, and its result would be uninterpretable regardless of the accuracy.
"""
from __future__ import annotations

import argparse
import sys
import types
from pathlib import Path

import pytest
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import (  # noqa: E402
    RoiEncoder,
    build,
    decode,
    fret_loss,
    roi_crops,
)
from guitar_vision.qualify import Device  # noqa: E402

SEED = 11
_REPO = Path(__file__).resolve().parents[4]
_RECORDS = _REPO / "datasets/guitar-vision/synthetic/train/records"
_VIEWS = _REPO / "datasets/guitar-vision/synthetic/train/views"


def make_args(**overrides) -> argparse.Namespace:
    base = dict(
        variant="ROI_ONLY_NO_TOKEN", steps=1200, pages=40, batch_pages=4, held_out=20,
        image_size=256, max_objects=128, hidden=192, layers=4, lr=3e-3,
        train_jitter=0.35, roi_grid=8, roi_context=1.6, seed=SEED, device="cpu",
        out=None,
    )
    base.update(overrides)
    return argparse.Namespace(**base)


@pytest.fixture(scope="module")
def device() -> Device:
    return Device("cpu")


@pytest.fixture(scope="module")
def batch() -> dict[str, torch.Tensor]:
    """A real collated batch. Synthetic tensors would not exercise the samplers."""
    if not _RECORDS.exists():
        pytest.skip("synthetic corpus not present")
    samples = load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=2)
    return collate(samples, 128)


def build_pair(device: Device):
    """Build both variants under the same seed, so initial weights are identical."""
    torch.manual_seed(SEED)
    roi26 = build("roi26", make_args(variant="roi26"), device)
    torch.manual_seed(SEED)
    no_token = build("ROI_ONLY_NO_TOKEN", make_args(), device)
    roi26.eval()
    no_token.eval()
    return roi26, no_token


@pytest.fixture(scope="module")
def pair(device: Device):
    """Shared, read-only pair.

    Read-only tests share this because rebuilding two models per test dominates the
    runtime. Tests that run an optimiser step build their own via `build_pair`, so
    no test can observe another's mutated weights.
    """
    return build_pair(device)


def test_parameter_keys_and_count_match_roi26(device: Device, pair) -> None:
    roi26, no_token = pair
    assert set(roi26.state_dict()) == set(no_token.state_dict())
    assert sum(p.numel() for p in roi26.parameters()) == sum(
        p.numel() for p in no_token.parameters()
    )


def test_initial_weights_are_identical_under_equal_seed(device: Device) -> None:
    """Equal seed must give the identical starting point, or the comparison is not clean."""
    roi26, no_token = build_pair(device)
    a, b = roi26.state_dict(), no_token.state_dict()
    for key in a:
        assert torch.equal(a[key], b[key]), f"init diverges at {key}"


def test_roi_geometry_and_encoder_are_untouched(device: Device) -> None:
    """Grid, context, encoder shape, projection shape: all identical to roi26."""
    roi26, no_token = build_pair(device)
    assert roi26.grid == no_token.grid == 8
    assert roi26.context == no_token.context == 1.6
    assert isinstance(no_token.encoder, RoiEncoder)
    assert no_token.encoder.out_channels == roi26.encoder.out_channels
    assert no_token.roi_projection.weight.shape == roi26.roi_projection.weight.shape
    assert no_token.fret_classifier.weight.shape == roi26.fret_classifier.weight.shape


def test_unrelated_heads_are_bit_identical(device: Device, batch) -> None:
    """The change is fret-local: no other head may move by a single float."""
    roi26, no_token = build_pair(device)
    with torch.no_grad():
        out_a, out_b = roi26(batch), no_token(batch)
    for name in ("object_type", "string", "tile"):
        assert torch.equal(out_a[name], out_b[name]), f"{name} logits changed"


def test_fret_logits_differ(device: Device, batch, pair) -> None:
    roi26, no_token = pair
    with torch.no_grad():
        assert not torch.equal(roi26(batch)["fret"], no_token(batch)["fret"])


def test_only_the_token_term_differs(device: Device, batch) -> None:
    """The decisive test: each variant equals its own closed form exactly.

    Same crop, same encoder, same projection, same classifier. If both identities
    hold, the two variants differ by exactly ``+ tokens`` and by nothing else.
    """
    roi26, no_token = build_pair(device)
    with torch.no_grad():
        finest = roi26.base.backbone(batch["images"].flatten(0, 1))[0]
        crops = roi_crops(
            finest, batch["boxes"], batch["object_mask"], roi26.grid, roi26.context
        )
        encoded = roi26.encoder(
            crops, batch["object_mask"], roi26.grid, roi26.base.backbone.output_channels[0]
        )
        flat = encoded.flatten(-2)
        # `shared_tokens` samples from `self.features`, which `forward` normally
        # assigns. This test calls the stages directly, so it must do the same or
        # the sampler has nothing to read.
        roi26.features = roi26.base.backbone(batch["images"].flatten(0, 1))
        tokens = roi26.shared_tokens(batch, roi26.features[0])

        expected_no_token = roi26.fret_classifier(roi26.roi_projection(flat))
        expected_roi26 = roi26.fret_classifier(roi26.roi_projection(flat) + tokens)

        assert torch.allclose(no_token(batch)["fret"], expected_no_token, atol=1e-5)
        assert torch.allclose(roi26(batch)["fret"], expected_roi26, atol=1e-5)
        # And the two closed forms really differ, so the assertion has teeth.
        assert not torch.allclose(expected_no_token, expected_roi26, atol=1e-3)


def test_token_contribution_is_the_whole_difference(device: Device, batch, pair) -> None:
    roi26, no_token = pair
    with torch.no_grad():
        gap = (roi26(batch)["fret"] - no_token(batch)["fret"]).abs().max()
    assert float(gap) > 1e-3


def test_loss_terms_and_routing_are_identical(device: Device, batch) -> None:
    """Same supervised terms, same 26-way routing, no slots and no presence head."""
    roi26, no_token = build_pair(device)
    with torch.no_grad():
        _, parts_a = fret_loss(roi26(batch), batch)
        _, parts_b = fret_loss(no_token(batch), batch)
        out = no_token(batch)
    assert set(parts_a) == set(parts_b) == {"object_type", "string", "fret"}
    assert parts_b["fret"] > 0.0
    assert "slots" not in out and "presence" not in out
    assert out["fret"].shape[-1] == 26
    assert torch.equal(decode(out), out["fret"].argmax(-1))


def test_loss_weights_are_all_one(device: Device, batch) -> None:
    """`fret_loss` sums the parts, so every weight is 1 by construction.

    Asserted rather than trusted: a silent reweight is exactly the confound this
    experiment must not introduce. The total must equal the sum of the parts.
    """
    _, no_token = build_pair(device)
    with torch.no_grad():
        total, parts = fret_loss(no_token(batch), batch)
    assert float(total) == pytest.approx(sum(parts.values()), rel=1e-5)


def test_gradients_reach_the_roi_path(device: Device, batch) -> None:
    """The dedicated ROI branch must still train end to end."""
    _, no_token = build_pair(device)
    model = no_token
    model.train()
    out = model(batch)
    loss, _ = fret_loss(out, batch)
    model.zero_grad(set_to_none=True)
    loss.backward()
    for name, module in (
        ("encoder", model.encoder.body[0]),
        ("roi_projection", model.roi_projection),
        ("fret_classifier", model.fret_classifier),
    ):
        assert module.weight.grad is not None, f"{name} received no gradient"
        assert float(module.weight.grad.abs().sum()) > 0.0, f"{name} gradient is zero"


def test_the_fret_term_alone_no_longer_reaches_the_token_path(
    device: Device, batch
) -> None:
    """The precise claim behind the deletion, isolated from the other loss terms.

    `object_type` and `string` also read `tokens`, so the full loss legitimately
    trains the context layers. What must be true is narrower: the **fret** term
    alone no longer touches the token path. Verified by backpropagating only that
    term and requiring exactly zero gradient in the shared token modules.
    """
    _, no_token = build_pair(device)
    model = no_token
    model.train()
    out = model(batch)
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    fret_only = F.cross_entropy(out["fret"][is_fret], batch["fret"][is_fret])
    model.zero_grad(set_to_none=True)
    fret_only.backward()

    token_path = []
    for name, parameter in model.named_parameters():
        if name.startswith(("base.sampler.", "base.tab_sampler.", "base.context.",
                            "base.final_norm.", "base.geometry_projection.",
                            "base.visual_projection.")):
            token_path.append((name, parameter))
    assert token_path, "no token-path parameters were found to check"
    for name, parameter in token_path:
        assert parameter.grad is None or float(parameter.grad.abs().sum()) == 0.0, (
            f"{name} received gradient from the fret term alone"
        )


def test_geometry_branch_no_longer_reaches_the_fret_head(device: Device, batch) -> None:
    """A falsifiable prediction, asserted now so it cannot be reinterpreted later.

    `roi26`'s token contains `geometry_projection(boxes)`, so zeroing geometry must
    move its fret logits. This variant's fret head never reads the token, so zeroing
    geometry must move its fret logits by nothing. That makes a geometry-neutralised
    control a clean test here rather than a caveat to be explained away.
    """
    roi26, no_token = build_pair(device)
    with torch.no_grad():
        base_roi26 = roi26(batch)["fret"].clone()
        base_no_token = no_token(batch)["fret"].clone()

        restored = []
        for model in (roi26, no_token):
            projection = model.base.geometry_projection
            original = projection.forward

            def blanked(_module, boxes, _original=original):
                return _original(boxes) * 0.0

            projection.forward = types.MethodType(blanked, projection)
            restored.append((projection, original))

        try:
            zeroed_roi26 = roi26(batch)["fret"]
            zeroed_no_token = no_token(batch)["fret"]
        finally:
            for projection, original in restored:
                projection.forward = original

    assert not torch.allclose(base_roi26, zeroed_roi26, atol=1e-3)
    assert torch.allclose(base_no_token, zeroed_no_token, atol=1e-6)


def test_shared_model_underneath_is_unmodified(device: Device) -> None:
    """The full `shared` model is still there, with its samplers and config intact."""
    _, no_token = build_pair(device)
    for attribute in ("sampler", "tab_sampler", "geometry_projection",
                      "visual_projection", "source_projection", "backbone"):
        assert hasattr(no_token.base, attribute), f"{attribute} missing"
    assert no_token.base.config.hidden == 192
    assert no_token.base.config.layers == 4
    assert no_token.base.config.image_width == 256
    assert no_token.base.config.max_objects == 128
    assert set(no_token.base.heads) == {"object_type", "string", "fret", "tile"}


def test_training_step_is_finite_on_a_real_batch(device: Device, batch) -> None:
    torch.manual_seed(SEED)
    _, no_token = build_pair(device)
    model = no_token
    model.train()
    optimiser = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
    for _ in range(3):
        out = model(batch)
        loss, parts = fret_loss(out, batch)
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimiser.step()
    assert torch.isfinite(loss)
    assert all(torch.isfinite(torch.tensor(v)) for v in parts.values())
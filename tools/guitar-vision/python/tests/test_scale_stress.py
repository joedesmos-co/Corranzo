"""Unit tests for deterministic scale-stress transforms.

These tests cover only the fixed audit operations. They do not import the corpus,
evaluate held-out data, train anything, or modify production behavior.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.scale_stress import (  # noqa: E402
    accuracy_by_subset,
    attenuate_contrast,
    downsample_then_upsample,
    gaussian_blur,
    perturb_crop,
    severity_levels,
)


def test_severity_lattice_is_fixed_and_monotone() -> None:
    levels = severity_levels()
    assert [level.name for level in levels] == [
        "native", "mild", "moderate", "strong", "severe", "very-severe", "extreme"]
    factors = [level.resolution for level in levels]
    assert factors == sorted(factors, reverse=True)
    assert factors[0] == 1.0
    assert factors[-1] == 0.25
    assert all(level.source == "fixed-lattice" for level in levels)


def test_native_level_is_exactly_identity() -> None:
    crop = torch.linspace(0.0, 1.0, 32 * 32).reshape(32, 32)
    native = severity_levels()[0]
    assert native.blur_sigma == 0.0
    assert native.contrast == 1.0
    assert torch.equal(perturb_crop(crop, native), crop)


def test_degradation_transforms_preserve_geometry_and_range() -> None:
    torch.manual_seed(11)
    crop = torch.rand(32, 32)
    for factor, sigma, contrast in [(0.5, 0.25, 0.75), (0.32, 0.9, 0.55)]:
        output = attenuate_contrast(
            gaussian_blur(downsample_then_upsample(crop, factor), sigma), contrast)
        assert output.shape == (32, 32)
        assert float(output.min()) >= 0.0
        assert float(output.max()) <= 1.0
        # Severe degradation must be observable, but the transform must not erase
        # the whole field.
        assert float((output - crop).abs().mean()) > 1e-4
        assert float(output.std()) > 1e-4


def test_repeated_application_is_bitwise_deterministic() -> None:
    torch.manual_seed(7)
    crop = torch.rand(32, 32)
    level = severity_levels()[4]
    assert torch.equal(perturb_crop(crop, level), perturb_crop(crop, level))


def test_invalid_parameters_fail_closed() -> None:
    crop = torch.zeros(32, 32)
    for bad in (0.0, -0.25, 1.25):
        try:
            downsample_then_upsample(crop, bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"resolution {bad} was accepted")
    for bad in (-0.1,):
        try:
            gaussian_blur(crop, bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"sigma {bad} was accepted")


def test_subset_accuracy_reports_only_selected_rows() -> None:
    prediction = np.array([0, 1, 1, 0])
    labels = np.array([0, 1, 0, 0])
    mask = np.array([True, True, False, False])
    assert accuracy_by_subset(prediction, labels, mask) == {
        "accuracy": 1.0, "correct": 2, "total": 2}

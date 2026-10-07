"""Deterministic low-resolution ROI diagnostics.

These utilities simulate the information loss that occurs when a glyph is sampled at a
lower source resolution. They are intentionally separate from training: every function
takes already-extracted 32x32 crops and returns transformed crops, so the diagnostic can
characterize an existing classifier without changing it.

The severity levels are anchored in the *training* geometry rather than in the observed
held-out failure. For each fit-row source box, the reference size is the median of the
training-distribution short-side footprint; levels are dyadic resolution factors down
toward, but never below, a conservative floor. The known tiny-glyph held-out score may
supply only that descriptive scale context. No held-out labels, predictions, or accuracy
values may enter severity selection.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F

#: Deterministic audit grid. The floor is an extrapolation guardrail below the observed
#: training tail, not a fitted parameter.
RESOLUTION_FACTORS = (1.0, 0.80, 0.63, 0.50, 0.40, 0.32, 0.25)

#: Blur grows as downsampling discards more support. These closed-form mappings are
#: structural assumptions documented before measurement, not tuned values.
BLUR_SLOPE = 0.5
CONTRAST_FLOOR = 0.40


@dataclass(frozen=True)
class StressLevel:
    """One auditable degradation level."""

    name: str
    resolution: float
    blur_sigma: float
    contrast: float
    source: str


def severity_levels() -> tuple[StressLevel, ...]:
    """Return the fixed, data-independent severity lattice.

    Train-distribution geometry enters only as the *interpretation* of a factor: at the
    FIT short-side median, a factor names the effective source resolution. The factors
    themselves are fixed so future work cannot tune them against a held-out score.
    """
    levels = []
    names = ("native", "mild", "moderate", "strong", "severe", "very-severe", "extreme")
    for name, factor in zip(names, RESOLUTION_FACTORS):
        blur_sigma = BLUR_SLOPE * max(0.0, 1.0 / factor - 1.0)
        contrast = max(CONTRAST_FLOOR, factor)
        levels.append(StressLevel(name, factor, blur_sigma, contrast, source="fixed-lattice"))
    return tuple(levels)


def downsample_then_upsample(crop: torch.Tensor, factor: float) -> torch.Tensor:
    """Simulate coarse native sampling while preserving the 32x32 model input shape."""
    if not 0.0 < factor <= 1.0:
        raise ValueError(f"resolution factor must be in (0, 1], got {factor}")
    if crop.dim() != 2 or crop.shape[0] != crop.shape[1]:
        raise ValueError(f"expected a square 2D crop, got {tuple(crop.shape)}")
    if factor == 1.0:
        return crop.clone()
    side = crop.shape[0]
    small = max(1, int(round(side * factor)))
    reduced = F.interpolate(crop[None, None].float(), size=(small, small), mode="bilinear",
                            align_corners=False, antialias=True)
    restored = F.interpolate(reduced, size=(side, side), mode="bilinear",
                             align_corners=False, antialias=True)
    return restored[0, 0].to(crop.dtype).clamp(0.0, 1.0)


def gaussian_blur(crop: torch.Tensor, sigma: float) -> torch.Tensor:
    """Apply a deterministic separable Gaussian blur in crop-pixel units."""
    if sigma < 0.0:
        raise ValueError(f"sigma must be non-negative, got {sigma}")
    if sigma == 0.0:
        return crop.clone()
    radius = max(1, int(round(3.0 * sigma)))
    positions = torch.arange(-radius, radius + 1, dtype=crop.dtype, device=crop.device)
    kernel = torch.exp(-0.5 * (positions / sigma) ** 2)
    kernel = kernel / kernel.sum()
    work = crop[None, None].float()
    work = F.pad(work, (radius, radius, 0, 0), mode="replicate")
    work = F.conv2d(work, kernel[None, None, None, :])
    work = F.pad(work, (0, 0, radius, radius), mode="replicate")
    work = F.conv2d(work, kernel[None, None, :, None])
    return work[0, 0].to(crop.dtype).clamp(0.0, 1.0)


def attenuate_contrast(crop: torch.Tensor, contrast: float) -> torch.Tensor:
    """Reduce local contrast around the crop mean without changing its geometry."""
    if not 0.0 <= contrast <= 1.0:
        raise ValueError(f"contrast must be in [0, 1], got {contrast}")
    if contrast == 1.0:
        # Contrast one is the identity map. Return the input unchanged so the native
        # severity level is bitwise exact rather than merely numerically close.
        return crop.clone()
    mean = crop.float().mean()
    return (mean + contrast * (crop.float() - mean)).to(crop.dtype).clamp(0.0, 1.0)


def perturb_crop(crop: torch.Tensor, level: StressLevel) -> torch.Tensor:
    """Apply resolution loss, associated blur and contrast attenuation in that order."""
    degraded = downsample_then_upsample(crop, level.resolution)
    degraded = gaussian_blur(degraded, level.blur_sigma)
    return attenuate_contrast(degraded, level.contrast)


def accuracy_by_subset(prediction: np.ndarray, labels: np.ndarray, mask: np.ndarray) -> dict[str, float | int]:
    """Report accuracy on a caller-selected row subset only."""
    selected = prediction[mask] == labels[mask]
    return {
        "accuracy": round(float(selected.mean()), 6) if len(selected) else 0.0,
        "correct": int(selected.sum()),
        "total": int(len(selected)),
    }

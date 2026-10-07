"""S2 knee probe (FIT/SAME only; frozen production head; no training, no held-out).

Locates where recognition collapses as effective glyph resolution falls, using a
fine factor grid around the 1.0->0.8 cliff seen in the frozen lattice. Informs the
input-quality-gate threshold methodology, not model selection.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.inference import load as load_model  # noqa: E402
from guitar_vision.roi import ROI_CROP  # noqa: E402
from guitar_vision.scale_stress import (  # noqa: E402
    BLUR_SLOPE,
    CONTRAST_FLOOR,
    accuracy_by_subset,
    downsample_then_upsample,
    gaussian_blur,
    attenuate_contrast,
)
from scale_stress_benchmark import (  # noqa: E402
    ARTIFACT,
    extract_train_crops,
    train_dev_masks,
    train_geometries,
)
from guitar_vision.dataset import load_dataset  # noqa: E402

FACTORS = (1.0, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.63, 0.50)


def main() -> int:
    model = load_model(ARTIFACT, "cpu")
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(256, 256), limit=0)
    labels, fit_mask, same_mask, _ = train_dev_masks()
    matrix = extract_train_crops(everything, model)
    native_median = train_geometries(everything)["median"]
    model._model.roi_head.eval()
    tensors = torch.from_numpy(matrix).reshape(-1, ROI_CROP, ROI_CROP)
    print(f"FIT short-side median {native_median}px; n_fit {int(fit_mask.sum())} "
          f"n_same {int(same_mask.sum())}")
    with torch.no_grad():
        for factor in FACTORS:
            sigma = BLUR_SLOPE * max(0.0, 1.0 / factor - 1.0)
            contrast = max(CONTRAST_FLOOR, factor)
            out = []
            for crop in tensors:
                degraded = downsample_then_upsample(crop, factor)
                degraded = gaussian_blur(degraded, sigma)
                out.append(attenuate_contrast(degraded, contrast))
            perturbed = torch.stack(out).reshape(len(tensors), -1)
            prediction = model._model.roi_head(perturbed).argmax(-1).numpy()
            fit = accuracy_by_subset(prediction, labels[:767], fit_mask)
            same = accuracy_by_subset(prediction, labels[:767], same_mask)
            print(f"factor {factor:.2f} eff {native_median * factor:5.1f}px "
                  f"fit {fit['accuracy']:.4f} same {same['accuracy']:.4f}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

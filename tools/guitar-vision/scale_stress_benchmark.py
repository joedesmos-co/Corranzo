"""Train/dev-only scale-stress benchmark for the dedicated raw-ROI fret branch.

This script characterizes an already-trained head; it does not train, fine-tune, alter,
select, or otherwise modify any model. It reports only FIT and SAME-SCORE objects. It
never loads, extracts, scores, labels, or aggregates the 395 score-disjoint held-out
objects.

## What it measures

Each 32x32 validated crop is deterministically degraded to simulate a lower native glyph
sampling rate, then returned to 32x32 before the frozen head sees it. The perturbations
are fixed audit transforms, not tunable augmentation:

- uniform source-resolution downsampling, then bilinear restoration;
- Gaussian blur proportional to the lost support;
- contrast attenuation proportional to the retained resolution.

Severity levels are relative sampling factors:

    (1.00, 0.80, 0.63, 0.50, 0.40, 0.32, 0.25)

At the FIT short-side training median of 39.21 source pixels, these correspond to
effective glyph sampling of approximately 39.2, 31.4, 24.7, 19.6, 15.7, 12.5 and 9.8
pixels. The floor is intended as a conservative descriptive marker near the previously
observed tiny-glyph scale range. That observation supplies only the range; it supplies no
labels and no performance target, and the held-out score itself never enters this script.

Using perturbations of the model *input* is different from changing model behavior. The
production dedicated CNN is unchanged here.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.inference import load as load_model  # noqa: E402
from guitar_vision.roi import ROI_CROP  # noqa: E402
from guitar_vision.scale_stress import accuracy_by_subset, perturb_crop, severity_levels

ARTIFACT = Path("tmp/gvprobe/dedicated-roi-production.pt")
SPLIT_MATRIX = Path("tmp/gvprobe/P_std_step1200.npz")
OUT = Path("tmp/gvprobe/scale-stress-train-dev.json")


def train_dev_masks() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return FIT and SAME masks restricted to the first 767 train objects.

    The cached matrix merely supplies the established split keys. No held-out row is
    included in any returned mask.
    """
    blob = np.load(SPLIT_MATRIX)
    scores, page, row = blob["scores"], blob["page"], blob["row"]
    labels = blob["labels"]
    fit, same, held, _ = d8.splits(scores, page, row)
    if (int(fit.sum()), int(same.sum()), int(held.sum())) != (614, 153, 395):
        raise SystemExit("split does not match the validated 614/153/395 partition")
    train_positions = np.arange(767)
    return labels, fit[:767], same[:767], train_positions


def train_geometries(everything) -> dict[str, float]:
    """Summarize FIT source-box footprints in plane pixels. Train data only."""
    blob = np.load(SPLIT_MATRIX)
    scores, page, row = blob["scores"], blob["page"], blob["row"]
    fit, _, _, _ = d8.splits(scores, page, row)
    order = []
    for page_index, sample in enumerate(everything[:40]):
        keep = (sample["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()
        order.extend([(page_index, fret_row) for fret_row in keep])
    if len(order) != int(fit[:767].sum() + 153):
        raise SystemExit("live train extraction order does not match the split matrix")
    shorts = []
    for position, (page_index, fret_row) in enumerate(order):
        if not fit[position]:
            continue
        x0, y0, x1, y1 = everything[page_index]["boxes"][fret_row].tolist()
        shorts.append(min((x1 - x0) * 256.0, (y1 - y0) * 256.0))
    shorts = np.asarray(shorts)
    return {
        "count": int(len(shorts)),
        "median": round(float(np.median(shorts)), 3),
        "p25": round(float(np.percentile(shorts, 25)), 3),
        "p10": round(float(np.percentile(shorts, 10)), 3),
        "minimum": round(float(shorts.min()), 3),
    }


def extract_train_crops(everything, model) -> np.ndarray:
    """Extract the 767 train fret crops through the production loader."""
    rows = []
    with torch.no_grad():
        for page in everything[:40]:
            crops = model._model.roi_crops(collate([page], model._max_objects()))
            keep = (page["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()
            rows.append(crops[0, keep].numpy())
    matrix = np.concatenate(rows).astype(np.float32)
    if matrix.shape != (767, 1024):
        raise SystemExit(f"expected 767 train crops, got {matrix.shape}")
    for name, parameter in model._model.named_parameters():
        if parameter.requires_grad:
            raise SystemExit(f"benchmark must not leave parameters trainable: {name}")
    return matrix


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, default=ARTIFACT)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    if not args.artifact.exists():
        raise SystemExit(f"production artifact is missing: {args.artifact}")

    model = load_model(args.artifact, "cpu")
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(256, 256), limit=0)
    labels, fit_mask, same_mask, _ = train_dev_masks()
    matrix = extract_train_crops(everything, model)
    geometries = train_geometries(everything)
    native_median = geometries["median"]
    model._model.roi_head.eval()

    report = {
        "artifact": str(args.artifact),
        "checkpoint_sha256": model.checkpoint_sha256,
        "scope": "FIT and SAME-SCORE objects only; no 395-row held-out evaluation",
        "geometry": geometries,
        "native_short_side_reference_px": native_median,
        "severity": [],
    }
    with torch.no_grad():
        tensors = torch.from_numpy(matrix).reshape(-1, ROI_CROP, ROI_CROP)
        for level in severity_levels():
            perturbed = torch.stack([perturb_crop(crop, level) for crop in tensors])
            perturbed = perturbed.reshape(len(tensors), -1)
            prediction = model._model.roi_head(perturbed).argmax(-1).numpy()
            fit = accuracy_by_subset(prediction, labels[:767], fit_mask)
            same = accuracy_by_subset(prediction, labels[:767], same_mask)
            report["severity"].append({
                "name": level.name,
                "resolution": level.resolution,
                "blur_sigma": level.blur_sigma,
                "contrast": level.contrast,
                "effective_median_short_side_px": round(native_median * level.resolution, 3),
                "fit": fit,
                "same_score": same,
            })
            print(f"{level.name:<11} resolution {level.resolution:.2f} "
                  f"fit {fit['accuracy']:.4f} same {same['accuracy']:.4f}", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"wrote {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"""Production regressions for the dedicated raw-ROI fret path.

These tests verify integration only. The scientific baseline lives at commit
``97720548c375e444c60bfc773b7b5e89a5bcbb5f``; this file must not train, retrain, tune,
or otherwise alter that result.
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.inference import (  # noqa: E402
    DEDICATED_FRET_MODEL,
    DEDICATED_ROI_FORMAT,
    DEDICATED_ROI_FORMAT_VERSION,
    DEDICATED_ROI_KIND,
    INTERVENTIONS,
    CheckpointFormatError,
    DedicatedRoiMetadata,
    GuitarFretModel,
    MultiPageBatchError,
    load,
)
from guitar_vision.qualify import Device  # noqa: E402
from guitar_vision.roi import ROI_CONTEXT, ROI_CROP  # noqa: E402

_REPO = Path(__file__).resolve().parents[4]
_RECORDS = _REPO / "datasets/guitar-vision/synthetic/train/records"
_VIEWS = _REPO / "datasets/guitar-vision/synthetic/train/views"
ARTIFACT = _REPO / "tmp/gvprobe/dedicated-roi-production.pt"
EXPERIMENTAL_HEAD = _REPO / "tmp/gvprobe/dedicated-roi-ckpt/head.pt"
PHASE1 = _REPO / "tmp/gvprobe/std-ckpt/step1200/state.pt"
BASELINE_COMMIT = "97720548c375e444c60bfc773b7b5e89a5bcbb5f"


def _require(path: Path) -> None:
    if not path.exists():
        pytest.skip(f"{path} not present")


def _valid_payload() -> dict:
    return {
        "format": DEDICATED_ROI_FORMAT,
        "format_version": DEDICATED_ROI_FORMAT_VERSION,
        "variant": DEDICATED_ROI_KIND,
        "architecture": {
            "name": "RoiFretCnn",
            "version": "roi-fret-cnn/v1",
            "input_channels": 1,
            "crop": ROI_CROP,
            "widths": [32, 64, 128],
            "spatial_pooling": "AdaptiveAvgPool2d(1)->Flatten",
            "output_classes": 26,
            "parameter_count": 96_474,
        },
        "roi_extraction": {
            "name": "sample_roi",
            "version": "roi-sample/v1",
            "crop": ROI_CROP,
            "context": ROI_CONTEXT,
            "interpolation": "bilinear",
            "align_corners": False,
            "padding_mode": "zeros",
        },
        "model": {"roi_head.head.weight": torch.zeros(26, 128)},
        "model_config": {
            "image_size": 256,
            "max_objects": 128,
            "hidden": 192,
            "layers": 4,
            "roi_grid": 8,
            "roi_context": 1.6,
        },
        "training": {
            "seed": 11,
            "steps": 3000,
            "batch": 64,
            "optimizer": "Adam",
            "learning_rate": 0.001,
            "weight_decay": 0.0,
            "schedule": "none",
            "split": {"fit": 614, "same_score": 153, "score_disjoint": 395},
            "split_scores": {
                "train": [f"train-{index:02d}" for index in range(40)],
                "held_out": [f"held-{index:02d}" for index in range(20)],
            },
            "experiment_commit": BASELINE_COMMIT,
            "source_phase1": {
                "path": "tmp/gvprobe/std-ckpt/step1200/state.pt",
                "sha256": "0" * 64,
                "step": 1200,
                "variant": "FROZEN_RANDOM_ROI_ENCODER_STANDARDIZED",
            },
            "source_head_checkpoint": {
                "path": "tmp/gvprobe/dedicated-roi-ckpt/head.pt",
                "sha256": "1" * 64,
            },
            "reference_metrics": {"score_disjoint": 0.926582},
        },
        "vocabulary": {
            "name": "guitar-fret-vocabulary",
            "version": "guitar-fret-vocabulary/v1",
            "classes": 26,
            "represented": list(range(20)),
            "unused": [20, 21, 22, 23, 24, 25],
            "semantics": "test-only",
        },
        "provenance": {"source": "unit-test"},
    }


@pytest.fixture(scope="module")
def device() -> Device:
    return Device("cpu")


@pytest.fixture(scope="module")
def pages() -> list[dict[str, torch.Tensor]]:
    if not _RECORDS.exists():
        pytest.skip("synthetic corpus not present")
    return load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=12)


@pytest.fixture(scope="module")
def production() -> GuitarFretModel:
    _require(ARTIFACT)
    return load(ARTIFACT, "cpu")


# ---------------------------------------------------------------- format


def test_dedicated_checkpoint_loads_with_validated_metadata(production) -> None:
    assert production.dedicated is True
    assert production.two_phase is False
    assert production.variant == DEDICATED_ROI_KIND
    assert production.fret_path == "dedicated-raw-roi"
    metadata = production.metadata
    assert isinstance(metadata, DedicatedRoiMetadata)
    assert metadata.format == DEDICATED_ROI_FORMAT
    assert metadata.format_version == DEDICATED_ROI_FORMAT_VERSION
    assert metadata.experiment_commit == BASELINE_COMMIT
    assert metadata.head_parameter_count == 96_474
    assert metadata.split == {"fit": 614, "same_score": 153, "score_disjoint": 395}
    assert len(metadata.held_score_ids) == 20
    described = production.describe()
    assert described["metadata"]["fret_model"] == DEDICATED_FRET_MODEL
    assert described["metadata"]["training"]["held_score_ids"] == list(
        metadata.held_score_ids)


def test_incomplete_experimental_head_cannot_load_as_production() -> None:
    """The h82 head-only file is not a production checkpoint."""
    _require(EXPERIMENTAL_HEAD)
    with pytest.raises(CheckpointFormatError):
        load(EXPERIMENTAL_HEAD, "cpu")


@pytest.mark.parametrize("missing", [
    "architecture", "roi_extraction", "model", "model_config", "training",
    "vocabulary", "provenance",
])
def test_metadata_rejects_missing_top_level_keys(missing) -> None:
    payload = _valid_payload()
    payload.pop(missing)
    with pytest.raises(CheckpointFormatError):
        DedicatedRoiMetadata.from_checkpoint(payload)


@pytest.mark.parametrize("mutation", [
    {"format_version": 2},
    {"variant": "DEDICATED_ROI_FRET_EXPERIMENTAL"},
    {"architecture": {"parameter_count": 96_475}},
    {"roi_extraction": {"context": 1.7}},
    {"model_config": {"roi_grid": 0}},
    {"training": {"split": {"fit": 1, "same_score": 1, "score_disjoint": 1}}},
    {"vocabulary": {"classes": 20}},
])
def test_metadata_rejects_changed_provenance(mutation) -> None:
    payload = _valid_payload()
    for key, value in mutation.items():
        if isinstance(value, dict):
            payload[key] = {**payload[key], **value}
        else:
            payload[key] = value
    with pytest.raises(CheckpointFormatError):
        DedicatedRoiMetadata.from_checkpoint(payload)


def test_metadata_rejects_overlapping_or_misshapen_splits() -> None:
    payload = _valid_payload()
    payload["training"]["split_scores"]["held_out"] = (
        payload["training"]["split_scores"]["train"][:20])
    with pytest.raises(CheckpointFormatError):
        DedicatedRoiMetadata.from_checkpoint(payload)


# --------------------------------------------------------- crop provenance


def test_canonical_crop_matches_validated_probe_crop(pages) -> None:
    """The production crop must equal the probe-validation implementation."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    import h1_direct_roi_probe as h1_reference
    from guitar_vision.roi import sample_roi as canonical_roi

    batch = collate(pages[:1], 128)
    reference = h1_reference.sample_roi(
        batch["images"], batch["boxes"],
        torch.ones(batch["object_type"].shape[-1], dtype=torch.bool).unsqueeze(0),
        batch["view"], ROI_CROP)
    actual = canonical_roi(
        batch["images"], batch["boxes"], batch["object_mask"], batch["view"],
        ROI_CROP, ROI_CONTEXT)
    keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
    assert keep, "the provenance fixture unexpectedly contains no fret objects"
    assert float((reference[0, keep] - actual[0, keep]).abs().max()) == 0.0


# --------------------------------------- batch invariance and pagewise API


def _same_object_rows(page, wanted: int = 2) -> list[int]:
    rows = (page["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()
    assert len(rows) >= wanted
    return rows[:wanted]


def _branch_output(model, subset, target, row):
    position = next(index for index, page in enumerate(subset) if page is target)
    batch = collate(subset, model._max_objects())
    with torch.no_grad():
        crops = model._model.roi_crops(batch)
        logits = model._model.roi_head(crops)
    return crops[position, row].clone(), logits[position, row].clone()


def _varying_plane_pages(pages):
    counts = [(index, int(page["images"].shape[0])) for index, page in enumerate(pages)]
    by_planes = sorted(counts, key=lambda item: item[1])
    short = pages[by_planes[0][0]]
    tall = pages[by_planes[-1][0]]
    middle = pages[by_planes[len(by_planes) // 2][0]]
    assert len({short["score_id"], middle["score_id"], tall["score_id"]}) == 3
    assert short["images"].shape[0] != tall["images"].shape[0]
    return short, middle, tall


def test_raw_roi_branch_is_batch_invariant(production, pages) -> None:
    """The raw-ROI path must not inherit the shared padded-plane softmax bug."""
    production._model.eval()
    short, middle, tall = _varying_plane_pages(pages)
    target_rows = _same_object_rows(short)
    compositions = [
        [short],
        [short, tall],
        [tall, short],
        [short, middle, tall],
        [tall, middle, short],
    ]
    with torch.no_grad():
        base_crops, base_logits = _branch_output(production, [short], short, target_rows[0])
        for subset in compositions[1:]:
            crops, logits = _branch_output(production, subset, short, target_rows[0])
            assert torch.equal(crops, base_crops)
            assert torch.equal(logits, base_logits)
        # A second, independently addressed object on the same target page.
        base_crops, base_logits = _branch_output(production, [short], short, target_rows[1])
        for subset in compositions[1:]:
            crops, logits = _branch_output(production, subset, short, target_rows[1])
            assert torch.equal(crops, base_crops)
            assert torch.equal(logits, base_logits)


def test_multi_page_public_call_matches_single_page_calls(production, pages) -> None:
    subset = pages[:3]
    together = production.infer(subset)
    separate = [production.infer_page(page) for page in subset]
    assert len(together) == len(separate) == 3
    for combined, single in zip(together, separate):
        assert torch.equal(combined.fret_logits, single.fret_logits)
        assert combined.fret_numbers() == single.fret_numbers()


# -------------------------------------------------------- reload and heads


def test_production_checkpoint_reloads_deterministically(production, pages) -> None:
    _require(ARTIFACT)
    again = load(ARTIFACT, "cpu")
    assert again.checkpoint_sha256 == production.checkpoint_sha256
    for left, right in zip(production.infer(pages[:3]), again.infer(pages[:3])):
        assert torch.equal(left.fret_logits, right.fret_logits)
        assert torch.equal(left.object_type, right.object_type)


def test_unrelated_heads_match_phase1(production, pages) -> None:
    _require(PHASE1)
    phase1 = load(PHASE1, "cpu")
    for expected, actual in zip(
            production.infer(pages[:6]), phase1.infer(pages[:6])):
        for name in ("object_type", "string", "tile"):
            assert torch.equal(getattr(expected, name), getattr(actual, name))


# --------------------------------------------------------------- controls


def _accuracy(model, pages, intervention=None) -> float:
    correct = total = 0
    for page, prediction in zip(
            pages, model.infer(pages, intervention=intervention)):
        target = page["fret"]
        keep = prediction.is_fret
        correct += int((prediction.fret[keep] == target[keep]).sum())
        total += int(keep.sum())
    return correct / max(total, 1)


def test_normal_beats_each_pixel_control(production, pages) -> None:
    normal = _accuracy(production, pages[:3])
    for mode in INTERVENTIONS:
        assert _accuracy(production, pages[:3], mode) < normal - 0.10, mode


def test_ablation_removes_the_box_interior(pages) -> None:
    from guitar_vision.dataset import collate as collate_batch
    from guitar_vision.inference import _apply_intervention

    batch = collate_batch(pages[:1], 128)
    changed = _apply_intervention(batch, "pixel_ablation")
    changed_pixels = int((batch["images"] != changed["images"]).sum())
    assert changed_pixels > 10_000
    assert changed_pixels < 0.5 * batch["images"].numel()

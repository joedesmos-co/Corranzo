"""Production integration tests for `guitar_vision.inference`.

The two-phase recipe is validated; these tests are about the *integration*: that a
two-phase checkpoint loads with its provenance checked, that a legacy checkpoint keeps
its own behaviour without statistics being invented, that the statistics are read-only,
and that the page-at-a-time contract holds through the public API.

The page-at-a-time requirement is not a preference. The fret representation is not
batch-invariant (see ``test_batch_invariance_known_bug.py``), so a batched forward would
return representations that depend on the batch's composition.
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.dataset import load_dataset  # noqa: E402
from guitar_vision.inference import (  # noqa: E402
    INTERVENTIONS,
    TWO_PHASE_FORMAT,
    CheckpointFormatError,
    GuitarFretModel,
    MultiPageBatchError,
    TwoPhaseMetadata,
    load,
)
from guitar_vision.qualify import Device  # noqa: E402

_REPO = Path(__file__).resolve().parents[4]
_RECORDS = _REPO / "datasets/guitar-vision/synthetic/train/records"
_VIEWS = _REPO / "datasets/guitar-vision/synthetic/train/views"
TWO_PHASE = _REPO / "tmp/gvprobe/two-phase-ckpt/phase2.pt"
LEGACY = _REPO / "tmp/gvprobe/frz-ckpt/step1200/state.pt"
PHASE1 = _REPO / "tmp/gvprobe/std-ckpt/step1200/state.pt"


def _require(path: Path) -> None:
    if not path.exists():
        pytest.skip(f"{path} not present")


@pytest.fixture(scope="module")
def pages() -> list[dict[str, torch.Tensor]]:
    if not _RECORDS.exists():
        pytest.skip("synthetic corpus not present")
    return load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=3)


@pytest.fixture(scope="module")
def two_phase() -> GuitarFretModel:
    _require(TWO_PHASE)
    return load(TWO_PHASE, "cpu")


# ------------------------------------------------------------ 1. checkpoint load


def test_two_phase_checkpoint_loads_with_validated_metadata(two_phase) -> None:
    assert two_phase.two_phase is True
    assert two_phase.variant == "TWO_PHASE_STANDARDIZED"
    metadata = two_phase.metadata
    assert metadata.format == TWO_PHASE_FORMAT
    assert len(metadata.phase1_sha256) == 64
    assert metadata.phase1_step == 1200
    assert metadata.phase2_step == 3000
    assert metadata.epsilon == 1e-6
    assert metadata.sample_count == 614.0
    assert metadata.split == {"fit": 614, "same_score": 153, "score_disjoint": 395}


def test_load_rejects_a_checkpoint_without_a_variant(tmp_path) -> None:
    payload = torch.load(TWO_PHASE, map_location="cpu", weights_only=False)
    payload = copy.deepcopy(payload)
    payload.pop("config")
    payload.pop("variant", None)
    path = tmp_path / "no_variant.pt"
    torch.save(payload, path)
    with pytest.raises(CheckpointFormatError):
        load(path, "cpu")


def test_load_rejects_missing_metadata_keys(tmp_path) -> None:
    payload = copy.deepcopy(torch.load(TWO_PHASE, map_location="cpu", weights_only=False))
    payload.pop("source_phase1")
    path = tmp_path / "missing_source.pt"
    torch.save(payload, path)
    with pytest.raises(CheckpointFormatError):
        load(path, "cpu")


def test_metadata_validation_rejects_bad_statistics(tmp_path) -> None:
    base = torch.load(TWO_PHASE, map_location="cpu", weights_only=False)

    def mutate(**changes):
        payload = copy.deepcopy(base)
        payload["statistics"] = {**payload["statistics"], **changes}
        return payload

    cases = {
        "non_positive_sigma": mutate(sigma=torch.zeros(192)),
        "wrong_length": mutate(mean=torch.zeros(3)),
        "bad_epsilon": mutate(eps=0.0),
        "bad_count": mutate(count=0.0),
    }
    for name, payload in cases.items():
        path = tmp_path / f"{name}.pt"
        torch.save(payload, path)
        with pytest.raises(CheckpointFormatError):
            load(path, "cpu")


def test_metadata_validation_rejects_bad_provenance(tmp_path) -> None:
    base = torch.load(TWO_PHASE, map_location="cpu", weights_only=False)

    payload = copy.deepcopy(base)
    payload["source_phase1"] = {**payload["source_phase1"], "sha256": "not-a-digest"}
    path = tmp_path / "bad_sha.pt"
    torch.save(payload, path)
    with pytest.raises(CheckpointFormatError):
        load(path, "cpu")

    payload = copy.deepcopy(base)
    payload["format"] = "guitar-vision-two-phase-v2"
    path = tmp_path / "bad_format.pt"
    torch.save(payload, path)
    with pytest.raises(CheckpointFormatError):
        load(path, "cpu")

    payload = copy.deepcopy(base)
    payload["variant"] = "shared"
    path = tmp_path / "bad_variant.pt"
    torch.save(payload, path)
    with pytest.raises(CheckpointFormatError):
        load(path, "cpu")


# ------------------------------------------------------- 2. legacy fallback


def test_legacy_checkpoint_keeps_legacy_behaviour() -> None:
    _require(LEGACY)
    model = load(LEGACY, "cpu")
    assert model.two_phase is False
    assert model.metadata is None
    # No statistics are fabricated and none are exposed.
    assert model.statistics() == {}
    assert not hasattr(model._model, "p_standardizer") or not model.two_phase


def test_legacy_checkpoint_still_runs(pages) -> None:
    _require(LEGACY)
    model = load(LEGACY, "cpu")
    prediction = model.infer_page(pages[0])
    assert prediction.fret.shape[0] == prediction.object_mask.shape[0]
    assert len(prediction.fret_numbers()) == int(prediction.is_fret.sum())


def test_two_phase_and_legacy_are_not_conflated() -> None:
    _require(TWO_PHASE)
    _require(LEGACY)
    assert load(TWO_PHASE, "cpu").two_phase is True
    assert load(LEGACY, "cpu").two_phase is False


# ----------------------------------------------- 3/4. read-only statistics


def test_statistics_are_read_only_across_inference(two_phase, pages) -> None:
    before = two_phase.statistics()
    two_phase.infer(pages)
    after = two_phase.statistics()
    for key in before:
        if torch.is_tensor(before[key]):
            assert torch.equal(before[key], after[key]), key
        else:
            assert before[key] == after[key], key


def test_statistics_match_the_checkpoint_exactly(two_phase) -> None:
    payload = torch.load(TWO_PHASE, map_location="cpu", weights_only=False)
    statistics = two_phase.statistics()
    assert torch.equal(statistics["mean"],
                       torch.as_tensor(payload["statistics"]["mean"]).double())
    assert torch.equal(statistics["sigma"],
                       torch.as_tensor(payload["statistics"]["sigma"]).double())
    assert statistics["sample_count"] == 614.0


def test_repeated_evaluation_does_not_move_statistics(two_phase, pages) -> None:
    """No held-out, blank or ablated page can reach mu or sigma."""
    before = two_phase.statistics()
    for mode in (None, *INTERVENTIONS):
        two_phase.infer(pages, intervention=mode)
    after = two_phase.statistics()
    for key in before:
        if torch.is_tensor(before[key]):
            assert torch.equal(before[key], after[key]), key
        else:
            assert before[key] == after[key], key


def test_standardizer_never_updates_in_any_mode(two_phase, pages) -> None:
    standardizer = two_phase._model.p_standardizer
    before = (standardizer.count.clone(), standardizer.mean.clone(), standardizer.sigma.clone())
    two_phase._model.train()
    two_phase.infer(pages)
    two_phase._model.eval()
    two_phase.infer(pages)
    assert torch.equal(standardizer.count, before[0])
    assert torch.equal(standardizer.mean, before[1])
    assert torch.equal(standardizer.sigma, before[2])


# --------------------------------------------- 5/6. one-page contract


def test_infer_page_returns_one_page(two_phase, pages) -> None:
    prediction = two_phase.infer_page(pages[0])
    expected_objects = pages[0]["boxes"].shape[0]
    assert prediction.fret.shape[0] == expected_objects
    assert prediction.fret_logits.shape == (expected_objects, 26)


def test_multi_page_call_is_pagewise_equivalent(two_phase, pages) -> None:
    """The contract: infer([A, B]) equals infer(A) followed by infer(B)."""
    both = two_phase.infer(pages[:2])
    first = two_phase.infer_page(pages[0])
    second = two_phase.infer_page(pages[1])
    assert torch.equal(both[0].fret_logits, first.fret_logits)
    assert torch.equal(both[1].fret_logits, second.fret_logits)
    assert both[0].fret_numbers() == first.fret_numbers()
    assert both[1].fret_numbers() == second.fret_numbers()


def test_infer_preserves_input_order(two_phase, pages) -> None:
    forward = two_phase.infer(pages)
    backward = two_phase.infer(list(reversed(pages)))
    for a, b in zip(forward, reversed(backward)):
        assert torch.equal(a.fret_logits, b.fret_logits)


def test_batched_forward_is_refused(two_phase, pages) -> None:
    """Explicit invariant, so the batch bug cannot be reintroduced silently."""
    with pytest.raises(MultiPageBatchError):
        two_phase.infer_batch(pages[:2])
    # One page is allowed through the explicit path.
    assert len(two_phase.infer_batch(pages[:1])) == 1


def test_batch_invariance_bug_is_real_through_the_public_api(two_phase, pages) -> None:
    """Documents *why* the refusal exists, measured rather than asserted.

    The model itself is batch-dependent, so this builds a two-page batch by hand and
    shows the representation moves. The production API avoids this by never batching.
    """
    from guitar_vision.dataset import collate
    from guitar_vision.fret_experiments import roi_crops

    def representation(page_subset):
        batch = collate(page_subset, two_phase._max_objects())
        batch = {k: (v.to("cpu") if torch.is_tensor(v) else v) for k, v in batch.items()}
        with torch.no_grad():
            two_phase._model(batch)
            crops = roi_crops(two_phase._model.features[0], batch["boxes"],
                              batch["object_mask"], 8, 1.6)
            encoded = two_phase._model.encoder(
                crops, batch["object_mask"], 8,
                two_phase._model.base.backbone.output_channels[0])
            p = two_phase._model.roi_projection(encoded.flatten(-2))
        keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
        return p[0, keep]

    alone = representation(pages[1:2])
    with_neighbour = representation(pages[1:3])
    delta = float((alone - with_neighbour).abs().max())
    assert delta > 1e-4, (
        "the batch-invariance bug appears to be fixed; if roi_crops now excludes padded "
        "planes, update this test and the module docstring rather than deleting it"
    )


# -------------------------------------------- 7. cached vs live representation


def test_live_representation_reproduces_the_cached_matrix(two_phase) -> None:
    """The production path must reproduce the matrix the head was trained on."""
    cached_path = _REPO / "tmp/gvprobe/P_std_step1200.npz"
    _require(cached_path)
    import numpy as np

    cached = np.load(cached_path)["P"].astype(np.float32)
    from guitar_vision.dataset import collate
    from guitar_vision.fret_experiments import roi_crops

    pages_all = load_dataset(_RECORDS, _VIEWS, size=(256, 256), limit=0)
    rows = []
    for page in pages_all:
        batch = collate([page], two_phase._max_objects())
        batch = {k: (v.to("cpu") if torch.is_tensor(v) else v) for k, v in batch.items()}
        with torch.no_grad():
            two_phase._model(batch)
            crops = roi_crops(two_phase._model.features[0], batch["boxes"],
                              batch["object_mask"], 8, 1.6)
            encoded = two_phase._model.encoder(
                crops, batch["object_mask"], 8,
                two_phase._model.base.backbone.output_channels[0])
            p = two_phase._model.roi_projection(encoded.flatten(-2))
        keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
        rows.append(p[0, keep].numpy())
    live = np.concatenate(rows)
    assert live.shape == cached.shape
    assert float(abs(live - cached).max()) < 1e-4


# ------------------------------------------------ 8. reload determinism


def test_reload_is_deterministic(two_phase, pages) -> None:
    _require(TWO_PHASE)
    again = load(TWO_PHASE, "cpu")
    a = two_phase.infer(pages)
    b = again.infer(pages)
    for left, right in zip(a, b):
        assert torch.equal(left.fret_logits, right.fret_logits)
    assert torch.equal(two_phase.statistics()["mean"], again.statistics()["mean"])
    assert torch.equal(two_phase.statistics()["sigma"], again.statistics()["sigma"])


def test_checkpoint_digest_is_reported(two_phase) -> None:
    assert len(two_phase.checkpoint_sha256) == 64
    assert two_phase.describe()["metadata"]["phase1_sha256"] == \
        two_phase.metadata.phase1_sha256


# --------------------------------------- 9/10/11. pixel causality controls


def _fret_accuracy(model, pages, intervention=None) -> float:
    correct = total = 0
    for page, prediction in zip(pages, model.infer(pages, intervention=intervention)):
        target = page["fret"]
        keep = prediction.is_fret
        correct += int((prediction.fret[keep] == target[keep]).sum())
        total += int(keep.sum())
    return correct / max(total, 1)


def test_normal_beats_every_visual_control(two_phase, pages) -> None:
    normal = _fret_accuracy(two_phase, pages)
    for mode in INTERVENTIONS:
        degraded = _fret_accuracy(two_phase, pages, mode)
        assert degraded < normal - 0.15, (
            f"{mode} scored {degraded:.4f} against normal {normal:.4f}; the model is "
            f"not depending on the correct pixels"
        )


def test_blank_and_wrong_roi_degrade_prediction(two_phase, pages) -> None:
    normal = _fret_accuracy(two_phase, pages)
    assert _fret_accuracy(two_phase, pages, "blank") < normal - 0.15
    assert _fret_accuracy(two_phase, pages, "wrong_roi") < normal - 0.15


def test_pixel_ablation_actually_changes_the_intended_pixels(pages) -> None:
    """The corrected ablation must remove a glyph-sized area, not two pixels.

    The old implementation read normalised boxes as pixel indices and ablated 2 pixels
    of 1,507,328, which measures as "ablation changes nothing". This pins the fix.
    """
    from guitar_vision.dataset import collate
    from guitar_vision.inference import _apply_intervention

    batch = collate(pages[:1], 128)
    ablated = _apply_intervention(batch, "pixel_ablation")
    changed = int((batch["images"] != ablated["images"]).sum())
    total = batch["images"].numel()
    assert changed > 10_000, f"only {changed} of {total} pixels changed"
    # And it must leave most of the page alone, or it is just a blank in disguise.
    assert changed < 0.5 * total


def test_pixel_ablation_degrades_prediction(two_phase, pages) -> None:
    normal = _fret_accuracy(two_phase, pages)
    assert _fret_accuracy(two_phase, pages, "pixel_ablation") < normal - 0.15


def test_unknown_intervention_is_rejected(two_phase, pages) -> None:
    with pytest.raises(ValueError):
        two_phase.infer_page(pages[0], intervention="shuffle")


# ------------------------------------------- 12. unrelated heads unchanged


def test_unrelated_heads_match_the_phase1_checkpoint(pages) -> None:
    _require(TWO_PHASE)
    _require(PHASE1)
    two_phase = load(TWO_PHASE, "cpu")
    phase1 = load(PHASE1, "cpu")
    a = two_phase.infer(pages)
    b = phase1.infer(pages)
    for left, right in zip(a, b):
        assert torch.equal(left.object_type, right.object_type)
        assert torch.equal(left.string, right.string)
        assert torch.equal(left.tile, right.tile)
    # The fret head is the only thing that differs.
    assert not torch.equal(a[0].fret_logits, b[0].fret_logits)


# ------------------------------------------------------------ device handling


def test_device_selection_is_explicit() -> None:
    _require(TWO_PHASE)
    model = GuitarFretModel.load(TWO_PHASE, Device("cpu"))
    assert model._device.name == "cpu"
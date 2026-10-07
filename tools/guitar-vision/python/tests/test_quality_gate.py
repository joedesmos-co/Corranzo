"""Regression tests for the fret input-quality gate.

The gate is a pure geometry layer: thresholds were frozen from FIT/SAME stress
tests before this file existed. No test here tunes anything. The tiny-glyph test
reads only box geometry of the known failure page — never its labels — and proves
the frozen gate would have refused it.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.dataset import load_dataset  # noqa: E402
from guitar_vision.inference import load as load_model  # noqa: E402
from guitar_vision.quality_gate import (  # noqa: E402
    GATE_VERSION,
    REJECT_BELOW,
    STRONG_WARN_BELOW,
    WARN_BELOW,
    GateClass,
    SourceType,
    assess_page,
    classify,
    effective_height_px,
    gate_fret_numbers,
)

REPO = Path(__file__).resolve().parents[4]
RECORDS = REPO / "datasets/guitar-vision/synthetic/train/records"
VIEWS = REPO / "datasets/guitar-vision/synthetic/train/views"
ARTIFACT = REPO / "tmp/gvprobe/dedicated-roi-production.pt"
TINY_SCORE = "synthetic-train-20260928052"


def test_accept_at_and_above_39() -> None:
    assert classify(39.0) == GateClass.ACCEPT
    assert classify(41.5) == GateClass.ACCEPT
    assert classify(100.0) == GateClass.ACCEPT


def test_warn_band_35_to_39() -> None:
    assert classify(37.2) == GateClass.WARN
    report = assess_page([37.2], "p", SourceType.RASTER)
    assert report.page_action == "process_with_warning"
    assert report.user_message is not None
    assert "39" not in report.user_message and "px" not in report.user_message


def test_strong_warn_band_31_to_35() -> None:
    assert classify(33.3) == GateClass.STRONG_WARN
    report = assess_page([33.3], "p", SourceType.PHOTO)
    assert report.page_action == "process_with_strong_warning"
    assert report.user_message is not None
    assert "33" not in report.user_message


def test_reject_below_31() -> None:
    for height in (8.5, 9.08, 30.9, 0.0):
        assert classify(height) == GateClass.REJECT
    report = assess_page([9.08], "p", SourceType.RASTER)
    assert report.page_action == "refuse_fret"
    assert report.refused_indices == [0]
    assert report.user_message is not None
    assert "31" not in report.user_message


def test_exact_boundaries() -> None:
    assert classify(REJECT_BELOW) == GateClass.STRONG_WARN
    assert classify(STRONG_WARN_BELOW) == GateClass.WARN
    assert classify(WARN_BELOW) == GateClass.ACCEPT
    assert classify(REJECT_BELOW - 0.001) == GateClass.REJECT
    assert classify(STRONG_WARN_BELOW - 0.001) == GateClass.STRONG_WARN
    assert classify(WARN_BELOW - 0.001) == GateClass.WARN


def test_mixed_quality_page_is_localized() -> None:
    report = assess_page([41.0, 37.0, 33.0, 8.5], "mixed", SourceType.RASTER,
                         object_indices=[3, 7, 9, 12])
    assert report.page_action == "process_with_refusals"
    assert report.refused_indices == [12]
    assert report.affected_indices == [7, 9, 12]
    assert report.objects[0].classification == GateClass.ACCEPT
    assert not report.objects[0].refused


def test_all_reject_page_refuses_fret() -> None:
    report = assess_page([9.0, 8.0, 20.0], "tiny", SourceType.RASTER)
    assert report.page_action == "refuse_fret"


def test_empty_page_processes() -> None:
    report = assess_page([], "empty", SourceType.UNKNOWN)
    assert report.page_action == "process"
    assert report.user_message is None


def test_gate_suppresses_only_rejects() -> None:
    assessments = assess_page([41.0, 37.0, 33.0, 8.5], "p").objects
    assert gate_fret_numbers([5, 12, 3, 7], list(assessments)) == [5, 12, 3, None]
    with pytest.raises(ValueError):
        gate_fret_numbers([5, 12], list(assessments))


def test_vector_copy_differs_raster_copy() -> None:
    raster = assess_page([9.0], "p", SourceType.RASTER).user_message
    vector = assess_page([9.0], "p", SourceType.VECTOR).user_message
    assert raster != vector
    assert "export" in (vector or "")


def test_quality_metadata_deterministic_and_complete() -> None:
    first = assess_page([41.0, 37.0, 8.5], "p", SourceType.RASTER)
    second = assess_page([41.0, 37.0, 8.5], "p", SourceType.RASTER)
    assert first == second
    json.dumps(first.diagnostics)  # serializable
    assert first.diagnostics["gate_version"] == GATE_VERSION
    assert first.diagnostics["thresholds_px"] == {
        "accept_at_least": WARN_BELOW, "strong_warn_at_least": STRONG_WARN_BELOW,
        "reject_below": REJECT_BELOW}
    assert first.diagnostics["source_type"] == "raster"
    assert first.diagnostics["counts"] == {
        "accept": 1, "warn": 1, "strong_warn": 0, "reject": 1}


@pytest.fixture(scope="module")
def pages() -> list:
    if not RECORDS.exists():
        pytest.skip("synthetic corpus not present")
    return load_dataset(RECORDS, VIEWS, size=(256, 256), limit=53)


@pytest.fixture(scope="module")
def production():
    if not ARTIFACT.exists():
        pytest.skip(f"{ARTIFACT} not present")
    return load_model(ARTIFACT, "cpu")


def _fret_heights(page) -> list[float]:
    rows = (page["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()
    return [float(page["boxes"][r][3] - page["boxes"][r][1]) * 256.0 for r in rows]


def test_gated_path_keeps_unrelated_heads(production, pages) -> None:
    page = pages[0]
    plain = production.infer_page(page)
    heights = _fret_heights(page)
    report = assess_page(heights, str(page["score_id"]), SourceType.UNKNOWN)
    assert report.page_action == "process"
    gated = gate_fret_numbers(plain.fret_numbers(), list(report.objects))
    assert gated == plain.fret_numbers()
    assert torch.equal(plain.object_type, production.infer_page(page).object_type)
    assert torch.equal(plain.string, production.infer_page(page).string)
    assert torch.equal(plain.tile, production.infer_page(page).tile)


def test_legacy_infer_still_returns_numbers_for_tiny_objects(production, pages) -> None:
    tiny = next(p for p in pages if str(p["score_id"]) == TINY_SCORE)
    plain = production.infer_page(tiny)
    assert len(plain.fret_numbers()) == 32  # legacy behavior unchanged; gate is opt-in


def test_known_tiny_glyph_failure_would_be_refused(pages) -> None:
    """Geometry only. Thresholds frozen; sample['fret'] labels never touched."""
    tiny = next(p for p in pages if str(p["score_id"]) == TINY_SCORE)
    heights = _fret_heights(tiny)  # boxes only — no labels enter this test
    assert len(heights) == 32
    assert max(heights) < REJECT_BELOW
    report = assess_page(heights, TINY_SCORE, SourceType.RASTER)
    assert report.page_action == "refuse_fret"
    assert report.refused_indices == list(range(32))
    assert report.user_message is not None

"""Decision-consistency for the glyph-normalization experiment.

Recomputes the preregistered CASE rule from the h89 report and pins the headline
numbers. Skips if the report is absent.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[4]
REPORT = REPO / "tmp/gvprobe/glyph-normalization.json"


def test_verdict_matches_preregistered_rule() -> None:
    if not REPORT.exists():
        pytest.skip(f"{REPORT} not present")
    report = json.loads(REPORT.read_text())
    lattice = report["lattice"]
    assert [entry["level"] for entry in lattice] == [
        "native", "mild", "moderate", "strong", "severe", "very-severe", "extreme"]
    degraded = [entry["fit"]["accuracy"] for entry in lattice[1:]]
    case_a = (report["fit_native"]["accuracy"] >= 0.999
              and report["same_native"]["accuracy"] >= 0.999
              and float(np.mean(degraded)) >= 0.50)
    native_harmed = (report["fit_native"]["accuracy"] < 0.999
                     or report["same_native"]["accuracy"] < 0.999)
    expected = "CASE A" if case_a else ("CASE B" if native_harmed else "CASE C")
    assert report["decision"]["verdict"] == expected
    assert report["decision"]["verdict"] == "CASE B"
    assert report["fit_native"] == {"accuracy": 1.0, "correct": 614, "total": 614}
    assert report["same_native"]["total"] == 153
    assert report["batch_invariance"] == {"repeat_equal": True}

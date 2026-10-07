"""Decision-consistency for the scale-robustness experiment.

Recomputes the preregistered CASE rule from the h86 report. The experiment scripts
themselves are untested harnesses (like h82); this guards the reported verdict only.
Skips if the report is absent.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[4]
REPORT = REPO / "tmp/gvprobe/scale-robustness.json"


def test_verdict_matches_preregistered_rule() -> None:
    if not REPORT.exists():
        pytest.skip(f"{REPORT} not present")
    report = json.loads(REPORT.read_text())
    lattice = report["lattice"]
    assert [entry["level"] for entry in lattice] == [
        "native", "mild", "moderate", "strong", "severe", "very-severe", "extreme"]
    degraded = [entry["fit"]["accuracy"] for entry in lattice[1:]]
    case_b = (report["fit_native"]["accuracy"] >= 0.999
              and report["same_native"]["accuracy"] >= 0.999
              and float(np.mean(degraded)) >= 0.50)
    assert report["decision"]["verdict"] == ("CASE B" if case_b else "CASE C")
    assert report["decision"]["verdict"] == "CASE C"
    assert report["fit_native"]["total"] == 614
    assert report["same_native"]["total"] == 153

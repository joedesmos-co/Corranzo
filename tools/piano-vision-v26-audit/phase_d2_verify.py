"""Re-export of the corpus-side staff-geometry verifier.

The module lives beside the corpus builder that enforces it
(`tools/real-pdf-adaptation/staff_geometry_verify.py`) so the gate and its
enforcement cannot drift apart. This alias exists only for audit scripts.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real-pdf-adaptation"))
from staff_geometry_verify import (  # noqa: F401,E402
    BandCheck, MAX_GAP_DISAGREEMENT, MAX_LEDGER_SPACES, MIN_BAND_LINES,
    check_band, check_measure, label_is_admissible, physical_ceiling_note,
)

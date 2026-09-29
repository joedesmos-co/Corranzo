"""Phase D2 - self-verifying staff geometry and label admissibility.

Every geometric claim the corpus makes about a notehead is checkable without
any model, and three of them are checkable against the DETECTED STAFF ALONE:

  1. Band membership. The object attributed to a band must be nearer that
     band's centre than the other band's. `build_corpus._closer` computes this
     to assign the object, so a label that disagrees with it means the label
     was emitted against the wrong object.

  2. Physical admissibility. A five-line staff is 4 staff spaces tall, and a
     notehead may sit on a ledger line above or below it, but only a few. A
     `stepsFromBandCenter` far outside that is not a notehead on that staff;
     it is a mis-attributed object. This is the invariant that catches the
     index-space bug that made half the corpus inadmissible.

  3. Band-local spacing agreement. The pooled `staff_space()` is a median over
     BOTH staves' lines. If a band's own implied gap disagrees with the pooled
     gap, every staff step in that band is scaled by the wrong factor.

None of these need ground truth, so they can gate the corpus before any
training label is written. Nothing here fabricates a value: a result that
fails a check is REFUSED, never repaired by guessing.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

# A five-line staff spans exactly 4 staff spaces. Ledger lines extend it; a
# notehead further than this from the band centre is not on that staff.
MAX_LEDGER_SPACES = 8.0
# A detected band whose own line spacing disagrees with the pooled gap by more
# than this factor has its staff steps scaled wrongly.
MAX_GAP_DISAGREEMENT = 1.35
MIN_BAND_LINES = 4


@dataclass
class BandCheck:
    role: str
    ok: bool
    center: float | None
    gap: float | None
    n_lines: int
    reasons: list[str] = field(default_factory=list)
    n_objects: int = 0
    k_min: float | None = None
    k_max: float | None = None

    def to_dict(self):
        return {
            "role": self.role, "ok": self.ok, "center": self.center, "gap": self.gap,
            "n_lines": self.n_lines, "reasons": sorted(set(self.reasons)),
            "n_objects": self.n_objects, "k_min": self.k_min, "k_max": self.k_max,
        }


def check_band(role, lines, pooled_gap, object_cy):
    """Verify one band against the analytic invariants, without ground truth."""
    ordered = sorted(float(v) for v in (lines or []))
    n = len(ordered)
    reasons = []
    if n < MIN_BAND_LINES:
        reasons.append("band_line_count_below_gate")
        return BandCheck(role, False, None, pooled_gap, n, reasons, len(object_cy))
    center = (ordered[0] + ordered[-1]) / 2.0
    local_gap = (ordered[-1] - ordered[0]) / 4.0
    if not pooled_gap or pooled_gap <= 1e-9:
        reasons.append("staff_space_missing")
    elif local_gap <= 1e-9:
        reasons.append("degenerate_band_span")
    else:
        ratio = local_gap / pooled_gap
        if ratio > MAX_GAP_DISAGREEMENT or ratio < 1.0 / MAX_GAP_DISAGREEMENT:
            reasons.append("band_gap_disagrees_with_pooled")
    ks = [(center - float(cy)) / pooled_gap for cy in object_cy] if pooled_gap else []
    ok = not reasons
    if ks:
        lo, hi = min(ks), max(ks)
        outside = [k for k in ks if abs(k) > MAX_LEDGER_SPACES]
        if outside:
            reasons.append("object_outside_ledger_envelope")
            ok = False
    else:
        lo = hi = None
    if reasons and ok is False and "object_outside_ledger_envelope" not in reasons:
        ok = False
    return BandCheck(role, ok, center, pooled_gap, n, reasons, len(object_cy), lo, hi)


def check_measure(centers, lines_by_role, pooled_gap, objects):
    """Verify both bands of one measure and return per-role verdicts.

    `objects` is the measure's FULL physical-object list. Band membership is
    recomputed here with the same nearest-centre rule the builder uses, so a
    label whose role disagrees with geometry is detectable downstream.
    """
    out = {}
    for role in ("upper", "lower"):
        lines = lines_by_role.get(role) or []
        member_cy = []
        if centers.get(role) is not None and centers.get(role) is not None:
            other = "lower" if role == "upper" else "upper"
            for obj in objects:
                cy = float(obj["center"]["y"])
                cu, cl = centers.get("upper"), centers.get("lower")
                if cu is None and cl is None:
                    continue
                if cu is None:
                    nearest = "lower"
                elif cl is None:
                    nearest = "upper"
                else:
                    nearest = "upper" if abs(cy - cu) <= abs(cy - cl) else "lower"
                if nearest == role:
                    member_cy.append(cy)
        out[role] = check_band(role, lines, pooled_gap, member_cy)
    return out


def label_is_admissible(check, role, object_index, objects, centers, pooled_gap):
    """Final per-label gate. Refuses rather than repairs."""
    reasons = []
    if not check.ok:
        reasons.extend(check.reasons)
    if not (0 <= object_index < len(objects)):
        return False, ["object_index_out_of_range"]
    cy = float(objects[object_index]["center"]["y"])
    cu, cl = centers.get("upper"), centers.get("lower")
    if cu is None and cl is None:
        reasons.append("no_band_centers")
    else:
        if cu is None:
            nearest = "lower"
        elif cl is None:
            nearest = "upper"
        else:
            nearest = "upper" if abs(cy - cu) <= abs(cy - cl) else "lower"
        if nearest != role:
            reasons.append("role_disagrees_with_nearest_band")
    if pooled_gap and pooled_gap > 1e-9 and centers.get(role) is not None:
        k = (centers[role] - cy) / pooled_gap
        if abs(k) > MAX_LEDGER_SPACES:
            reasons.append("staff_step_outside_ledger_envelope")
    return (not reasons), sorted(set(reasons))


def physical_ceiling_note():
    return (f"A five-line staff spans 4 staff spaces; with ledger lines an "
            f"admissible notehead lies within +/-{MAX_LEDGER_SPACES:g} staff "
            f"spaces of the band centre. Anything beyond that is not a notehead "
            f"on that staff.")

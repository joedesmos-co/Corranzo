"""Production input-quality gate for Guitar fret transcription.

Refuses or warns on fret glyphs whose effective resolution is outside the
empirically trustworthy range, instead of hallucinating fret numbers.

## Metric

``effective_height_px``: the fret object's box height in plane pixels,
``(y1 - y0) * 256`` for plane-normalized boxes. Height — not the min dimension —
because a 1-digit native glyph is 22-36 px wide yet transcribes at 1.000 (measured
h84/h87); a min-dimension gate would reject the reliable region itself. Cap height
is invariant to digit count and stable under the loader's horizontal tile squeeze.

## Thresholds (internal; provisional FIT/SAME-derived — see below)

- ``>= 39`` ACCEPT (measured 1.0000 at 39.2)
- ``35-39`` WARN (measured 0.23 at 37.2)
- ``31-35`` STRONG_WARN (measured 0.06-0.14)
- ``< 31`` REJECT (measured chance)

These come from one controlled FIT/SAME stress characterization, not from broad
real-world inputs. They must be recalibrated on real Guitar material before anyone
treats them as universal. The version string travels with every report so future
calibration can compare.

## Behavior

Per-object classification; the page takes the worst object severity, but only
REJECTED objects lose their fret numbers — the rest of the page still processes
(partial success). A page whose every fret object rejects gets REFUSE_FRET.
User-facing copy carries no pixel numbers; diagnostics carry everything.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

#: Internal thresholds in effective plane px. Provisional, FIT/SAME-derived.
REJECT_BELOW = 31.0
STRONG_WARN_BELOW = 35.0
WARN_BELOW = 39.0

GATE_VERSION = "fret-quality-gate/v1"
GATE_PROVENANCE = (
    "provisional thresholds from controlled FIT/SAME stress tests "
    "(reliable >= 39, knee 37.2 -> 0.23, chance <= 31.4); "
    "must be calibrated on broader real-world Guitar inputs"
)


class SourceType(str, Enum):
    """What the original source was. Recorded, never inferred here."""

    VECTOR = "vector"
    RASTER = "raster"
    PHOTO = "photo"
    UNKNOWN = "unknown"


class GateClass(str, Enum):
    ACCEPT = "accept"
    WARN = "warn"
    STRONG_WARN = "strong_warn"
    REJECT = "reject"


def effective_height_px(box: tuple[float, float, float, float]) -> float:
    """Fret glyph scale in plane pixels from a plane-normalized box."""
    return (box[3] - box[1]) * 256.0


def classify(height_px: float) -> GateClass:
    """Classify one effective height. Boundary-exact: thresholds belong up."""
    if height_px >= WARN_BELOW:
        return GateClass.ACCEPT
    if height_px >= STRONG_WARN_BELOW:
        return GateClass.WARN
    if height_px >= REJECT_BELOW:
        return GateClass.STRONG_WARN
    return GateClass.REJECT


def _user_message(worst: GateClass, affected: int, source: SourceType) -> str | None:
    if worst == GateClass.ACCEPT:
        return None
    better_source = (
        " Try a larger or higher-resolution export."
        if source == SourceType.VECTOR
        else " Try a higher-resolution PDF, scan, or photo."
    )
    if worst == GateClass.WARN:
        return ("Some fret numbers are a bit small, so a few may be less certain."
                if affected > 1 else
                "One fret number is a bit small, so it may be less certain.")
    if worst == GateClass.STRONG_WARN:
        return ("Some fret numbers are too small to read confidently." + better_source)
    return ("This TAB is too low-resolution to read reliably." + better_source
            if affected > 1 else
            "One fret number is too small to read reliably." + better_source)


@dataclass(frozen=True)
class ObjectAssessment:
    """Gate verdict for one fret object."""

    page_id: str
    object_index: int
    height_px: float
    classification: GateClass

    @property
    def refused(self) -> bool:
        """Only REJECT suppresses the fret number. Nothing else does."""
        return self.classification == GateClass.REJECT

    @property
    def low_confidence(self) -> bool:
        return self.classification in (GateClass.STRONG_WARN, GateClass.REJECT)


@dataclass(frozen=True)
class PageGateReport:
    """Whole-page gate verdict with localized affected objects."""

    page_id: str
    source_type: SourceType
    objects: tuple[ObjectAssessment, ...]
    page_action: str
    user_message: str | None
    diagnostics: dict = field(default_factory=dict)

    @property
    def refused_indices(self) -> list[int]:
        return [o.object_index for o in self.objects if o.refused]

    @property
    def affected_indices(self) -> list[int]:
        return [o.object_index for o in self.objects
                if o.classification != GateClass.ACCEPT]


def assess_page(
    heights_px: list[float],
    page_id: str,
    source_type: SourceType = SourceType.UNKNOWN,
    object_indices: list[int] | None = None,
) -> PageGateReport:
    """Assess every fret object on a page. Pure and deterministic."""
    indices = list(range(len(heights_px))) if object_indices is None else object_indices
    objects = tuple(
        ObjectAssessment(page_id=page_id, object_index=index,
                         height_px=round(height, 3), classification=classify(height))
        for index, height in zip(indices, heights_px))
    order = {GateClass.ACCEPT: 0, GateClass.WARN: 1,
             GateClass.STRONG_WARN: 2, GateClass.REJECT: 3}
    worst = max((o.classification for o in objects),
                key=lambda c: order[c], default=GateClass.ACCEPT)
    if not objects:
        action = "process"
    elif worst == GateClass.ACCEPT:
        action = "process"
    elif worst == GateClass.WARN:
        action = "process_with_warning"
    elif worst == GateClass.STRONG_WARN:
        action = "process_with_strong_warning"
    else:
        action = ("refuse_fret" if all(o.refused for o in objects)
                  else "process_with_refusals")
    affected = sum(1 for o in objects if o.classification != GateClass.ACCEPT)
    return PageGateReport(
        page_id=page_id, source_type=source_type, objects=objects,
        page_action=action,
        user_message=_user_message(worst, affected, source_type),
        diagnostics={
            "gate_version": GATE_VERSION,
            "gate_provenance": GATE_PROVENANCE,
            "thresholds_px": {"accept_at_least": WARN_BELOW,
                              "strong_warn_at_least": STRONG_WARN_BELOW,
                              "reject_below": REJECT_BELOW},
            "source_type": source_type.value,
            "counts": {cls.value: sum(1 for o in objects if o.classification == cls)
                       for cls in GateClass},
        })


def gate_fret_numbers(
    fret_numbers: list[int],
    assessments: list[ObjectAssessment],
) -> list[int | None]:
    """Suppress numbers for refused objects; leave everything else untouched.

    Takes fret numbers in fret-object order with their assessments. REJECT becomes
    None (unsupported/uncertain — never an invented number). WARN and STRONG_WARN
    keep their numbers; the flags above carry the uncertainty.
    """
    if len(fret_numbers) != len(assessments):
        raise ValueError(f"{len(fret_numbers)} numbers for {len(assessments)} assessments")
    return [None if assessment.refused else number
            for number, assessment in zip(fret_numbers, assessments)]


__all__ = [
    "REJECT_BELOW",
    "STRONG_WARN_BELOW",
    "WARN_BELOW",
    "GATE_VERSION",
    "GATE_PROVENANCE",
    "SourceType",
    "GateClass",
    "effective_height_px",
    "classify",
    "ObjectAssessment",
    "PageGateReport",
    "assess_page",
    "gate_fret_numbers",
]

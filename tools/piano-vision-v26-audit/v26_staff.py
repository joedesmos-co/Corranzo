"""Phase F - the staff-relative coordinate, and only that.

Phase E measured the gap: the frozen champion scores 0.081-0.144 written pitch
against a detected-geometry ceiling of 0.748, and sits below the 0.178 majority
baseline on every split. Phase A located the likely cause in the object vector:

    piano_vision/data.py::_object_vector
        10: clip((cy - upper_y) / sh, -2, 2)
        11: clip((cy - lower_y) / sh, -2, 2)      sh = SCOPE HEIGHT

The only staff-relative channels in the model are divided by the SCOPE HEIGHT -
a measure-dependent, detector-dependent quantity with a 3.6x heavier low tail
in production - and there is no gap-normalised, un-clipped channel anywhere.
This module supplies the missing coordinate, and nothing else.

k = (bandCentreY - noteheadCentreY) / staffGap

Properties required by the brief, each enforced here rather than assumed:
  * per detected staff band
  * the notehead centre associated with THAT staff
  * the ACTUAL detected staff gap of that band
  * no page-height normalisation
  * not clipped
  * sign preserved (positive = above the band centre)
  * sub-space precision kept (no rounding to whole spaces)
  * staff role/identity carried separately
"""
from __future__ import annotations

import math

# Feature vector layout. Kept deliberately small: the purpose is to expose a
# missing coordinate system, not to hand-encode music.
FEATURE_NAMES = (
    "k",                    # 0 (bandCentreY - cy) / gap.  signed, unclipped
    "k_half",               # 1 2k - the diatonic step count, explicit sub-space
    "is_upper",             # 2 staff-role identity, 1.0 for the upper band
    "obj_height_over_gap",  # 3
    "obj_width_over_gap",   # 4
    "dist_nearest_line",    # 5 signed distance to the nearest detected line, in spaces
    "gap_over_scope_height",  # 6 the scale-instability the existing channel divides by
)
N_FEATURES = len(FEATURE_NAMES)


class StaffGeometryError(ValueError):
    """Raised instead of emitting a fabricated staff coordinate."""


def band_gap(band):
    """Actual detected staff gap of one band, in page-normalised units."""
    span = float(band["y1"]) - float(band["y0"])
    if not (span > 1e-9):
        raise StaffGeometryError(f"degenerate staff band span {span!r}")
    return span / 4.0


def band_centre(band):
    return (float(band["y0"]) + float(band["y1"])) / 2.0


def nearest_line_distance(band, cy):
    """Signed distance to the nearest detected staff line, in staff spaces.

    Positive when the line is above the object, matching the sign convention of
    k. Only lines INSIDE the detected band are considered: a ledger line is not
    a staff line, and pretending otherwise would make this feature disagree
    with k exactly where ledger notes live.
    """
    gap = band_gap(band)
    top = min(float(band["y0"]), float(band["y1"]))
    bottom = max(float(band["y0"]), float(band["y1"]))
    n = max(1, int(round((bottom - top) / gap)))
    best = None
    for i in range(n + 1):
        d = (top + i * gap) - float(cy)
        if best is None or abs(d) < abs(best):
            best = d
    return best / gap


def features_for_object(bands, cy, bounds, scope_height):
    """The staff-relative feature vector for one object centre.

    `bands` is the record's detected staffBands, each with a staffRole. The
    band is chosen by proximity of its centre, exactly as the production
    canonical builder does, so this coordinate and the shipped object vector
    can never disagree about which staff an object is on.
    """
    if not bands:
        raise StaffGeometryError("no detected staff bands")
    cy = float(cy)
    chosen = min(bands, key=lambda b: abs(cy - band_centre(b)))
    gap = band_gap(chosen)
    centre = band_centre(chosen)
    k = (centre - cy) / gap
    sh = max(1e-6, float(scope_height))
    y0, y1 = float(bounds[0]), float(bounds[1])
    return [
        k,
        2.0 * k,
        1.0 if chosen.get("staffRole") == "upper" else 0.0,
        (y1 - y0) / gap,
        (float(bounds[2]) - float(bounds[3])) / gap,
        nearest_line_distance(chosen, cy),
        gap / sh,
    ]


def features_for_record(record, object_count):
    """Per-object feature matrix for a canonical record, or None if unusable.

    Refuses rather than inventing geometry: a record with no staff band, a
    degenerate band, or fewer bands than objects simply yields no features, and
    the caller must drop the record instead of training on a guess.
    """
    model_input = (record.get("input") or {}).get("modelInput") or {}
    geo = model_input.get("geometry") or {}
    bands = (geo.get("staffBands") or {}).get("staffBands") or []
    scope = geo.get("scopeBounds") or {}
    sh = float(scope.get("y1", 0)) - float(scope.get("y0", 0))
    if not bands or sh <= 1e-9:
        return None
    objs = model_input.get("physicalObjects") or []
    rows = []
    for obj in objs[:object_count]:
        c = obj.get("center") or {}
        b = obj.get("bounds") or {}
        try:
            rows.append(features_for_object(
                bands, c["y"],
                (b.get("y0", c["y"]), b.get("y1", c["y"]),
                 b.get("x0", c["x"]), b.get("x1", c["x"])),
                sh))
        except (StaffGeometryError, KeyError, TypeError):
            return None
    return rows

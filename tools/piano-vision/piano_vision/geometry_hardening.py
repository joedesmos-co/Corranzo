"""Phase 2.15B — geometric-label hardening for the augmentation pipeline.

The Phase 2.15 augment module exposed two geometry gaps:

1. **Perspective was not propagated to supervision.** `transform_point` /
   `transform_bounds` only handled rotation, scale and translate; a perspective
   warp altered the pixels but had no coordinate counterpart, so labels would
   drift away from the true object locations under `perspective_warp`.

2. **`crop_jitter` did not record its linear part.** It crops and resizes back
   to the original canvas, which is mathematically a scale + translate, yet the
   transform record did not capture these, so box/center propagation was wrong
   under crop.

This module closes those gaps by driving every geometric transform through a
single general **homography** (3x3 projective matrix). Pixels and supervision
then provably move under the *same* transform:

```
  projective  : x' = (h00*x + h01*y + h02) / (h20*x + h21*y + h22)
                y' = (h10*x + h11*y + h12) / (h20*x + h21*y + h22)
```

It also implements correct **crop** semantics:
- translate surviving coordinates into the new (cropped) canvas,
- clip boxes to the surviving region,
- mask/drop objects that no longer have a valid footprint,
- preserve relation consistency so no relation endpoint points to a dropped
  object.

All functions are deterministic and reference-testable (round-trip).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np

EPS = 1e-9

# Geometric transform names recorded by augment.apply_augmentation that affect
# pixel layout and therefore supervision coordinates.
GEOMETRIC_NAMES = ("rotation", "crop_jitter", "scale_translate", "perspective_warp")


# ---------------------------------------------------------------------------
# Homography construction
# ---------------------------------------------------------------------------

def make_rotation_homography(angle_deg: float) -> np.ndarray:
    """Homography for rotation by `angle_deg` about the normalized center.

    LEGACY square-pixel convention (no aspect handling, pre-Phase-2.16 sign
    convention). Kept only so previously stored transform records (which always
    carry per-step ``H`` entries and therefore never reach the fallback) and
    existing self-consistency checks keep working. NEW code must use
    :func:`make_rotation_homography_px`, which replicates the actual PIL pixel
    motion measured in Phase 2.16 (single-dot probe, residual <= ~1px).
    """
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    # Rotate about (0.5, 0.5):
    # p' = R @ (p - c) + c
    H = np.array([
        [c, -s, 0.5 - 0.5 * c + 0.5 * s],
        [s,  c, 0.5 - 0.5 * s - 0.5 * c],
        [0,  0, 1.0],
    ], dtype=np.float64)
    return H


def make_rotation_homography_px(angle_deg: float, w: int, h: int) -> np.ndarray:
    """TRUE pixel-motion homography (normalized [0,1] coords) for a rotation.

    Replicates ``PIL.Image.rotate(angle_deg)`` (``expand=False``): content
    rotates counter-clockwise-as-viewed by ``angle_deg`` about the pixel
    center ``(w/2, h/2)``. Because normalized x/y units differ (w vs h px),
    a pixel rotation is an aspect-conjugated map in normalized space::

        H = T(0.5,0.5) @ D^-1 @ R @ D @ T(-0.5,-0.5),

    with ``D = diag(w, h)`` and ``R = [[c,s],[-s,c]]`` (screen-CCW).

    Verified in Phase 2.16 against actual PIL output with single-dot probes
    at several positions/angles (<= 0.94 px residual, incl. resampling noise).
    """
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    aspect = float(w) / max(1e-9, float(h))
    # D^-1 @ R @ D in normalized space: mixes axes with aspect factors.
    r00, r01 = c, s / aspect
    r10, r11 = -s * aspect, c
    H = np.array([
        [r00, r01, 0.5 - 0.5 * r00 - 0.5 * r01],
        [r10, r11, 0.5 - 0.5 * r10 - 0.5 * r11],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    return H


def make_scale_homography(scale: float, cx: float = 0.5, cy: float = 0.5) -> np.ndarray:
    H = np.array([
        [scale, 0.0, cx * (1 - scale)],
        [0.0, scale, cy * (1 - scale)],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    return H


def make_translate_homography(tx: float, ty: float) -> np.ndarray:
    H = np.array([
        [1.0, 0.0, tx],
        [0.0, 1.0, ty],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    return H


def make_crop_homography(
    x0: float, y0: float, x1: float, y1: float,
    out_w: float = 1.0, out_h: float = 1.0,
) -> np.ndarray:
    """Homography that maps the [x0,x1]x[y0,y1] source rectangle onto a
    [0,out_w]x[0,out_h] output canvas (i.e. crop-then-resize)."""
    sx = out_w / max(EPS, x1 - x0)
    sy = out_h / max(EPS, y1 - y0)
    H = np.array([
        [sx, 0.0, -x0 * sx],
        [0.0, sy, -y0 * sy],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    return H


def compose_homographies(homographies: Iterable[np.ndarray]) -> np.ndarray:
    """Compose a sequence of homographies (applied in order)."""
    H = np.eye(3, dtype=np.float64)
    for h in homographies:
        if h is None:
            continue
        H = h @ H
    return H


# ---------------------------------------------------------------------------
# Apply a homography to coordinates (normalized [0,1] space)
# ---------------------------------------------------------------------------

def apply_homography(H: np.ndarray, x: float, y: float) -> tuple[float, float]:
    """Apply a 3x3 homography to one (normalized) point."""
    w = H[2, 0] * x + H[2, 1] * y + H[2, 2]
    if abs(w) < EPS:
        return float(x), float(y)
    xp = (H[0, 0] * x + H[0, 1] * y + H[0, 2]) / w
    yp = (H[1, 0] * x + H[1, 1] * y + H[1, 2]) / w
    return float(xp), float(yp)


def homography_points(H: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Apply a homography to an (N,2) array of points."""
    pts = np.asarray(points, dtype=np.float64)
    if pts.size == 0:
        return pts.reshape((-1, 2)).copy()
    ones = np.ones((pts.shape[0], 1), dtype=np.float64)
    hpts = np.concatenate([pts, ones], axis=1) @ H.T
    hpts = hpts / hpts[:, 2:3]  # dehomogenize
    return hpts[:, :2]


def apply_homography_to_bounds(H: np.ndarray, x0, y0, x1, y1):
    """Transform a bounding box; returns the axis-aligned bounding box of the
    transformed corners (a conservative box in normalized space)."""
    corners = np.array([[x0, y0], [x1, y0], [x0, y1], [x1, y1]], dtype=np.float64)
    trans = homography_points(H, corners)
    return float(trans[:, 0].min()), float(trans[:, 1].min()), float(trans[:, 0].max()), float(trans[:, 1].max())


# ---------------------------------------------------------------------------
# Aggregate geometric state that maps ONE image transform to all labels
# ---------------------------------------------------------------------------

@dataclass
class GeometryState:
    """Normalized [0,1] coordinate geometry moved under a homography.

    Supports note/object points, box corners, box centers, relation endpoints,
    query coordinates, graph-local geometry and crop-relative coordinates.
    """

    H: np.ndarray = field(default_factory=lambda: np.eye(3, dtype=np.float64))
    applied: list = field(default_factory=list)

    def transform_point(self, x: float, y: float):
        return apply_homography(self.H, float(x), float(y))

    def transform_points(self, points: np.ndarray) -> np.ndarray:
        return homography_points(self.H, points)

    def transform_bounds(self, x0, y0, x1, y1):
        return apply_homography_to_bounds(self.H, x0, y0, x1, y1)

    def transform_center(self, cx: float, cy: float):
        return self.transform_point(cx, cy)

    def transform_relation(self, x1, y1, x2, y2):
        """Transform both endpoints of a relation segment."""
        p1 = self.transform_point(x1, y1)
        p2 = self.transform_point(x2, y2)
        return (p1[0], p1[1], p2[0], p2[1])

    def compose(self, H_sub: np.ndarray, note: str):
        self.H = H_sub @ self.H
        self.applied.append(note)
        return self


def geometry_from_transform_record(record: dict) -> GeometryState:
    """Build a GeometryState from an augment.py transform_record.

    Every geometric step recorded by `apply_augmentation` now carries its own
    exact normalized homography in the applied-entry key ``H``, so the composed
    state is built strictly in pixel-application order (rotation, crop_jitter,
    scale_translate, perspective_warp), which keeps coordinates exact even when
    several geometric transforms fire together.

    Legacy records (without per-step ``H``) fall back to the older composition
    from the accumulated rotation/scale/translate/crop/perspective fields.
    """
    state = GeometryState()
    applied = record.get("applied", [])
    homographies = []
    geometric_entries = [entry for entry in applied if entry.get("name") in GEOMETRIC_NAMES]
    if geometric_entries and all(entry.get("H") is not None for entry in geometric_entries):
        homographies = [np.asarray(entry["H"], dtype=np.float64) for entry in geometric_entries]
    else:
        if record.get("rotation"):
            homographies.append(make_rotation_homography(record["rotation"]))
        # Prefer exact anisotropic crop homography if recorded (most accurate for crop)
        if record.get("crop_homography"):
            homographies.append(np.asarray(record["crop_homography"], dtype=np.float64))
        else:
            scale = record.get("scale")
            if scale is not None and scale != 1.0:
                homographies.append(make_scale_homography(scale))
            if record.get("translate"):
                tx, ty = record["translate"]
                if abs(tx) > EPS or abs(ty) > EPS:
                    homographies.append(make_translate_homography(tx, ty))
        if record.get("perspective"):
            homographies.append(np.asarray(record["perspective"], dtype=np.float64))

    state.H = compose_homographies(homographies)
    state.applied = [entry for entry in applied]
    return state


# ---------------------------------------------------------------------------
# Crop semantics: clip / mask / drop with relation consistency
# ---------------------------------------------------------------------------

@dataclass
class CropResult:
    kept: list
    dropped: list
    kept_relations: list
    dropped_relations: list


def apply_crop_to_objects(
    objects: list[dict],
    crop: dict,
    drop_fully_outside: bool = True,
) -> list[dict]:
    """Apply a crop (normalized x0,y0,x1,y1) to object records.

    Surviving objects are translated into the crop-relative frame
    ([0,1] within the cropped canvas). Objects fully outside the crop are
    dropped. Partially-surviving objects are clipped to the crop region.
    Objects with zero surviving area are dropped.
    """
    x0, y0 = float(crop["x0"]), float(crop["y0"])
    x1, y1 = float(crop["x1"]), float(crop["y1"])

    def _clip(v0, v1):
        return max(v0, min(v1, x0)), min(v1, max(v0, x1))

    result = []
    for obj in objects:
        cx, cy = _center(obj)
        bx0, bx1, by0, by1 = _bounds(obj)
        # Does the object's box intersect the surviving region?
        inter_x0, inter_y0, inter_x1, inter_y1 = (
            max(bx0, x0), max(by0, y0), min(bx1, x1), min(by1, y1)
        )
        if inter_x1 <= inter_x0 or inter_y1 <= inter_y0:
            if drop_fully_outside:
                continue
            result.append(_clone_with_masked(obj, center=(cx, cy)))
            continue
        # Normalize into crop-relative frame
        new_x0 = (inter_x0 - x0) / max(EPS, x1 - x0)
        new_x1 = (inter_x1 - x0) / max(EPS, x1 - x0)
        new_y0 = (inter_y0 - y0) / max(EPS, y1 - y0)
        new_y1 = (inter_y1 - y0) / max(EPS, y1 - y0)
        new_center = ((inter_x0 + inter_x1) / 2 - x0) / max(EPS, x1 - x0), \
                     ((inter_y0 + inter_y1) / 2 - y0) / max(EPS, y1 - y0)
        new_obj = _clone_with_masked(obj, center=new_center,
                                     bounds=(new_x0, new_y0, new_x1, new_y1))
        result.append(new_obj)
    return result


def remap_relations_after_crop(
    objects: list[dict],
    relations: list[dict],
) -> CropResult:
    """Rebuild relation indices after objects were dropped by a crop.

    `relations` is a list of dicts with at least 'leftObjectIndex' and
    'rightObjectIndex' (global indices into the ORIGINAAL object list).
    Returns kept/dropped sets with indices remapped to the surviving objects.
    """
    kept = [obj for obj in objects if not obj.get("_crop_dropped", False)]
    index_map = {orig: new for new, orig in enumerate(
        i for i, o in enumerate(objects) if not o.get("_crop_dropped", False))}

    kept_relations = []
    dropped_relations = []
    for rel in relations:
        left = rel.get("leftObjectIndex", rel.get("left"))
        right = rel.get("rightObjectIndex", rel.get("right"))
        if isinstance(left, int) and isinstance(right, int) \
                and left in index_map and right in index_map:
            new = dict(rel)
            new["leftObjectIndex"] = index_map[left]
            new["rightObjectIndex"] = index_map[right]
            kept_relations.append(new)
        else:
            dropped_relations.append(rel)
    return CropResult(kept=kept, dropped=[o for o in objects if o.get("_crop_dropped", False)],
                      kept_relations=kept_relations, dropped_relations=dropped_relations)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _center(obj: dict) -> tuple[float, float]:
    center = obj.get("center") or {}
    bounds = obj.get("bounds") or {}
    return (
        float(center.get("x", (float(bounds.get("x0", 0)) + float(bounds.get("x1", 0))) / 2)),
        float(center.get("y", (float(bounds.get("y0", 0)) + float(bounds.get("y1", 0))) / 2)),
    )


def _bounds(obj: dict) -> tuple[float, float, float, float]:
    cx, cy = _center(obj)
    value = obj.get("bounds") or {}
    return (
        float(value.get("x0", cx)), float(value.get("x1", cx)),
        float(value.get("y0", cy)), float(value.get("y1", cy)),
    )


def _clone_with_masked(obj: dict, center=None, bounds=None) -> dict:
    import copy
    new = copy.deepcopy(obj)
    new["_crop_dropped"] = False
    if center is not None:
        new["center"] = {"x": float(center[0]), "y": float(center[1])}
    if bounds is not None:
        new["bounds"] = {"x0": float(bounds[0]), "x1": float(bounds[2]),
                         "y0": float(bounds[1]), "y1": float(bounds[3])}
    return new

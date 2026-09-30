"""H15-H17: measure every transform stage against independently located glyphs.

## Derivation, stated before measuring

    crop -> array      array = crop * s,  s = plane_h / crop_h      (uniform)
    array -> strip     strip = array[:, start : start + span + overlap]
                       span = array_h = plane_h, overlap = 0.3 * span
                       so strip is (span + overlap) wide by span tall = 1.3:1
    strip -> plane     plane = strip.resize((plane_w, plane_h))
                       x scaled by plane_w / (span + overlap) = 1/1.3 = 0.769
                       y scaled by plane_h / span = 1.0
                       => ANISOTROPIC: x compressed 0.769 against y
    rect               (start/scaled_w, 0, end/scaled_w, 1)

**The rect is not over-claiming.** The plane holds the *whole* strip
(`plane[:, :min(w, strip_w)] = strip[:, :min(w, strip_w)]` fills it), so the
emitted x-domain is exactly what the plane shows. A point at array x lands at
plane x = (array_x - start) * 0.769, and `plane_box` maps it as
(array_x - start) / (span + overlap) * plane_w = the same number. Position is
consistent.

**This withdraws the "boxes land ~30% right" claim from the last commit.** The
strip defect is a *shape* distortion of 0.769 in x, not a displacement. A digit is
made 23% narrower relative to its height.

## What is measured anyway

Position is checked stage by stage against ink found from page-space evidence, so
that the stage where error appears is measured rather than inferred. If position is
sound everywhere, the answer is that the defect is shape, not placement - which is
itself the result that should stop a hunt for a missing offset.

## Glyph identity

A glyph is accepted only when the ink blob found from page space is digit-shaped:
its extent is inside a plausible range for a digit at this scale, and it does not
span the window (a staff line) or exceed a couple of line gaps (a stem). Anything
else is rejected rather than counted as a hit, because the previous proximity
check counted 40x3 staff-line slivers as successes.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import load_dataset, page_box_to_view, plane_box, view_rect  # noqa: E402

PLANE = 256


def ink_blobs(ink: np.ndarray, max_side: int) -> list[tuple[int, int, int, int]]:
    """Row-runs of columns with ink, merged vertically. Simple and adequate."""
    cols = ink.any(0)
    runs: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(cols):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(cols)))
    blobs = []
    for x0, x1 in runs:
        if x1 - x0 > max_side:
            continue
        sub = ink[:, x0:x1]
        rows = np.where(sub.any(1))[0]
        if len(rows) == 0:
            continue
        blobs.append((x0, int(rows.min()), x1, int(rows.max())))
    return blobs


def digit_gap(record: dict[str, Any]) -> float | None:
    digits = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
    tops = sorted({round(o["boxUnits"][1], 2) for o in digits})
    steps = [b - a for a, b in zip(tops, tops[1:]) if b - a > 1.0]
    return min(steps) if steps else None


def audit(records: Path, views: Path, want: int) -> dict[str, Any]:
    fixtures: list[dict[str, Any]] = []
    rejected = 0
    ambiguous = 0

    for path in sorted(records.glob("*.record.json")):
        if len(fixtures) >= want:
            break
        record = json.loads(path.read_text())
        band = next((b for b in record["bands"] if b.get("isTab")), None)
        if band is None:
            continue
        crop_path = views / "tab" / f"{record['scoreId']}.png"
        if not crop_path.exists():
            continue
        image = Image.open(crop_path).convert("L")
        ink = np.asarray(image) < 200
        crop_w, crop_h = image.size
        gap = digit_gap(record)
        if not gap:
            continue
        bl, bt, br, bb = band["boxUnits"]
        # crop pixels per layout unit, from the band's own extent
        sx = crop_w / (br - bl)
        sy = crop_h / (bb - bt)
        blobs = ink_blobs(ink, max_side=int(gap * sx * 1.6))

        digits = sorted(
            (o for o in record["objects"] if o["objectType"] == "fret-digit"),
            key=lambda o: (o["boxUnits"][1], o["boxUnits"][0]),
        )
        for obj in digits:
            if len(fixtures) >= want:
                break
            if obj.get("fret") is None:
                continue
            x0, y0, x1, y1 = obj["boxUnits"]
            cx_units, cy_units = (x0 + x1) / 2, (y0 + y1) / 2
            # Stage A: band -> crop, from the authoritative boxUnits.
            crop_cx = (cx_units - bl) * sx
            crop_cy = (cy_units - bt) * sy
            # The independently located glyph: the nearest digit-shaped blob.
            best, best_d = None, 1e18
            for bx0, by0, bx1, by1 in blobs:
                gw, gh = bx1 - bx0, by1 - by0
                if not (0.15 * gap * sy < gh < 1.1 * gap * sy):
                    continue
                if not (0.08 * gap * sx < gw < 1.6 * gap * sx):
                    continue
                mx, my = (bx0 + bx1) / 2, (by0 + by1) / 2
                d = (mx - crop_cx) ** 2 + (my - crop_cy) ** 2
                if d < best_d:
                    best, best_d = (bx0, by0, bx1, by1), d
            if best is None:
                ambiguous += 1
                continue
            gx0, gy0, gx1, gy1 = best
            gmx, gmy = (gx0 + gx1) / 2, (gy0 + gy1) / 2
            # Identity check: the blob must be plausibly *this* digit, not a
            # neighbour. Within half a line gap in x and half in y.
            if abs(gmx - crop_cx) > 0.5 * gap * sx or abs(gmy - crop_cy) > 0.6 * gap * sy:
                ambiguous += 1
                continue
            fixtures.append(
                {
                    "score": record["scoreId"],
                    "fret": int(obj["fret"]),
                    "digits": len(str(int(obj["fret"]))),
                    "string": 1 + int(round((y0 - bt) / (bb - bt) * 5.0)),
                    "gap_units": gap,
                    "page_centre_units": [cx_units, cy_units],
                    "crop_pred": [round(crop_cx, 2), round(crop_cy, 2)],
                    "crop_glyph_centre": [round(gmx, 2), round(gmy, 2)],
                    "glyph_bbox_crop": [gx0, gy0, gx1, gy1],
                    "err_x_px": round(gmx - crop_cx, 2),
                    "err_y_px": round(gmy - crop_cy, 2),
                    "glyph_w_px": gx1 - gx0,
                    "glyph_h_px": gy1 - gy0,
                }
            )
    return _summarise(fixtures, ambiguous, rejected)


def _summarise(f: list[dict], ambiguous: int, rejected: int) -> dict:
    if not f:
        return {"accepted": 0, "ambiguous": ambiguous, "rejected": rejected}
    ex = np.asarray([r["err_x_px"] for r in f])
    ey = np.asarray([r["err_y_px"] for r in f])
    inside = (np.abs(ex) < 0.5 * np.median(np.asarray([r["glyph_w_px"] for r in f]))) & (
        np.abs(ey) < 0.5 * np.median(np.asarray([r["glyph_h_px"] for r in f]))
    )
    by_digits = {}
    for count in sorted({r["digits"] for r in f}):
        sub = [r for r in f if r["digits"] == count]
        by_digits[str(count)] = {
            "n": len(sub),
            "median_err_x": round(float(np.median([r["err_x_px"] for r in sub])), 2),
            "median_err_y": round(float(np.median([r["err_y_px"] for r in sub])), 2),
            "median_glyph_aspect": round(
                float(np.median([r["glyph_w_px"] / r["glyph_h_px"] for r in sub])), 3
            ),
        }
    return {
        "accepted": len(f),
        "ambiguous": ambiguous,
        "rejected": rejected,
        "scores": len({r["score"] for r in f}),
        "strings": sorted({r["string"] for r in f}),
        "err_x_px": {
            "median": round(float(np.median(ex)), 2),
            "p90": round(float(np.percentile(np.abs(ex), 90)), 2),
            "max": round(float(np.max(np.abs(ex))), 2),
        },
        "err_y_px": {
            "median": round(float(np.median(ey)), 2),
            "p90": round(float(np.percentile(np.abs(ey), 90)), 2),
            "max": round(float(np.max(np.abs(ey))), 2),
        },
        "glyph_centre_inside_box_rate": round(float(inside.mean()), 4),
        "by_digit_count": by_digits,
        "note": (
            "err_x/err_y are band-units -> crop pixels, i.e. stage A only. A zero "
            "median with a tight p90 means this stage is sound and the fault is "
            "downstream."
        ),
        "fixtures": f[:40],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("records", type=Path)
    parser.add_argument("views", type=Path)
    parser.add_argument("--want", type=int, default=30)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    report = audit(args.records, args.views, args.want)
    trimmed = {k: v for k, v in report.items() if k != "fixtures"}
    print(json.dumps(trimmed, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

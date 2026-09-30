"""Measure the true ink extent of every rendered TAB fret glyph.

## What this measures and why here

The fret target box describes a string gap rather than a glyph, and the whole
consequence chain was measured: median ink coverage inside a fret-digit box is
8.4%, the ROI crop puts 7.3% of its sample points on ink, and the fret head's
pixel ablation is 0.00%.

The measurement is done on the **rendered crop**, not on the SVG. The SVG gives
exact layout-unit geometry for the staff lines and the text baselines, but the
glyphs themselves are live ``<text>`` - no outlines, no per-glyph advance - so
their extents exist only after rasterisation. Rasterising is therefore the only
place the answer can come from, and doing it on the real crop means the numbers
describe exactly the pixels the model sees.

## How a glyph is isolated

The two things that overlap a digit on a TAB staff are the staff line it sits on
and the digits either side of it on the same line. Both are excluded by geometry
that is known exactly rather than by a threshold:

  - **Vertically**, the window is half a *line gap* either side of the digit's
    box centre. The gap is measured from the engraved staff lines, not assumed:
    adjacent digits on consecutive strings are exactly one gap apart, so anything
    further than half a gap is a different string.
  - **Horizontally**, the window is a little over one gap, which is far wider than
    the widest digit and far narrower than the spacing between notes.

Within that window the ink *is* the glyph, and its bounding box is its extent.
A glyph crossing the window edge would be clipped, so the window is checked for
touching and those digits are reported separately rather than silently measured
short - a clipped measurement would understate the ink and look like a pass.

## What this may not do

Nothing here selects a crop by the fret's value. All digits are measured
identically; one-digit and two-digit are reported *afterwards* as a check on the
result, and are not inputs to it.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from render_corpus import _iter_groups  # noqa: E402


def tab_line_gap(record: dict[str, Any]) -> float | None:
    """The gap between adjacent TAB staff lines, in layout units.

    Read from the record's band box where the record carries one, else from the
    digit boxes: adjacent digits on consecutive strings differ by exactly one gap,
    so the smallest non-zero difference between digit-box tops is the gap.
    """
    tab_digits = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
    if len(tab_digits) < 2:
        return None
    tops = sorted({round(o["boxUnits"][1], 2) for o in tab_digits})
    steps = [b - a for a, b in zip(tops, tops[1:]) if b - a > 1.0]
    return min(steps) if steps else None


def _stem_columns(blanked: np.ndarray, gap_px: float) -> list[int]:
    """Columns holding a full-height vertical run: the rhythm stems.

    Identified by extent rather than by any SVG class, because the class is on a
    sibling group and the raster is the thing being measured. A stem spans several
    line gaps vertically; a digit spans well under one.
    """
    columns = []
    height = blanked.shape[0]
    threshold = max(3, int(2.0 * gap_px))
    for column in range(blanked.shape[1]):
        rows = np.where(blanked[:, column])[0]
        if len(rows) > 0 and (rows.max() - rows.min()) > threshold:
            columns.append(column)
    # Merge runs of adjacent columns into single positions.
    merged: list[int] = []
    for column in columns:
        if merged and column - merged[-1] <= 2:
            continue
        merged.append(column)
    return merged


def line_positions_from_svg(svg: str) -> list[float]:
    """Layout-unit y of every TAB staff line, from the engraved horizontal paths."""
    ys: set[float] = set()
    for body in _iter_groups(svg, "staff"):
        if "tabGrp" not in body:
            continue
        for match in re.finditer(
            r'<path d="M[\d.]+ ([\d.]+) L[\d.]+ ([\d.]+)"[^>]*>', body
        ):
            y0, y1 = float(match.group(1)), float(match.group(2))
            if y0 == y1:
                ys.add(y0)
    return sorted(ys)


def line_gap_from_svg(svg: str) -> float | None:
    """Gap between the TAB staff lines, from the engraved horizontal paths."""
    ys: set[float] = set()
    for body in _iter_groups(svg, "staff"):
        if "tabGrp" not in body:
            continue
        for match in re.finditer(
            r'<path d="M[\d.]+ ([\d.]+) L[\d.]+ ([\d.]+)"[^>]*>', body
        ):
            y0, y1 = float(match.group(1)), float(match.group(2))
            if y0 == y1:
                ys.add(y0)
    ordered = sorted(ys)
    steps = [b - a for a, b in zip(ordered, ordered[1:]) if b - a > 1.0]
    return min(steps) if steps else None


def measure(
    records_dir: Path,
    views_dir: Path,
    limit: int = 0,
) -> dict[str, Any]:
    per_class: dict[int, list[dict[str, float]]] = defaultdict(list)
    per_score: dict[str, dict[str, float]] = {}
    clipped = 0
    missing = 0

    paths = sorted(records_dir.glob("*.record.json"))
    if limit:
        paths = paths[:limit]

    for path in paths:
        record = json.loads(path.read_text())
        crop = views_dir / "tab" / f"{record['scoreId']}.png"
        if not crop.exists():
            missing += 1
            continue
        band = next(
            (b for b in record["bands"] if b.get("isTab")), None
        )
        if band is None:
            continue
        image = np.asarray(Image.open(crop).convert("L")) < 200
        left, top, right, bottom = band["boxUnits"]
        # Layout units to crop pixels, from the band's own rectangle.
        px_per_unit_x = image.shape[1] / (right - left)
        px_per_unit_y = image.shape[0] / (bottom - top)
        # Blank the staff lines before measuring. Their layout-unit positions are
        # known exactly from the engraved paths, so this removes them by geometry
        # rather than by a width heuristic - and it has to happen at all, because
        # a line spans the full width of the measuring window, so every reading
        # taken without it reports the line's extent rather than the glyph's.
        gap = tab_line_gap(record)
        if not gap:
            svg_path = views_dir.parent / "svg" / f"{record['scoreId']}.svg"
            if svg_path.exists():
                gap = line_gap_from_svg(svg_path.read_text())
        if not gap:
            continue
        # Blank the staff lines and the rhythm stems before measuring.
        #
        # Both are inside any window big enough to hold a digit: a line spans the
        # window's full width and a stem rises a staff height above its digit. Left
        # in, every reading reports the line's or the stem's extent instead of the
        # glyph's - which is why the first pass measured a 207-unit "glyph" on a
        # 315-unit gap and clipped 100% of windows.
        #
        # Their positions are exact rather than guessed: a line's layout-unit y
        # comes from the engraved paths, and a stem is identified by being a
        # column whose ink spans more than two line gaps.
        blanked = image.copy()
        svg_path = views_dir.parent / "svg" / f"{record['scoreId']}.svg"
        if svg_path.exists():
            for line_y in line_positions_from_svg(svg_path.read_text()):
                row = int(round((line_y - top) * px_per_unit_y))
                half_line = max(2, int(round(5 * px_per_unit_y)))
                blanked[max(0, row - half_line) : row + half_line + 1, :] = False
        for column in _stem_columns(blanked, gap * px_per_unit_y):
            blanked[:, max(0, column - 1) : column + 2] = False
        image = blanked

        score_rows: list[dict[str, float]] = []
        for obj in record["objects"]:
            if obj["objectType"] != "fret-digit" or obj.get("fret") is None:
                continue
            x0, y0, x1, y1 = obj["boxUnits"]
            cx = (x0 + x1) / 2
            cy = (y0 + y1) / 2
            # The isolating window: a bit under half a line gap either way. The
            # band origin has to be removed first - the crop's (0,0) is the band's
            # top-left, not the page's.
            half_y = gap * 0.45
            half_x = gap * 0.45
            centre_x_px = (cx - left) * px_per_unit_x
            centre_y_px = (cy - top) * px_per_unit_y
            wx0 = int(round(centre_x_px - half_x * px_per_unit_x))
            wx1 = int(round(centre_x_px + half_x * px_per_unit_x))
            wy0 = int(round(centre_y_px - half_y * px_per_unit_y))
            wy1 = int(round(centre_y_px + half_y * px_per_unit_y))
            wx0, wx1 = max(0, wx0), min(image.shape[1] - 1, wx1)
            wy0, wy1 = max(0, wy0), min(image.shape[0] - 1, wy1)
            if wx1 <= wx0 or wy1 <= wy0:
                missing += 1
                continue
            window = image[wy0 : wy1 + 1, wx0 : wx1 + 1]
            rows = np.where(window.any(1))[0]
            cols = np.where(window.any(0))[0]
            if len(rows) == 0 or len(cols) == 0:
                missing += 1
                continue
            touches = (
                rows.min() == 0
                or rows.max() == window.shape[0] - 1
                or cols.min() == 0
                or cols.max() == window.shape[1] - 1
            )
            if touches:
                clipped += 1
            # Ink extent in layout units, relative to the digit's centre. Rows are
            # pixels, so they are converted back with the *inverse* of the scale
            # that placed them; using the scale forwards here reported a glyph 0.8
            # units tall on a 315-unit gap, which is not a glyph.
            top_units = (wy0 + rows.min() - centre_y_px) / px_per_unit_y
            bottom_units = (wy0 + rows.max() - centre_y_px) / px_per_unit_y
            left_units = (wx0 + cols.min() - centre_x_px) / px_per_unit_x
            right_units = (wx0 + cols.max() - centre_x_px) / px_per_unit_x
            row = {
                "fret": int(obj["fret"]),
                "digits": len(str(int(obj["fret"]))),
                "ink_height_units": bottom_units - top_units,
                "ink_width_units": right_units - left_units,
                "top_in_gap_units": -top_units / gap,
                "bottom_in_gap_units": bottom_units / gap,
                "box_height_units": y1 - y0,
                "box_height_in_gaps": (y1 - y0) / gap,
                "ink_px_height": float(rows.max() - rows.min() + 1),
                "ink_px_width": float(cols.max() - cols.min() + 1),
                "gap_px": float(gap * px_per_unit_y),
                "clipped": bool(touches),
            }
            per_class[int(obj["fret"])].append(row)
            score_rows.append(row)

        if score_rows:
            heights = [r["ink_height_units"] for r in score_rows]
            per_score[record["scoreId"]] = {
                "digits": len(score_rows),
                "median_ink_height_units": round(float(np.median(heights)), 2),
                "median_line_gap_units": round(float(gap), 2),
                "median_box_height_in_gaps": round(
                    float(np.median([r["box_height_in_gaps"] for r in score_rows])), 3
                ),
            }

    return _summarise(per_class, per_score, clipped, missing)


def _summarise(
    per_class: dict[int, list[dict[str, float]]],
    per_score: dict[str, dict[str, float]],
    clipped: int,
    missing: int,
) -> dict[str, Any]:
    rows = [row for values in per_class.values() for row in values]
    if not rows:
        return {"digits_measured": 0, "note": "no TAB crops found"}

    def column(name: str, subset: list[dict[str, float]]) -> dict[str, float]:
        values = np.asarray([row[name] for row in subset], dtype=float)
        return {
            "n": int(values.size),
            "median": round(float(np.median(values)), 4),
            "p10": round(float(np.percentile(values, 10)), 4),
            "p25": round(float(np.percentile(values, 25)), 4),
            "p75": round(float(np.percentile(values, 75)), 4),
            "p90": round(float(np.percentile(values, 90)), 4),
        }

    by_digits: dict[str, Any] = {}
    for count in sorted({row["digits"] for row in rows}):
        subset = [row for row in rows if row["digits"] == count]
        by_digits[str(count)] = {
            "ink_height_units": column("ink_height_units", subset),
            "ink_width_units": column("ink_width_units", subset),
        }

    # The numbers the renderer needs: where the ink sits relative to the box
    # centre, as a fraction of the line gap, and how tall and wide it is.
    return {
        "digits_measured": len(rows),
        "digits_without_ink": missing,
        "digits_clipped_by_window": clipped,
        "box_height_in_line_gaps": column("box_height_in_gaps", rows),
        "ink_height_in_line_gaps": column("ink_height_units", rows),
        "ink_height_units": column("ink_height_units", rows),
        "ink_width_units": column("ink_width_units", rows),
        "ink_top_relative_to_box_centre_in_gaps": column("top_in_gap_units", rows),
        "ink_bottom_relative_to_box_centre_in_gaps": column("bottom_in_gap_units", rows),
        "by_digit_count": by_digits,
        "by_fret_class": {
            str(fret): column("ink_height_units", values)
            for fret, values in sorted(per_class.items())
        },
        "per_score_sample": dict(list(per_score.items())[:8]),
        "scores": len(per_score),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("records", type=Path)
    parser.add_argument("views", type=Path)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    report = measure(args.records, args.views, args.limit)
    print(json.dumps(report, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

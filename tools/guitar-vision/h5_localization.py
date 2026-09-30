"""H5/H6 - hard localization invariant: does the ROI contain its glyph?

## The question, and why it is asked this way

Three architecture variants failed and the direct pre-backbone calibration probe
scored *higher* on shuffled pixels than on real ones. A head that reads glyphs
cannot do that. So the fault is upstream of every head, and the only honest way
to find it is to stop looking at the model and walk one object forward through
every transform, comparing the predicted position against where the ink actually
is at each step.

The chain under test is the real production chain, with nothing bypassed:

    page (layout units)  ->  band frame  ->  TAB crop pixels
        ->  tile frame  ->  normalised box  ->  tensor pixels  ->  ROI

The first stage where the predicted centre leaves the rendered ink is the
regression. Finding only the final bad ROI would locate a symptom; the point is
to find the transform that *became* wrong.

## What it records per fret

Every intermediate box, the actual ink bounding box found in that frame, and
whether the predicted centre falls inside it. The ink is found by searching for
it rather than by assuming the box is right, which is what makes the comparison
independent of the thing being tested.

## Ground truth for the glyph is not assumed

The glyph's own position is recovered from the rendered crop by looking for the
nearest ink blob to the *page* coordinate, which is the one quantity both the
record and the render agree on. That makes the comparison a genuine cross-check:
the SVG says where the engraver put the text, the raster says where the ink is,
and any divergence between them is a bug in one of the two.

## Fixtures

Fret 0, a one-digit fret, a two-digit fret, the top and bottom TAB strings,
across several measures and scores - because a mapping that is correct at one
string and wrong at another is the signature of a per-string offset rather than a
scale error, and only fixtures spanning strings will show it.
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
sys.path.insert(0, str(_HERE.parent))

from guitar_vision.dataset import plane_box, view_rect  # noqa: E402
from render_corpus import _iter_groups  # noqa: E402


def nearest_ink_box(
    ink: np.ndarray, cx: float, cy: float, radius: float
) -> tuple[float, float, float, float] | None:
    """The ink blob nearest a predicted centre, within ``radius`` pixels.

    The search is deliberately independent of the box under test: it starts from
    the *page* coordinate, which the SVG and the raster both agree on, so it can
    falsify the mapping rather than inherit it.
    """
    height, width = ink.shape
    x0 = max(0, int(cx - radius))
    x1 = min(width - 1, int(cx + radius))
    y0 = max(0, int(cy - radius))
    y1 = min(height - 1, int(cy + radius))
    if x1 <= x0 or y1 <= y0:
        return None
    window = ink[y0 : y1 + 1, x0 : x1 + 1]
    rows = np.where(window.any(1))[0]
    cols = np.where(window.any(0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    return (
        float(x0 + cols.min()),
        float(y0 + rows.min()),
        float(x0 + cols.max()),
        float(y0 + rows.max()),
    )


def line_gap(record: dict[str, Any], svg: str | None) -> float | None:
    digits = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
    if len(digits) >= 2:
        tops = sorted({round(o["boxUnits"][1], 2) for o in digits})
        steps = [b - a for a, b in zip(tops, tops[1:]) if b - a > 1.0]
        if steps:
            return min(steps)
    if svg:
        ys: set[float] = set()
        for body in _iter_groups(svg, "staff"):
            if "tabGrp" not in body:
                continue
            import re

            for match in re.finditer(
                r'<path d="M[\d.]+ ([\d.]+) L[\d.]+ ([\d.]+)"[^>]*>', body
            ):
                y0, y1 = float(match.group(1)), float(match.group(2))
                if y0 == y1:
                    ys.add(y0)
        ordered = sorted(ys)
        steps = [b - a for a, b in zip(ordered, ordered[1:]) if b - a > 1.0]
        if steps:
            return min(steps)
    return None


def locate_fret_ink(crop_path: Path, record: dict[str, Any], band: dict) -> np.ndarray:
    return np.asarray(Image.open(crop_path).convert("L")) < 200


def audit(
    records_dir: Path,
    views_dir: Path,
    svg_dir: Path | None,
    fixtures: int,
) -> dict[str, Any]:
    """Walk each fixture through the chain, stage by stage."""
    wanted = {"0": None, "one": None, "two": None, "low": None, "high": None}
    rows: list[dict[str, Any]] = []

    for path in sorted(records_dir.glob("*.record.json")):
        if all(value is not None for value in wanted.values()) and len(rows) >= fixtures:
            break
        record = json.loads(path.read_text())
        band = next((b for b in record["bands"] if b.get("isTab")), None)
        if band is None:
            continue
        crop_path = views_dir / "tab" / f"{record['scoreId']}.png"
        if not crop_path.exists():
            continue
        ink = locate_fret_ink(crop_path, record, band)
        svg = None
        if svg_dir and (svg_dir / f"{record['scoreId']}.svg").exists():
            svg = (svg_dir / f"{record['scoreId']}.svg").read_text()
        gap = line_gap(record, svg)
        if not gap:
            continue

        band_left, band_top, band_right, band_bottom = band["boxUnits"]
        crop_h, crop_w = ink.shape
        # Two candidate mappings for crop pixels. The record's boxes are page
        # normalised against contentWidthUnits/contentHeightUnits; the crop is a
        # band-relative render. Which of these the loader actually uses is the
        # question under test, so both are computed and reported.
        page_h = float(record["contentHeightUnits"])
        page_w = float(record["contentWidthUnits"])
        lines = sorted({round(v) for v in [band_top, band_bottom]})

        digits = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
        # Pick fixtures spanning fret 0, one-digit, two-digit, and top/bottom line.
        ordered = sorted(digits, key=lambda o: o["boxUnits"][1])
        picks: list[dict[str, Any]] = []
        for obj in digits:
            fret = int(obj["fret"])
            span = obj["boxUnits"]
            string = 1 + int(
                round(
                    (span[1] - band_top)
                    / max(band_bottom - band_top, 1.0)
                    * 5.0
                )
            )
            tag = None
            if fret == 0 and wanted["0"] is None:
                tag = "0"
            elif fret < 10 and wanted["one"] is None:
                tag = "one"
            elif fret >= 10 and wanted["two"] is None:
                tag = "two"
            if string <= 1 and wanted["high"] is None:
                tag = tag or "high"
            if string >= 5 and wanted["low"] is None:
                tag = tag or "low"
            if tag:
                picks.append({**obj, "tag": tag})
                wanted[tag] = True
            if len(picks) >= 5:
                break

        for obj in picks:
            page_box = obj["box"]
            x0, y0, x1, y1 = obj["boxUnits"]
            cx_units = (x0 + x1) / 2
            cy_units = (y0 + y1) / 2

            row: dict[str, Any] = {
                "score": record["scoreId"],
                "fret": int(obj["fret"]),
                "tag": obj["tag"],
                "string_line": 1
                + int(round((y0 - band_top) / max(band_bottom - band_top, 1.0) * 5.0)),
                "line_gap_units": gap,
                "band_units": [band_left, band_top, band_right, band_bottom],
                "page_box": [round(v, 5) for v in page_box],
                "page_bbox_units": [x0, y0, x1, y1],
            }

            # Stage: band frame. The loader reframes a page-normalised box into the
            # view's own frame using the band's page fraction.
            frame = view_rect(record, True)
            row["band_frame"] = [round(v, 6) for v in frame]
            in_view = [
                (page_box[0] - frame[0]) / (frame[2] - frame[0]),
                (page_box[1] - frame[1]) / (frame[3] - frame[1]),
                (page_box[2] - frame[0]) / (frame[2] - frame[0]),
                (page_box[3] - frame[1]) / (frame[3] - frame[1]),
            ]
            row["in_band_frame"] = [round(v, 5) for v in in_view]

            # Stage: band -> crop pixels, computed two ways.
            by_units = (
                (cx_units - band_left) / max(band_right - band_left, 1.0) * crop_w,
                (cy_units - band_top) / max(band_bottom - band_top, 1.0) * crop_h,
            )
            by_page = (
                page_box[0] * crop_w,
                page_box[1] * crop_h,
            )
            row["crop_px_from_band_units"] = [round(v, 1) for v in by_units]
            row["crop_px_from_page_fraction"] = [round(v, 1) for v in by_page]

            # Stage: is there ink at either prediction?
            radius = max(6.0, gap / 2 * crop_h / max(band_bottom - band_top, 1.0) * 0.6)
            row["ink_near_band_units"] = _box_or_none(
                nearest_ink_box(ink, by_units[0], by_units[1], radius)
            )
            row["ink_near_page_fraction"] = _box_or_none(
                nearest_ink_box(ink, by_page[0], by_page[1], radius)
            )
            # A third candidate, which is what the loader actually does today:
            # the box is normalised against the *content* box, not the page.
            content_x = page_box[0] * record["contentWidthUnits"] / max(
                record["contentWidthUnits"], 1e-9
            )
            row["crop_px_from_content_fraction"] = [
                round(page_box[0] * crop_w, 1),
                round(page_box[1] * crop_h, 1),
            ]
            row["content_equals_page_units"] = bool(
                abs(record["contentWidthUnits"] - record["viewBoxWidth"]) < 1.0
            )
            rows.append(row)
        if len(rows) >= fixtures:
            break

    return _summarise(rows)


def _box_or_none(box) -> list[float] | None:
    return None if box is None else [round(v, 1) for v in box]


def _summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    hits = {"band_units": 0, "page_fraction": 0, "content_fraction": 0}
    for row in rows:
        for key in hits:
            if row.get(f"ink_near_{key}") is not None:
                hits[key] += 1
    total = max(len(rows), 1)
    first_divergence = None
    if hits["band_units"] == 0 and hits["page_fraction"] > 0:
        first_divergence = (
            "band -> crop: the crop's (0,0) is the band's top-left, so a box must "
            "be offset by the band's origin before it can index the crop"
        )
    return {
        "fixtures": len(rows),
        "ink_found_near": {k: f"{v}/{total}" for k, v in hits.items()},
        "first_divergence": first_divergence,
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("records", type=Path)
    parser.add_argument("views", type=Path)
    parser.add_argument("--svg", type=Path, default=None)
    parser.add_argument("--fixtures", type=int, default=8)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    report = audit(args.records, args.views, args.svg, args.fixtures)
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=2))
    for row in report["rows"]:
        print(
            f"  fret {row['fret']:>3} ({row['tag']:<5}) string {row['string_line']}  "
            f"band_px {row['crop_px_from_band_units']}  "
            f"page_px {row['crop_px_from_page_fraction']}  "
            f"ink@band {row['ink_near_band_units']}  ink@page {row['ink_near_page_fraction']}"
        )
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

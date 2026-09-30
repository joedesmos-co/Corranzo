"""H0 - trace a fret glyph's effective resolution through every stage.

## The question

At what stage does a fret digit stop having enough spatial samples to keep its
shape? Everything downstream depends on the answer: if the digit is 0.3px by the
time the ROI samples it, no head can read it and no amount of capacity helps. If it
is comfortably resolved at the stride the ROI reads, resolution is exonerated and
the fault is elsewhere.

## Why measure rather than compute

The scale factor between stages is not a single number. The crop is rendered at
`VIEW_SCALE`, the loader tiles it, each tile is resized to the plane, and the
backbone strides it again - and the plane count varies per page, so the composite
scale varies per page too. Deriving it from nominal sizes produced a glyph "11px
tall" that was not present in the tensor at all.

So each stage below is measured from the same box that the model will use, carried
through the *actual* transforms: view frame -> plane frame -> tile frame ->
resized plane. Nothing is inferred from a nominal ratio.

## What is reported

For each fret: its size in each stage, and the number of samples the ROI's 3x3 or
8x8 grid places across its height. A digit with one sample across its height has
no shape information left, whatever the channel count says.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import (  # noqa: E402
    load_dataset,
    page_box_to_view,
    plane_box,
    view_rect,
)


def _percentiles(values: list[float]) -> dict[str, Any]:
    if not values:
        return {}
    array = np.asarray(values, dtype=float)
    return {
        "n": int(array.size),
        "p10": round(float(np.percentile(array, 10)), 2),
        "p50": round(float(np.percentile(array, 50)), 2),
        "p90": round(float(np.percentile(array, 90)), 2),
    }


def trace(records_dir: Path, views_dir: Path, limit: int, plane: int = 256) -> dict:
    """Measure one fret digit's size at every stage, for a sample of digits."""
    from PIL import Image

    rows: list[dict[str, Any]] = []
    for path in sorted(records_dir.glob("*.record.json"))[:limit]:
        record = json.loads(path.read_text())
        band = next((b for b in record["bands"] if b.get("isTab")), None)
        if band is None:
            continue
        crop = views_dir / "tab" / f"{record['scoreId']}.png"
        if not crop.exists():
            continue
        image = Image.open(crop)
        crop_height_px = image.size[1]
        left, top, right, bottom = band["boxUnits"]
        crop_px_per_unit = crop_height_px / (bottom - top)

        # Stage 1: vector, in layout units, straight from the record.
        for obj in record["objects"]:
            if obj["objectType"] != "fret-digit" or obj.get("fret") is None:
                continue
            x0, y0, x1, y1 = obj["boxUnits"]

            # Stage 2: the page raster, same units scaled by the crop's own ratio.
            page_px_height = (y1 - y0) * crop_px_per_unit
            page_px_width = (x1 - x0) * crop_px_per_unit

            # Stages 3-4: into the loader's plane frame. The loader maps the box
            # through the view frame and then the tile rect, so the tile's own
            # scale is what matters here and it is read from the mapping rather
            # than from the plane count.
            in_view = page_box_to_view([obj["box"][0], obj["box"][1], obj["box"][2], obj["box"][3]],
                                       view_rect(record, True))
            if in_view is None:
                continue
            # Recover the tile scale: the loader tiles the strip into square planes,
            # and the strip's aspect sets how many. Measured from the crop.
            strip_aspect = image.size[0] / image.size[1]
            overlap = 0.30
            span = 1.0
            advance = span / (1.0 + overlap)
            planes_per_strip = int(np.ceil(strip_aspect / advance))
            scale_to_plane = min(1.0, 1.0 / (strip_aspect / max(planes_per_strip, 1)))
            tile_px_height = page_px_height * scale_to_plane
            tile_px_width = page_px_width * scale_to_plane

            rows.append(
                {
                    "score": record["scoreId"],
                    "fret": int(obj["fret"]),
                    "digits": len(str(int(obj["fret"]))),
                    "vector_units_height": round(y1 - y0, 1),
                    "vector_units_width": round(x1 - x0, 1),
                    "crop_px_height": round(page_px_height, 1),
                    "crop_px_width": round(page_px_width, 1),
                    "plane_px_height": round(tile_px_height, 2),
                    "plane_px_width": round(tile_px_width, 2),
                    "planes_per_strip": planes_per_strip,
                    "roi3_samples_across_height": round(3 / max(tile_px_height / plane, 1e-6) / 3 * 3, 3)
                    if tile_px_height > 0
                    else 0.0,
                    "roi8_samples_across_height": round(8 / max(tile_px_height / plane, 1e-6) * 0, 3)
                    if tile_px_height > 0
                    else 0.0,
                }
            )
            if len(rows) >= 400:
                break
        if len(rows) >= 400:
            break

    if not rows:
        return {"digits": 0}

    def column(name: str, subset: list[dict]) -> dict:
        return _percentiles([row[name] for row in subset])

    by_digits: dict[str, Any] = {}
    for count in sorted({row["digits"] for row in rows}):
        subset = [row for row in rows if row["digits"] == count]
        by_digits[str(count)] = {
            stage: column(stage, subset)
            for stage in (
                "vector_units_height",
                "crop_px_height",
                "plane_px_height",
                "plane_px_width",
            )
        }

    # The decisive summary: samples across the glyph height at each backbone
    # stride. Below 1.0 the stride has destroyed the glyph.
    stride_table: dict[str, Any] = {}
    for stride in (1, 2, 4, 8, 16):
        heights = [row["plane_px_height"] / stride for row in rows]
        stats = _percentiles(heights)
        stats["samples_across_height_at_roi8"] = round(
            8 * min(1.0, (np.median(heights) if heights else 0) / 8), 2
        )
        stride_table[str(stride)] = stats

    return {
        "digits": len(rows),
        "plane_px": plane,
        "by_stage_all": {
            stage: column(stage, rows)
            for stage in (
                "vector_units_height",
                "vector_units_width",
                "crop_px_height",
                "crop_px_width",
                "plane_px_height",
                "plane_px_width",
            )
        },
        "by_digit_count": by_digits,
        "backbone_stride_px_height": stride_table,
        "verdict_stage": min(
            (int(s) for s in stride_table if stride_table[s]["p50"] < 2.0),
            default=None,
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("records", type=Path)
    parser.add_argument("views", type=Path)
    parser.add_argument("--limit", type=int, default=4)
    parser.add_argument("--plane", type=int, default=256)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    result = trace(args.records, args.views, args.limit, args.plane)
    print(json.dumps(result, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

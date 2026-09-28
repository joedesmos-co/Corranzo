#!/usr/bin/env python3
"""Guitar Vision data engine — rasterise the three views.

Writes one PNG per view per score:

  * ``full-page`` — the whole page, carrying barlines, repeats and the staff
    pairing that a crop cannot show;
  * ``notation``  — the notation bands only, at VIEW_SCALE, because noteheads and
    accidentals need the resolution;
  * ``tab``       — the TAB bands only, at VIEW_SCALE, because fret digits are
    roughly half a notehead's height and frets 10-24 are two glyphs.

## Why the crop is done in Pillow, not in the browser

The obvious approach — clip the SVG in the browser — silently produces blank
images. Verovio lays out in its own internal units while the SVG header declares
a nominal page size, and the two disagree by a large factor, so a clip offset
computed in one space is meaningless in the other. The failure is a correctly
sized, entirely white PNG, which is the worst kind of bug: it looks like data.

So the full page is rasterised once and the crops are taken from that one image
with a units-to-pixels factor derived from the record. The PNG and the target
boxes then come from the same render by construction, and a crop that would be
empty is detected and reported rather than written.

Rasterisation goes through headless Chromium because no SVG rasteriser is
installed system-wide (no libcairo) and Playwright is already a project
dependency, which keeps this reproducible on a clean machine.

Usage:
    python3 tools/guitar-vision/rasterize_views.py --records <dir> --svg <dir> --out <dir>
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PAGE_WIDTH = 2100
# Fret digits are about half a notehead's height, so the notation and TAB views
# are rendered wider than the page and then cropped back to their bands.
VIEW_SCALE = 2.0
VIEW_PADDING_PX = 24
VIEW_PADDING_UNITS = 40

VIEW_SCALES = {"full-page": 1.0, "notation": VIEW_SCALE, "tab": VIEW_SCALE}

_RASTERISER = r"""
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const [svgPath, pngPath, width] = process.argv.slice(2)
const svg = readFileSync(svgPath, 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 100, height: 100 } })
await page.setContent(
  `<html><body style="margin:0;background:#fff;line-height:0">` +
  `<div id="wrap" style="width:${width}px;overflow:hidden">${svg}</div></body></html>`,
)
const box = await page.locator('#wrap').boundingBox()
await page.setViewportSize({ width: Math.ceil(width), height: Math.ceil(box.height) })
await page.locator('#wrap').screenshot({ path: pngPath })
await browser.close()
"""

SCRIPT_CACHE: Path | None = None


def _script_path(tmp: Path) -> Path:
    """Write the rasteriser inside the repository.

    It has to live under the repo root, not under the output directory: the script
    imports `playwright`, and Node resolves a package by walking up from the
    *script's* location. A script written to /tmp finds no node_modules and fails
    with a module-not-found error that looks nothing like a rasterisation problem.
    """
    global SCRIPT_CACHE
    if SCRIPT_CACHE is None:
        tmp.mkdir(parents=True, exist_ok=True)
        path = tmp / "gv-rasterise.mjs"
        path.write_text(_RASTERISER)
        SCRIPT_CACHE = path
    return SCRIPT_CACHE


def render_full_page(
    svg_path: Path,
    png_path: Path,
    target_width: int,
    viewbox: tuple[float, float],
    tmp: Path,
) -> tuple[float, bool]:
    """Rasterise the SVG at ``target_width`` and report pixels-per-layout-unit.

    Verovio wraps the page in a nested ``<svg class="definition-scale">`` that
    carries a viewBox in layout units (21000 x 29700) and **no** width or height.
    An inner SVG without dimensions defaults to 100% of the outer box, so
    ``preserveAspectRatio`` scales the viewBox to *fit* and centres it.

    That is where a long chain of confusing failures came from: giving the outer
    SVG a box with the wrong aspect ratio made the page content shrink and
    letterbox, so every target box pointed at empty margin and every crop came
    back blank - while the report cheerfully said "0 objects in view".

    So the outer box keeps the viewBox's aspect ratio, one unit then maps to
    ``target_width / viewbox_width`` pixels, and that is returned rather than
    assumed.
    """
    png_path.parent.mkdir(parents=True, exist_ok=True)
    viewbox_width, viewbox_height = viewbox
    if viewbox_width <= 0 or viewbox_height <= 0:
        return 0.0, False
    target_height = max(1, round(target_width * viewbox_height / viewbox_width))

    svg_text = re.sub(
        r'(<svg\b[^>]*?)\bwidth="[^"]+"([^>]*?)\bheight="[^"]+"',
        lambda m: f'{m.group(1)}width="{target_width}" height="{target_height}"{m.group(2)}',
        svg_path.read_text(),
        count=1,
    )
    sized_path = png_path.with_suffix(".sized.svg")
    sized_path.write_text(svg_text)

    result = subprocess.run(
        ["node", str(_script_path(tmp)), str(sized_path), str(png_path), str(target_width)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    sized_path.unlink(missing_ok=True)
    if result.returncode != 0 or not png_path.exists():
        print(result.stderr[-400:], file=sys.stderr)
        return 0.0, False
    return target_width / viewbox_width, True

def band_box_units(bands: list[dict[str, Any]], is_tab: bool) -> tuple[float, float, float, float] | None:
    """Union box over every band of one kind, in layout units."""
    selected = [band for band in bands if bool(band["isTab"]) == is_tab]
    if not selected:
        return None
    top = min(band["boxUnits"][1] for band in selected)
    bottom = max(band["boxUnits"][3] for band in selected)
    left = min(band["boxUnits"][0] for band in selected)
    right = max(band["boxUnits"][2] for band in selected)
    if bottom - top <= 0 or right - left <= 0:
        return None
    return (left, top, right, bottom)


def crop_view(
    image: Image.Image,
    units_to_px: float,
    box_units: tuple[float, float, float, float] | None,
    scale: float,
    out_path: Path,
) -> tuple[bool, str | None]:
    """Crop a rendered page to a band, upscaled, and report an empty crop."""
    if box_units is None:
        return False, "no bands of this kind on the page"
    left, top, right, bottom = box_units
    left = max(0.0, left - VIEW_PADDING_UNITS)
    top = max(0.0, top - VIEW_PADDING_UNITS)
    right = right + VIEW_PADDING_UNITS
    bottom = bottom + VIEW_PADDING_UNITS

    width, height = image.size
    x0 = max(0, min(width - 1, int(round(left * units_to_px * scale))))
    y0 = max(0, min(height - 1, int(round(top * units_to_px * scale))))
    x1 = max(x0 + 1, min(width, int(round(right * units_to_px * scale))))
    y1 = max(y0 + 1, min(height, int(round(bottom * units_to_px * scale))))
    px = (x0, y0, x1, y1)
    crop = image.crop(px)
    if crop.width < 2 or crop.height < 2:
        return False, f"degenerate crop {crop.size} at {px} of {image.size}"
    # A crop that is uniformly white is a silent failure, not a valid view.
    extrema = crop.convert("L").getextrema()
    if extrema[0] == extrema[1]:
        return False, f"blank crop at {px} of {image.size}"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    crop.save(out_path)
    return True, None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", required=True)
    parser.add_argument("--svg", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    records_dir = Path(args.records)
    svg_dir = Path(args.svg)
    out_dir = Path(args.out)
    tmp = ROOT / "tmp" / "guitar-vision" / "rasterise"
    tmp.mkdir(parents=True, exist_ok=True)

    record_paths = sorted(records_dir.glob("*.record.json"))
    if args.limit:
        record_paths = record_paths[: args.limit]
    if not record_paths:
        print("no records found", file=sys.stderr)
        return 1

    written = 0
    failures: list[str] = []
    per_view = {"full-page": 0, "notation": 0, "tab": 0}
    pages_dir = out_dir / ".pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    for record_path in record_paths:
        record = json.loads(record_path.read_text())
        svg_path = svg_dir / f"{record['scoreId']}.svg"
        if not svg_path.exists():
            failures.append(f"{record['scoreId']}: no svg at {svg_path}")
            continue

        # One render of the widest view; the others are crops of it, so all three
        # views are guaranteed to be the same pixels.
        widest = int(PAGE_WIDTH * VIEW_SCALE)
        page_png = pages_dir / f"{record['scoreId']}.png"
        units_to_px, ok = render_full_page(
            svg_path,
            page_png,
            widest,
            (float(record["viewBoxWidth"]), float(record["viewBoxHeight"])),
            tmp,
        )
        if not ok:
            failures.append(f"{record['scoreId']}: full-page render failed")
            continue
        with Image.open(page_png) as image:
            image.load()
            for view_name in ("full-page", "notation", "tab"):
                scale = VIEW_SCALES[view_name]
                if view_name == "full-page":
                    out_path = out_dir / "full-page" / f"{record['scoreId']}.png"
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    image.resize(
                        (int(image.width / VIEW_SCALE), int(image.height / VIEW_SCALE)),
                        Image.LANCZOS,
                    ).save(out_path)
                    per_view[view_name] += 1
                    continue
                box = band_box_units(record["bands"], is_tab=view_name == "tab")
                ok, reason = crop_view(
                    image,
                    units_to_px,
                    box,
                    1.0,
                    out_dir / view_name / f"{record['scoreId']}.png",
                )
                if ok:
                    per_view[view_name] += 1
                else:
                    failures.append(f"{record['scoreId']}/{view_name}: {reason}")
        written += 1

    try:
        (tmp / "gv-rasterise.mjs").unlink()
        tmp.rmdir()
        for leftover in pages_dir.glob("*.png"):
            leftover.unlink()
        pages_dir.rmdir()
    except OSError:
        pass

    print("Guitar Vision — view rasterisation")
    print("=" * 56)
    print(f"scores processed:   {written}/{len(record_paths)}")
    print(f"full-page views:    {per_view['full-page']}")
    print(f"notation views:     {per_view['notation']}")
    print(f"tab views:          {per_view['tab']}")
    print(f"out:                {out_dir}")
    if failures:
        print(f"failures:           {len(failures)}")
        for failure in failures[:6]:
            print(f"  {failure}")
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())

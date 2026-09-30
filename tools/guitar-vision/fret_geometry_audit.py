"""Audit how Verovio places TAB fret text, and derive the glyph box from it.

## Why this exists

The fret target box was wrong by roughly a factor of four in height: it described
a string gap, not a glyph. The consequences were measured - a crop over the box
put 7.3% of its sample points on ink, and the pixel ablation for the fret head was
exactly 0.00%, meaning the head was not reading anything.

Box constants had been fitted against rendered pixels twice and both attempts
broke the mapping, because a pixel measurement cannot tell a glyph from the staff
line under it. So this does not fit anything. It reads the geometry the engraver
actually used, and measures the glyph in isolation.

## What is read, not guessed

**Vertical placement.** From the SVG: the TAB staff lines are the horizontal
paths in a ``class="staff"`` group that also contains ``tabGrp``, and the digits
are ``<text>`` elements with a baseline. Those two together give the rule exactly:

    baseline = staff_line + font_size / 3

Measured on the rendered corpus: five TAB lines at 4193, 4508, 4823, 5138, 5453
(spacing 315) and five baselines at 4303, 4617, 4931, 5245, 5559. Every baseline
is 106-110 units below its line, which is 0.33 x the 324px font size. Verovio
centres a digit on its line by pushing the baseline down by a third of the font
size, and that is a property of the engraver, not a tuning constant.

**Glyph extents.** Digits are live ``<text>``, so there is no outline geometry to
read. They are measured instead, and measured *in isolation*: the staff lines are
removed from a copy of the SVG before rasterising, so the only ink left is
glyphs. That is the whole reason this measurement is trustworthy - a staff line
and a digit's crossbar are indistinguishable by any threshold applied to a
picture that contains both.

Neither the SVG nor the raster is used for training. This is a diagnostic that
produces the constants the renderer should use, plus the evidence that they are
right.

## What this must never do

The derived box may use the rendered glyph's own geometry. It must not use the
fret *value*: not to place the box, not to select a crop, not to choose an
extent. ``audit`` measures one-digit and two-digit frets together and reports
them separately afterwards, which is a check on the result and not an input to
it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_HERE = Path(__file__).resolve().parent
# _HERE is <repo>/tools/guitar-vision, so parents[1] is the repo root.
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE.parent))

from render_corpus import _iter_groups  # noqa: E402

# A staff line is a horizontal <path> inside a staff group. Removing them from a
# copy of the SVG for measurement leaves only glyphs, and is what makes the
# measurement a glyph measurement rather than a line measurement.
_HORIZONTAL_PATH = re.compile(r'<path d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"[^>]*>')
_TAB_TEXT = re.compile(
    r'<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>\s*<tspan font-size="([\d.]+)px">(\d+)</tspan>',
    re.S,
)


def tab_staff_lines(svg: str) -> list[float]:
    """Y positions of the TAB staff's horizontal lines.

    Read from the paths inside staff groups that contain ``tabGrp``, which is how
    the engraver distinguishes a TAB staff from a notation one. Every horizontal
    path is collected, then collapsed to a set, because a line is drawn in
    segments wherever something interrupts it.
    """
    lines: set[float] = set()
    for body in _iter_groups(svg, "staff"):
        if "tabGrp" not in body:
            continue
        for match in _HORIZONTAL_PATH.finditer(body):
            y0, y1 = float(match.group(2)), float(match.group(4))
            if y0 == y1:
                lines.add(y0)
    return sorted(lines)


def tab_digit_texts(svg: str) -> list[tuple[float, float, float, str]]:
    """``(x, baseline, font_size, digits)`` for every engraved TAB fret."""
    return [
        (float(m.group(1)), float(m.group(2)), float(m.group(3)), m.group(4))
        for m in _TAB_TEXT.finditer(svg)
    ]


def without_staff_lines(svg: str) -> str:
    """A copy of the SVG with the TAB staff's lines removed, for measurement only."""
    lines = tab_staff_lines(svg)
    if not lines:
        return svg
    pattern = re.compile(
        r'<path d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"[^>]*>'
    )

    def drop(match: re.Match) -> str:
        y0, y1 = float(match.group(2)), float(match.group(4))
        if y0 == y1 and any(abs(y0 - line) < 1.0 for line in lines):
            return ""
        return match.group(0)

    return pattern.sub(drop, svg)


def rasterise(svg_path: Path, svg_text: str, target_width: int) -> np.ndarray:
    """Rasterise an SVG and return a 0/1 ink mask.

    Chromium, because that is what the data engine uses and therefore the same
    glyph rasterisation the model will see.
    """
    import subprocess

    script = f"""
const {{ chromium }} = require(process.env.PW_PATH);
(async () => {{
  const browser = await chromium.launch();
  const page = await browser.newPage({{ viewport: {{ width: {target_width}, height: 1000 }} }});
  await page.setContent({json.dumps(svg_text)});
  const el = await page.locator('svg').first();
  await el.screenshot({{ path: process.argv[2], omitBackground: false }});
  await browser.close();
}})();
"""
    script_path = svg_path.with_name("_audit_raster.js")
    out_path = svg_path.with_name("_audit_raster.png")
    script_path.write_text(script)
    os.environ["PW_PATH"] = str(_REPO / "node_modules" / "playwright")
    try:
        subprocess.run(
            ["node", str(script_path), str(out_path)],
            check=True,
            capture_output=True,
            # node resolves `require('playwright')` from the script's directory,
            # and the audit writes its scratch script next to the SVG, which is
            # outside the project. Running with the repo as the working directory
            # and an absolute require path is what makes it resolve.
            cwd=str(_REPO),
        )
        image = Image.open(out_path).convert("L")
        return np.asarray(image) < 200
    finally:
        for path in (script_path, out_path):
            if path.exists():
                path.unlink()


def _line_rows(mask: np.ndarray, threshold: float = 0.75) -> list[int]:
    """Raster rows of the staff lines: rows whose ink spans the page width."""
    if mask.size == 0:
        return []
    rows = np.where(mask.sum(1) > threshold * mask.shape[1])[0]
    return rows.tolist()


def _fit_vertical(mask: np.ndarray, lines: list[float]) -> tuple[float | None, float]:
    """Least-squares fit of ``row = scale * unit_y + offset`` from the staff lines.

    Returns ``(scale, offset)``, or ``(None, 0)`` if there are not enough lines to
    constrain it. Three lines are needed for a two-parameter fit to mean anything.
    """
    rows = _line_rows(mask)
    if len(rows) < 3 or len(lines) < 3:
        return None, 0.0
    count = min(len(rows), len(lines))
    units = np.asarray(lines[:count], dtype=float)
    observed = np.asarray(rows[:count], dtype=float)
    scale, offset = np.polyfit(units, observed, 1)
    return float(scale), float(offset)


def _fit_horizontal_offset(
    mask: np.ndarray, texts: list[tuple[float, float, float, str]], scale: float, offset_y: float
) -> float:
    """The horizontal offset, from the ink actually present.

    The vertical fit fixes the scale; the horizontal origin still has to come from
    somewhere, and taking it from the SVG's declared width is exactly the fragile
    step being avoided here. Centring on the ink column nearest each digit's
    expected x finds it, and the median over all digits rejects the outliers where
    a neighbouring note intrudes into the window.
    """
    offsets = []
    for x, baseline, font_size, _digits in texts:
        cy = int(round(baseline * scale + offset_y))
        half = int(round(font_size * scale * 0.4))
        y0, y1 = max(0, cy - half), min(mask.shape[0], cy + half)
        window = mask[y0:y1]
        cols = np.where(window.any(0))[0]
        if len(cols) == 0:
            continue
        # The nearest ink column to the digit's x, then how far it sits from the
        # position the scale alone would predict.
        expected = x * scale
        nearest = cols[int(np.argmin(np.abs(cols - expected)))]
        offsets.append(float(nearest - expected))
    return float(np.median(offsets)) if offsets else 0.0


def audit(svg_paths: list[Path], target_width: int = 2400) -> dict[str, Any]:
    """Measure the glyph box relative to the baseline and font size."""
    ascent: list[float] = []
    descent: list[float] = []
    half_left: list[float] = []
    half_right: list[float] = []
    per_digits: dict[int, list[tuple[float, float, float]]] = defaultdict(list)
    baseline_rule: list[float] = []
    used_lines: list[float] = []
    used_bases: list[float] = []

    for path in svg_paths:
        svg = path.read_text()
        lines = tab_staff_lines(svg)
        texts = tab_digit_texts(svg)
        if not lines or not texts:
            continue
        for x, baseline, font_size, digits in texts:
            gap = min(abs(baseline - line) for line in lines)
            if gap < font_size:
                baseline_rule.append(gap / font_size)
        # The raster's relationship to layout units is *fitted*, not assumed.
        #
        # The SVG declares its size in pixels while the geometry is in layout
        # units, Verovio nests a second <svg> whose viewBox is in units, and the
        # browser then scales the result to whatever viewport it is given. Any one
        # of those three conversions is easy to get wrong by a constant, and a
        # constant error in the scale turns the measurement into noise - which is
        # exactly what happened: the first run reported a glyph 0.09 font units
        # tall, because the window landed beside the digit rather than on it.
        #
        # So the scale is solved from the staff lines themselves, whose layout-unit
        # positions are known exactly and whose raster rows are unambiguous in a
        # rendering that still has them. Two constraints are enough and are far
        # more robust than assuming the outer svg's width equals its viewBox.
        with_lines = rasterise(path, svg, target_width)
        scale, offset_y = _fit_vertical(with_lines, lines)
        if scale is None:
            continue
        mask = rasterise(path, without_staff_lines(svg), target_width)
        if mask.size == 0:
            continue
        offset_x = _fit_horizontal_offset(mask, texts, scale, offset_y)

        used_lines.extend(lines)
        used_bases.extend(base for _x, base, _f, _d in texts)

        for x, baseline, font_size, digits in texts:
            cx = int(round(x * scale + offset_x))
            cy = int(round(baseline * scale + offset_y))
            half = int(round(font_size * scale * 0.4))
            y0, y1 = max(0, cy - half), min(mask.shape[0], cy + half)
            x0, x1 = max(0, cx - half), min(mask.shape[1], cx + half)
            if y1 <= y0 or x1 <= x0:
                continue
            window = mask[y0:y1, x0:x1]
            rows = np.where(window.any(1))[0]
            cols = np.where(window.any(0))[0]
            if len(rows) == 0 or len(cols) == 0:
                continue
            top = (y0 + rows.min() - cy) / font_size
            bottom = (y0 + rows.max() - cy) / font_size
            left = (x0 + cols.min() - cx) / font_size
            right = (x0 + cols.max() - cx) / font_size
            ascent.append(-top)
            descent.append(bottom)
            half_left.append(-left)
            half_right.append(right)
            per_digits[len(digits)].append((-top, bottom, right - left))

    def stats(values: list[float]) -> dict[str, float]:
        array = np.asarray(values, dtype=float)
        if array.size == 0:
            return {}
        return {
            "n": int(array.size),
            "median": round(float(np.median(array)), 5),
            "p10": round(float(np.percentile(array, 10)), 5),
            "p90": round(float(np.percentile(array, 90)), 5),
        }

    return {
        "baseline_offset_in_font_units": {
            **stats(baseline_rule),
            "note": "baseline - nearest TAB staff line, divided by font size",
        },
        "glyph_ascent_in_font_units": stats(ascent),
        "glyph_descent_in_font_units": stats(descent),
        "half_width_left_in_font_units": stats(half_left),
        "half_width_right_in_font_units": stats(half_right),
        "by_digit_count": {
            str(count): {
                "ascent": stats([v[0] for v in values]),
                "descent": stats([v[1] for v in values]),
                "width": stats([v[2] for v in values]),
            }
            for count, values in sorted(per_digits.items())
        },
        "staff_lines_seen": sorted({round(value) for value in used_lines}),
        "baselines_seen": sorted({round(value) for value in used_bases}),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("svg_dir", type=Path)
    parser.add_argument("--limit", type=int, default=6)
    parser.add_argument("--width", type=int, default=2400)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    paths = sorted(args.svg_dir.glob("*.svg"))[: args.limit]
    if not paths:
        raise SystemExit(f"no SVGs under {args.svg_dir}")
    report = audit(paths, args.width)
    print(json.dumps(report, indent=2))
    if args.out:
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Read the TAB fret glyph geometry from the browser's own font metrics.

## Why the browser and not the raster

Every attempt to measure the glyph from pixels has been defeated by the same
thing: on a TAB staff the glyph shares its neighbourhood with the staff line it
sits on, the rhythm stem rising a staff height above it, and the digits either
side. Four separate passes produced "glyph heights" of 207, 119, 19 and 3 units on
a 315-unit gap, and 100%, 100%, 98% and 0% of windows flagged as clipped. Each was
contaminated by a neighbour and each looked plausible.

The browser already has the answer and it needs no threshold at all.
``SVGTextContentElement.getBBox()`` returns the element's box in user units from
the font's own metrics, and ``getExtentOfChar()`` returns each glyph's advance.
Both are exact, both are computed from the same font and shaping engine that
rasterises the page the model sees, and neither can be confused with a staff line.

## What is read

For every TAB ``<text>`` element:

  - ``getBBox()``            -> the glyph box in layout units
  - ``getExtentOfChar(0/1)`` -> per-digit advance, which is what makes a
    two-digit fret twice as wide as a one-digit one rather than the same width
  - the ``y`` attribute        -> the baseline
  - the enclosing staff line  -> which string the digit is on

The baseline rule falls out of the first and last without being assumed, and is
reported so it can be checked: Verovio centres a digit on its line by setting the
baseline a third of the font size below it. Measured on this corpus: 0.33333.

## What this may not do

Nothing here reads the fret's value to decide where the glyph is. The box is a
function of the font metrics and the text anchor alone. One-digit and two-digit
advances are read because the font reports them, not because the value was known.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
# _HERE is <repo>/tools/guitar-vision, so parents[1] is the repo root.
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE.parent))

from render_corpus import _iter_groups  # noqa: E402

TAB_TEXT = re.compile(
    r'<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>\s*<tspan font-size="([\d.]+)px">(\d+)</tspan>',
    re.S,
)

PROBE = r"""
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  const out = await page.evaluate(() => {
    const results = [];
    for (const text of document.querySelectorAll('text')) {
      const span = text.querySelector('tspan');
      if (!span || !/^[0-9]+$/.test(span.textContent.trim())) continue;
      let box;
      try { box = text.getBBox(); } catch (e) { continue; }
      const chars = [];
      for (let i = 0; i < span.textContent.trim().length; i++) {
        try {
          const e = text.getExtentOfChar(i);
          chars.push({ x: e.x, y: e.y, width: e.width, height: e.height });
        } catch (err) { chars.push(null); }
      }
      results.push({
        digits: span.textContent.trim(),
        x: parseFloat(text.getAttribute('x')),
        baseline: parseFloat(text.getAttribute('y')),
        fontSize: parseFloat(span.getAttribute('font-size')),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        chars,
      });
    }
    return results;
  });
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})();
"""


def tab_line_positions(svg: str) -> list[float]:
    """Layout-unit y of each TAB staff line, from the engraved horizontal paths."""
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


def probe(svg_path: Path) -> list[dict[str, Any]]:
    import os

    # Named .cjs: the repo's package.json declares "type": "module", so a .js
    # file is loaded as an ES module and `require` is undefined in it.
    script = _REPO / "tmp" / "_fret_metrics_probe.cjs"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(PROBE)
    os.environ["PW_PATH"] = str(_REPO / "node_modules" / "playwright")
    try:
        result = subprocess.run(
            ["node", str(script), str(svg_path)],
            check=True,
            capture_output=True,
            cwd=str(_REPO),
        )
        return json.loads(result.stdout.decode())
    finally:
        if script.exists():
            script.unlink()


def report(svg_dir: Path, limit: int) -> dict[str, Any]:
    paths = sorted(svg_dir.glob("*.svg"))[:limit]
    if not paths:
        raise SystemExit(f"no SVGs under {svg_dir}")
    ascent: list[float] = []
    descent: list[float] = []
    top: list[float] = []
    bottom: list[float] = []
    baseline_rule: list[float] = []
    advance_by_count: dict[int, list[float]] = defaultdict(list)
    width_by_count: dict[int, list[float]] = defaultdict(list)
    digits = 0

    for path in paths:
        svg = path.read_text()
        lines = tab_line_positions(svg)
        try:
            entries = probe(path)
        except subprocess.CalledProcessError as error:
            print(f"probe failed on {path.name}: {error.stderr.decode()[:200]}")
            continue
        for entry in entries:
            digits += 1
            font = entry["fontSize"]
            if font <= 0:
                continue
            box = entry["box"]
            top.append((box["y"] - entry["baseline"]) / font)
            bottom.append((box["y"] + box["height"] - entry["baseline"]) / font)
            count = len(entry["digits"])
            width_by_count[count].append(box["width"] / font)
            if entry["chars"] and all(entry["chars"]):
                advance_by_count[count].append(
                    sum(char["width"] for char in entry["chars"][:count]) / font
                )
            if lines:
                gap = min(abs(entry["baseline"] - y) for y in lines)
                baseline_rule.append(gap / font)

    def stats(values: list[float]) -> dict[str, Any]:
        if not values:
            return {}
        import numpy as np

        array = np.asarray(values, dtype=float)
        return {
            "n": int(array.size),
            "median": round(float(np.median(array)), 5),
            "p10": round(float(np.percentile(array, 10)), 5),
            "p90": round(float(np.percentile(array, 90)), 5),
        }

    return {
        "scores": len(paths),
        "digits_probed": digits,
        "baseline_below_staff_line_in_font_units": stats(baseline_rule),
        "box_top_above_baseline_in_font_units": stats(top),
        "box_bottom_below_baseline_in_font_units": stats(bottom),
        "box_width_in_font_units_by_digit_count": {
            str(k): stats(v) for k, v in sorted(width_by_count.items())
        },
        "advance_width_in_font_units_by_digit_count": {
            str(k): stats(v) for k, v in sorted(advance_by_count.items())
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("svg_dir", type=Path)
    parser.add_argument("--limit", type=int, default=6)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    result = report(args.svg_dir, args.limit)
    print(json.dumps(result, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

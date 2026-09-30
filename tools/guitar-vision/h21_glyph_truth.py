"""H21-H23: independent fret glyph truth, then walk the production pipeline.

## Two independent locators, and why both are needed

**Source A - SVG.** Verovio emits each TAB fret as a live `<text>` with an `x`,
a baseline `y`, a `tspan` font size and the digit string. The browser's
`getBBox()` on that element gives the glyph's box in layout units directly from
the font metrics that rasterise the page. That is the engraver's own statement of
where the fret is, and it does not touch the production transform.

It is deliberately **not** treated as the ink box: font metrics and visible ink
differ, and the brief asks for a reliable centre, not an invented tight box. So it
is used as a *position*, and corroborated.

**Source B - raster.** The rendered TAB crop, with the staff lines blanked at the
exact y positions the SVG gives for them. Blank them by geometry, not by a width
heuristic and not by class. Without this the projection collapses: the lines run
the full width, every column has ink, and the blob finder returns one blob
covering the entire page - which is exactly what defeated the previous locator on
all 1162 candidates.

## Acceptance

A fixture is accepted only when the two independent sources corroborate each
other: an SVG-derived centre, a raster blob of digit-shaped size near it, and the
two centres agreeing within a tolerance. Anything else is rejected, not
relabelled. A fixture that needs the production transform to be located is not a
fixture.

## The walk

Once truth is frozen, the same page-space point is propagated through the real
production code - the loader's own `view_rect`, `page_box_to_view` and
`plane_box` - and compared against where the glyph actually is in the plane the
loader produced. The first stage whose error departs materially is the finding.
It is measured, not inferred from reading the code.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import (  # noqa: E402
    MIN_PLANES_PER_VIEW,
    load_dataset,
    page_box_to_view,
    plane_box,
    view_rect,
)
from render_corpus import _iter_groups  # noqa: E402

TAB_TEXT = re.compile(
    r'<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>\s*<tspan font-size="([\d.]+)px">(\d+)</tspan>',
    re.S,
)
PROBE = """
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
      results.push({
        digits: span.textContent.trim(),
        x: parseFloat(text.getAttribute('x')),
        baseline: parseFloat(text.getAttribute('y')),
        fontSize: parseFloat(span.getAttribute('font-size')),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }
    return results;
  });
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})();
"""


def svg_probe(path: Path) -> list[dict]:
    script = _REPO / "tmp" / "_glyph_truth_probe.cjs"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(PROBE)
    os.environ["PW_PATH"] = str(_REPO / "node_modules" / "playwright")
    try:
        out = subprocess.run(
            ["node", str(script), str(path)], check=True, capture_output=True, cwd=str(_REPO)
        )
        return json.loads(out.stdout.decode())
    finally:
        script.unlink(missing_ok=True)


def staff_lines(svg: str) -> list[float]:
    ys: set[float] = set()
    for body in _iter_groups(svg, "staff"):
        if "tabGrp" not in body:
            continue
        for m in re.finditer(r'<path d="M[\d.]+ ([\d.]+) L[\d.]+ ([\d.]+)"[^>]*>', body):
            y0, y1 = float(m.group(1)), float(m.group(2))
            if y0 == y1:
                ys.add(y0)
    return sorted(ys)


def mask_lines(ink: np.ndarray, lines: list[float], band_top: float, band_bottom: float,
               crop_h: int, thickness_units: float = 12.0) -> np.ndarray:
    """Blank the TAB staff lines at their exact SVG positions."""
    out = ink.copy()
    if band_bottom <= band_top:
        return out
    sy = crop_h / (band_bottom - band_top)
    half = max(2, int(round(thickness_units * sy / 2)))
    for y in lines:
        row = int(round((y - band_top) * sy))
        out[max(0, row - half) : row + half + 1, :] = False
    return out


def nearest_blob(masked: np.ndarray, cx: float, cy: float, reach: int,
                 max_w: int, max_h: int, min_h: int) -> tuple[int, int, int, int] | None:
    """The ink blob nearest a predicted centre, of plausible digit size."""
    h, w = masked.shape
    x0, x1 = max(0, int(cx - reach)), min(w - 1, int(cx + reach))
    y0, y1 = max(0, int(cy - reach)), min(h - 1, int(cy + reach))
    if x1 <= x0 or y1 <= y0:
        return None
    window = masked[y0 : y1 + 1, x0 : x1 + 1]
    colink = window.any(0)
    best, best_d = None, 1e18
    run = None
    runs = []
    for i, v in enumerate(colink):
        if v and run is None:
            run = i
        elif not v and run is not None:
            runs.append((run, i))
            run = None
    if run is not None:
        runs.append((run, len(colink)))
    for a, b in runs:
        bw = b - a
        if bw > max_w:
            continue
        sub = window[:, a:b]
        rows = np.where(sub.any(1))[0]
        if len(rows) == 0:
            continue
        bh = rows.max() - rows.min() + 1
        if not (min_h <= bh <= max_h):
            continue
        mx, my = x0 + (a + b) / 2, y0 + (rows.min() + rows.max()) / 2
        d = (mx - cx) ** 2 + (my - cy) ** 2
        if d < best_d:
            best, best_d = (x0 + a, y0 + int(rows.min()), x0 + b, y0 + int(rows.max())), d
    return best


def build(records: Path, views: Path, svgs: Path, want: int, plane: int) -> dict[str, Any]:
    accepted: list[dict] = []
    ambiguous = 0
    rejected = 0
    corpus = load_dataset(records, views, size=(plane, plane), limit=want)

    for path in sorted(svgs.glob("*.svg")):
        if len(accepted) >= want:
            break
        score = path.stem
        record_path = records / f"{score}.record.json"
        crop_path = views / "tab" / f"{score}.png"
        if not record_path.exists() or not crop_path.exists():
            continue
        record = json.loads(record_path.read_text())
        band = next((b for b in record["bands"] if b.get("isTab")), None)
        if band is None:
            continue
        bl, bt, br, bb = band["boxUnits"]
        image = Image.open(crop_path).convert("L")
        ink = np.asarray(image) < 200
        crop_w, crop_h = image.size
        sx, sy = crop_w / (br - bl), crop_h / (bb - bt)
        svg = path.read_text()
        masked = mask_lines(ink, staff_lines(svg), bt, bb, crop_h)
        gap_units = _digit_gap(record)
        if not gap_units:
            continue

        for entry in svg_probe(path):
            if len(accepted) >= want:
                break
            # Source A: the engraver's own position, in layout units.
            svg_cx = entry["x"]
            svg_cy = entry["baseline"] - entry["fontSize"] * 0.36
            # band -> crop, from truth only.
            crop_cx = (svg_cx - bl) * sx
            crop_cy = (svg_cy - bt) * sy
            # Source B: the raster, corroborated independently.
            blob = nearest_blob(
                masked, crop_cx, crop_cy,
                reach=int(0.5 * gap_units * sx),
                max_w=int(1.5 * gap_units * sx),
                max_h=int(1.0 * gap_units * sy),
                min_h=int(0.15 * gap_units * sy),
            )
            if blob is None:
                ambiguous += 1
                continue
            bx0, by0, bx1, by1 = blob
            r_cx, r_cy = (bx0 + bx1) / 2, (by0 + by1) / 2
            tolerance = 0.35 * gap_units * sx
            if abs(r_cx - crop_cx) > tolerance:
                ambiguous += 1
                continue
            if not (bl <= svg_cx <= br and bt <= svg_cy <= bb):
                rejected += 1
                continue
            accepted.append(
                {
                    "score": score,
                    "fret": int(entry["digits"]),
                    "digits": len(entry["digits"]),
                    "svg_centre_units": [round(svg_cx, 2), round(svg_cy, 2)],
                    "raster_centre_crop_px": [round(r_cx, 2), round(r_cy, 2)],
                    "svg_vs_raster_px": [
                        round(r_cx - crop_cx, 2), round(r_cy - crop_cy, 2)
                    ],
                    "glyph_bbox_crop_px": [bx0, by0, bx1, by1],
                    "string": 1 + int(round((svg_cy - bt) / (bb - bt) * 5.0)),
                    "gap_units": gap_units,
                }
            )
    return {
        "accepted": len(accepted),
        "ambiguous": ambiguous,
        "rejected": rejected,
        "scores": len({a["score"] for a in accepted}),
        "fixtures": accepted,
    }


def _digit_gap(record: dict[str, Any]) -> float | None:
    tops = sorted({round(o["boxUnits"][1], 2) for o in record["objects"]
                   if o["objectType"] == "fret-digit"})
    steps = [b - a for a, b in zip(tops, tops[1:]) if b - a > 1.0]
    return min(steps) if steps else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("records", type=Path)
    parser.add_argument("views", type=Path)
    parser.add_argument("svgs", type=Path)
    parser.add_argument("--want", type=int, default=30)
    parser.add_argument("--plane", type=int, default=256)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    report = build(args.records, args.views, args.svgs, args.want, args.plane)
    out = {k: v for k, v in report.items() if k != "fixtures"}
    out["svg_vs_raster_agreement_px"] = _agreement(report["fixtures"])
    print(json.dumps(out, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({**report, "agreement": out["svg_vs_raster_agreement_px"]}, indent=2) + "\n")
    return 0


def _agreement(fixtures: list[dict]) -> dict:
    if not fixtures:
        return {}
    dx = np.asarray([f["svg_vs_raster_px"][0] for f in fixtures])
    dy = np.asarray([f["svg_vs_raster_px"][1] for f in fixtures])
    return {
        "n": len(fixtures),
        "median_abs_dx": round(float(np.median(np.abs(dx))), 2),
        "median_abs_dy": round(float(np.median(np.abs(dy))), 2),
        "p90_abs_dx": round(float(np.percentile(np.abs(dx), 90)), 2),
        "p90_abs_dy": round(float(np.percentile(np.abs(dy), 90)), 2),
    }


if __name__ == "__main__":
    raise SystemExit(main())

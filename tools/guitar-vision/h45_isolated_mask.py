"""H45-H46: isolated target mask, and the page-space box judged against it.

## Why isolation

The last measurement used a 7x7 window at the box centre as a localization
invariant. That was wrong: "0" is hollow, "8" has a waist, "1" is a thin stroke,
and a two-digit fret has space between its digits. A hollow centre is not a
misplaced box, and a metric that cannot distinguish them measures nothing.

What replaces it is a target with no ambiguity in it at all. The exact semantic
TAB ``<text>`` element is identified from the SVG, every other drawable in a clone
of the page is hidden, and the result is rasterised. The mask that comes out
contains that glyph and nothing else - no staff line, no stem, no neighbouring
string, no second digit of its own fret. A bbox of that mask *is* the glyph, and
"does the production box contain it" becomes a question with one answer.

## What this settles first

The page-space comparison, before any downstream transform. Over 129 objects the
record's box centre already agrees with the semantic SVG centre to 0.00 units, so
the question is not position but **size and aspect**: is the box large enough to
hold the glyph it names, and is its shape right?

A box can be perfectly centred and still be unusable if it is too small, and on
this corpus the box is derived from font metrics rather than from the rendered
glyph. So size is tested against the isolated mask directly, not assumed.
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

_HERE = Path(__file__).resolve().parent
# _HERE is <repo>/tools/guitar-vision, so parents[1] is the repo root.
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

# Rasterise the page once per score at the production viewport, then hide
# everything except one <text>. Keeping the same viewport matters: a different one
# rescales the page, and a mask from a different scale would not be comparable.
ISOLATE = """
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const keep = parseInt(process.argv[3], 10);
  const width = parseInt(process.argv[4], 10);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.waitForTimeout(150);
  const texts = await page.evaluate((k) => {
    const all = [...document.querySelectorAll('text')];
    const target = all.filter(t => {
      const s = t.querySelector('tspan');
      return s && /^[0-9]+$/.test(s.textContent.trim());
    })[k];
    if (!target) return null;
    // Hide drawable *leaves* only, and never a group.
    //
    // The previous version hid every element under the svg except the target,
    // which included the target's own ancestors - the layer group and the tabGrp.
    // Hiding an ancestor hides its descendants, so the target was hidden along
    // with them and every mask came back empty. Groups carry transforms, styles,
    // clipping and the positioning context the target depends on, so hiding them
    // for anything but the target's own subtree destroys the target itself.
    const DRAWABLE = new Set(['path', 'use', 'text', 'line', 'rect',
                              'polygon', 'polyline', 'circle', 'ellipse']);
    const inTarget = (el) => el === target || target.contains(el);
    for (const el of document.querySelectorAll('svg *')) {
      if (inTarget(el)) continue;
      if (DRAWABLE.has(el.tagName)) el.style.display = 'none';
    }
    const box = target.getBBox();
    const r = target.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height,
             rx: r.x, ry: r.y, rw: r.width, rh: r.height };
  }, keep);
  const el = await page.locator('svg').first();
  await el.screenshot({ path: process.argv[5], omitBackground: true });
  await browser.close();
  process.stdout.write(JSON.stringify(texts));
})();
"""

PROBE = """
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2400, height: 900 } });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.waitForTimeout(150);
  const out = await page.evaluate(() => {
    const all = [...document.querySelectorAll('text')];
    return all.filter(t => {
      const s = t.querySelector('tspan');
      return s && /^[0-9]+$/.test(s.textContent.trim());
    }).map(t => {
      const s = t.querySelector('tspan');
      const box = t.getBBox();
      return { digits: s.textContent.trim(),
               x: parseFloat(t.getAttribute('x')),
               baseline: parseFloat(t.getAttribute('y')),
               font: parseFloat(s.getAttribute('font-size')),
               box: { x: box.x, y: box.y, w: box.width, h: box.height } };
    });
  });
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})();
"""


def _run(script: str, svg_path: Path, args: list[str]) -> str:
    path = _REPO / "tmp" / ("_h45.cjs" if args else "_h45p.cjs")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(script)
    os.environ["PW_PATH"] = str(_REPO / "node_modules" / "playwright")
    try:
        out = subprocess.run(
            ["node", str(path), str(svg_path), *args],
            check=True,
            capture_output=True,
            cwd=str(_REPO),
        )
        return out.stdout.decode()
    finally:
        path.unlink(missing_ok=True)


def semantic_targets(svg_path: Path) -> list[dict]:
    return json.loads(_run(PROBE, svg_path, []))


def isolate(svg_path: Path, index: int, width: int, out_png: Path) -> dict | None:
    try:
        return json.loads(_run(ISOLATE, svg_path, [str(index), str(width), str(out_png)]))
    except Exception:
        return None


def mask_bbox(png: Path) -> tuple[int, int, int, int] | None:
    from PIL import Image

    with Image.open(png) as image:
        array = np.asarray(image.convert("L"))
    rows = np.where((array < 200).any(1))[0]
    cols = np.where((array < 200).any(0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    return int(cols.min()), int(rows.min()), int(cols.max()), int(rows.max())


def build(records: Path, views: Path, svgs: Path, want: int, width: int, tmp: Path) -> dict:
    from PIL import Image

    rows: list[dict[str, Any]] = []
    ambiguous = rejected = 0

    for path in sorted(svgs.glob("*.svg")):
        if len(rows) >= want:
            break
        score = path.stem
        record_path = records / f"{score}.record.json"
        if not record_path.exists():
            continue
        record = json.loads(record_path.read_text())
        band = next((b for b in record["bands"] if b.get("isTab")), None)
        if band is None:
            continue
        try:
            image = Image.open(views / "tab" / f"{score}.png")
            crop_w, crop_h = image.size
        except Exception:
            continue
        bl, bt, br, bb = band["boxUnits"]
        # SVG units -> crop pixels, from the band rectangle the crop was taken on.
        sx, sy = crop_w / (br - bl), crop_h / (bb - bt)

        try:
            targets = semantic_targets(path)
        except Exception:
            continue
        if not targets:
            continue

        digits = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
        by_value: dict[str, list[int]] = {}
        for k, t in enumerate(targets):
            by_value.setdefault(t["digits"], []).append(k)

        for obj in digits:
            if len(rows) >= want:
                break
            fret = str(int(obj["fret"]))
            candidates = by_value.get(fret, [])
            bu = obj["boxUnits"]
            bcx, bcy = (bu[0] + bu[2]) / 2, (bu[1] + bu[3]) / 2
            # Unique semantic match: the digit string, the page, and an x position
            # within half a line gap. Anything else is ambiguous and is rejected.
            scored = []
            for k in candidates:
                t = targets[k]
                tcy = t["baseline"] - t["font"] * 0.36
                if abs(t["x"] - bcx) > 0.5 * (bb - bt) / 5:
                    continue
                scored.append((abs(t["x"] - bcx), k))
            if len(scored) != 1:
                (ambiguous if scored else rejected).__int__()
                if len(scored) > 1:
                    ambiguous += 1
                else:
                    rejected += 1
                continue
            k = scored[0][1]
            png = tmp / f"{score}_{k}.png"
            info = isolate(path, k, width, png)
            if info is None:
                rejected += 1
                continue
            box = mask_bbox(png)
            png.unlink(missing_ok=True)
            if box is None:
                rejected += 1
                continue
            mx0, my0, mx1, my1 = box
            # Mask bbox in crop pixels, via the element's own screen rect.
            gx0 = info["rx"] * sx
            gy0 = (bb - bt) and (info["ry"] * sy)
            gw = info["rw"] * sx
            gh = info["rh"] * sy
            pbox = [
                (bu[0] - bl) * sx,
                (bu[1] - bt) * sy,
                (bu[2] - bl) * sx,
                (bu[3] - bt) * sy,
            ]
            ix0, iy0 = max(gx0, pbox[0]), max(gy0, pbox[1])
            ix1, iy1 = min(gx0 + gw, pbox[2]), min(gy0 + gh, pbox[3])
            inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
            glyph_area = max(gw * gh, 1e-9)
            rows.append(
                {
                    "score": score,
                    "fret": int(obj["fret"]),
                    "digits": len(fret),
                    "string": 1 + int(round((bcy - bt) / (bb - bt) * 5.0)),
                    "glyph_px": [round(gx0, 1), round(gy0, 1), round(gx0 + gw, 1), round(gy0 + gh, 1)],
                    "box_px": [round(v, 1) for v in pbox],
                    "capture": round(inter / glyph_area, 4),
                    "box_area_ratio": round(
                        ((pbox[2] - pbox[0]) * (pbox[3] - pbox[1])) / glyph_area, 3
                    ),
                    "centre_dx": round((gx0 + gw / 2) - (pbox[0] + pbox[2]) / 2, 2),
                    "centre_dy": round((gy0 + gh / 2) - (pbox[1] + pbox[3]) / 2, 2),
                    "glyph_aspect": round(gw / max(gh, 1e-9), 3),
                    "box_aspect": round(
                        (pbox[2] - pbox[0]) / max(pbox[3] - pbox[1], 1e-9), 3
                    ),
                }
            )
    return _report(rows, ambiguous, rejected)


def _report(rows: list[dict], ambiguous: int, rejected: int) -> dict:
    if not rows:
        return {"accepted": 0, "ambiguous": ambiguous, "rejected": rejected}
    cap = np.asarray([r["capture"] for r in rows])
    dx = np.asarray([r["centre_dx"] for r in rows])
    dy = np.asarray([r["centre_dy"] for r in rows])
    out: dict[str, Any] = {
        "accepted": len(rows),
        "ambiguous": ambiguous,
        "rejected": rejected,
        "scores": len({r["score"] for r in rows}),
        "strings": sorted({r["string"] for r in rows}),
        "glyph_capture_of_box": {
            "median": round(float(np.median(cap)), 4),
            "p10": round(float(np.percentile(cap, 10)), 4),
            "zero_capture_rate": round(float((cap <= 0.0).mean()), 4),
        },
        "centre_dx_px": {"median": round(float(np.median(dx)), 2), "p90": round(float(np.percentile(np.abs(dx), 90)), 2)},
        "centre_dy_px": {"median": round(float(np.median(dy)), 2), "p90": round(float(np.percentile(np.abs(dy), 90)), 2)},
        "by_digit_count": {
            str(k): {
                "n": sum(1 for r in rows if r["digits"] == k),
                "median_capture": round(float(np.median([r["capture"] for r in rows if r["digits"] == k])), 4),
                "median_glyph_aspect": round(float(np.median([r["glyph_aspect"] for r in rows if r["digits"] == k])), 3),
                "median_box_aspect": round(float(np.median([r["box_aspect"] for r in rows if r["digits"] == k])), 3),
                "median_box_area_ratio": round(float(np.median([r["box_area_ratio"] for r in rows if r["digits"] == k])), 3),
            }
            for k in sorted({r["digits"] for r in rows})
        },
    }
    out["sample"] = rows[:6]
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("records", type=Path)
    p.add_argument("views", type=Path)
    p.add_argument("svgs", type=Path)
    p.add_argument("--want", type=int, default=50)
    p.add_argument("--width", type=int, default=2400)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()
    tmp = _REPO / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    report = build(args.records, args.views, args.svgs, args.want, args.width, tmp)
    print(json.dumps({k: v for k, v in report.items() if k != "sample"}, indent=2))
    for r in report.get("sample", []):
        print(
            f"  {r['score'][-6:]} f{r['fret']:>3} d{r['digits']} s{r['string']}  "
            f"capture {r['capture']:.2f}  d({r['centre_dx']:+.1f},{r['centre_dy']:+.1f})  "
            f"glyphAR {r['glyph_aspect']:.2f} boxAR {r['box_aspect']:.2f}"
        )
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

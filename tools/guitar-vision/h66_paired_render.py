"""H66-H71: paired-render differencing, then the page-space size test.

## Why differencing

Screenshot transparency cannot be relied on: the page may be opaque white, Verovio
may emit a background rect, and alpha may be flattened before the PNG is written.
That is what made every isolated mask so far either empty (ancestors hidden) or
the whole page (nothing transparent).

Differencing removes the dependency entirely. Two renders are taken from the same
DOM at the same viewport, differing in exactly one respect:

    A  every drawable leaf except the target suppressed, target kept
    B  the same, plus the target suppressed

Everything else is identical - viewport, dimensions, groups, transforms, styles,
background, defs, clipping - because it is literally the same page. The absolute
difference is then exactly the pixels the target contributes, whatever the
background happens to be. A white background cancels; a background rect cancels; a
target over a staff line cancels the line and leaves the glyph.

## The measurement, and what is deliberately not measured

The verified CTM maps the production box's layout units into the same viewport
pixels the diff mask lives in, so the two are directly comparable. Nothing is
scaled by a crop ratio, an outer width or a nominal factor.

Not measured, because each was wrong before: whether the box centre *has ink* (a
hollow "0" does not), what fraction of the box area is ink, or the nearest blob.
The question is whether the box *contains the glyph*, and the diff mask answers it
without a threshold or a heuristic.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

RENDER = """
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const k = parseInt(process.argv[3], 10);
  const width = parseInt(process.argv[4], 10);
  const hideTarget = process.argv[6] === 'baseline';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.waitForTimeout(150);
  const info = await page.evaluate(({ idx, baseline }) => {
    const all = [...document.querySelectorAll('text')].filter(t => {
      const s = t.querySelector('tspan');
      return s && /^[0-9]+$/.test(s.textContent.trim());
    });
    const target = all[idx];
    if (!target) return null;
    const DRAWABLE = new Set(['path','use','text','line','rect',
                              'polygon','polyline','circle','ellipse']);
    for (const el of document.querySelectorAll('svg *')) {
      if (el === target || target.contains(el)) continue;
      if (DRAWABLE.has(el.tagName)) el.style.display = 'none';
    }
    // B differs from A in exactly one respect: the target is suppressed too.
    if (baseline) target.style.display = 'none';
    const b = target.getBBox();
    const m = target.getScreenCTM();
    return {
      bbox: { x: b.x, y: b.y, w: b.width, h: b.height },
      ctm: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
    };
  }, { idx: k, baseline: hideTarget });
  const el = await page.locator('svg').first();
  const box = await el.boundingBox();
  await el.screenshot({ path: process.argv[5] });
  await browser.close();
  process.stdout.write(JSON.stringify({ info, box }));
})();
"""


def _render(svg: Path, index: int, width: int, out: Path, baseline: bool) -> dict | None:
    script = _REPO / "tmp" / "_h66.cjs"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(RENDER)
    os.environ["PW_PATH"] = str(_REPO / "node_modules" / "playwright")
    try:
        result = subprocess.run(
            ["node", str(script), str(svg), str(index), str(width),
             str(out), "baseline" if baseline else "target"],
            check=True, capture_output=True, cwd=str(_REPO),
        )
        return json.loads(result.stdout.decode())
    finally:
        script.unlink(missing_ok=True)


def build(records: Path, svgs: Path, want: int, width: int, tmp: Path) -> dict[str, Any]:
    from PIL import Image

    rows: list[dict[str, Any]] = []
    rejected = ambiguous = 0
    smoke: dict[str, Any] = {}

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
        bl, bt, br, bb = band["boxUnits"]
        band_span = bb - bt

        # Discover the semantic targets once, at the same viewport the renders use.
        probe_index = _render(path, 0, width, tmp / "_probe.png", False)
        probe_index = None
        targets = _semantic_targets(path)
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
            bu = obj["boxUnits"]
            bcx, bcy = (bu[0] + bu[2]) / 2, (bu[1] + bu[3]) / 2
            tol = 0.6 * band_span / 5
            matches = [
                k for k in by_value.get(fret, [])
                if abs(targets[k]["x"] - bcx) <= tol
                and abs((targets[k]["baseline"] - targets[k]["font"] * 0.36) - bcy) <= tol
            ]
            if len(matches) != 1:
                if matches:
                    ambiguous += 1
                else:
                    rejected += 1
                continue
            k = matches[0]

            a_png, b_png = tmp / "a.png", tmp / "b.png"
            try:
                a_meta = _render(path, k, width, a_png, False)
                b_meta = _render(path, k, width, b_png, True)
            except Exception:
                rejected += 1
                continue
            if not a_meta or not b_meta:
                rejected += 1
                continue
            with Image.open(a_png) as ia, Image.open(b_png) as ib:
                if ia.size != ib.size:
                    rejected += 1
                    continue
                A = np.asarray(ia.convert("L"), dtype=np.int16)
                B = np.asarray(ib.convert("L"), dtype=np.int16)
            diff = np.abs(A - B)
            rows_hit = np.where(diff.max(1) > 8)[0]
            cols_hit = np.where(diff.max(0) > 8)[0]
            if len(rows_hit) == 0 or len(cols_hit) == 0:
                a_png.unlink(missing_ok=True)
                b_png.unlink(missing_ok=True)
                rejected += 1
                continue
            gx0, gx1 = float(cols_hit.min()), float(cols_hit.max()) + 1
            gy0, gy1 = float(rows_hit.min()), float(rows_hit.max()) + 1

            if not smoke:
                tmp.mkdir(parents=True, exist_ok=True)
                Image.fromarray(np.clip(A - B + 128, 0, 255).astype(np.uint8)).save(
                    tmp / "h67_diff.png"
                )
                smoke = {
                    "render_dims_match": ia.size == ib.size,
                    "changed_pixels": int((diff > 8).sum()),
                    "diff_bbox": [gx0, gy0, gx1, gy1],
                    "page_px": list(ia.size),
                    "artifacts": ["tmp/a.png", "tmp/b.png", "tmp/h67_diff.png"],
                }
            a_png.unlink(missing_ok=True)
            b_png.unlink(missing_ok=True)

            m = a_meta["info"]["ctm"]
            corners = [(bu[0], bu[1]), (bu[2], bu[1]), (bu[0], bu[3]), (bu[2], bu[3])]
            bpx = [dict(x=m["a"] * x + m["c"] * y + m["e"],
                        y=m["b"] * x + m["d"] * y + m["f"]) for x, y in corners]
            bx0, by0 = min(p["x"] for p in bpx), min(p["y"] for p in bpx)
            bx1, by1 = max(p["x"] for p in bpx), max(p["y"] for p in bpx)
            ix0, iy0 = max(gx0, bx0), max(gy0, by0)
            ix1, iy1 = min(gx1, bx1), min(gy1, by1)
            inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
            area = max((gx1 - gx0) * (gy1 - gy0), 1e-9)
            rows.append({
                "score": score, "fret": int(obj["fret"]), "digits": len(fret),
                "glyph": [round(gx0, 2), round(gy0, 2), round(gx1, 2), round(gy1, 2)],
                "box": [round(bx0, 2), round(by0, 2), round(bx1, 2), round(by1, 2)],
                "capture": round(inter / area, 4),
                "w_ratio": round((gx1 - gx0) / max(bx1 - bx0, 1e-9), 4),
                "h_ratio": round((gy1 - gy0) / max(by1 - by0, 1e-9), 4),
                "margin_l": round(gx0 - bx0, 2), "margin_r": round(bx1 - gx1, 2),
                "margin_t": round(gy0 - by0, 2), "margin_b": round(by1 - gy1, 2),
                "centre_dx": round((gx0 + gx1) / 2 - (bx0 + bx1) / 2, 2),
                "centre_dy": round((gy0 + gy1) / 2 - (by0 + by1) / 2, 2),
                "glyph_aspect": round((gx1 - gx0) / max(gy1 - gy0, 1e-9), 3),
            })

    return _report(rows, rejected, ambiguous, smoke)


def _semantic_targets(path: Path) -> list[dict]:
    import re

    svg = path.read_text()
    out = []
    for m in re.finditer(
        r'<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>\s*<tspan font-size="([\d.]+)px">(\d+)</tspan>',
        svg, re.S,
    ):
        out.append({
            "x": float(m.group(1)), "baseline": float(m.group(2)),
            "font": float(m.group(3)), "digits": m.group(4),
        })
    return out


def _report(rows, rejected, ambiguous, smoke) -> dict:
    if not rows:
        return {"accepted": 0, "rejected": rejected, "ambiguous": ambiguous, "smoke": smoke}
    cap = np.asarray([r["capture"] for r in rows])
    out = {
        "accepted": len(rows), "rejected": rejected, "ambiguous": ambiguous,
        "scores": len({r["score"] for r in rows}),
        "smoke": smoke,
        "capture": {
            "median": round(float(np.median(cap)), 4),
            "p10": round(float(np.percentile(cap, 10)), 4),
            "zero_rate": round(float((cap <= 0).mean()), 4),
            "full_capture_rate": round(float((cap > 0.999).mean()), 4),
        },
        "centre_dx": {"median": round(float(np.median([r["centre_dx"] for r in rows])), 2),
                      "p90": round(float(np.percentile(np.abs([r["centre_dx"] for r in rows]), 90)), 2)},
        "centre_dy": {"median": round(float(np.median([r["centre_dy"] for r in rows])), 2),
                      "p90": round(float(np.percentile(np.abs([r["centre_dy"] for r in rows]), 90)), 2)},
        "by_digit_count": {
            str(k): {
                "n": sum(1 for r in rows if r["digits"] == k),
                "median_capture": round(float(np.median([r["capture"] for r in rows if r["digits"] == k])), 4),
                "median_glyph_aspect": round(float(np.median([r["glyph_aspect"] for r in rows if r["digits"] == k])), 3),
                "median_w_ratio": round(float(np.median([r["w_ratio"] for r in rows if r["digits"] == k])), 4),
                "median_h_ratio": round(float(np.median([r["h_ratio"] for r in rows if r["digits"] == k])), 4),
                "median_margins": {
                    s: round(float(np.median([r[f"margin_{s}"] for r in rows if r["digits"] == k])), 2)
                    for s in ("l", "r", "t", "b")
                },
            }
            for k in sorted({r["digits"] for r in rows})
        },
        "fret0": [r for r in rows if r["fret"] == 0][:3],
        "sample": rows[:6],
    }
    # Verdict, from the numbers only.
    full = cap > 0.999
    if float(np.median(cap)) > 0.95:
        out["verdict"] = "A: page-space box position AND size cleared; fault is downstream"
    elif float(np.median([r["h_ratio"] for r in rows])) > 1.0:
        out["verdict"] = "B: vertical clipping - box too short"
    elif float(np.median([r["w_ratio"] for r in rows])) > 1.0:
        out["verdict"] = "C: horizontal clipping - box too narrow"
    else:
        out["verdict"] = "mixed - needs per-class breakdown before any verdict"
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("records", type=Path)
    p.add_argument("svgs", type=Path)
    p.add_argument("--want", type=int, default=50)
    p.add_argument("--width", type=int, default=2400)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()
    tmp = _REPO / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    report = build(args.records, args.svgs, args.want, args.width, tmp)
    print(json.dumps({k: v for k, v in report.items() if k not in ("sample", "fret0")}, indent=2))
    for r in report.get("sample", []):
        print(f"  {r['score'][-6:]} f{r['fret']:>3} d{r['digits']} capture {r['capture']:.3f} "
              f"w/h {r['w_ratio']:.2f}/{r['h_ratio']:.2f} "
              f"margins l{r['margin_l']:.1f} r{r['margin_r']:.1f} t{r['margin_t']:.1f} b{r['margin_b']:.1f}")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

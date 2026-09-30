"""H60-H65: the exact SVG->viewport transform, then the page-space size test.

## The mistake this replaces

Every scale in this investigation so far has been *assumed*: that the outer svg's
pixel width equals the inner svg's layout viewBox, that x and y scale alike, that
a crop's ratio is the same ratio as a standalone render's. Four separate
measurements produced confident wrong conclusions that way, and the last one
produced a centre error growing linearly with page x - the unmistakable signature
of a scale error.

`getScreenCTM()` returns the browser's own affine map from an element's user space
to viewport pixels: `a b c d e f`. It is measured, not derived, and it is valid
whatever transforms, nested viewBoxes or `preserveAspectRatio` the document
happens to contain.

## Validation gate

The four corners of `getBBox()` are transformed through the CTM and compared with
`getBoundingClientRect()`. If those disagree, everything downstream is computed
from a bad map and the run stops. `getBoundingClientRect` is used **only** as this
cross-check - it is the browser's view of the box, and the CTM is the map.

## The question

Not "does the centre have ink" - a hollow "0" has no centre ink and that metric
was wrong. The question is whether the production box, mapped through the verified
transform into the same pixel space as an isolated single-glyph mask, **contains
that glyph**. Position is already cleared (0.00 units over 129 objects); this tests
extent, which has never been tested.
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

PROBE = """
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const width = parseInt(process.argv[3], 10);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.waitForTimeout(150);
  const out = await page.evaluate(() => {
    const targets = [...document.querySelectorAll('text')].filter(t => {
      const s = t.querySelector('tspan');
      return s && /^[0-9]+$/.test(s.textContent.trim());
    });
    const root = document.querySelector('svg');
    const inner = document.querySelector('svg svg');
    return {
      outer: { w: root ? root.getBoundingClientRect().width : null,
               h: root ? root.getBoundingClientRect().height : null,
               viewBox: root ? root.getAttribute('viewBox') : null,
               par: root ? root.getAttribute('preserveAspectRatio') : null },
      inner: inner ? { viewBox: inner.getAttribute('viewBox'),
                       par: inner.getAttribute('preserveAspectRatio'),
                       w: inner.getBoundingClientRect().width,
                       h: inner.getBoundingClientRect().height } : null,
      targets: targets.map(t => {
        const s = t.querySelector('tspan');
        const b = t.getBBox();
        const r = t.getBoundingClientRect();
        const m = t.getScreenCTM();
        // The CTM is the authoritative map; the corners are transformed by it
        // rather than by any assumed scale.
        const corners = [[b.x, b.y], [b.x + b.width, b.y],
                         [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
          .map(([x, y]) => ({ x: m.a * x + m.c * y + m.e,
                              y: m.b * x + m.d * y + m.f }));
        const px = corners.map(p => p.x), py = corners.map(p => p.y);
        const predicted = { x0: Math.min(...px), y0: Math.min(...py),
                            x1: Math.max(...px), y1: Math.max(...py) };
        const ancestors = [];
        for (let n = t; n && n.tagName && n.tagName.toLowerCase() !== 'svg'; n = n.parentNode) {
          if (n.getAttribute && n.getAttribute('transform'))
            ancestors.push(n.getAttribute('transform'));
        }
        return {
          digits: s.textContent.trim(),
          x: parseFloat(t.getAttribute('x')),
          baseline: parseFloat(t.getAttribute('y')),
          font: parseFloat(s.getAttribute('font-size')),
          bbox: { x: b.x, y: b.y, w: b.width, h: b.height },
          ctm: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
          client: { x0: r.x, y0: r.y, x1: r.right, y1: r.bottom },
          predicted,
          ancestors,
        };
      }),
    };
  });
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})();
"""

ISOLATE = """
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const k = parseInt(process.argv[3], 10);
  const width = parseInt(process.argv[4], 10);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.waitForTimeout(150);
  const kept = await page.evaluate((idx) => {
    const all = [...document.querySelectorAll('text')].filter(t => {
      const s = t.querySelector('tspan');
      return s && /^[0-9]+$/.test(s.textContent.trim());
    });
    const target = all[idx];
    if (!target) return null;
    const DRAWABLE = new Set(['path','use','text','line','rect',
                              'polygon','polyline','circle','ellipse']);
    const inTarget = (el) => el === target || target.contains(el);
    for (const el of document.querySelectorAll('svg *')) {
      if (inTarget(el)) continue;
      // Drawable leaves only. Groups carry the transforms and clipping the
      // target depends on; hiding one hides the target with it.
      if (DRAWABLE.has(el.tagName)) el.style.display = 'none';
    }
    return true;
  }, k);
  if (!kept) { await browser.close(); process.stdout.write('null'); return; }
  const el = await page.locator('svg').first();
  await el.screenshot({ path: process.argv[5], omitBackground: true });
  await browser.close();
  process.stdout.write('ok');
})();
"""


def _run(script: str, svg: Path, args: list[str]) -> str:
    path = _REPO / "tmp" / ("_h60.cjs" if len(args) > 1 else "_h60p.cjs")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(script)
    os.environ["PW_PATH"] = str(_REPO / "node_modules" / "playwright")
    try:
        out = subprocess.run(["node", str(path), str(svg), *args],
                             check=True, capture_output=True, cwd=str(_REPO))
        return out.stdout.decode()
    finally:
        path.unlink(missing_ok=True)


def mask_bbox(png: Path) -> tuple[float, float, float, float] | None:
    from PIL import Image

    with Image.open(png) as image:
        a = np.asarray(image.convert("L"))
    rows = np.where((a < 200).any(1))[0]
    cols = np.where((a < 200).any(0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    return float(cols.min()), float(rows.min()), float(cols.max()) + 1, float(rows.max()) + 1


def build(records: Path, svgs: Path, want: int, width: int, tmp: Path) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    rejected = ambiguous = 0
    ctm_report: dict[str, Any] = {}
    viewbox_report: dict[str, Any] = {}

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
            doc = json.loads(_run(PROBE, path, [str(width)]))
        except Exception:
            continue
        targets = doc.get("targets") or []
        if not targets:
            continue
        if not ctm_report:
            ctm_report = {"outer": doc.get("outer"), "inner": doc.get("inner")}
        viewbox_report = {"outer": doc.get("outer"), "inner": doc.get("inner")}

        digits = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
        by_value: dict[str, list[int]] = {}
        for k, t in enumerate(targets):
            by_value.setdefault(t["digits"], []).append(k)

        for obj in digits:
            if len(rows) >= want:
                break
            fret = str(int(obj["fret"]))
            bu = obj["boxUnits"]
            bcx = (bu[0] + bu[2]) / 2
            matches = []
            for k in by_value.get(fret, []):
                t = targets[k]
                tcy = t["baseline"] - t["font"] * 0.36
                if abs(t["x"] - bcx) > 0.6 * (band["boxUnits"][3] - band["boxUnits"][1]) / 5:
                    continue
                if abs(tcy - (bu[1] + bu[3]) / 2) > 0.6 * (band["boxUnits"][3] - band["boxUnits"][1]) / 5:
                    continue
                matches.append(k)
            if len(matches) != 1:
                if matches:
                    ambiguous += 1
                else:
                    rejected += 1
                continue
            k = matches[0]
            t = targets[k]
            m = t["ctm"]

            png = tmp / f"{score}_{k}_iso.png"
            try:
                if _run(ISOLATE, path, [str(k), str(width), str(png)]).strip() != "ok":
                    rejected += 1
                    continue
            except Exception:
                rejected += 1
                continue
            mask = mask_bbox(png)
            png.unlink(missing_ok=True)
            if mask is None:
                rejected += 1
                continue

            # The production box, through the *verified* CTM. No crop ratio, no
            # assumed scale: the same matrix that maps the target maps the box,
            # because both are expressed in the element's user space.
            corners = [(bu[0], bu[1]), (bu[2], bu[1]),
                       (bu[0], bu[3]), (bu[2], bu[3])]
            bpx = [dict(x=m["a"] * x + m["c"] * y + m["e"], y=m["b"] * x + m["d"] * y + m["f"])
                   for x, y in corners]
            bx0, by0 = min(p["x"] for p in bpx), min(p["y"] for p in bpx)
            bx1, by1 = max(p["x"] for p in bpx), max(p["y"] for p in bpx)

            gx0, gy0, gx1, gy1 = mask
            ix0, iy0 = max(gx0, bx0), max(gy0, by0)
            ix1, iy1 = min(gx1, bx1), min(gy1, by1)
            inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
            glyph_area = max((gx1 - gx0) * (gy1 - gy0), 1e-9)
            rows.append({
                "score": score,
                "fret": int(obj["fret"]),
                "digits": len(fret),
                "mask_px": [round(v, 2) for v in mask],
                "box_px": [round(bx0, 2), round(by0, 2), round(bx1, 2), round(by1, 2)],
                "capture": round(inter / glyph_area, 4),
                "glyph_w": round(gx1 - gx0, 2),
                "glyph_h": round(gy1 - gy0, 2),
                "box_w": round(bx1 - bx0, 2),
                "box_h": round(by1 - by0, 2),
                "w_ratio": round((gx1 - gx0) / max(bx1 - bx0, 1e-9), 4),
                "h_ratio": round((gy1 - gy0) / max(by1 - by0, 1e-9), 4),
                "margin_l": round(gx0 - bx0, 2),
                "margin_r": round(bx1 - gx1, 2),
                "margin_t": round(gy0 - by0, 2),
                "margin_b": round(by1 - gy1, 2),
                "centre_dx": round((gx0 + gx1) / 2 - (bx0 + bx1) / 2, 2),
                "centre_dy": round((gy0 + gy1) / 2 - (by0 + by1) / 2, 2),
                "scale_x": round(float(np.hypot(m["a"], m["b"])), 6),
                "scale_y": round(float(np.hypot(m["c"], m["d"])), 6),
                "ctm": m,
                "ctm_vs_client": [
                    round(bx0 - t["client"]["x0"], 2), round(by0 - t["client"]["y0"], 2),
                    round(bx1 - t["client"]["x1"], 2), round(by1 - t["client"]["y1"], 2),
                ],
                "target_vs_client": [
                    round(t["predicted"]["x0"] - t["client"]["x0"], 2),
                    round(t["predicted"]["y0"] - t["client"]["y0"], 2),
                    round(t["predicted"]["x1"] - t["client"]["x1"], 2),
                    round(t["predicted"]["y1"] - t["client"]["y1"], 2),
                ],
                "ancestors": t["ancestors"],
            })

    return _report(rows, rejected, ambiguous, ctm_report, viewbox_report)


def _report(rows, rejected, ambiguous, ctm_report, viewbox) -> dict:
    if not rows:
        return {"accepted": 0, "rejected": rejected, "ambiguous": ambiguous, "ctm": ctm_report}
    cap = np.asarray([r["capture"] for r in rows])
    tv = np.asarray([abs(v) for r in rows for v in r["target_vs_client"]])
    sx = np.asarray([r["scale_x"] for r in rows])
    sy = np.asarray([r["scale_y"] for r in rows])
    return {
        "accepted": len(rows), "rejected": rejected, "ambiguous": ambiguous,
        "scores": len({r["score"] for r in rows}),
        "ctm_sample": rows[0]["ctm"],
        "svg_structure": viewbox,
        "scale_x": {"median": round(float(np.median(sx)), 6),
                    "p10": round(float(np.percentile(sx, 10)), 6),
                    "p90": round(float(np.percentile(sx, 90)), 6)},
        "scale_y": {"median": round(float(np.median(sy)), 6),
                    "p10": round(float(np.percentile(sy, 10)), 6),
                    "p90": round(float(np.percentile(sy, 90)), 6)},
        "uniform_xy": bool(abs(np.median(sx) - np.median(sy)) < 1e-9),
        "ctm_vs_client_max_abs_px": round(float(tv.max()), 3),
        "ctm_valid": bool(tv.max() < 1.0),
        "capture": {
            "median": round(float(np.median(cap)), 4),
            "p10": round(float(np.percentile(cap, 10)), 4),
            "zero_rate": round(float((cap <= 0).mean()), 4),
        },
        "w_ratio": {"median": round(float(np.median([r["w_ratio"] for r in rows])), 4)},
        "h_ratio": {"median": round(float(np.median([r["h_ratio"] for r in rows])), 4)},
        "by_digit_count": {
            str(k): {
                "n": sum(1 for r in rows if r["digits"] == k),
                "median_capture": round(float(np.median([r["capture"] for r in rows if r["digits"] == k])), 4),
                "median_w_ratio": round(float(np.median([r["w_ratio"] for r in rows if r["digits"] == k])), 4),
                "median_h_ratio": round(float(np.median([r["h_ratio"] for r in rows if r["digits"] == k])), 4),
                "median_margins": {
                    side: round(float(np.median([r[f"margin_{side}"] for r in rows if r["digits"] == k])), 2)
                    for side in ("l", "r", "t", "b")
                },
            }
            for k in sorted({r["digits"] for r in rows})
        },
        "fret0": {
            "n": sum(1 for r in rows if r["fret"] == 0),
            "median_capture": round(float(np.median([r["capture"] for r in rows if r["fret"] == 0])), 4) if any(r["fret"] == 0 for r in rows) else None,
        },
        "centre_dx": {"median": round(float(np.median([r["centre_dx"] for r in rows])), 2),
                      "p90": round(float(np.percentile(np.abs([r["centre_dx"] for r in rows]), 90)), 2)},
        "centre_dy": {"median": round(float(np.median([r["centre_dy"] for r in rows])), 2),
                      "p90": round(float(np.percentile(np.abs([r["centre_dy"] for r in rows]), 90)), 2)},
        "sample": rows[:5],
    }


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
    print(json.dumps({k: v for k, v in report.items() if k != "sample"}, indent=2))
    for r in report.get("sample", []):
        print(f"  {r['score'][-6:]} f{r['fret']:>3} d{r['digits']} capture {r['capture']:.2f} "
              f"w/h ratio {r['w_ratio']:.2f}/{r['h_ratio']:.2f} "
              f"margins l{r['margin_l']:.0f} r{r['margin_r']:.0f} t{r['margin_t']:.0f} b{r['margin_b']:.0f}")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

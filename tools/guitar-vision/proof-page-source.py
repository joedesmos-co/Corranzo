"""Page source: committed workdir PNG/SVG -> usable page image + transform.

The committed page PNGs are letterboxed (verovio renders its SVG at the
natural `width="878px"` inside a 2100px canvas), so content occupies
only ~40% of the frame and the detector - tuned on full-frame pages -
cannot see TAB glyphs. This module derives the correct mapping and
optionally re-frames the content so it fills the frame.

Coordinate chain (see tools/guitar-vision/render_corpus.py):
  layout units -> (content crop, letterbox px via svgw/viewBoxW)
               -> (rescale to frame width)

Everything here is deterministic and reads only committed assets.
"""
from __future__ import annotations
import json, re
from pathlib import Path
import numpy as np
from PIL import Image

W = Path('/Users/ryland/Documents/scoreflow-guitar')


def svg_units(svg_path: Path) -> tuple[float, float] | None:
    """(svg width px, viewBox width units) from the verovio SVG."""
    try:
        head = svg_path.read_text()[:30000]
    except Exception:
        return None
    m = re.search(r'<svg width="(\d+(?:\.\d+)?)px"', head)
    v = re.search(r'viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"', head)
    if not m or not v:
        return None
    return float(m.group(1)), float(v.group(1))


def png_path(workdir: str, layout: str, page_no: int) -> Path | None:
    base = W / workdir
    if layout == 'standard':
        cands = ([base / 'page-w2100.png'] if page_no == 1 else []) + \
                [base / f'page-p{page_no}-w2100.png']
    else:
        cands = ([base / f'page-{layout}-w2100.png'] if page_no == 1 else []) + \
                [base / f'page-{layout}-p{page_no}-w2100.png']
    for c in cands:
        if c.exists():
            return c
    return None


def svg_path(workdir: str, layout: str, page_no: int) -> Path | None:
    base = W / workdir
    name = 'render.svg' if layout == 'standard' else f'render-{layout}.svg'
    cands = []
    if page_no == 1:
        cands.append(base / name)
    else:
        cands += [base / name.replace('.svg', f'-p{page_no}.svg'),
                  base / name.replace('.svg', f'{page_no}.svg')]
    for c in cands:
        if c.exists():
            return c
    return None


def load_page(workdir: str, layout: str, page_no: int, reframe: bool = True,
              frame_width: int = 2100):
    """Return dict(image, fx, fy, ox, oy).

    Pixel mapping for a box in LAYOUT UNITS: x_px = x*fx - ox,
    y_px = y*fy - oy (letterbox -> crop -> rescale). reframe=True crops
    the letterboxed content and rescales it to fill `frame_width`, which
    is what the detector needs.
    """
    png = png_path(workdir, layout, page_no)
    if png is None:
        return None
    svg = svg_path(workdir, layout, page_no)
    su = svg_units(svg) if svg else None
    if su is None:
        return None
    svgw, vbw = su
    u8 = np.asarray(Image.open(png).convert('L')).astype(np.uint8)
    fx0 = svgw / vbw  # units -> letterbox px
    if not reframe:
        return {'image': u8, 'fx': fx0, 'fy': fx0, 'ox': 0.0, 'oy': 0.0}
    ink = u8 < 128
    cols = np.nonzero(ink.any(axis=0))[0]
    rows = np.nonzero(ink.any(axis=1))[0]
    if not len(cols):
        return {'image': u8, 'fx': fx0, 'fy': fx0, 'ox': 0.0, 'oy': 0.0}
    x0, x1 = max(int(cols.min()) - 6, 0), min(int(cols.max()) + 6, u8.shape[1] - 1)
    y0, y1 = max(int(rows.min()) - 6, 0), min(int(rows.max()) + 6, u8.shape[0] - 1)
    im = Image.fromarray(u8).crop((x0, y0, x1 + 1, y1 + 1))
    sc = frame_width / im.size[0]
    up = im.resize((frame_width, int(round(im.size[1] * sc))), Image.LANCZOS)
    u8b = np.asarray(up, dtype=np.uint8)
    fx = fx0 * sc
    return {'image': u8b, 'fx': fx, 'fy': fx, 'ox': x0 * sc, 'oy': y0 * sc}


# ---------------------------------------------------------------------------
# Native rendering at a controlled staff gap (M1/M2)
# ---------------------------------------------------------------------------
_RENDER_JS = r"""
const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
  const [svgPath, pngPath, width] = process.argv.slice(2);
  let svg = fs.readFileSync(svgPath, 'utf8');
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  const W = Number(width);
  const H = Math.round(W * Number(vb[2]) / Number(vb[1]));
  // Only the outer <svg> size is overridden; the nested definition-scale
  // svg has no width/height of its own so it inherits the outer viewport
  // and its viewBox scales the units to W. No content is rewritten.
  svg = svg.replace(/<svg width="\d+px" height="\d+px"/, `<svg width="${W}px" height="${H}px"`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
  await page.setContent(`<html><body style="margin:0;background:#fff;line-height:0">` +
    `<div id="wrap" style="width:${W}px;overflow:hidden">${svg}</div></html>`);
  const box = await page.locator('#wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
  await page.locator('#wrap').screenshot({ path: pngPath });
  await browser.close();
})();
"""


def measure_gap(u8: np.ndarray) -> float | None:
    """Median in-system staff-line gap in px (image only)."""
    h, w = u8.shape
    if w < 100 or h < 100:
        return None
    prof = (u8[:, int(w * 0.2):int(w * 0.8)] < 128).mean(axis=1)
    rows = np.nonzero(prof > 0.3)[0]
    if len(rows) < 5:
        return None
    bands, start, prev = [], rows[0], rows[0]
    for r in rows[1:]:
        if r - prev > 2:
            bands.append((start + prev) / 2)
            start = r
        prev = r
    bands.append((start + prev) / 2)
    if len(bands) < 5:
        return None
    small = [g for g in np.diff(bands) if g < 100]
    if len(small) < 4:
        return None
    return float(np.median(small))


def _node_script() -> Path:
    """The chromium renderer script (cached; needs the repo node_modules).

    Written under /tmp and invoked with NODE_PATH so `require('playwright')`
    resolves against the repo's own node_modules without touching it.
    """
    p = Path('/tmp/proof/gv-render.cjs')
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(_RENDER_JS)
    return p


def _node_env() -> dict:
    import os
    env = dict(os.environ)
    nm = str(W / 'node_modules')
    env['NODE_PATH'] = nm + (os.pathsep + env['NODE_PATH'] if env.get('NODE_PATH') else '')
    return env


def render_at_gap(workdir: str, layout: str, page_no: int, target_gap: float = 26.0,
                  cache_root: str = '/tmp/proof/gv-render') -> dict | None:
    """Render the committed SVG so the measured staff gap == target_gap.

    Returns dict(image, fx, fy, ox, oy, gap, width). Deterministic: the
    same inputs always produce the same raster width, so the cache key is
    stable and regeneration is reproducible (no session state needed).

    The staff gap is MEASURED from the committed letterbox raster (in
    units, via the SVG's own svg-width/viewBox ratio), then the render
    width is solved for the target gap. No fixed page width is assumed.
    """
    import subprocess
    png = png_path(workdir, layout, page_no)
    svg = svg_path(workdir, layout, page_no)
    if png is None or svg is None:
        return None
    su = svg_units(svg)
    if su is None:
        return None
    svgw, vbw = su
    # Measure the staff gap on the RE-FRAMED raster (content fills the
    # frame there, so the row profile is reliable; on the letterbox
    # original the systems are tiny and the estimator drifts).
    reframed = load_page(workdir, layout, page_no, reframe=True)
    if reframed is None:
        return None
    gap_px = measure_gap(reframed['image'])
    if gap_px is None:
        return None
    gap_units = gap_px / reframed['fx']    # staff gap in layout units
    width = int(round(target_gap * vbw / gap_units))
    layout_dir = Path(cache_root) / layout / Path(workdir).name
    layout_dir.mkdir(parents=True, exist_ok=True)
    out = layout_dir / f'p{page_no}-g{target_gap:g}.png'
    if not out.exists():
        r = subprocess.run(['node', str(_node_script()), str(svg), str(out), str(width)],
                           capture_output=True, text=True, cwd=str(W), env=_node_env())
        if r.returncode != 0 or not out.exists():
            return None
    u8 = np.asarray(Image.open(out).convert('L')).astype(np.uint8)
    # Crop to ink (does not change the gap) and record the origin so
    # layout units map as x_px = x*fx - ox.
    ink = u8 < 128
    cols = np.nonzero(ink.any(axis=0))[0]
    rows = np.nonzero(ink.any(axis=1))[0]
    if not len(cols):
        return None
    ox = float(max(int(cols.min()) - 4, 0))
    oy = float(max(int(rows.min()) - 4, 0))
    x1 = min(int(cols.max()) + 4, u8.shape[1] - 1)
    y1 = min(int(rows.max()) + 4, u8.shape[0] - 1)
    img = Image.fromarray(u8).crop((int(ox), int(oy), x1 + 1, y1 + 1))
    fx = width / vbw
    return {'image': np.asarray(img, dtype=np.uint8), 'fx': fx, 'fy': fx,
            'ox': ox, 'oy': oy, 'gap': measure_gap(np.asarray(img, dtype=np.uint8)) or target_gap,
            'width': width}

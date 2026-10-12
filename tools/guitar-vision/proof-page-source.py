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

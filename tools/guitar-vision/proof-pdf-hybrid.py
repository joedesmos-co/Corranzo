"""PDF text-layer TAB recognition prototype (hybrid).

For a PDF page:
  1. rasterise (pymupdf) at the page's own resolution, no font override
  2. extract text spans (PyMuPDF get_text('dict'))
  3. classify digit-like spans: pure int 0-19, small width/height
  4. detect TAB staves from the raster (contiguous horizontal runs)
  5. keep a digit span only if it sits on a detected TAB staff line
  6. (optional) de-duplicate spans that overlap
Reports the recovered digit count, fonts, and staff geometry.

Usage:
  python3 tools/guitar-vision/proof-pdf-hybrid.py --pdf PATH --page 0
"""
import argparse, json, os, re, sys
from pathlib import Path
import fitz
import numpy as np
from PIL import Image

W = Path('/Users/ryland/Documents/scoreflow-guitar')


def rasterize(page, dpi=150):
    pix = page.get_pixmap(dpi=dpi)
    return np.asarray(Image.frombytes('RGB', [pix.width, pix.height], pix.samples).convert('L')).astype(np.uint8), pix


def staff_lines(u8, minrun=40):
    ink = u8 < 128
    h, w = ink.shape
    runs = np.zeros(h, dtype=np.int32)
    for y in range(h):
        ch = np.flatnonzero(ink[y])
        if not len(ch):
            continue
        brk = np.flatnonzero(np.diff(ch) > 1)
        st = np.concatenate(([0], brk + 1))
        en = np.concatenate((brk, [len(ch) - 1]))
        runs[y] = int((ch[en] - ch[st] + 1).max())
    rows = np.nonzero(runs >= minrun)[0]
    bands, st, pv = [], rows[0], rows[0] if len(rows) else 0
    for r in rows[1:]:
        if r - pv > 3:
            bands.append((st, pv))
            st = r
        pv = r
    if len(rows) >= 1:
        bands.append((st, pv))
    return bands, runs


def tab_staves(bands):
    """Group 5-6 line runs with consistent gap into TAB staves."""
    mids = [(a + b) / 2 for a, b in bands]
    out = []
    i = 0
    while i + 5 <= len(mids):
        m = mids[i:i + 6]
        gaps = [b - a for a, b in zip(m, m[1:])]
        mg = sum(gaps) / 5.0
        if mg < 3 or mg > 60:
            i += 1
            continue
        cv = (sum((g - mg) ** 2 for g in gaps) / 5.0) ** 0.5 / mg
        if cv <= 0.20:
            out.append((m[0], m[-1], mg))
            i += 6
        else:
            i += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--page', type=int, default=0)
    ap.add_argument('--dpi', type=int, default=150)
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    page = doc[args.page]
    u8, pix = rasterize(page, args.dpi)
    scale = pix.width / page.rect.width  # px per pt

    # text spans
    spans = []
    for b in page.get_text('dict')['blocks']:
        if 'lines' not in b:
            continue
        for l in b['lines']:
            for s in l['spans']:
                txt = s['text'].strip()
                if not txt:
                    continue
                spans.append({'text': txt, 'font': s['font'], 'size': round(s['size'], 1),
                              'bbox': [round(x * scale, 1) for x in s['bbox']]})

    # digit-like: pure int 0-19, small span
    digits = []
    for s in spans:
        if s['text'].isdigit() and 0 <= int(s['text']) <= 19:
            w = s['bbox'][2] - s['bbox'][0]
            h = s['bbox'][3] - s['bbox'][1]
            if w < 40 and h < 30:
                digits.append(s)

    # staff lines
    bands, _ = staff_lines(u8, minrun=40)
    staves = tab_staves(bands)

    # keep digits that sit on a detected TAB staff line (within 4px)
    on_staff = []
    for d in digits:
        cy = (d['bbox'][1] + d['bbox'][3]) / 2
        near = [s for s in staves if s[0] - 6 <= cy <= s[1] + 6]
        if near:
            on_staff.append(d)

    print('page size pt:', round(page.rect.width, 1), round(page.rect.height, 1))
    print('raster px:', pix.width, pix.height, 'scale:', round(scale, 3))
    print('text spans:', len(spans), 'digit-like:', len(digits), 'on TAB staff:', len(on_staff))
    print('detected staves:', staves)
    print('digit fonts:', sorted(set(d['font'] for d in digits)))
    print('sample on-staff digits:', [(d['text'], d['bbox'], d['font']) for d in on_staff[:12]])


if __name__ == '__main__':
    main()

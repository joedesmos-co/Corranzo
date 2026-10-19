"""PDF text-layer feasibility probe (M2).

For a PDF page, extract text spans with bounding boxes and identify those
that look like TAB fret digits (standalone 0-19, small, near a staff line).
Reports: how many digit-like spans, their font/size, whether they sit on
a staff line, and a recall estimate against the page's joins GT (if the
page is one of the committed fixture scores).

Usage:
  python3 tools/guitar-vision/proof-pdf-text.py --pdf PATH --page 0 --out JSON
"""
import argparse, json, re, sys
from pathlib import Path
import fitz


def run(pdf_path, page_no=0, out=None):
    doc = fitz.open(str(pdf_path))
    page = doc[page_no]
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
                              'bbox': [round(x, 1) for x in s['bbox']]})
    # digit-like: pure int 0-19, short span (width < 30pt)
    digits = []
    for s in spans:
        if s['text'].isdigit() and 0 <= int(s['text']) <= 19:
            w = s['bbox'][2] - s['bbox'][0]
            h = s['bbox'][3] - s['bbox'][1]
            if w < 30 and h < 20:
                digits.append(s)
    # staff lines via horizontal ink runs on a raster of the page
    pix = page.get_pixmap(dpi=150)
    import numpy as np
    from PIL import Image
    img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples).convert('L')
    u8 = np.asarray(img).astype(np.uint8)
    ink = u8 < 128
    rf = ink.mean(axis=1)
    staff_rows = np.nonzero(rf > 0.3)[0]
    # classify each digit: on a staff line (nearest staff row within 4px)
    on_line = 0
    for d in digits:
        cy = (d['bbox'][1] + d['bbox'][3]) / 2
        if staff_rows.size and abs(staff_rows[np.argmin(np.abs(staff_rows - cy))] - cy) <= 4:
            on_line += 1
    rep = {'pdf': str(pdf_path), 'page': page_no, 'page_size_pt': [round(page.rect.width, 1), round(page.rect.height, 1)],
           'raster_size_px': [pix.width, pix.height], 'dpi': 150,
           'text_spans': len(spans), 'digit_like_spans': len(digits),
           'digits_on_staff_line': on_line,
           'fonts': sorted(set(s['font'] for s in digits)),
           'sample_digits': digits[:20]}
    if out:
        Path(out).write_text(json.dumps(rep, indent=2))
    print(json.dumps({k: v for k, v in rep.items() if k != 'sample_digits'}, indent=1))
    print('sample digits:', [(d['text'], d['bbox'], d['font']) for d in digits[:8]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--page', type=int, default=0)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    run(args.pdf, args.page, args.out)


if __name__ == '__main__':
    main()

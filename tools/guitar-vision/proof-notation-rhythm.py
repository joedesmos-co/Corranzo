"""Notation-side rhythm layer (SMuFL text + raster stems/beams).

The paired fixtures embed standard notation as SMuFL text items, so
noteheads have EXACT positions from the PDF text layer. Durations are
then derived from actual notation evidence:

  notehead glyph  U+E0A0..E0A4 family (whole/half/quarter-and-shorter)
  stem            vertical ink run from the notehead edge
  beams           horizontal ink rows at the stem tip (0/1/2+)
  dots            ink blob right of the notehead

Duration = base_from_notehead / 2**beams, times 1.5 per dot.
Nothing is defaulted silently: a note whose stem/beam evidence is
missing is marked `rhythm_confident = False`.

Usage:
  python3 tools/guitar-vision/proof-notation-rhythm.py --pdf PATH --page 0 --out DIR
"""
import argparse, json, os, sys
from pathlib import Path
import numpy as np
from PIL import Image

W = Path('/Users/ryland/Documents/scoreflow-guitar')
sys.path.insert(0, str(W / 'tools/guitar-vision'))
import importlib.util as _ilu


def _imp(name, filename):
    spec = _ilu.spec_from_file_location(name, W / 'tools/guitar-vision' / filename)
    m = _ilu.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


# SMuFL notehead families -> base duration in quarters
SMUFL_NOTEHEADS = {
    '\ue0a0': ('whole', 4.0),
    '\ue0a2': ('half', 2.0),
    '\ue0a3': ('half', 2.0),
    '\ue0a4': ('quarter', 1.0),   # black notehead; beams decide shorter
}


def noteheads(items):
    out = []
    for it in items:
        txt = it.get('text') or ''
        ch = txt.strip()[:1]
        if not ch or ord(ch) < 0xE000:
            continue
        if ch in SMUFL_NOTEHEADS:
            name, base = SMUFL_NOTEHEADS[ch]
            x0, y0, x1, y1 = it['bbox']
            out.append({'kind': name, 'base': base,
                        'box': [x0, y0, x1, y1],
                        'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2})
    out.sort(key=lambda n: (n['cx'], n['cy']))
    return out


def rhythm_for(note, ink, beam_mask, rhy):
    """Stem/beam/dot evidence for one notehead from the raster."""
    box = [int(round(v)) for v in note['box']]
    a = rhy.anchored_stem(ink, beam_mask, box, ink.shape[0])
    beams = int(a.get('beams') or 0)
    dots = int(a.get('dots') or 0)
    if note['kind'] == 'whole':
        dur, conf = 4.0, True
    elif note['kind'] == 'half':
        dur, conf = 2.0, True
    else:
        if a.get('stem'):
            dur, conf = 1.0 / (2 ** min(beams, 3)), True
        else:
            dur, conf = 1.0, False
    if dots:
        dur *= 1.5 ** min(dots, 2)
    return {'duration': dur, 'beams': beams, 'dots': dots,
            'stem': bool(a.get('stem')), 'confident': conf}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--page', type=int, default=0)
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    png = out / f'p{args.page}.png'
    # reuse the main pipeline's extractor
    pt = _imp('proof_pdf_tab', 'proof-pdf-tab.py')
    ex = pt.extract(args.pdf, png, args.dpi, args.page)
    if 'error' in ex:
        print('extract failed:', ex['error'])
        return 2
    u8 = np.asarray(Image.open(png).convert('L')).astype(np.uint8)
    ink = u8 < 128
    rhy = _imp('proof_rhythm_graph', 'proof-rhythm-graph.py')
    _, beam_mask = rhy.detect_stems_beams(u8)
    nhs = noteheads(ex['items'])
    rows = []
    for n in nhs:
        r = rhythm_for(n, ink, beam_mask, rhy)
        rows.append({'x': n['cx'], 'y': n['cy'], 'kind': n['kind'],
                     **r})
    from collections import Counter
    print(json.dumps({
        'pdf': args.pdf, 'page': args.page, 'noteheads': len(nhs),
        'kinds': dict(Counter(r['kind'] for r in rows)),
        'durations': dict(Counter(r['duration'] for r in rows)),
        'beams': dict(Counter(r['beams'] for r in rows)),
        'confident': sum(1 for r in rows if r['confident']),
    }, indent=1))
    (out / f'p{args.page}-rhythm.json').write_text(json.dumps(rows, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())

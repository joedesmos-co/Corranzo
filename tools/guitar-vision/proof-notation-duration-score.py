"""Score the notation duration classifier against a reference MusicXML.

This evaluates ONLY the rhythm layer (notehead glyph -> stem/beam/flag ->
written value) on a page, independent of TAB digit recognition. It exists
because the three TAB fixtures are quarter-note only: they cannot show
whether eighth-note evidence (flags/beams) is read correctly.

Alignment is by reading order: notehead columns across systems (top to
bottom, left to right) against reference onsets in measure order. That is
sufficient for the fixture layout and is reported as an alignment count,
not assumed silently. Any mismatch aborts rather than guessing.

Usage:
  python3 tools/guitar-vision/proof-notation-duration-score.py \
      --pdf PAGE.pdf --ref REF.musicxml [--json OUT]
"""
import argparse, importlib.util, json, sys
from collections import Counter
from pathlib import Path
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

W = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(W / 'tools/guitar-vision'))
spec = importlib.util.spec_from_file_location('proof_pdf_tab',
                                              W / 'tools/guitar-vision/proof-pdf-tab.py')
pt = importlib.util.module_from_spec(spec)
sys.modules['proof_pdf_tab'] = pt
spec.loader.exec_module(pt)


def ref_onsets(path):
    root = ET.parse(path).getroot()
    part = list(root.iter('part'))[0]
    out = []
    for m in part.iter('measure'):
        for n in m.iter('note'):
            if n.find('rest') is not None:
                continue
            if n.find('chord') is not None:
                continue
            t = n.find('type')
            out.append(t.text if t is not None else None)
    return out


def page_columns(pdf, page, dpi, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    png = out / f'p{page}.png'
    ex = pt.extract(pdf, png, dpi, page)
    if 'error' in ex:
        raise SystemExit(ex['error'])
    u8 = np.asarray(Image.open(png).convert('L')).astype(np.uint8)
    ink = u8 <= 128
    rhy = pt._load_mod('proof_rhythm_graph', 'proof-rhythm-graph.py')
    _, bm = rhy.detect_stems_beams(u8)
    nhs = pt.notation_noteheads(ex['items'])
    if not nhs:
        return [], 0, 0
    h = float(np.median([n['h'] for n in nhs]))
    nhs = sorted(nhs, key=lambda n: n['cy'])
    systems = [[nhs[0]]]
    for n in nhs[1:]:
        if n['cy'] - systems[-1][-1]['cy'] > 4.0 * h:
            systems.append([n])
        else:
            systems[-1].append(n)
    staff_rows = ink.sum(axis=1) > 0.35 * ink.shape[1]
    staff_space = h / 2.0
    min_run = 1.6 * staff_space
    flag_min_ink = max(4, int(round(0.3 * staff_space)))
    seq = []
    for si, s in enumerate(systems):
        cols = pt.notehead_columns(s)
        for i, c in enumerate(cols):
            gaps = []
            if i:
                gaps.append(c['cx'] - cols[i - 1]['cx'])
            if i + 1 < len(cols):
                gaps.append(cols[i + 1]['cx'] - c['cx'])
            side = (max(3.0, min(16.0, 0.45 * min(gaps))) if gaps else 16.0)
            ev = pt._column_evidence(c, ink, bm, rhy, min_run, side,
                                     staff_rows, flag_min_ink)
            r = pt._duration_from_evidence(c, ev)
            seq.append({'system': si, 'x': round(c['cx'], 1),
                        'duration': r['duration'], 'beams': r['beams'],
                        'flags': r['flags'], 'stem': r['stem'],
                        'confident': r['confident'],
                        'ambiguous': r['ambiguous'],
                        'beam_flag_conflict': r['beam_flag_conflict']})
    return seq, len(systems), len(nhs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--ref', required=True)
    ap.add_argument('--page', type=int, default=0)
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--out', default='/tmp/proof/notation-duration')
    ap.add_argument('--json', default=None)
    args = ap.parse_args()
    seq, n_sys, n_nh = page_columns(args.pdf, args.page, args.dpi, args.out)
    ref = ref_onsets(args.ref)
    if len(seq) != len(ref):
        print(json.dumps({'error': 'alignment mismatch',
                          'page_columns': len(seq), 'reference_onsets': len(ref),
                          'systems': n_sys, 'noteheads': n_nh}, indent=1))
        return 2
    conf = Counter()
    rows = []
    correct = 0
    for i, (p, r) in enumerate(zip(seq, ref)):
        name, dots = pt.type_for_quarters(p['duration'])
        ok = (name == r and dots == 0)
        correct += 1 if ok else 0
        conf[(r, name)] += 1
        rows.append({**p, 'index': i, 'ref': r, 'pred': name, 'ok': ok})
    res = {
        'pdf': args.pdf, 'systems': n_sys, 'noteheads': n_nh,
        'onsets': len(seq), 'correct': correct,
        'accuracy': round(correct / max(len(seq), 1), 4),
        'confusion_ref_pred': {f'{a}->{b}': v for (a, b), v in sorted(conf.items())},
        'ambiguous': sum(1 for p in seq if p['ambiguous']),
        'beam_flag_conflicts': sum(1 for p in seq if p['beam_flag_conflict']),
        'confident': sum(1 for p in seq if p['confident']),
    }
    print(json.dumps(res, indent=1))
    if args.json:
        open(args.json, 'w').write(json.dumps({**res, 'rows': rows}, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())

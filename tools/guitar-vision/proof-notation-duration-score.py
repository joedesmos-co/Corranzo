"""Score the notation duration classifier against a reference MusicXML.

This evaluates ONLY the rhythm layer (notehead -> stem/beam/flag ->
written value) on a page, independent of TAB digit recognition. It exists
because the three TAB fixtures are quarter-note only: they cannot show
whether eighth-note evidence (flags/beams) is read correctly.

Two front ends:
  SMuFL     noteheads are text glyphs (exact positions)
  RASTER    noteheads are filled shapes on the rendered page (font
            independent), split when chord tones touch

Alignment is by reading order: notehead columns across systems (top to
bottom, left to right) against reference onsets in measure order. Any
count mismatch aborts rather than guessing. Measure validity is checked
separately from barlines using an INFERRED meter (candidate meters are
tried; the reference's time signature is not used for inference).

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

METERS = [(4, 4), (3, 4), (2, 4), (6, 8), (12, 8), (2, 2), (3, 8), (9, 8)]


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


def infer_meter(sums):
    scores = []
    for num, den in METERS:
        beats = num * 4.0 / den
        ok = sum(1 for s in sums if abs(s - beats) <= 0.02)
        scores.append({'meter': f'{num}/{den}', 'beats': beats,
                       'matched': ok, 'fraction': round(ok / max(len(sums), 1), 3)})
    scores.sort(key=lambda s: (-s['fraction'], s['beats']))
    return scores


def systems_from_raster(u8, ink):
    """Detect notation systems from the rendered page.

    Noteheads are detected on the whole page, then split into systems by
    vertical gap (a system's chord tones are close; systems are far
    apart). Each system's barlines come from the nearest staff group at
    or below it with five or more lines - the TAB staff in paired
    layouts, the notation staff itself otherwise. Low ledger notes stay
    with the system above instead of being assigned to the next staff.
    """
    bands = pt.line_bands(u8, thr=pt.otsu_threshold(u8))
    groups = pt.band_clusters(bands, min_lines=4)
    if not groups:
        return []
    gap = float(np.median([g['gap'] for g in groups]))
    heads = pt.raster_noteheads(ink, 0, ink.shape[0], gap)
    if not heads:
        return []
    med_h = float(np.median([q['h'] for q in heads]))
    heads.sort(key=lambda q: q['cy'])
    clusters = [[heads[0]]]
    for q in heads[1:]:
        if q['cy'] - clusters[-1][-1]['cy'] > 4.0 * med_h:
            clusters.append([q])
        else:
            clusters[-1].append(q)
    systems = []
    for cl in clusters:
        if len(cl) < 2:
            continue
        cy = float(np.median([q['cy'] for q in cl]))
        g = min(groups, key=lambda g: pt._dist_to_span(cy, g['top'], g['bot']))
        bars = []
        for h in sorted(groups, key=lambda h: h['top']):
            if h['top'] > g['top'] and h['lines'] >= 5:
                bars = pt.staff_barlines(u8, h)
                if bars:
                    break
        if not bars:
            bars = pt.staff_barlines(u8, g)
        systems.append({'staff': g, 'noteheads': cl, 'barlines': bars})
    systems.sort(key=lambda s: s['staff']['top'])
    return systems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--ref', required=True)
    ap.add_argument('--page', type=int, default=0)
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--out', default='/tmp/proof/notation-duration')
    ap.add_argument('--json', default=None)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    png = out / f'p{args.page}.png'
    ex = pt.extract(args.pdf, png, args.dpi, args.page)
    if 'error' in ex:
        raise SystemExit(ex['error'])
    u8 = np.asarray(Image.open(png).convert('L')).astype(np.uint8)
    ink = u8 <= 128
    rhy = pt._load_mod('proof_rhythm_graph', 'proof-rhythm-graph.py')
    _, bm = rhy.detect_stems_beams(u8)

    noteheads = pt.notation_noteheads(ex['items'])
    source = 'smufl-glyphs'
    systems = []
    if noteheads:
        h = float(np.median([n['h'] for n in noteheads]))
        ns = sorted(noteheads, key=lambda n: n['cy'])
        clusters = [[ns[0]]]
        for q in ns[1:]:
            if q['cy'] - clusters[-1][-1]['cy'] > 4.0 * h:
                clusters.append([q])
            else:
                clusters[-1].append(q)
        for cl in clusters:
            systems.append({'staff': {'top': 0, 'bot': h * 2, 'gap': h / 2.0},
                            'noteheads': cl, 'barlines': []})
    else:
        systems = systems_from_raster(u8, ink)
        source = 'raster-fallback'

    cols_by_system = []
    for s in systems:
        cols = pt.notehead_columns(s['noteheads'])
        cols_by_system.append({'staff': s['staff'], 'cols': cols,
                              'barlines': s.get('barlines') or []})

    rows = []
    for si, s in enumerate(cols_by_system):
        cols = s['cols']
        gap = float(s['staff']['gap'])
        for i, c in enumerate(cols):
            gaps = []
            if i:
                gaps.append(c['cx'] - cols[i - 1]['cx'])
            if i + 1 < len(cols):
                gaps.append(cols[i + 1]['cx'] - c['cx'])
            if source == 'raster-fallback':
                side = max(3.0, min(9.0, 0.45 * min(gaps))) if gaps else 9.0
            else:
                side = max(3.0, min(16.0, 0.45 * min(gaps))) if gaps else 16.0
            ev = pt._column_evidence(c, ink, bm, rhy, 1.6 * gap, side,
                                     None, max(4, int(round(0.3 * gap))))
            r = pt._duration_from_evidence(c, ev)
            rows.append({'system': si, 'x': round(c['cx'], 1),
                         'y': round(float(np.mean([m['cy'] for m in c['members']])), 1),
                         'duration': r['duration'],
                         'beams': r['beams'], 'flags': r['flags'],
                         'stem': r['stem'], 'confident': r['confident'],
                         'ambiguous': r['ambiguous'],
                         'beam_flag_conflict': r['beam_flag_conflict']})

    # measures per system from raster barlines (measure validity only)
    for si, s in enumerate(cols_by_system):
        g = s['staff']
        if g['top'] == 0:
            continue
        bars = s.get('barlines') or []
        if len(bars) >= 2:
            import bisect
            for r in rows:
                if r['system'] != si:
                    continue
                r['measure_local'] = max(1, bisect.bisect_left(bars, r['x']))

    ref = ref_onsets(args.ref)
    if len(rows) != len(ref):
        print(json.dumps({'error': 'alignment mismatch',
                          'page_columns': len(rows), 'reference_onsets': len(ref),
                          'notehead_source': source}, indent=1))
        return 2
    conf = Counter(); correct = 0
    for i, (p, r) in enumerate(zip(rows, ref)):
        name, dots = pt.type_for_quarters(p['duration'])
        ok = (name == r and dots == 0)
        correct += 1 if ok else 0
        conf[(r, name)] += 1
        p['index'] = i; p['ref'] = r; p['pred'] = name; p['ok'] = ok

    sums = {}
    for p in rows:
        if 'measure_local' in p:
            sums.setdefault((p['system'], p['measure_local']), 0.0)
            sums[(p['system'], p['measure_local'])] += p['duration']
    meter_scores = infer_meter(list(sums.values())) if sums else []
    best = meter_scores[0] if meter_scores else None
    valid = sum(1 for v in sums.values()
                if best and abs(v - best['beats']) <= 0.02)

    res = {
        'pdf': args.pdf, 'systems': len(systems),
        'notehead_source': source,
        'noteheads': sum(len(s['noteheads']) for s in systems),
        'onsets': len(rows), 'correct': correct,
        'accuracy': round(correct / max(len(rows), 1), 4),
        'confusion_ref_pred': {f'{a}->{b}': v for (a, b), v in sorted(conf.items())},
        'ambiguous': sum(1 for p in rows if p['ambiguous']),
        'beam_flag_conflicts': sum(1 for p in rows if p['beam_flag_conflict']),
        'confident': sum(1 for p in rows if p['confident']),
        'measures_detected': len(sums),
        'inferred_meter': best['meter'] if best else None,
        'inferred_meter_fraction': best['fraction'] if best else None,
        'meter_candidates': meter_scores[:4],
        'measures_valid': valid,
    }
    print(json.dumps(res, indent=1))
    if args.json:
        open(args.json, 'w').write(json.dumps({**res, 'rows': rows}, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())

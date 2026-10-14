"""Staff-grouping diagnostic (task 1): make the system-partition failure
reproducible and independently scoreable.

For each page it records, for EVERY candidate six-line run:
  - line spacing (mean gap, CV), max line thickness
  - detected-digit support (how many tabdigit peaks fall inside)
  - the ownership span it would produce
and the downstream barline/measure consequence (bars_per_sys), plus the
GT tab systems derived independently from the joins (never fed back into
the algorithm).

Usage:
  python3 tools/guitar-vision/proof-staff-groups.py --work .../pdmx-QmTxoAbitsi9 \
      --pages 1,2 --hires /tmp/proof/hires-fixed/hires --out /tmp/proof/sgroup.json
"""
import argparse, json, re, sys
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image
import torch

W = Path('/Users/ryland/Documents/scoreflow-guitar')
sys.path.insert(0, str(W / 'tools/guitar-vision'))
import importlib.util as _ilu


def _imp(name, filename):
    spec = _ilu.spec_from_file_location(name, W / 'tools/guitar-vision' / filename)
    m = _ilu.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


pig = _imp('proof_ignore_train', 'proof-ignore-train.py')
dec = _imp('proof_heatmap_decode', 'proof-heatmap-decode.py')
psg = _imp('proof_string_geometric', 'proof-string-geometric.py')

DEV = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
_DET = None


def det():
    global _DET
    if _DET is None:
        _DET = pig.TinyFCN4().to(DEV)
        sd = torch.load(str(W / dec.WEIGHTS), map_location=DEV, weights_only=True)
        _DET.load_state_dict(sd.get('state', sd))
        _DET.eval()
    return _DET


def line_bands(img, thr=0.3):
    ink = img < 128
    h, w = ink.shape
    rf = ink[:, int(w * 0.2):int(w * 0.8)].mean(axis=1)
    rows = np.nonzero(rf > thr)[0]
    if len(rows) < 6:
        return []
    bands, st, pv = [], rows[0], rows[0]
    for r in rows[1:]:
        if r - pv > 3:
            bands.append((st, pv))
            st = r
        pv = r
    bands.append((st, pv))
    return bands


def candidate_runs(bands):
    """All maximal-ish 6-line runs with their geometry stats."""
    mids = [((a + b) / 2, b - a + 1) for a, b in bands]
    out = []
    i = 0
    while i + 6 <= len(mids):
        m = [x for x, _ in mids[i:i + 6]]
        gaps = [b - a for a, b in zip(m, m[1:])]
        mg = sum(gaps) / 5.0
        thick = max(w for _, w in mids[i:i + 6])
        cv = (sum((x - mg) ** 2 for x in gaps) / 5.0) ** 0.5 / mg if mg else 9e9
        out.append({'i': int(i), 'top': float(m[0]), 'bot': float(m[-1]),
                    'gap': float(mg), 'cv': float(cv), 'thick': int(thick),
                    'thin_ok': bool(thick <= 0.35 * mg),
                    'regular_ok': bool(cv <= 0.18)})
        i += 1
    return out


def gt_tab_systems(joins, page_no, fx, fy, ox, oy):
    """GT tab systems, derived independently from the joins (eval only)."""
    ys = []
    for sid, v in joins.get('joins', {}).items():
        if 'tab-text' not in (v.get('children') or []):
            continue
        if (v.get('page') or 1) != page_no:
            continue
        for b in v.get('boxes', []):
            ys.append((b[1] + b[3]) / 2 * fy - oy)
    if not ys:
        return []
    ys.sort()
    cl, cur = [], [ys[0]]
    for a, b in zip(ys, ys[1:]):
        if b - a > 100:
            cl.append(cur)
            cur = []
        cur.append(b)
    cl.append(cur)
    return [{'top': min(c), 'bot': max(c), 'n': len(c)} for c in cl]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    ap.add_argument('--pages', default='1')
    ap.add_argument('--hires', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    sample = Path(args.work).name
    man = json.loads((Path(args.hires) / f'{sample}-manifest.json').read_text())
    jn = 'joins.json'
    joins = json.loads((Path(args.work) / jn).read_text())
    report = {}
    for pgkey, meta in man.items():
        if 'file' not in meta:
            continue
        pg = int(pgkey.replace('page', ''))
        if pg not in [int(p) for p in args.pages.split(',')]:
            continue
        u8 = np.asarray(Image.open(meta['file']).convert('L')).astype(np.uint8)
        fx = meta['cssWidth'] / meta['viewBox'][0]
        fy = meta['height'] / meta['viewBox'][1]
        ink = u8 < 128
        cols = np.nonzero(ink.any(axis=0))[0]
        rows = np.nonzero(ink.any(axis=1))[0]
        ox = float(max(int(cols.min()) - 4, 0))
        oy = float(max(int(rows.min()) - 4, 0))
        img = np.asarray(Image.fromarray(u8).crop(
            (int(ox), int(oy), min(int(cols.max()) + 5, u8.shape[1]),
             min(int(rows.max()) + 5, u8.shape[0]))), dtype=np.uint8)
        bands = line_bands(img)
        runs = candidate_runs(bands)
        with torch.no_grad():
            heat = det()(torch.from_numpy(img.astype(np.float32) / 255.0)
                         .unsqueeze(0).unsqueeze(0).to(DEV))[0]
        preds = dec.decode_page(heat, img, fx, fy, staff_gate=False)
        digs = [p for p in preds if p['cls'] == 'tabdigit']
        dys = np.array([d['y'] for d in digs]) if digs else np.array([])
        for r in runs:
            inside = int(((dys >= r['top'] - 3) & (dys <= r['bot'] + 3)).sum()) if len(dys) else 0
            r['digits_inside'] = inside
            r['digits_frac'] = round(float(inside) / max(len(digs), 1), 3)
        gt = gt_tab_systems(joins, pg, fx, fy, ox, oy)
        # the algorithm's current choice: first passing run, step 6
        chosen, i = [], 0
        while i + 6 <= len(runs):
            r = runs[i]
            if r['thin_ok'] and r['regular_ok']:
                chosen.append(r['i'])
                i += 6
            else:
                i += 1
        report[f'page{pg}'] = {
            'n_bands': len(bands), 'n_digits': len(digs),
            'page_sp': psg.page_spacing(img.astype(np.float32)),
            'gt_systems': [{'top': round(g['top']), 'bot': round(g['bot']), 'n': g['n']} for g in gt],
            'chosen_idx': chosen,
            'chosen': [{'top': round(runs[i]['top']), 'bot': round(runs[i]['bot']),
                        'gap': round(runs[i]['gap'], 1), 'cv': round(runs[i]['cv'], 3),
                        'thick': runs[i]['thick'], 'digits': runs[i]['digits_inside'],
                        'digits_frac': runs[i]['digits_frac']} for i in chosen],
            'runs': [{k: (round(v, 2) if isinstance(v, float) else v)
                      for k, v in r.items()} for r in runs],
        }
        print(f"page{pg}: bands={len(bands)} digits={len(digs)} "
              f"gt_sys={len(gt)}[{','.join(str(g['n']) for g in gt)}] "
              f"chosen={len(chosen)}[{','.join(str(runs[i]['digits_inside']) for i in chosen)}]")
    Path(args.out).write_text(json.dumps(report, indent=1))
    print('wrote', args.out)


if __name__ == '__main__':
    main()

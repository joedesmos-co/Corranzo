"""Pair-bridge rhythm audit (Phase 1).

For adjacent onset pairs (same system, gap 8-100px): count horizontal
ink bridges (rows with continuous ink from x1+3 to x2-3) in the rhythm
zone. Onset beams = max over adjacent pairs. Compares to truth beams.
"""
import json, re
import numpy as np
from PIL import Image
import importlib.util, sys
from collections import Counter, defaultdict
import torch


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_pigs = _load('pig', '/Users/ryland/Documents/scoreflow-guitar/tools/guitar-vision/proof-ignore-train.py')
_decs = _load('dec', '/Users/ryland/Documents/scoreflow-guitar/tools/guitar-vision/proof-heatmap-decode.py')
_mbs = _load('mb', '/Users/ryland/Documents/scoreflow-guitar/tools/guitar-vision/proof-measure-bars.py')
_psg = _load('psg', '/Users/ryland/Documents/scoreflow-guitar/tools/guitar-vision/proof-string-geometric.py')
DEV = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
_DET = None


def det_model():
    global _DET
    if _DET is None:
        _DET = _pigs.TinyFCN4().to(DEV)
        sd = torch.load('/Users/ryland/Documents/scoreflow-guitar/datasets/guitar-vision/proof-detection/heatmap-ignore.pt',
                        map_location=DEV, weights_only=True)
        _DET.load_state_dict(sd.get('state', sd))
        _DET.eval()
    return _DET

W = '/Users/ryland/Documents/scoreflow-guitar'


def pair_bridges(u8, x1, x2, ztop, zbot):
    x1, x2, ztop, zbot = int(x1), int(x2), int(ztop), int(zbot)
    if x2 - x1 < 8:
        return 0
    lo, hi = max(0, ztop), min(u8.shape[0] - 1, zbot)
    if hi <= lo:
        return 0
    n = 0
    prev = -99
    for r in range(lo, hi + 1):
        row = u8[r, max(0, x1 + 3):min(u8.shape[1], x2 - 2)] < 128
        if len(row) and row.all():
            if r - prev > 3:
                n += 1
            prev = r
    return n


def run_sample(sample, work, hfile, joinsname='joins.json', detected=False):
    joins = json.load(open(f'{W}/{work}/{sample}/{joinsname}'))
    canon = json.load(open(f'{W}/{work}/{sample}/canonical.json'))
    man = json.load(open(hfile))
    links = {}
    for e in canon.get('events', []):
        m = re.search(r'-n(\d+)$', (e.get('source') or {}).get('noteId') or '')
        if m:
            links[f'{sample}-n{int(m.group(1)) + 1:03d}'] = e
    res = Counter()
    for pgkey, m in man.items():
        if not isinstance(m, dict) or 'file' not in m:
            continue
        pg = int(pgkey.replace('page', ''))
        u8 = np.asarray(Image.open(m['file']).convert('L')).astype(np.uint8)
        fx = m['cssWidth'] / m['viewBox'][0]
        fy = m['height'] / m['viewBox'][1]
        if detected:
            with torch.no_grad():
                heat = det_model()(torch.from_numpy(u8.astype(np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(DEV))[0]
            preds, _ = _decs.infer_page_merged(det_model(), u8, fx, fy, DEV)
            gtd = [(g['cx'], g['cy'], g['cls']) for g in _decs.build_gt(joins, pg, fx, fy) if g['cls'] == 'tabdigit']
            items = []
            for pp in preds:
                if pp['cls'] != 'tabdigit':
                    continue
                tb = [len((links[k].get('time') or {}).get('beams') or [])
                      for k, gg in zip(list(links), gtd)
                      if abs(pp['x'] - gg[0]) < 15 and abs(pp['y'] - gg[1]) < 15
                      for links_k in [k] if links[links_k]]
                items.append((pp['x'], pp['y'], max(tb) if tb else 0))
        else:
            items = []
            for sid, v in joins.get('joins', {}).items():
                if 'tab-text' not in (v.get('children') or []):
                    continue
                if (v.get('page') or 1) != pg:
                    continue
                e = links.get(sid)
                if not e:
                    continue
                tb = len((e.get('time') or {}).get('beams') or [])
                for b in v.get('boxes', []):
                    items.append(((b[0] + b[2]) / 2 * fx, (b[1] + b[3]) / 2 * fy, tb))
        # per-system columns
        bysys = defaultdict(list)
        for x, y, tb in sorted(items):
            bysys[int(y // 250)].append((x, y, tb))
        for k in sorted(bysys):
            cols, cur = [], []
            for x, y, tb in bysys[k]:
                if cur and x - cur[-1][0] > 12:
                    cols.append(cur)
                    cur = []
                cur.append((x, y, tb))
            if cur:
                cols.append(cur)
            tabtop = min(y for c in cols for _, y, _ in c) - 100
            for ci, col in enumerate(cols):
                truth = Counter(tb for _, _, tb in col).most_common(1)[0][0]
                cx = sum(x for x, _, _ in col) / len(col)
                bl, br = 0, 0
                if ci > 0:
                    pl = sum(x for x, _, _ in cols[ci - 1]) / len(cols[ci - 1])
                    if 8 <= cx - pl <= 100:
                        bl = pair_bridges(u8, pl, cx, tabtop - 40, tabtop + 60)
                if ci + 1 < len(cols):
                    pr = sum(x for x, _, _ in cols[ci + 1]) / len(cols[ci + 1])
                    if 8 <= pr - cx <= 100:
                        br = pair_bridges(u8, cx, pr, tabtop - 40, tabtop + 60)
                res[(max(bl, br), truth)] += 1
    return res


if __name__ == '__main__':
    import sys as _s
    _det = '--detected' in _s.argv
    for sample, work, hfile in [
            ('pdmx-QmTxoAbitsi9', 'datasets/guitar-vision/pdmx/work', '/tmp/proof/hires/pdmx-QmTxoAbitsi9-manifest.json'),
            ('pdmx2-QmekQbhC1yAP', 'datasets/guitar-vision/pdmx/work', '/tmp/proof/hires/pdmx2-QmekQbhC1yAP-manifest.json')]:
        r = run_sample(sample, work, hfile, detected=_det)
        print('===', sample, '(pairbridges, truthBeams)')
        for k in sorted(r, key=lambda k: (str(k[1]), str(k[0]))):
            print('  ', k, r[k])

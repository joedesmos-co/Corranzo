"""Stem ownership audit (Priority 1) + notehead fill (Priority 2).

Supervision: canonical events carry `stemDirection` (up/down) and
`duration`. Notehead joins link to events by the note-join counter
convention (nh sid-nXXX -> counter XXX-1).

Two stem-side predictors, both image-only:
  A) legacy anchored_stem (nearest-strip search)
  B) ink-COMPONENT connectivity from the notehead edge

Uses proof_page_source so it works from committed assets (the /tmp
staging was reaped).
"""
import json, re, sys
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from scipy import ndimage as ndi

W = Path('/Users/ryland/Documents/scoreflow-guitar')
import importlib.util as _ilu


def _imp(name, filename):
    spec = _ilu.spec_from_file_location(name, W / 'tools/guitar-vision' / filename)
    module = _ilu.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ps = _imp('proof_page_source', 'proof-page-source.py')
pig = _imp('proof_ignore_train', 'proof-ignore-train.py')
dec = _imp('proof_heatmap_decode', 'proof-heatmap-decode.py')
rhy = _imp('proof_rhythm_graph', 'proof-rhythm-graph.py')

DEV = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
_DET = None


def det():
    global _DET
    if _DET is None:
        _DET = pig.TinyFCN4().to(DEV)
        sd = torch.load(str(W / 'datasets/guitar-vision/proof-detection/heatmap-ignore.pt'),
                        map_location=DEV, weights_only=True)
        _DET.load_state_dict(sd.get('state', sd))
        _DET.eval()
    return _DET


def ink_components(u8):
    ink = u8 < 128
    work = ink.copy()
    rows = np.nonzero(ink.mean(axis=1) > 0.5)[0]
    for r in rows:
        work[max(0, r - 2):r + 3, :] = False
    return ndi.label(work)


def stem_side_connectivity(lab, box, min_run=20, tol=8):
    x0, y0, x1, y1 = int(box[0]), int(box[1]), int(box[2]), int(box[3])
    H, Wd = lab.shape
    x0, x1 = max(0, min(x0, Wd - 1)), max(0, min(x1, Wd - 1))
    y0, y1 = max(0, min(y0, H - 1)), max(0, min(y1, H - 1))
    if x1 <= x0 or y1 <= y0:
        return None
    sub = lab[y0:y1 + 1, max(0, x0 - tol):min(Wd, x1 + tol + 1)]
    left_ids = set(sub[:, :tol + 1].ravel().tolist()) - {0}
    right_ids = set(sub[:, -tol - 1:].ravel().tolist()) - {0}
    out, best_run = None, 0
    for side, ids in (("left", left_ids), ("right", right_ids)):
        if not ids:
            continue
        mask = np.isin(lab, list(ids))
        ys = np.nonzero(mask.any(axis=1))[0]
        if len(ys) == 0:
            continue
        near = ys[(ys >= y0 - 4) & (ys <= y1 + 4)]
        if len(near) == 0:
            continue
        run = max(y0 - ys.min(), ys.max() - y1)
        if run >= min_run and run > best_run:
            best_run, out = run, side
    return out


def run(sample, workdir, pages, layout='standard'):
    jn = 'joins.json' if layout == 'standard' else f'joins-{layout}.json'
    joins = json.loads((W / workdir / jn).read_text())
    canon = json.loads((W / workdir / 'canonical.json').read_text())
    byc = {}
    for e in canon.get('events', []):
        m = re.search(r'-n(\d+)$', (e.get('source') or {}).get('noteId') or '')
        if m:
            byc[int(m.group(1))] = e
    res = Counter()
    for pg in pages:
        page = ps.load_page(workdir, layout, pg)
        if page is None:
            continue
        u8 = page['image']; fx = page['fx']; _ox = page['ox']; _oy = page['oy']
        with torch.no_grad():
            heat = det()(torch.from_numpy(u8.astype(np.float32) / 255.0)
                         .unsqueeze(0).unsqueeze(0).to(DEV))[0]
        preds = dec.decode_page(heat, u8, fx, fx, staff_gate=False)
        pnote = [p for p in preds if p['cls'] == 'note']
        ink = u8 < 128
        _, beam_mask = rhy.detect_stems_beams(u8)
        lab, _ = ink_components(u8)
        nhs = []
        for k, v in joins.get('joins', {}).items():
            if 'notehead' not in (v.get('children') or []):
                continue
            if (v.get('page') or 1) != pg:
                continue
            m = re.search(r'-n(\d+)$', k)
            if m:
                nhs.append((int(m.group(1)) - 1, v['boxes'][0]))
        nhs.sort()
        for cnt, nb in nhs:
            e = byc.get(cnt)
            if not e:
                continue
            sd = (e.get('time') or {}).get('stemDirection')
            if sd not in ('up', 'down'):
                continue
            gbox = [nb[0] * fx - _ox, nb[1] * fx - _oy,
                    nb[2] * fx - _ox, nb[3] * fx - _oy]
            best, bd = None, 0.0
            for p in pnote:
                v = dec.iou(p['box'], gbox)
                if v > bd:
                    best, bd = p, v
            if best is None or bd < 0.5:
                res['miss'] += 1
                continue
            res['n'] += 1
            a = rhy.anchored_stem(ink, beam_mask, best['box'], u8.shape[0])
            sideA = a.get('side')
            sideB = stem_side_connectivity(lab, best['box'])
            sideT = 'right' if sd == 'up' else 'left'
            for tag, side in (('A', sideA), ('B', sideB)):
                if side == sideT:
                    res[tag + '_ok'] += 1
                elif side is None:
                    res[tag + '_none'] += 1
                else:
                    res[tag + '_bad'] += 1
            rows = [r for r in range(int(gbox[1]), int(gbox[3]) + 1)
                    if not (ink.mean(axis=1) > 0.5)[r]]
            if rows:
                sub = ink[rows, :][:, int(gbox[0]):int(gbox[2]) + 1]
                inner = sub[1:-1, 1:-1] if sub.shape[0] > 2 and sub.shape[1] > 2 else sub
                fill = float(inner.mean()) if inner.size else 0.0
                res[('fill_dur', round(fill, 1), (e.get('time') or {}).get('durationQuarters'))] += 1
    return res


if __name__ == '__main__':
    CASES = [
        ('pdmx-QmTxoAbitsi9', 'datasets/guitar-vision/pdmx/work/pdmx-QmTxoAbitsi9', [1, 2], 'standard'),
        ('pdmx2-QmekQbhC1yAP', 'datasets/guitar-vision/pdmx/work/pdmx2-QmekQbhC1yAP', [1, 2, 3], 'standard'),
    ]
    for sample, workdir, pages, layout in CASES:
        r = run(sample, workdir, pages, layout)
        n = r['n']
        print('=== %s (matched n=%d, missed=%d)' % (sample, n, r['miss']))
        for k in ['A_ok', 'A_bad', 'A_none', 'B_ok', 'B_bad', 'B_none']:
            print('   %-7s %d  (%.3f)' % (k, r[k], r[k] / max(n, 1)))
        fd = Counter({k: v for k, v in r.items() if k[0] == 'fill_dur'})
        for k in sorted(fd, key=str):
            print('   fill=%s dur=%s n=%d' % (k[1], k[2], fd[k]))

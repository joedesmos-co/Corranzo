"""Notation-to-TAB alignment audit (Milestones 1-2).

Scoring-only (supervision used for evaluation, never at inference).
For every GT join that has BOTH a notehead and a tab-text box:
  1. does the detector find the notehead (iou>=0.5)?
  2. is the nearest DETECTED tab-digit-x within tol of the GT tab digit?
Also reports note-class P/R against joins noteheads, and detects
rests separately.
"""
import json, re, sys
import numpy as np
from PIL import Image
import importlib.util
import torch
from collections import Counter

W = '/Users/ryland/Documents/scoreflow-guitar'


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, f'{W}/tools/guitar-vision/{filename}')
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_pig = _load('pig_mod', 'proof-ignore-train.py')
_dec = _load('dec_mod', 'proof-heatmap-decode.py')
DEV = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
_DET = None


def det():
    global _DET
    if _DET is None:
        _DET = _pig.TinyFCN4().to(DEV)
        sd = torch.load(f'{W}/datasets/guitar-vision/proof-detection/heatmap-ignore.pt',
                        map_location=DEV, weights_only=True)
        _DET.load_state_dict(sd.get('state', sd))
        _DET.eval()
    return _DET


def run(sample, work, hfile, x_tol=45, layout='standard'):
    jname = 'joins.json' if layout == 'standard' else f'joins-{layout}.json'
    joins = json.load(open(f'{W}/{work}/{sample}/{jname}'))
    canon = json.load(open(f'{W}/{work}/{sample}/canonical.json'))
    man = json.load(open(hfile))
    # NOTE: notehead- and tab-text-joins are SEPARATELY numbered sid
    # series (verified: nh n002.. vs tab n535.., same onsets). Pair per
    # page by nearest-x (median offset 17px, p95 19px). Supervision for
    # scoring only; inference must not use it.
    J = joins.get('joins', {})
    per_page_nh = {}
    per_page_tb = {}
    for sid, v in J.items():
        ch = v.get('children') or []
        bs = v.get('boxes') or []
        if not bs:
            continue
        pg = v.get('page', 1)
        if 'notehead' in ch:
            per_page_nh.setdefault(pg, []).append(bs[0])
        elif 'tab-text' in ch:
            per_page_tb.setdefault(pg, []).append(bs[0])
    gt_pair = {}
    for pg, nhs in per_page_nh.items():
        tbs = sorted(per_page_tb.get(pg, []), key=lambda b: b[0])
        for nb in sorted(nhs, key=lambda b: b[0]):
            if not tbs:
                break
            tb = min(tbs, key=lambda b: abs((b[0] + b[2]) / 2 - (nb[0] + nb[2]) / 2))
            gt_pair[(pg, round((nb[0] + nb[2]) / 2))] = {'nh': nb, 'tab': tb}
    res = Counter()
    for pgkey, m in man.items():
        if not isinstance(m, dict) or 'file' not in m:
            continue
        pg = int(pgkey.replace('page', ''))
        u8 = np.asarray(Image.open(m['file']).convert('L')).astype(np.uint8)
        fx = m['cssWidth'] / m['viewBox'][0]
        fy = m['height'] / m['viewBox'][1]
        with torch.no_grad():
            heat = det()(torch.from_numpy(u8.astype(np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(DEV))[0]
        preds, _ = _dec.infer_page_merged(det(), u8, fx, fy, DEV)
        pnote = [p for p in preds if p['cls'] == 'note']
        ptab = [p for p in preds if p['cls'] == 'tabdigit']
        prest = [p for p in preds if p['cls'] == 'rest']
        used = set()
        for (ppg, _x), rec in sorted(gt_pair.items()):
            if ppg != pg:
                continue
            res['gt_notehead_tab_pair'] += 1
            nb = rec['nh']
            gbox = [nb[0] * fx, nb[1] * fy, nb[2] * fx, nb[3] * fy]
            best, bd, bpos = None, 0.0, None
            for i, p in enumerate(pnote):
                if i in used:
                    continue
                v2 = _dec.iou(p['box'], gbox)
                if v2 > bd:
                    best, bd, bpos = i, v2, p
            if best is None or bd < 0.5:
                res['note_detected'] = res.get('note_detected', 0)
                res['note_missed'] += 1
                continue
            used.add(best)
            res['note_detected'] += 1
            if not ptab:
                res['assoc_no_tab_det'] += 1
                continue
            tab_gt_cx = (rec['tab'][0] + rec['tab'][2]) / 2 * fx
            near = min(ptab, key=lambda t: abs(t['x'] - bpos['x']))
            res['assoc_ok' if abs(near['x'] - tab_gt_cx) <= x_tol else 'assoc_bad'] += 1
    return res


if __name__ == '__main__':
    CASES = [
        ('pdmx2-QmekQbhC1yAP', 'datasets/guitar-vision/pdmx/work',
         '/tmp/proof/hires/pdmx2-QmekQbhC1yAP-manifest.json', 'standard'),
        ('pdmx-QmTxoAbitsi9', 'datasets/guitar-vision/pdmx/work',
         '/tmp/proof/hires/pdmx-QmTxoAbitsi9-manifest.json', 'standard'),
    ]
    for sample, work, hfile, layout in CASES:
        r = run(sample, work, hfile, layout=layout)
        ok, bad = r.get('assoc_ok', 0), r.get('assoc_bad', 0)
        print('===', sample)
        for k in sorted(r):
            print('   %-24s %d' % (k, r[k]))
        if ok + bad:
            print('   assoc@45px: %d/%d = %.3f' % (ok, ok + bad, ok / (ok + bad)))

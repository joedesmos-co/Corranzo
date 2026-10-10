"""Rhythm counting variants vs supervision (G5).

Per onset column (GT digits, x within 12px): compare duration-decision
inputs: plain row-groups (median), stem-anchored groups (median / ANY),
vs truth beams. Reports confusion per sample. Image-only features,
supervision scoring only.
"""
import json, re, sys
import numpy as np
from PIL import Image
from collections import Counter

W = '/Users/ryland/Documents/scoreflow-guitar'

def load(sample, work, hires, layout='standard'):
    joins = json.load(open(f'{W}/{work}/{sample}/joins.json'))
    canon = json.load(open(f'{W}/{work}/{sample}/canonical.json'))
    suf = '' if layout == 'standard' else '-' + layout
    man = json.load(open(f'/tmp/proof/hires{suf}/{sample}{suf}-manifest.json'))
    links = {}
    for e in canon.get('events', []):
        m = re.search(r'-n(\d+)$', (e.get('source') or {}).get('noteId') or '')
        if m:
            links[f'{sample}-n{int(m.group(1)) + 1:03d}'] = e
    return joins, canon, man, links

def groups_plain(u8, gt, gb, cx):
    s = (u8[gt:gb, max(0, int(cx - 8)):int(cx + 8)] < 128)
    rr = np.nonzero(s.mean(axis=1) > 0.5)[0]
    gl, pv = 0, -99
    for r in rr:
        if r - pv > 2:
            gl += 1
        pv = r
    return gl

def groups_stemanchored(u8, rule, gt, gb, cx, sp):
    s = (u8[gt:gb, max(0, int(cx - 8)):int(cx + 8)] < 128)
    frac = s.mean(axis=1)
    thin = (frac > 0.05) & (frac < 0.6)
    run = best = btop = bbot = 0
    blo = bhi = 0
    for ri, rv in enumerate(thin):
        if rv:
            if run == 0:
                btop = ri
            run += 1
            bbot = ri
        else:
            run = 0
        if run > best:
            best = run
            blo, bhi = btop, bbot
    if best < 0.8 * sp:
        return None
    rows = [r for r in range(blo, bhi + 1)
            if frac[r] > 0.5 and not rule[gt + r]]
    ng, pv = 0, -99
    for r in rows:
        if r - pv > 1:
            ng += 1
        pv = r
    return ng

def run_sample(sample, work, hires):
    joins, canon, man, links = load(sample, work, hires)
    res = Counter()
    for pgkey, m in man.items():
        if not isinstance(m, dict) or 'file' not in m:
            continue
        pg = int(pgkey.replace('page', ''))
        u8 = np.asarray(Image.open(m['file']).convert('L')).astype(np.uint8)
        fx = m['cssWidth'] / m['viewBox'][0]
        rule = (u8 < 128).mean(axis=1) > 0.5
        # page sp via band method
        ink = u8 < 128
        h, w = ink.shape
        x0, x1 = int(w * 0.1), int(w * 0.9)
        rf = ink[:, x0:x1].mean(axis=1)
        rows = np.nonzero(rf > 0.25)[0]
        bands, st, pv = [], rows[0], rows[0]
        for r in rows[1:]:
            if r - pv > 3:
                bands.append((st, pv))
                st = r
            pv = r
        bands.append((st, pv))
        mids = [(a + b) / 2 for a, b in bands]
        diffs = sorted([mids[i + 1] - mids[i] for i in range(len(mids) - 1)
                        if 8 <= mids[i + 1] - mids[i] <= 200])
        sp = diffs[len(diffs) // 2] if diffs else 32
        # TAB tops
        tabs = []
        cur = [bands[0]]
        for i in range(1, len(bands)):
            if mids[i] - mids[i - 1] < 60:
                cur.append(bands[i])
            else:
                if len(cur) == 6:
                    tabs.append(cur[0][0])
                cur = [bands[i]]
        if len(cur) == 6:
            tabs.append(cur[0][0])
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
                items.append(((b[0] + b[2]) / 2 * fx, tb))
        items.sort()
        cols, cur = [], []
        for x, tb in items:
            if cur and x - cur[-1][0] > 12:
                cols.append(cur)
                cur = []
            cur.append((x, tb))
        if cur:
            cols.append(cur)
        for col in cols:
            truth = Counter(tb for _, tb in col).most_common(1)[0][0]
            # tabtop for column
            ys = []
            for x, tb in col:
                pass
            # use first digit's y? approximate tabtop via nearest tabs to median x? use fixed zone per column from page: find tabtop nearest above min digit... need y. store y in items? redo quickly: use cy from boxes
        # second pass with y
        items2 = []
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
                items2.append(((b[0] + b[2]) / 2 * fx, (b[1] + b[3]) / 2, tb))
        items2.sort()
        cols, cur = [], []
        for x, y, tb in items2:
            if cur and x - cur[-1][0] > 12:
                cols.append(cur)
                cur = []
            cur.append((x, y, tb))
        if cur:
            cols.append(cur)
        for col in cols:
            truth = Counter(tb for _, _, tb in col).most_common(1)[0][0]
            dtop = min(y for _, y, _ in col)
            cands = [t for t in tabs if t - 2 * sp <= dtop]
            tt = max(cands) if cands else None
            if tt is None:
                continue
            gt, gb = int(tt - 3.5 * sp), int(tt - 0.5 * sp)
            if gt < 0:
                continue
            plains, anchs = [], []
            for x, y, tb in col:
                plains.append(groups_plain(u8, gt, gb, x))
                a = groups_stemanchored(u8, rule, gt, gb, x, sp)
                anchs.append(a)
            med_plain = sorted(plains)[len(plains) // 2]
            med_anch = sorted([a for a in anchs if a is not None])
            med_anch = med_anch[len(med_anch) // 2] if med_anch else None
            any_anch = max([a for a in anchs if a is not None], default=None)
            res[('plain', med_plain, truth)] += 1
            res[('medanch', med_anch, truth)] += 1
            res[('anyanch', any_anch, truth)] += 1
    return res

if __name__ == '__main__':
    for sample, work, hires in [('pdmx-QmTxoAbitsi9', 'datasets/guitar-vision/pdmx/work', '/tmp/proof/hires'),
                                ('pdmx2-QmekQbhC1yAP', 'datasets/guitar-vision/pdmx/work', '/tmp/proof/hires')]:
        r = run_sample(sample, work, hires)
        print('===', sample)
        for mode in ['plain', 'medanch', 'anyanch']:
            print(' ', mode)
            keys = sorted(set((g, t) for m, g, t in r if m == mode), key=lambda k: (str(k[0]), str(k[1])))
            for g, t in keys:
                print('    groups=%s truthBeams=%s n=%d' % (g, t, r[(mode, g, t)]))

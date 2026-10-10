"""Beam-object association audit (Phase 1).

Beam OBJECTS (connected components of staff-excluded (1,20)-opened
ink) associated to onset columns by x-overlap + rhythm-zone y. Counts
objects per GT column vs truth beams. Supervision scoring only.
"""
import json, re, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from collections import Counter

W = '/Users/ryland/Documents/scoreflow-guitar'


def beam_rows_in(u8, y0, y1):
    # Beam rows as horizontal ink runs (20-500px) per row, grouped
    # vertically (gap<=2). Unlike connected components, this does not
    # merge beams with their stems (Pi shapes) and needs no height cap.
    ink = u8 < 128
    h, w = ink.shape
    rule = ink.mean(axis=1) > 0.5
    y0, y1 = max(0, y0), min(h - 1, y1)
    rows = []
    for r in range(y0, y1 + 1):
        if rule[r]:
            continue
        run = 0
        for v in ink[r, :]:
            if v:
                run += 1
            else:
                if run >= 20:
                    rows.append((r, run))
                run = 0
        if run >= 20:
            rows.append((r, run))
    # NOTE: per-row runs (not x-ranges); association uses overlap below.
    return rows


def beam_objects(u8):
    ink = u8 < 128
    h, w = ink.shape
    rule = ink.mean(axis=1) > 0.5
    work = ink.copy()
    d = np.nonzero(rule)[0]
    for r in d:
        work[max(0, r - 2):min(h, r + 3), :] = False
    raw = ndi.binary_opening(work, structure=np.ones((1, 20)))
    lab, n = ndi.label(raw)
    objs = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        hh = ys.max() - ys.min() + 1
        ww = xs.max() - xs.min() + 1
        if len(ys) >= 20 and ww <= 500 and hh <= 10:
            objs.append((xs.min(), xs.max(), ys.min(), ys.max()))
    return objs


def tab_tops(u8):
    # TAB system tops via 6-band groups (same rule as bar module)
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
    tops = []
    cur = [bands[0]]
    for i in range(1, len(bands)):
        if mids[i] - mids[i - 1] < 60:
            cur.append(bands[i])
        else:
            if len(cur) == 6:
                tops.append(cur[0][0])
            cur = [bands[i]]
    if len(cur) == 6:
        tops.append(cur[0][0])
    return tops


def run_sample(sample, work, hdir, suffix=''):
    joins = json.load(open(f'{W}/{work}/{sample}/joins.json'))
    canon = json.load(open(f'{W}/{work}/{sample}/canonical.json'))
    man = json.load(open(f'{hdir}/{sample}{suffix}-manifest.json'))
    jname = 'joins.json'
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
        objs = beam_objects(u8)
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
        # per-system columns (x-only merges cross-system digits!)
        # assign digits to nearest TAB system by y
        tabs = tab_tops(u8)
        bysys = {}
        for x, y, tb in sorted(items):
            if tabs:
                si = min(range(len(tabs)), key=lambda i: abs(y - tabs[i]))
                bysys.setdefault(si, []).append((x, y, tb))
            else:
                bysys.setdefault(0, []).append((x, y, tb))
        cols = []
        for k in sorted(bysys):
            cur = []
            for x, y, tb in bysys[k]:
                if cur and x - cur[-1][0] > 12:
                    cols.append(cur)
                    cur = []
                cur.append((x, y, tb))
            if cur:
                cols.append(cur)
        # TAB tops via digit rows (supervision-free clustering would use detections)
        for col in cols:
            truth = Counter(tb for _, _, tb in col).most_common(1)[0][0]
            topcy = min(y for _, y, _ in col)
            xs = [x for x, _, _ in col]
            # Full inter-staff gap zone (rhythm geometry varies by
            # engraver; fixed zones miss tall stems). Needs notation
            # bottom: approximate as tabtop-4.5sp via page sp estimate.
            tt = None
            if tabs:
                c = [t for t in tabs if t - 100 <= topcy]
                tt = max(c) if c else tabs[0]
            zlo = (tt - 150) if tt else (topcy - 150)
            zhi = (tt - 8) if tt else (topcy - 8)
            hit = set()
            for i, (x0, x1, y0, y1) in enumerate(objs):
                if y1 >= zlo and y0 <= zhi:
                    if any(x0 - 4 <= x <= x1 + 4 for x in xs):
                        hit.add(i)
            res[(len(hit), truth)] += 1
    return res


if __name__ == '__main__':
    for sample, work, hdir in [('pdmx-QmTxoAbitsi9', 'datasets/guitar-vision/pdmx/work', '/tmp/proof/hires'),
                               ('pdmx2-QmekQbhC1yAP', 'datasets/guitar-vision/pdmx/work', '/tmp/proof/hires')]:
        r = run_sample(sample, work, hdir)
        print('===', sample, '(nobjs, truthBeams): ncols')
        for k in sorted(r, key=lambda k: (str(k[1]), str(k[0]))):
            print('  ', k, r[k])

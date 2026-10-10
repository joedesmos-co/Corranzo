"""Per-system barline audit vs truth measure boundaries (G5/G6).

For a sample+page: GT digits grouped by (system via y-clustering,
measure via links); truth boundary x per system = midpoint between
last digit of measure m and first digit of m+1 (same system).
Compares to detect_barline_systems() xs per TAB system (matched by
y-overlap). Reports hits/misses/FPs per system.
"""
import json, os, re, sys
from collections import defaultdict
import importlib.util
import numpy as np
from PIL import Image

W = os.path.expanduser('~/Documents/scoreflow-guitar')
spec = importlib.util.spec_from_file_location('mb', W + '/tools/guitar-vision/proof-measure-bars.py')
mb = importlib.util.module_from_spec(spec)
sys.modules['mb'] = mb
spec.loader.exec_module(mb)

sample = sys.argv[1]
w = next(d for d in json.load(open('/tmp/proof/workdirs.json')) if d.endswith('/' + sample))
joins = json.load(open(os.path.join(W, w, 'joins.json')))
canon = json.load(open(os.path.join(W, w, 'canonical.json')))
man = json.load(open(f'/tmp/proof/hires/{sample}-manifest.json'))
links = {}
for e in canon['events']:
    m = re.search(r"-n(\d+)$", (e.get('source') or {}).get('noteId') or '')
    if m:
        links[f"{sample}-n{int(m.group(1)) + 1:03d}"] = e

for pgkey, m in man.items():
    if not isinstance(m, dict) or 'file' not in m:
        continue
    pg = int(pgkey.replace('page', ''))
    u8 = np.asarray(Image.open(m['file']).convert('L')).astype(np.uint8)
    fx = m['cssWidth'] / m['viewBox'][0]
    fy = m['height'] / m['viewBox'][1]
    dg = []
    for sid, v in joins['joins'].items():
        if 'tab-text' not in (v.get('children') or []):
            continue
        if (v.get('page') or 1) != pg:
            continue
        e = links.get(sid)
        if not e:
            continue
        for b in v['boxes']:
            dg.append(((b[0] + b[2]) / 2 * fx, (b[1] + b[3]) / 2 * fy,
                       (e.get('source') or {}).get('measure')))
    dg.sort(key=lambda t: t[1])
    cys = [t[1] for t in dg]
    diffs = sorted([b - a for a, b in zip(cys, cys[1:]) if b - a > 1])
    med = diffs[len(diffs) // 2] if diffs else 50
    systems, cur = [], [dg[0]]
    for a, b in zip(dg, dg[1:]):
        if b[1] - a[1] > max(3 * med, 40):
            systems.append(cur)
            cur = [b]
        else:
            cur.append(b)
    systems.append(cur)
    det = mb.detect_barline_systems(u8)
    print(f'=== {sample} p{pg}: {len(systems)} GT systems, {len(det)} det systems ===')
    for si, sys_dg in enumerate(systems):
        top = min(t[1] for t in sys_dg)
        bot = max(t[1] for t in sys_dg)
        # truth boundaries: between consecutive measures in this system
        bym = defaultdict(list)
        for x, y, mm in sys_dg:
            bym[mm].append(x)
        laus = sorted(bym)
        bounds = []
        for a, b in zip(laus, laus[1:]):
            bounds.append((max(bym[a]) + min(bym[b])) / 2)
        # match detection system by y overlap (TAB systems contain digits)
        cands = [s for s in det if not (s['bot'] < top - 60 or s['top'] > bot + 60)]
        # prefer the TAB system (digits inside span)
        inside = [s for s in cands if s['top'] <= top and s['bot'] >= bot]
        ds = inside[0]['xs'] if inside else (cands[0]['xs'] if cands else [])
        tol = 25
        hits = sum(1 for t in bounds if any(abs(t - d) <= tol for d in ds))
        for t in bounds:
            if not any(abs(t - d) <= tol for d in ds):
                print(f'    MISS truthB x={t:.0f}')
        fp = sum(1 for d in ds if not any(abs(t - d) <= tol for t in bounds))
        print(f'sys{si} y[{top:.0f},{bot:.0f}] meas {laus[0]}-{laus[-1]}: '
              f'truthB={len(bounds)} detB={len(ds)} hits={hits} miss={len(bounds)-hits} fp={fp}')
        if fp:
            print('   fp xs:', [round(d) for d in ds if not any(abs(t - d) <= tol for t in bounds)][:8])

"""G3 join-coverage audit: source TAB events vs tab-text joins.

For every workdir: count canonical events with tab.string (ALL source
events denominator) vs joins with tab-text children, split-mapped via
dataset manifests. Classify per sample:
  - notation-only (no/few tab events in source)
  - joined (tab-text joins present)
  - missing (tab events exist but no joins)
Also reports unmatched-source counters if present in joins files.
"""
import json, os, re
from collections import defaultdict

W = os.path.expanduser('~/Documents/scoreflow-guitar')
WORKDIRS = json.load(open('/tmp/proof/workdirs.json'))
SPLIT = {}
for mp in ['datasets/guitar-vision/pdmx/dataset-manifest.json',
           'datasets/guitar-vision/v2/dataset-manifest.json']:
    man = json.load(open(os.path.join(W, mp)))
    for s in man['splits']['assignments']:
        SPLIT[s['sample']] = s['split']

rows = []
for w in WORKDIRS:
    s = os.path.basename(w)
    try:
        canon = json.load(open(os.path.join(W, w, 'canonical.json')))
    except Exception:
        continue
    tab_ev = sum(1 for e in canon.get('events', []) if (e.get('tab') or {}).get('string') is not None)
    jfiles = {}
    for f in os.listdir(os.path.join(W, w)):
        if f.startswith('joins') and f.endswith('.json'):
            j = json.load(open(os.path.join(W, w, f)))
            nt = sum(1 for v in j['joins'].values() if 'tab-text' in (v.get('children') or []))
            extra = {k: v for k, v in j.items() if k != 'joins'}
            jfiles[f] = (nt, extra)
    rows.append({'sample': s, 'split': SPLIT.get(s, '?'), 'tabEvents': tab_ev, 'joins': jfiles})

tot_ev = defaultdict(int)
tot_j = defaultdict(int)
missing = []
for r in rows:
    sp = r['split']
    tot_ev[sp] += r['tabEvents']
    std = r['joins'].get('joins.json', (0, {}))[0]
    tot_j[sp] += std
    if r['tabEvents'] > 0 and std == 0:
        missing.append((r['sample'], sp, r['tabEvents']))
    elif r['tabEvents'] > 0 and std < r['tabEvents']:
        missing.append((r['sample'], sp, r['tabEvents'], std))
print('=== source TAB events vs standard joins, by split ===')
for sp in sorted(tot_ev):
    print(f'{sp}: tabEvents={tot_ev[sp]} joined={tot_j[sp]} coverage={tot_j[sp]/max(1,tot_ev[sp]):.3f}')
print(f'\n=== samples with tab events but zero/partial joins ({len(missing)}) ===')
for m in missing:
    print(m)
json.dump(rows, open('/tmp/proof/join-coverage.json', 'w'), indent=1)
print('\nwrote /tmp/proof/join-coverage.json rows=%d' % len(rows))

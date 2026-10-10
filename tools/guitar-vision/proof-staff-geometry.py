"""Staff-line geometry audit for G1 line-relative string representation.

Part A (supervision on TRAIN-fit, all layouts): from GT tab-text joins
(joins[-layout].json) + canonical tab strings via exact noteId links,
cluster digits into systems by y-gaps, estimate per-string line
positions (median digit-center y), report per layout: line spacing
distribution, digit-to-own-line residuals (in spacing units),
per-string skew (drift per 1000px, in spacing units).

Part B (inference feasibility): on one hires PNG per layout, detect
horizontal staff lines via dark-pixel row projection inside the GT
digit x-band (ROI from supervision; detection itself image-only) and
compare peak rows to GT line rows.
"""
import json, math, os, re, sys
from collections import defaultdict
from PIL import Image

W = os.path.expanduser('~/Documents/scoreflow-guitar')
FIT = [t for t in re.split(r'[\s,]+', open('/tmp/proof/fit-samples.txt').read()) if t.strip()]
WORKDIRS = json.load(open('/tmp/proof/workdirs.json'))
LAYOUTS = ['standard', 'compact', 'large', 'bravura']
HIRES = {'standard': '/tmp/proof/hires', 'compact': '/tmp/proof/hires-compact',
         'large': '/tmp/proof/hires-large', 'bravura': '/tmp/proof/hires-bravura'}
_LINK_CACHE = {}

def load_sample(sample, layout):
    jname = 'joins.json' if layout == 'standard' else f'joins-{layout}.json'
    for w in WORKDIRS:
        if os.path.basename(w) != sample:
            continue
        jp = os.path.join(W, w, jname)
        if os.path.exists(jp):
            joins = json.load(open(jp))
            cpath = os.path.join(W, w, 'canonical.json')
            canon = json.load(open(cpath)) if os.path.exists(cpath) else None
            return joins, canon
    return None, None

def build_links(sample, canon):
    if sample not in _LINK_CACHE:
        table = {}
        for e in (canon or {}).get('events', []):
            m = re.search(r"-n(\d+)$", (e.get('source') or {}).get('noteId') or '')
            if m:
                table[f"{sample}-n{int(m.group(1)) + 1:03d}"] = (e.get('tab') or {}).get('string')
        _LINK_CACHE[sample] = table
    return _LINK_CACHE[sample]

def cluster_systems(items):
    items = sorted(items, key=lambda t: t[0])
    if not items:
        return []
    cys = [t[0] for t in items]
    diffs = sorted([b - a for a, b in zip(cys, cys[1:]) if b - a > 1])
    if not diffs:
        return [items]
    med = diffs[len(diffs) // 2]
    systems, cur = [], [items[0]]
    for a, b in zip(items, items[1:]):
        if b[0] - a[0] > max(3 * med, 40):
            systems.append(cur)
            cur = [b]
        else:
            cur.append(b)
    systems.append(cur)
    return systems

def main():
    print('=== PART A: supervision geometry (TRAIN fit) ===')
    sys_detail = []
    for lay in LAYOUTS:
        spacings, resids, skews, nsys, ndig = [], [], [], 0, 0
        rep = None
        for s in FIT:
            joins, canon = load_sample(s, lay)
            if not joins:
                continue
            links = build_links(s, canon)
            pages = defaultdict(list)
            for src_id, v in joins.get('joins', {}).items():
                if 'tab-text' not in (v.get('children') or []):
                    continue
                st = links.get(src_id)
                if not st:
                    continue
                for b in v.get('boxes', []):
                    x0, y0, x1, y1 = b
                    pages[v.get('page', 1)].append(((y0 + y1) / 2, (x0 + x1) / 2, st))
            for pg, items in pages.items():
                for sys_items in cluster_systems(items):
                    by_str = defaultdict(list)
                    for cy, x, st in sys_items:
                        by_str[st].append((cy, x))
                    if len(by_str) < 4:
                        continue
                    lines = {st: sorted(c for c, _ in v)[len(v) // 2] for st, v in by_str.items()}
                    ss = sorted(lines)
                    gaps = [g for g in (lines[ss[i + 1]] - lines[ss[i]] for i in range(len(ss) - 1)) if g > 0]
                    if not gaps:
                        continue
                    sp = sorted(gaps)[len(gaps) // 2]
                    spacings.append(sp)
                    nsys += 1
                    ndig += len(sys_items)
                    if rep is None:
                        rep = (s, pg)
                    for cy, x, st in sys_items:
                        resids.append((cy - lines[st]) / sp)
                    for st, v in by_str.items():
                        if len(v) >= 3:
                            xs = [x for _, x in v]
                            ys = [c for c, _ in v]
                            mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
                            den = sum((x - mx) ** 2 for x in xs)
                            slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else 0
                            skews.append(slope * 1000 / sp)
                    sys_detail.append({'sample': s, 'layout': lay, 'page': pg,
                                       'strings': ss, 'spacing': round(sp, 1), 'n': len(sys_items)})
        if nsys:
            spm = sum(spacings) / len(spacings)
            rsd = math.sqrt(sum(r * r for r in resids) / len(resids))
            arp = sorted(abs(r) for r in resids)
            print(f'{lay}: systems={nsys} digits={ndig} '
                  f'spacingMean={spm:.1f} min={min(spacings):.1f} max={max(spacings):.1f} '
                  f'residRMS={rsd:.4f}sp residP95={arp[int(0.95 * len(arp))]:.4f}sp '
                  f'skewMed={sorted(skews)[len(skews)//2] if skews else 0:.4f}sp/1000px rep={rep}')
        else:
            print(f'{lay}: no systems')
    json.dump(sys_detail, open('/tmp/proof/staff-systems-fit.json', 'w'), indent=1)
    print('systems=%d' % len(sys_detail))

if len(sys.argv) < 2 or sys.argv[1] != 'oracle':
    main()

def oracle_accuracy(samples, layout):
    """String-from-nearest-supervision-line accuracy (representation oracle)."""
    n, ok = 0, 0
    per_str = defaultdict(lambda: [0, 0])
    for s in samples:
        joins, canon = load_sample(s, layout)
        if not joins:
            continue
        links = build_links(s, canon)
        pages = defaultdict(list)
        for src_id, v in joins.get('joins', {}).items():
            if 'tab-text' not in (v.get('children') or []):
                continue
            st = links.get(src_id)
            if not st:
                continue
            for b in v.get('boxes', []):
                x0, y0, x1, y1 = b
                pages[v.get('page', 1)].append(((y0 + y1) / 2, (x0 + x1) / 2, st))
        for pg, items in pages.items():
            for sys_items in cluster_systems(items):
                by_str = defaultdict(list)
                for cy, x, st in sys_items:
                    by_str[st].append((cy, x))
                if len(by_str) < 4:
                    continue
                lines = {st: sorted(c for c, _ in v)[len(v) // 2] for st, v in by_str.items()}
                order = sorted(lines, key=lambda st: lines[st])
                idx_of = {st: i + 1 for i, st in enumerate(order)}
                for cy, x, st in sys_items:
                    pred = min(lines, key=lambda st2: abs(cy - lines[st2]))
                    n += 1
                    c = 1 if pred == st else 0
                    ok += c
                    per_str[st][0] += c
                    per_str[st][1] += 1
    return n, ok, {k: (v[0] / v[1], v[1]) for k, v in sorted(per_str.items())}

if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == 'oracle':
    HELD = [t for t in re.split(r'[\s,]+', open('/tmp/proof/held-samples.txt').read()) if t.strip()]
    for lay in (['standard'] if len(sys.argv) < 3 else [sys.argv[2]]):
        n, ok, ps = oracle_accuracy(HELD, lay)
        print(f'{lay} heldout oracle: n={n} acc={ok/max(1,n):.3f}')
        for st, (a, c) in ps.items():
            print(f'  s{st}: {a:.3f} (n={c})')

#!/usr/bin/env python3
"""Run the FROZEN native-font eval set (docs/guitar-vision/NATIVE_EVAL_SET.md).

Rasterises each heldout score at its documented width with its own
embedded font, derives geometry from pixels, normalises to the trained
gap, runs the frozen detector, and scores note/rest/tabdigit precision,
recall and FP against joins GT (eval only). Writes per-page JSON plus an
aggregate.

Usage:
  python3 tools/guitar-vision/proof-native-eval.py --out DIR [--widths W]
"""
import argparse, json, subprocess, sys
from pathlib import Path

W = Path('/Users/ryland/Documents/scoreflow-guitar')
EVAL = [
    ('pdmx-QmTJRwrHUET3', 'datasets/guitar-vision/pdmx/work/pdmx-QmTJRwrHUET3', 1700),
    ('pdmx-QmZ5K3BV9FDR', 'datasets/guitar-vision/pdmx/work/pdmx-QmZ5K3BV9FDR', 1900),
    ('pdmx2-QmVDaX5YmZCx', 'datasets/guitar-vision/pdmx/work/pdmx2-QmVDaX5YmZCx', 1700),
    ('guitar-ode-to-joy', 'datasets/guitar-vision/v2/work/guitar-ode-to-joy', 1700),
]


def pages_of(workdir):
    """1..N where page 1 is render.svg/page-w2100.png and page N>1 is
    render-pN.svg/page-pN-w2100.png."""
    p = W / workdir
    n = 1
    while (p / f'render-p{n + 1}.svg').exists() or (p / f'page-p{n + 1}-w2100.png').exists():
        n += 1
    return ','.join(str(i) for i in range(1, n + 1))


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=str(W))
    if r.returncode != 0:
        print('FAILED:', cmd[2], r.stderr[-300:])
    return r.returncode == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--base', default=None, help='existing dir to skip re-rasterising')
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    agg = {}
    for sample, workdir, width in EVAL:
        rdir = out_dir / sample
        rdir.mkdir(parents=True, exist_ok=True)
        rep = rdir / 'raster-report.json'
        if args.base:
            src = Path(args.base) / sample / 'raster-report.json'
            if src.exists():
                rep = src
        elif not rep.exists():
            # the baseline appends its own <sample> dir, so pass the parent
            run(['python3', 'tools/guitar-vision/proof-raster-baseline.py',
                 '--work', workdir, '--pages', pages_of(workdir),
                 '--width', str(width), '--out', str(out_dir)])
        if not rep.exists():
            print(sample, 'no report, skipped')
            continue
        sc = rdir / 'score.json'
        run(['python3', 'tools/guitar-vision/proof-raster-baseline.py', '--score',
             '--work', workdir, '--report', str(rep), '--out', str(sc)])
        if not sc.exists():
            continue
        scores = json.loads(sc.read_text())
        agg[sample] = scores
        for pg, r in scores.items():
            print(f'{sample} {pg} ' + ' '.join(
                f'{c}:P{r[c]["precision"]:.3f}/R{r[c]["recall"]:.3f}'
                for c in ['note', 'rest', 'tabdigit']))
    # aggregate over pages
    tot = {}
    for sample, scores in agg.items():
        for pg, r in scores.items():
            for c in ['note', 'rest', 'tabdigit']:
                d = tot.setdefault(c, {'tp': 0, 'fp': 0, 'fn': 0})
                d['tp'] += r[c]['tp']
                d['fp'] += r[c]['fp']
                d['fn'] += r[c]['gt'] - r[c]['tp']
    print('--- AGGREGATE (all eval pages) ---')
    summary = {}
    for c, d in tot.items():
        p = d['tp'] / max(d['tp'] + d['fp'], 1)
        r = d['tp'] / max(d['tp'] + d['fn'], 1)
        f1 = 2 * p * r / max(p + r, 1e-9)
        summary[c] = {'tp': d['tp'], 'fp': d['fp'], 'fn': d['fn'],
                      'precision': round(p, 3), 'recall': round(r, 3),
                      'f1': round(f1, 3)}
        print(f'{c}: tp={d["tp"]} fp={d["fp"]} fn={d["fn"]} P={p:.3f} R={r:.3f} F1={f1:.3f}')
    (out_dir / 'aggregate.json').write_text(json.dumps(summary, indent=2))
    print('wrote', out_dir / 'aggregate.json')


if __name__ == '__main__':
    main()

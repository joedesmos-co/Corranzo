#!/usr/bin/env python3
"""Generate chain-eval/transcribe manifests from the corrected render path.

Retires the obsolete /tmp/proof/hires staging: manifests now point at
renders produced by proof-page-source.render_at_gap (measured staff gap,
selected font), so consumers keep their existing --hires interface.

Usage:
  python3 tools/guitar-vision/make-pipeline-manifests.py \
      --samples pdmx-QmTxoAbitsi9,pdmx2-QmekQbhC1yAP \
      --layouts standard,compact --target-gap 26 --font Palatino
"""
import argparse, sys
from pathlib import Path

W = Path('/Users/ryland/Documents/scoreflow-guitar')
sys.path.insert(0, str(W / 'tools/guitar-vision'))
import importlib.util as _ilu


def _imp(name, filename):
    spec = _ilu.spec_from_file_location(name, W / 'tools/guitar-vision' / filename)
    m = _ilu.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


ps = _imp('proof_page_source', 'proof-page-source.py')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--samples', required=True, help='comma-separated sample ids')
    ap.add_argument('--layouts', default='standard')
    ap.add_argument('--target-gap', type=float, default=26.0)
    ap.add_argument('--font', default='Palatino')
    ap.add_argument('--out-root', default='/tmp/proof/hires-fixed')
    args = ap.parse_args()
    samples = [s for s in args.samples.split(',') if s.strip()]
    layouts = [l for l in args.layouts.split(',') if l.strip()]
    workdirs = []
    for s in samples:
        for root in ['datasets/guitar-vision/pdmx/work', 'datasets/guitar-vision/v2/work']:
            p = W / root / s
            if p.exists() and (p / 'canonical.json').exists():
                workdirs.append(str(p.relative_to(W)))
                break
        else:
            print(f'  {s}: no workdir, skipped')
    n = ps.write_manifests(workdirs, layouts, args.target_gap, args.font, args.out_root)
    print(f'manifests written: {n} for {len(workdirs)} samples x {len(layouts)} layouts')


if __name__ == '__main__':
    main()

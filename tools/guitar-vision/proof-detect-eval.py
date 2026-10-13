"""Detection quality on committed-asset renders (M4/M3 foundation).

Runs the real inference pipeline (no oracle boxes) on pages rendered at a
controlled staff gap, and scores note / rest / tabdigit against the joins
GT with the standard core-box matcher.

Usage:
  python3 tools/guitar-vision/proof-detect-eval.py \
      --work datasets/guitar-vision/pdmx/work/SAMPLE --pages 1,2 \
      --layout standard --target-gap 26
"""
import argparse, json, sys
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image
import torch

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
pig = _imp('proof_ignore_train', 'proof-ignore-train.py')
dec = _imp('proof_heatmap_decode', 'proof-heatmap-decode.py')

DEV = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
_DET = None


def det():
    global _DET
    if _DET is None:
        _DET = pig.TinyFCN4().to(DEV)
        import torch as _t
        sd = _t.load(str(W / dec.WEIGHTS), map_location=DEV, weights_only=True)
        _DET.load_state_dict(sd.get('state', sd))
        _DET.eval()
    return _DET


def run(workdir, pages, layout, target_gap, detector=None, font=None):
    jn = 'joins.json' if layout == 'standard' else f'joins-{layout}.json'
    joins = json.loads((W / workdir / jn).read_text())
    if detector is None:
        detector = dec.WEIGHTS
    import torch as _t
    d = pig.TinyFCN4().to(DEV)
    sd = _t.load(str(W / detector) if not str(detector).startswith('/') else str(detector),
                 map_location=DEV, weights_only=True)
    d.load_state_dict(sd.get('state', sd))
    d.eval()
    tot = Counter()
    per_page = {}
    for pg in pages:
        r = ps.render_at_gap(workdir, layout, pg, target_gap=target_gap, font=font)
        if r is None:
            continue
        u8, fx = r['image'], r['fx']
        ox, oy = r['ox'], r['oy']
        gt = dec.build_gt(joins, pg, fx, fy=fx, core=True)
        # shift GT into the cropped image frame
        for g in gt:
            g['box'] = [g['box'][0] - ox, g['box'][1] - oy, g['box'][2] - ox, g['box'][3] - oy]
            g['cx'] -= ox
            g['cy'] -= oy
        preds, _scale = dec.infer_page_merged(d, u8, fx, fx, DEV)
        tp, fp, fn = dec.match(preds, gt)
        tot['tp'] += tp
        tot['fp'] += fp
        tot['fn'] += fn
        per_page[pg] = (tp, fp, fn, len(preds), len(gt), r['gap'], round(_scale, 3))
    return tot, per_page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    ap.add_argument('--pages', default='1')
    ap.add_argument('--layout', default='standard')
    ap.add_argument('--target-gap', type=float, default=26.0)
    ap.add_argument('--detector', default=None)
    ap.add_argument('--font', default=None)
    args = ap.parse_args()
    pages = [int(p) for p in args.pages.split(',') if p.strip()]
    tot, per_page = run(args.work, pages, args.layout, args.target_gap, args.detector, args.font)
    print('work=%s layout=%s gap=%.1f' % (Path(args.work).name, args.layout, args.target_gap))
    for pg in sorted(per_page):
        tp, fp, fn, npred, ngt, gap, sc = per_page[pg]
        P = tp / max(tp + fp, 1)
        R = tp / max(tp + fn, 1)
        print('  p%d: preds=%d gt=%d tp=%d fp=%d fn=%d  P=%.3f R=%.3f F1=%.3f  (gap=%.1f scale=%.2f)'
              % (pg, npred, ngt, tp, fp, fn, P, R, 2 * P * R / max(P + R, 1e-9), gap, sc))
    tp, fp, fn = tot['tp'], tot['fp'], tot['fn']
    P = tp / max(tp + fp, 1)
    R = tp / max(tp + fn, 1)
    print('TOTAL: tp=%d fp=%d fn=%d P=%.3f R=%.3f F1=%.3f'
          % (tp, fp, fn, P, R, 2 * P * R / max(P + R, 1e-9)))


if __name__ == '__main__':
    main()

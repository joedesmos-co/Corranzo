"""Filter attrition ledger (task 1): where do detected digits go?

Replicates proof-transcribe's digit path stage by stage and records, for
every candidate, whether it matched a GT tab digit and which filter
(if any) discarded it. Uses only image evidence; GT is for scoring.

Usage:
  python3 tools/guitar-vision/proof-attrition.py --work .../pdmx-QmTxoAbitsi9 \
      --pages 1,2 --layout standard --hires /tmp/proof/hires-fixed/hires
"""
import argparse, json, re, sys
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F
from scipy import ndimage as ndi

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
mb = _imp('proof_measure_bars', 'proof-measure-bars.py')
frt = _imp('proof_fret_geometry', 'fret_geometry_audit.py')
cc = _imp('proof_context_crops', 'proof-context-crops.py')

DEV = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
_DET = None


def det():
    global _DET
    if _DET is None:
        _DET = pig.TinyFCN4().to(DEV)
        sd = torch.load(str(W / dec.WEIGHTS), map_location=DEV, weights_only=True)
        _DET.load_state_dict(sd.get('state', sd))
        _DET.eval()
    return _DET


def gt_digit_boxes(joins, page_no, fx, fy, ox=0.0, oy=0.0):
    out = []
    for sid, v in joins.get('joins', {}).items():
        if 'tab-text' not in (v.get('children') or []):
            continue
        if (v.get('page') or 1) != page_no:
            continue
        for b in v.get('boxes', []):
            x0, y0 = b[0] * fx - ox, b[1] * fy - oy
            x1, y1 = b[2] * fx - ox, b[3] * fy - oy
            out.append({'sid': sid, 'box': [x0, y0, x1, y1],
                        'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    ap.add_argument('--pages', default='1')
    ap.add_argument('--layout', default='standard')
    ap.add_argument('--hires', required=True, help='dir with the corrected manifests')
    ap.add_argument('--target-gap', type=float, default=26.0)
    args = ap.parse_args()
    sample = Path(args.work).name
    man = json.loads((Path(args.hires) / f'{sample}-manifest.json').read_text())
    jn = 'joins.json' if args.layout == 'standard' else f'joins-{args.layout}.json'
    joins = json.loads((Path(args.work) / jn).read_text())

    ledger = Counter()
    for pgkey, meta in man.items():
        if not isinstance(meta, dict) or 'file' not in meta:
            continue
        pg = int(pgkey.replace('page', ''))
        if pg not in [int(p) for p in args.pages.split(',')]:
            continue
        u8 = np.asarray(Image.open(meta['file']).convert('L')).astype(np.uint8)
        fx = meta['cssWidth'] / meta['viewBox'][0]
        fy = meta['height'] / meta['viewBox'][1]
        # crop to ink so the manifest's uncropped render is centred
        ink0 = u8 < 128
        cols = np.nonzero(ink0.any(axis=0))[0]
        rows = np.nonzero(ink0.any(axis=1))[0]
        ox = float(max(int(cols.min()) - 4, 0)) if len(cols) else 0.0
        oy = float(max(int(rows.min()) - 4, 0)) if len(rows) else 0.0
        img = np.asarray(Image.fromarray(u8).crop(
            (int(ox), int(oy), min(int(cols.max()) + 4, u8.shape[1]),
             min(int(rows.max()) + 4, u8.shape[0]))), dtype=np.uint8)
        gts = gt_digit_boxes(joins, pg, fx, fy, ox, oy)
        used = set()

        def match(x, y, box):
            best, bd = None, 30.0
            for i, g in enumerate(gts):
                if i in used:
                    continue
                d = ((g['cx'] - x) ** 2 + (g['cy'] - y) ** 2) ** 0.5
                if d < bd:
                    best, bd = i, d
            if best is None or bd > 25:
                return None
            used.add(best)
            return best

        ledger['gt_digits'] += len(gts)
        with torch.no_grad():
            heat = det()(torch.from_numpy(img.astype(np.float32) / 255.0)
                         .unsqueeze(0).unsqueeze(0).to(DEV))[0]
        preds = dec.decode_page(heat, img, fx, fy, staff_gate=False)
        digits = [p for p in preds if p['cls'] == 'tabdigit']
        ledger['detected_tabdigit'] += len(digits)

        # --- stage: TAB-span filter (transcribe: 0.75*page_sp margin) ---
        sys_bars = mb.detect_barline_systems(img)
        tabspans = [(s['top'], s['bot']) for s in sys_bars if s.get('tab')]
        page_sp = None
        # staff gap measured on the raster (transcribe uses page_spacing)
        import importlib.util as iu2
        spec = iu2.spec_from_file_location('psg', str(W / 'tools/guitar-vision' / 'proof-string-geometric.py'))
        psg = iu2.module_from_spec(spec); spec.loader.exec_module(psg)
        page_sp = psg.page_spacing(img.astype(np.float32))
        ledger['page_sp_measured_%s' % ('ok' if page_sp else 'none')] += 1
        span_survivors = []
        for d in digits:
            if tabspans and page_sp:
                dtab = min([0 if t <= d['y'] <= b else min(abs(d['y'] - t), abs(d['y'] - b))
                            for t, b in tabspans])
                if dtab > 0.75 * page_sp:
                    m = match(d['x'], d['y'], d['box'])
                    ledger['LOST_tabspan_gt' if m is not None else 'LOST_tabspan_fp'] += 1
                    continue
            span_survivors.append(d)
        ledger['survive_tabspan'] += len(span_survivors)

        # --- stage: confidence abstention (TAU) ---
        rule = (img < 128).mean(axis=1) > 0.5
        conf_survivors = []
        for d in span_survivors:
            cx, cy = d['x'], d['y']
            tall = None
            half_h = 130
            try:
                box = (max(int(cx - 30), 0), max(int(cy - half_h), 0),
                       min(int(cx + 30), img.shape[1]), min(int(cy + half_h), img.shape[0]))
                t = Image.fromarray(img).crop(box).resize((64, 256), Image.BILINEAR)
                tt = torch.from_numpy(np.asarray(t, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(DEV)
                sp = F.softmax(net_string(tt)['string'] / 0.7, dim=1)[0]
                s_conf = float(sp.max())
            except Exception:
                s_conf = 1.0
            if min(s_conf, d.get('v', 1.0)) < 0.6:
                m = match(cx, cy, d['box'])
                ledger['LOST_tau_gt' if m is not None else 'LOST_tau_fp'] += 1
                continue
            conf_survivors.append(d)
        ledger['survive_tau'] += len(conf_survivors)
        print('page %d: gt=%d detected=%d span_surv=%d conf_surv=%d' % (
            pg, len(gts), len(digits), len(span_survivors), len(conf_survivors)))
    print()
    for k in sorted(ledger):
        print('  %-28s %d' % (k, ledger[k]))


def net_string():
    """Load the string net (cached)."""
    global _DET
    if not hasattr(net_string, '_m'):
        import importlib.util as iu
        spec = iu.spec_from_file_location('pt', str(W / 'tools/guitar-vision' / 'proof_train.py'))
        pt = iu.module_from_spec(spec); spec.loader.exec_module(pt)
        m = pt.StringNet() if hasattr(pt, 'StringNet') else pt.ProofNet()
        sd = torch.load(str(W / 'datasets/guitar-vision/proof-context' / 'stringnet.pt'),
                        map_location=DEV, weights_only=True)
        m.load_state_dict(sd.get('state', sd) if isinstance(sd, dict) else sd)
        m.to(DEV).eval()
        net_string._m = m
    return net_string._m


if __name__ == '__main__':
    main()

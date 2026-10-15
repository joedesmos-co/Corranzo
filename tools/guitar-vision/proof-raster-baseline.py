"""Genuine raster baseline (M1): raster PDF/page -> pixels -> MusicXML.

Inference consumes a RASTER IMAGE ONLY. It does not read the source
SVG, viewBox, staff coordinates, page dimensions, font list or any
fixture manifest: the pixel->canonical-unit scale is derived from the
MEASURED staff-line spacing (fx = staff_gap / VEROVIO_STAFF_GAP), and
all geometry (staff groups, TAB spans, barlines) comes from pixels.

The raster is produced from the score's SVG with the DOCUMENT FONT LEFT
ALONE (no training-font override), at a raster width unrelated to the
controlled renders, so the result reflects native-font performance.

Usage:
  python3 tools/guitar-vision/proof-raster-baseline.py \
      --work datasets/guitar-vision/pdmx/work/SAMPLE --pages 1 --width 1700 \
      --out /tmp/proof/raster/SAMPLE
"""
import argparse, json, subprocess, sys
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image

W = Path('/Users/ryland/Documents/scoreflow-guitar')
sys.path.insert(0, str(W / 'tools/guitar-vision'))
import importlib.util as _ilu

VEROVIO_STAFF_GAP = 315.0  # canonical layout units between staff lines

NODE = r"""
const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
  const [svgPath, pngPath, width, pdfPath] = process.argv.slice(2);
  let svg = fs.readFileSync(svgPath, 'utf8');
  // ONLY the outer size is set, so the page renders at the requested raster
  // width. No font-family is touched: the document's own embedded font is used.
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  const Wd = Number(width), Hd = Math.round(Wd * Number(vb[2]) / Number(vb[1]));
  svg = svg.replace(/<svg width="\d+px" height="\d+px"/, `<svg width="${Wd}px" height="${Hd}px"`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Wd, height: Hd } });
  await page.setContent(`<html><body style="margin:0;background:#fff;line-height:0">` +
    `<div id="wrap" style="width:${Wd}px;height:${H}px;overflow:hidden">${svg}</div>`);
  await page.pdf({ path: pdfPath, width: Wd + 'px', height: Hd + 'px',
                   printBackground: true, margin: {top:'0',bottom:'0',left:'0',right:'0'} });
  await page.locator('#wrap').screenshot({ path: pngPath });
  await browser.close();
})();
"""
# Hd is used inside the template before definition in that scope; fix by
# making the template self-contained:
NODE = NODE.replace('height:${Hd}px', 'height:${Hd + "px"}')
NODE = NODE.replace('height:${H}px', 'height:${Hd}px')


def _imp(name, filename):
    spec = _ilu.spec_from_file_location(name, W / 'tools/guitar-vision' / filename)
    m = _ilu.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


def node_script():
    p = Path('/tmp/proof/gv-raster.cjs')
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(NODE)
    return p


def node_env():
    import os
    env = dict(os.environ)
    nm = str(W / 'node_modules')
    env['NODE_PATH'] = nm + (os.pathsep + env['NODE_PATH'] if env.get('NODE_PATH') else '')
    return env


def rasterize(workdir, layout, page_no, width, out_dir):
    base = W / workdir
    name = 'render.svg' if layout == 'standard' else f'render-{layout}.svg'
    svg = base / (name if page_no == 1 else name.replace('.svg', f'-p{page_no}.svg'))
    if not svg.exists():
        return None, None
    out_dir.mkdir(parents=True, exist_ok=True)
    png = out_dir / f'p{page_no}-w{width}.png'
    pdf = out_dir / f'p{page_no}-w{width}.pdf'
    r = subprocess.run(['node', str(node_script()), str(svg), str(png), str(width), str(pdf)],
                       capture_output=True, text=True, cwd=str(W), env=node_env())
    if r.returncode != 0 or not png.exists():
        print('rasterize failed:', r.stderr[-400:])
        return None, None
    return png, pdf


def measure_gap(img):
    ink = img < 128
    h, w = ink.shape
    if h < 100 or w < 100:
        return None
    # staff lines by contiguous run (width-relative), then line-band gaps
    runs = np.zeros(h, dtype=np.int32)
    for y in range(h):
        ch = np.flatnonzero(ink[y])
        if not len(ch):
            continue
        brk = np.flatnonzero(np.diff(ch) > 1)
        st = np.concatenate(([0], brk + 1))
        en = np.concatenate((brk, [len(ch) - 1]))
        runs[y] = int((ch[en] - ch[st] + 1).max())
    minrun = 100
    rows = np.nonzero(runs >= minrun)[0]
    if len(rows) < 6:
        return None
    bands, st, pv = [], rows[0], rows[0]
    for r in rows[1:]:
        if r - pv > 3:
            bands.append((st + pv) / 2)
            st = r
        pv = r
    bands.append((st + pv) / 2)
    small = [b - a for a, b in zip(bands, bands[1:]) if b - a < 100]
    if len(small) < 4:
        return None
    return float(np.median(small))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    ap.add_argument('--pages', default='1')
    ap.add_argument('--width', type=int, default=1700)
    ap.add_argument('--layout', default='standard')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    sample = Path(args.work).name
    out_dir = Path(args.out) / sample
    report = {'sample': sample, 'width': args.width, 'font': 'document-native',
              'pages': {}}
    for pg in [int(p) for p in args.pages.split(',')]:
        png, pdf = rasterize(args.work, args.layout, pg, args.width, out_dir)
        if png is None:
            continue
        img = np.asarray(Image.open(png).convert('L')).astype(np.uint8)
        gap = measure_gap(img)
        fx = (gap / VEROVIO_STAFF_GAP) if gap else None
        report['pages'][f'p{pg}'] = {
            'png': str(png), 'pdf': str(pdf) if pdf else None,
            'size': list(img.shape), 'measured_gap_px': gap,
            'derived_units_per_px': fx,
        }
        print(f'p{pg}: raster {img.shape[1]}x{img.shape[0]}  staff_gap={gap}  fx={fx}')
    (out_dir / 'raster-report.json').write_text(json.dumps(report, indent=2))
    print('wrote', out_dir / 'raster-report.json')




def score_detection(png, fx, workdir, page_no):
    """Detect on a raster and score against joins GT (EVAL ONLY)."""
    import torch
    pig = _imp('proof_ignore_train', 'proof-ignore-train.py')
    dec = _imp('proof_heatmap_decode', 'proof-heatmap-decode.py')
    dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    det = pig.TinyFCN4().to(dev)
    sd = torch.load(str(W / dec.WEIGHTS), map_location=dev, weights_only=True)
    det.load_state_dict(sd.get('state', sd))
    det.eval()
    img = np.asarray(Image.open(png).convert('L')).astype(np.uint8)
    joins = json.loads((W / workdir / 'joins.json').read_text())
    gt = []
    for sid, v in joins.get('joins', {}).items():
        if (v.get('page') or 1) != page_no:
            continue
        ch = v.get('children') or []
        cls = 'note' if 'notehead' in ch else ('rest' if 'rest' in ch else
              ('tabdigit' if 'tab-text' in ch else None))
        if not cls or not v.get('boxes'):
            continue
        for b in v['boxes']:
            gt.append({'cls': cls, 'box': [b[0]*fx, b[1]*fx, b[2]*fx, b[3]*fx]})
    # SCALE NORMALIZATION to the detector's trained staff gap. A real PDF
    # rasterised at an arbitrary width/DPI has a staff gap far from the
    # trained 26px (measured 15.5-22px at other widths), and the frozen
    # detector is scale-sensitive: without this, detection collapses to
    # near-zero (0-7 tp of 200+). Everything is derived from the measured
    # gap, so any page size becomes irrelevant.
    from proof_heatmap_decode import normalize_scale as _norm
    img2, _scale = _norm(img)
    with torch.no_grad():
        heat = det(torch.from_numpy(img2.astype(np.float32)/255.0).unsqueeze(0).unsqueeze(0).to(dev))[0]
    preds = dec.decode_page(heat, img2, fx * _scale, fx * _scale, staff_gate=False)
    gt = [dict(g, box=[v * _scale for v in g['box']]) for g in gt]
    _raster_scale = _scale
    res = {'raster_scale_to_trained_gap': round(float(_scale), 3),
           'trained_gap_px': 26.0}
    for cls in ['note', 'rest', 'tabdigit']:
        P = [p for p in preds if p['cls'] == cls]
        G = [g for g in gt if g['cls'] == cls]
        used = set()
        tp = 0
        for g in G:
            best, bd = None, 0.0
            for i, p in enumerate(P):
                if i in used:
                    continue
                v = dec.iou(p['box'], g['box'])
                if v > bd:
                    best, bd = i, v
            if best is not None and bd >= 0.5:
                used.add(best)
                tp += 1
        fp = len(P) - len(used)
        prec = tp / max(tp + fp, 1)
        rec = tp / max(len(G), 1)
        res[cls] = {'preds': len(P), 'gt': len(G), 'tp': tp, 'fp': fp,
                    'precision': round(prec, 3), 'recall': round(rec, 3),
                    'f1': round(2 * prec * rec / max(prec + rec, 1e-9), 3)}
    return res


def main_score():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    ap.add_argument('--report', required=True)
    ap.add_argument('--out', required=True)
    a, _ = ap.parse_known_args()
    rep = json.loads(Path(a.report).read_text())
    out = {}
    for pg, info in rep['pages'].items():
        fx = info['derived_units_per_px']
        if fx is None:
            continue
        n = int(pg.lstrip('p'))
        out[pg] = score_detection(info['png'], fx, a.work, n)
        print(pg, json.dumps(out[pg]))
    Path(a.out).write_text(json.dumps(out, indent=2))
    print('wrote', a.out)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--score':
        main_score()
    else:
        main()

"""Prepare the font-augmentation render set (prereg GUITAR_FONT_AUG_PREREG).

For every TRAIN-split tab-bearing score (excluding the two controlled
tuned-on scores), render each page at the TRAIN width (staff gap 26px)
with ONE font chosen round-robin from the local serif families, and emit
a manifest in the format proof-ignore-train.py consumes:
{"pageN": {"file", "cssWidth", "viewBox", "height", "font"}}.

Nothing is written into the repo; output goes to /tmp/proof/hires-fontaug
and is regenerable from this script.

Usage:
  python3 tools/guitar-vision/proof-fontaug-prep.py --out /tmp/proof/hires-fontaug
"""
import argparse, json, os, re, subprocess, sys
from pathlib import Path
from PIL import Image

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

# Genuine local serif families (no downloads). Palatino is the control.
FONTS = ['Palatino', 'Times', 'Times New Roman', 'Georgia', 'Baskerville',
         'Charter', 'Hoefler Text', 'Liberation Serif', 'DejaVu Serif', 'PT Serif']
# TRAIN-tuned controlled scores: excluded so they stay a genuine holdout
EXCLUDE = {'pdmx-QmTxoAbitsi9', 'pdmx2-QmekQbhC1yAP'}
TARGET_GAP = 26.0

NODE = r"""
const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
  const [svgPath, pngPath, width, font] = process.argv.slice(2);
  let svg = fs.readFileSync(svgPath, 'utf8');
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  const Wd = Number(width), Hd = Math.round(Wd * Number(vb[2]) / Number(vb[1]));
  svg = svg.replace(/<svg width="\d+px" height="\d+px"/, `<svg width="${Wd}px" height="${Hd}px"`);
  svg = svg.replace(/font-family="[^"]*"/g, `font-family="${font}"`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Wd, height: Hd } });
  await page.setContent(`<html><body style="margin:0;background:#fff;line-height:0">` +
    `<div id="wrap" style="width:${Wd}px;height:${Hd}px;overflow:hidden">${svg}</div></html>`);
  await page.locator('#wrap').screenshot({ path: pngPath });
  await browser.close();
})();
"""


def node_env():
    env = dict(os.environ)
    nm = str(W / 'node_modules')
    env['NODE_PATH'] = nm + (os.pathsep + env['NODE_PATH'] if env.get('NODE_PATH') else '')
    return env


def train_pages(workdir):
    p = W / workdir
    pages = [1]
    while (p / f'render-p{len(pages) + 1}.svg').exists() or (p / f'page-p{len(pages) + 1}-w2100.png').exists():
        pages.append(len(pages) + 1)
    # cap at 6 pages/score to bound the render budget
    return pages[:6]


def _vbh(svg_path):
    """viewBox height from the verovio SVG."""
    head = svg_path.read_text(errors='ignore')[:30000]
    import re as _re
    m = _re.search('viewBox="0 0 ' + '[0-9.]+ ([0-9.]+)"', head)
    return float(m.group(1)) if m else 29700.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='/tmp/proof/hires-fontaug')
    ap.add_argument('--max-scores', type=int, default=12)
    args = ap.parse_args()
    SPLIT = {}
    for mp in ['datasets/guitar-vision/pdmx/dataset-manifest.json',
               'datasets/guitar-vision/v2/dataset-manifest.json']:
        p = W / mp
        if not p.exists():
            continue
        for a in json.loads(p.read_text())['splits']['assignments']:
            if a.get('sample'):
                SPLIT[a['sample']] = a.get('split')
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    script = Path('/tmp/proof/gv-fontaug.cjs')
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(NODE)
    manifest_out = {}
    n_scores = n_pages = 0
    for root in ['datasets/guitar-vision/pdmx/work', 'datasets/guitar-vision/v2/work']:
        base = W / root
        if not base.exists():
            continue
        for d in sorted(base.iterdir()):
            if n_scores >= args.max_scores:
                break
            if not d.is_dir() or not (d / 'joins.json').exists():
                continue
            s = d.name
            if s in EXCLUDE or SPLIT.get(s) != 'train':
                continue
            j = json.loads((d / 'joins.json').read_text())
            if not any('tab-text' in (v.get('children') or []) for v in j['joins'].values()):
                continue
            workdir = str(d.relative_to(W))
            man = {}
            ok = True
            for pi, pg in enumerate(train_pages(workdir)):
                svg = d / ('render.svg' if pg == 1 else f'render-p{pg}.svg')
                if not svg.exists():
                    continue
                su = ps.svg_units(svg)
                if su is None:
                    continue
                vbw = su[1]
                # round-robin: page 1 of the first score is Palatino (control)
                font = FONTS[n_pages % len(FONTS)]
                png = out_dir / f'{s}-p{pg}-{font.replace(" ", "_")}.png'
                width = int(round(TARGET_GAP * vbw / 315.0))
                r = subprocess.run(['node', str(script), str(svg), str(png),
                                    str(width), font], capture_output=True, text=True,
                                   cwd=str(W), env=node_env())
                if r.returncode != 0 or not png.exists():
                    print('render failed', s, pg, font, r.stderr[-160:])
                    ok = False
                    break
                man[f'page{pg}'] = {
                    'file': str(png), 'cssWidth': width,
                    'viewBox': [float(vbw), float(_vbh(svg))],
                    'height': Image.open(png).height, 'font': font}
                n_pages += 1
            if ok and man:
                (out_dir / f'{s}-manifest.json').write_text(json.dumps(man, indent=1))
                manifest_out[s] = sorted({v['font'] for v in man.values()})
                n_scores += 1
    all_fonts = set()
    for fs_ in manifest_out.values():
        all_fonts.update(fs_)
    (out_dir / 'prep-report.json').write_text(json.dumps(
        {'scores': n_scores, 'pages': n_pages, 'fonts': sorted(all_fonts),
         'per_score_fonts': manifest_out}, indent=2))
    print(f'scores={n_scores} pages={n_pages}')
    for s, fs_ in manifest_out.items():
        print(' ', s, sorted(set(fs_)))


if __name__ == '__main__':
    main()

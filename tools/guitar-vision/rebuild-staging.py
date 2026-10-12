#!/usr/bin/env python3
"""Rebuild /tmp/proof/hires-* staging from committed dataset assets.

The previous /tmp/proof staging was reaped by a reboot; every source it
referenced (committed SVGs, page PNGs, joins, canonical, detectors,
heads) is still in the repo. This reconstructs the manifests and split
lists the audit/eval tools expect, so work resumes without re-rendering.

Units: verovio SVGs nest `<svg class="definition-scale" viewBox="0 0
W H">` whose W,H are page units. A page PNG rendered at 2100px width
therefore maps units -> px by fx = 2100 / W.

Usage: python3 tools/guitar-vision/rebuild-staging.py
"""
import json, os, re, sys
from pathlib import Path

W = Path('/Users/ryland/Documents/scoreflow-guitar')
OUT = Path('/tmp/proof')

ROOTS = ['datasets/guitar-vision/pdmx/work',
         'datasets/guitar-vision/v2/work',
         'datasets/guitar-vision/pdmx-pilot/work',
         'datasets/guitar-vision/v2-pilot/work']

LAYOUT_SVG = {'standard': 'render.svg', 'compact': 'render-compact.svg',
              'large': 'render-large.svg', 'bravura': 'render-bravura.svg'}


def workdirs():
    out = []
    for r in ROOTS:
        base = W / r
        if not base.exists():
            continue
        for sid in sorted(os.listdir(base)):
            if (base / sid).is_dir() and (base / sid / 'canonical.json').exists():
                out.append(str((base / sid).relative_to(W)))
    return out


def splits():
    S = {}
    for man in ['datasets/guitar-vision/pdmx/dataset-manifest.json',
                'datasets/guitar-vision/v2/dataset-manifest.json',
                'datasets/guitar-vision/pdmx-pilot/dataset-manifest.json']:
        p = W / man
        if not p.exists():
            continue
        m = json.loads(p.read_text())
        for a in m.get('splits', {}).get('assignments', []) or []:
            if a.get('sample'):
                S[a['sample']] = a.get('split')
    return S


def viewbox(svg_path):
    try:
        head = svg_path.read_text()[:20000]
    except Exception:
        return None
    m = re.search(r'class="definition-scale"[^>]*viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"', head)
    if not m:
        m = re.search(r'viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"', head)
    if not m:
        return None
    return [float(m.group(1)), float(m.group(2))]


def png_pages(workdir, layout):
    """{page_no: Path} for the w2100 raster of this layout."""
    base = W / workdir
    out = {}
    pats = ([r'^page-p(\d+)-w2100\.png$', r'^page-w2100\.png$']
            if layout == 'standard'
            else [r'^page-%s-p(\d+)-w2100\.png$' % layout,
                  r'^page-%s-w2100\.png$' % layout])
    for f in sorted(os.listdir(base)):
        for pat in pats:
            m = re.match(pat, f)
            if m:
                pg = int(m.group(1)) if m.lastindex else 1
                out[pg] = base / f
                break
    return out


def svg_for(workdir, layout, page_no):
    """Per-page SVG (verovio emits render<N>-<layout>.svg for N>1)."""
    base = W / workdir
    name = LAYOUT_SVG[layout]
    cands = []
    if page_no == 1:
        cands.append(base / name)
    else:
        cands.append(base / name.replace('.svg', f'-p{page_no}.svg'))
        cands.append(base / name.replace('.svg', f'{page_no}.svg'))
    for c in cands:
        if c.exists():
            return c
    # fall back: any render*<layout>-pN.svg
    for f in sorted(os.listdir(base)):
        m = re.match(r'^render(?:-p\d+)?-%s(?:-p%d)?\.svg$' % (layout, page_no), f)
        if m:
            return base / f
    return None


def main():
    OUT.mkdir(exist_ok=True)
    sdirs = workdirs()
    S = splits()
    fit, held, dev = [], [], []
    manifests = 0
    for wd in sdirs:
        sample = os.path.basename(wd)
        sp = S.get(sample)
        if sp == 'train':
            fit.append(sample)
        elif sp == 'heldout':
            held.append(sample)
        else:
            dev.append(sample)
        for layout in LAYOUT_SVG:
            pages = png_pages(wd, layout)
            if not pages:
                continue
            man = {}
            ok = True
            for pg in sorted(pages):
                vb = None
                svg = svg_for(wd, layout, pg)
                if svg is not None:
                    vb = viewbox(svg)
                if vb is None:
                    ok = False
                    break
                man[f'page{pg}'] = {
                    'file': str(pages[pg]),
                    'cssWidth': 2100,
                    'viewBox': vb,
                    'height': int(round(2100 * vb[1] / vb[0])) if False else None,
                    'layout': layout,
                }
                # png height from the file
                from PIL import Image
                with Image.open(pages[pg]) as im:
                    man[f'page{pg}']['height'] = im.height
            if not ok:
                continue
            hdir = OUT / ('hires' if layout == 'standard' else f'hires-{layout}')
            hdir.mkdir(exist_ok=True)
            suffix = '' if layout == 'standard' else f'-{layout}'
            (hdir / f'{sample}{suffix}-manifest.json').write_text(json.dumps(man, indent=1))
            manifests += 1
    (OUT / 'workdirs.json').write_text(json.dumps(sdirs))
    (OUT / 'fit-samples.txt').write_text(','.join(sorted(fit)))
    (OUT / 'held-samples.txt').write_text(','.join(sorted(held)))
    (OUT / 'validation-samples.txt').write_text(','.join(sorted(dev)))
    print(f'workdirs={len(sdirs)} fit={len(fit)} heldout={len(held)} dev={len(dev)} manifests={manifests}')


if __name__ == '__main__':
    main()

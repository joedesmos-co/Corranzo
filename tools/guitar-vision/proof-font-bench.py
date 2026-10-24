"""Render scanned-TAB benchmark pages in several digit fonts.

The music is taken from an existing reference MusicXML, so the ground
truth is independent of the recogniser: only the digit typeface changes.
Each page contains a standard-notation staff (for rhythm) and a six-line
TAB staff, then is blurred/rotated/JPEG-compressed and embedded in an
image-only PDF (no text layer), mirroring a real scan.

This is a BENCHMARK GENERATOR, not recognition code. It lets the raster
TAB path be measured across fonts instead of one Helvetica-family scan.

Usage:
  python3 tools/guitar-vision/proof-font-bench.py --out /tmp/proof/font-bench
"""
import argparse, json, math
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / 'benchmarks/omr-fixtures/guitar-paired-scan/guitar-paired-scan.musicxml'

FONTS = {
    'arial': '/System/Library/Fonts/Supplemental/Arial.ttf',
    'times': '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
    'courier': '/System/Library/Fonts/Supplemental/Courier New.ttf',
    'georgia': '/System/Library/Fonts/Supplemental/Georgia.ttf',
    'verdana': '/System/Library/Fonts/Supplemental/Verdana.ttf',
    'dejavu-sans': '/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf',
    'dejavu-serif': '/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSerif.ttf',
    'stix': '/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/STIXGeneral.ttf',
}

W, H = 2550, 3300          # 300 dpi letter
GAP = 33                    # staff space at 300 dpi
X0, X1 = 145, 2320
SYSTEMS = [
    {'notation': 603, 'tab': 997},
    {'notation': 1791, 'tab': 2185},
]
NOTEHEAD_W, NOTEHEAD_H = 26, 16


def ref_score(path):
    root = ET.parse(path).getroot()
    part = list(root.iter('part'))[0]
    measures = []
    for m in part.iter('measure'):
        onsets = []
        for n in m.iter('note'):
            if n.find('rest') is not None or n.find('chord') is not None:
                continue
            tech = n.find('notations/technical')
            if tech is None or tech.find('string') is None:
                continue
            notes = [(int(tech.find('string').text), int(tech.find('fret').text))]
            onsets.append(notes)
        measures.append(onsets)
    # attach chord members (reference files list them after the first note)
    measures = []
    for m in part.iter('measure'):
        onsets = []
        for n in m.iter('note'):
            if n.find('rest') is not None:
                continue
            tech = n.find('notations/technical')
            if tech is None or tech.find('string') is None:
                continue
            sf = (int(tech.find('string').text), int(tech.find('fret').text))
            if n.find('chord') is not None and onsets:
                onsets[-1].append(sf)
            else:
                onsets.append([sf])
        measures.append(onsets)
    return measures


def draw_page(font_path, font_name, out_dir):
    font = ImageFont.truetype(font_path, 30)
    small = ImageFont.truetype(font_path, 24)
    img = Image.new('L', (W, H), 255)
    d = ImageDraw.Draw(img)
    measures = ref_score(REF)
    assert len(measures) == 8, len(measures)

    for si, sysdef in enumerate(SYSTEMS):
        # notation staff: five lines
        ntop = sysdef['notation']
        for k in range(5):
            y = ntop + k * GAP
            d.line([(X0, y), (X1, y)], fill=90, width=2)
        # TAB staff: six lines + TAB clef
        ttop = sysdef['tab']
        for k in range(6):
            y = ttop + k * GAP
            d.line([(X0, y), (X1, y)], fill=70, width=2)
        d.text((X0 + 25, ttop + GAP * 1.3), 'T', font=small, fill=30)
        d.text((X0 + 25, ttop + GAP * 2.3), 'A', font=small, fill=30)
        d.text((X0 + 25, ttop + GAP * 3.3), 'B', font=small, fill=30)

        mw = (X1 - X0) / 4.0
        # barlines: opening + each measure + closing
        for b in range(5):
            x = X0 + b * mw
            d.line([(x, ntop), (x, ttop + 5 * GAP)], fill=40, width=3)

        for mi in range(4):
            measure = measures[si * 4 + mi]
            base = X0 + mi * mw
            # four onsets per measure at stable positions
            fracs = (0.22, 0.45, 0.68, 0.88)
            for oi, notes in enumerate(measure):
                x = base + fracs[min(oi, 3)] * mw
                # TAB digits centered on string lines
                for (s, f) in notes:
                    txt = str(f)
                    tw = d.textlength(txt, font=font)
                    y = ttop + (s - 1) * GAP
                    d.text((x - tw / 2, y - 15), txt, font=font, fill=20)
                # one notation notehead per onset (rhythm only), stem up
                ny = ntop + 2 * GAP
                d.ellipse([x - NOTEHEAD_W / 2, ny - NOTEHEAD_H / 2,
                           x + NOTEHEAD_W / 2, ny + NOTEHEAD_H / 2], fill=20)
                d.line([(x + NOTEHEAD_W / 2 - 2, ny + 4),
                        (x + NOTEHEAD_W / 2 - 2, ny - 3.5 * GAP)], fill=20, width=3)

    # scan-like degradation
    img = img.rotate(0.25, resample=Image.Resampling.BICUBIC, fillcolor=246)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.35))
    img = ImageEnhance.Contrast(img).enhance(0.94).convert('RGB')

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    png = out / f'font-{font_name}.png'
    pdf = out / f'font-{font_name}.pdf'
    img.save(png)
    img.save(pdf, 'PDF', resolution=300.0)
    return {'font': font_name, 'font_path': font_path, 'pdf': str(pdf),
            'png': str(png), 'reference': str(REF)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='/tmp/proof/font-bench')
    ap.add_argument('--fonts', default=','.join(FONTS))
    args = ap.parse_args()
    rows = []
    for name in args.fonts.split(','):
        name = name.strip()
        if name not in FONTS:
            continue
        if not Path(FONTS[name]).exists():
            print('missing font', name, FONTS[name])
            continue
        rows.append(draw_page(FONTS[name], name, args.out))
        print('wrote', rows[-1]['pdf'])
    (Path(args.out) / 'manifest.json').write_text(json.dumps(rows, indent=1))


if __name__ == '__main__':
    main()

import sys, os
sys.path.insert(0, os.path.join(os.getcwd(),'tools/piano-vision-v26-audit'))
import sys, json, re
import xml.etree.ElementTree as ET
import verovio
SVGNS = "{http://www.w3.org/2000/svg}"
sm = {s['id']: s for s in json.load(open('tools/real-pdf-adaptation/split_manifest.json'))['scores']}
from collections import Counter
for sid in ('bc-bach-fugue-bwv846',):
    mp = 'public/fixtures/practice-library/piano-bach-staff'  # placeholder
    import harness as H
    path = H.V26_ROOT / sm[sid]['musicxml']
    tk = verovio.toolkit(); tk.loadFile(str(path))
    forms = Counter(); samples = {}
    pg = 1
    sroot = ET.fromstring(tk.renderToSVG(pg))
    # measure grouping
    for meas in sroot.iter(SVGNS + 'g'):
        if meas.get('class') != 'measure':
            continue
        bl = [b for b in meas if b.get('class') == 'barLine']
        for b in bl:
            for el in b.iter():
                tag = el.tag.replace(SVGNS, '')
                forms[(tag, sorted(el.attrib.keys())[0] if el.attrib else '')] += 1
                key = (tag, tuple(sorted(el.attrib.keys())))
                if key not in samples:
                    samples[key] = (el.tag.replace(SVGNS,''), dict(el.attrib), el.text)
    print('barLine subtree element forms on page 1 of', sid)
    for k, v in forms.most_common():
        print('   %-10s attrs=%-28s count=%d' % (k[0], str(k[1])[:28], v))
    print()
    print('samples:')
    for k, v in samples.items():
        print('   ', v[0], {kk: (v[1][kk][:60] if isinstance(v[1][kk], str) else v[1][kk]) for kk in list(v[1])[:4]})
    # how many barLine groups per measure?
    cnt = Counter()
    for meas in sroot.iter(SVGNS + 'g'):
        if meas.get('class') == 'measure':
            cnt[len([b for b in meas if b.get('class') == 'barLine'])] += 1
    print()
    print('barLine groups per measure-group on page 1:', dict(cnt))
    # total measures on page 1
    nm = len([m for m in sroot.iter(SVGNS + 'g') if m.get('class') == 'measure'])
    print('measure groups on page 1:', nm)

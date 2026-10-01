import sys, os, json, gzip
sys.path.insert(0, os.path.join(os.getcwd(), 'tools/piano-vision-v26-audit'))
import numpy as np
from PIL import Image
import harness as H
from phase_p_pdfbarline import THRESHOLDS, staff_rows, detect_band
sid = 'bc-bach-fugue-bwv846'
with gzip.open(H.REALPDF_ROOT/'shards'/(sid+'.jsonl.gz'),'rt') as f:
    rec = json.loads(f.readline())
geo = rec['input']['modelInput']['geometry']
im = np.array(Image.open(H.REALPDF_ROOT/'pages'/sid/'page-1.png'))
Hh, Ww = im.shape
b = geo['staffBands']['staffBands'][0]
y0, y1 = b['y0']*Hh, b['y1']*Hh
rows = staff_rows(im, y0, y1)
xs0, xs1 = min(r[1] for r in rows), max(r[2] for r in rows)
det = detect_band(im, y0, y1, xs0, xs1, THRESHOLDS)
print('band gap %.2f  staff extent x=[%d,%d]  strokes=%d events=%d'
      % (det['gap'], xs0, xs1, len(det['strokes']), len(det['events'])))
acc = {}
for s in det['strokes']: acc.setdefault(s['x'], []).append(s)
pad = 0.3*det['gap']
top = int(y0-pad); bot = int(y1+pad)
sub = im[top:bot+1, xs0:xs0+300] < 140
print('\nP8 overlay, columns x=%d..%d  (V marks an accepted stroke, | the staff lines)'%(xs0,xs0+300))
for r in range(sub.shape[0]):
    line=''
    for c in range(sub.shape[1]):
        v = 'V' if (xs0+c) in acc else ('#' if sub[r,c] else '.')
        line += v
    yy = top+r
    mark = '|' if yy in (int(y0), int(y1)) else ' '
    print('%5d %s %s' % (yy, mark, line))
print('\naccepted stroke x positions (first 30):', sorted(acc)[:30])
print('event cluster centres:', [int(np.mean([s['x'] for s in e])) for e in det['events']][:12])

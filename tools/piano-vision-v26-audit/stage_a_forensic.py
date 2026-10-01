import sys, os, json
sys.path.insert(0, os.path.join(os.getcwd(), 'tools/piano-vision-v26-audit'))
from collections import defaultdict
import numpy as np
from PIL import Image
import harness as H
from phase_p_pdfbarline import THRESHOLDS, staff_rows, detect_band, refine_staff
import stage_a_pdfbarline_gate as A
import xml.etree.ElementTree as ET, verovio
SVGNS="{http://www.w3.org/2000/svg}"
sm={s['id']:s for s in json.load(open('tools/real-pdf-adaptation/split_manifest.json'))['scores']}
keys=A.band_keys(json.load(open('out/realpdf_21/index.json')))
imgs={}
def page(sid,p):
    k=(sid,p)
    if k not in imgs:
        q=H.REALPDF_ROOT/'pages'/sid/('page-%d.png'%p)
        imgs[k]=np.array(Image.open(q)) if q.is_file() else None
    return imgs[k]
def vmeas(sid):
    tk=verovio.toolkit()
    if not tk.loadFile(str(sm[sid]['musicxml'])): return None
    n=0
    for pg in range(1,tk.getPageCount()+1):
        n+=len([m for m in ET.fromstring(tk.renderToSVG(pg)).iter(SVGNS+'g') if m.get('class')=='measure'])
    return n
by=defaultdict(lambda: defaultdict(int)); ns=defaultdict(set); nref=0; ntot=0
for sid,systems in sorted(keys.items()):
    for (pno,sysn),bands in sorted(systems.items()):
        for band in ('upper','lower'):
            if band not in bands: continue
            im=page(sid,pno)
            if im is None: continue
            Hh,Ww=im.shape
            yn,yb=bands[band]; y0,y1=yn*Hh,yb*Hh
            gap0=(y1-y0)/4.0
            ntot+=1
            r=refine_staff(im,y0,y1,gap0)
            if r is None: continue
            nref+=1
            rt,rb,rg=r
            rows=staff_rows(im,rt,rb)
            if len(rows)<3: continue
            xs0=min(x[1] for x in rows); xs1=max(x[2] for x in rows)
            det=detect_band(im,rt,rb,xs0,xs1,THRESHOLDS)
            if not det: continue
            by[sid][band]+=max(0,len(det['events'])-1)
            ns[sid].add((pno,sysn))
print('refined staff lines on %d/%d bands (%.3f)'%(nref,ntot,nref/max(1,ntot)))
print()
print('  %-40s %6s %8s %8s %9s %6s'%("score","sys","iv_upper","iv_lower","V meas","best/V"))
tu=tv=0; ok=0
for sid in sorted(by):
    up,lo=by[sid]['upper'],by[sid]['lower']; v=vmeas(sid)
    if not v: continue
    best=up if abs(up-v)<=abs(lo-v) else lo
    tu+=best; tv+=v
    if abs(best-v)<=1: ok+=1
    print('  %-40s %6d %8d %8d %9d %6.2f'%(sid,len(ns[sid]),up,lo,v,best/v))
print()
print('  within 1 of notated measure count: %d/%d scores'%(ok,len(by)))
print('  totals: intervals=%d  measures=%d  ratio=%.4f'%(tu,tv,tu/max(1,tv)))

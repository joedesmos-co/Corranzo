import sys, os, json
sys.path.insert(0, os.path.join(os.getcwd(), 'tools/piano-vision-v26-audit'))
from collections import defaultdict
import numpy as np
import xml.etree.ElementTree as ET, verovio
SVGNS="{http://www.w3.org/2000/svg}"
sm={s['id']:s for s in json.load(open('tools/real-pdf-adaptation/split_manifest.json'))['scores']}
rows=json.load(open('tools/piano-vision-v26-audit/out/H_consensus_canonical.json'))
def vpages(sid):
    tk=verovio.toolkit()
    if not tk.loadFile(str(sm[sid]['musicxml'])): return None
    have={int(p.split('-')[-1].split('.')[0]) for p in os.listdir('out/realpdf_21/pages/%s'%sid) if p.endswith('.png')}
    per={}
    for pg in range(1,tk.getPageCount()+1):
        if pg in have:
            per[pg]=len([m for m in ET.fromstring(tk.renderToSVG(pg)).iter(SVGNS+'g') if m.get('class')=='measure'])
    return per
print('Per-PAGE comparison, PDF intervals vs Verovio measures on the same pages\n')
print('  %-38s %-5s %7s %7s %7s'%('score','page','pdfIV','Vmeas','ratio'))
agg=[]
for sid in sorted({r['score'] for r in rows}):
    v=vpages(sid)
    if not v: continue
    byp=defaultdict(int)
    for r in rows:
        if r['score']==sid and r['paired']>=2: byp[r['page']]+=r['intervals']
    for pg in sorted(set(list(byp)+list(v))):
        a=byp.get(pg,0); b=v.get(pg,0)
        if a==0 and b==0: continue
        agg.append((a,b))
        flag='' if (b==0 or 0.5<=a/b<=2.0) else '  <-- OFF'
        print('  %-38s p%-3d %7d %7d %7.3f%s'%(sid[:38],pg,a,b,a/max(1,b),flag))
A=sum(x[0] for x in agg); B=sum(x[1] for x in agg)
print()
print('  TOTAL per-page: pdfIV=%d  Vmeas=%d  ratio=%.4f'%(A,B,A/max(1,B)))
ratios=[a/b for a,b in agg if b>0]
print('  per-page ratio: median %.3f  p10 %.3f  p90 %.3f'%(np.median(ratios),np.percentile(ratios,10),np.percentile(ratios,90)))
print('  pages within 0.7-1.4: %d/%d (%.4f)'%(sum(1 for r in ratios if 0.7<=r<=1.4),len(ratios),sum(1 for r in ratios if 0.7<=r<=1.4)/len(ratios)))

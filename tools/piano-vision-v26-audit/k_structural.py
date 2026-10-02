import sys, os, json
sys.path.insert(0, os.path.join(os.getcwd(), 'tools/piano-vision-v26-audit'))
from collections import defaultdict
import xml.etree.ElementTree as ET, verovio
SVGNS="{http://www.w3.org/2000/svg}"
sm={s['id']:s for s in json.load(open('tools/real-pdf-adaptation/split_manifest.json'))['scores']}
rows=json.load(open('tools/piano-vision-v26-audit/out/H_consensus_canonical.json'))
# Verovio measures restricted to the PAGES THE CORPUS ACTUALLY CONTAINS
def vmeas_pages(sid):
    tk=verovio.toolkit()
    if not tk.loadFile(str(sm[sid]['musicxml'])): return None
    have={int(p.split('-')[-1].split('.')[0]) for p in os.listdir('out/realpdf_21/pages/%s'%sid) if p.endswith('.png')}
    tot=0
    for pg in range(1,tk.getPageCount()+1):
        if pg not in have: continue
        tot+=len([m for m in ET.fromstring(tk.renderToSVG(pg)).iter(SVGNS+'g') if m.get('class')=='measure'])
    return tot, len(have), tk.getPageCount()
per=defaultdict(lambda:{'sys':0,'ok':0,'iv':0})
for r in rows:
    d=per[r['score']]; d['sys']+=1
    if r['paired']>=2: d['ok']+=1; d['iv']+=r['intervals']
"""K - Stage B structural correspondence.

THE KEY FINDING: comparing the PDF corpus against a Verovio render of the FULL
MusicXML is invalid, because the corpus is a PAGE-TRUNCATED selection. Beethoven
has 4 of 6 pages, etude-10-01 4 of 7, turkish-march 4 of 5. Verovio renders the
complete score, so any count deficit mixes real under-detection with pages that
were never in the corpus at all.

Restricted to the pages the corpus actually contains, the ratio is 799/789 = 1.0127.
"""
print('  %-40s %7s %7s %8s %9s %7s'%('score','pdfIV','V(corpus)','V(all)','corpus/all','ratio'))
ti=tc=ta=0; nA=nB=nC=nD=0
for sid in sorted(per):
    d=per[sid]; r=vmeas_pages(sid)
    if not r: continue
    vc,nh,va=r
    ti+=d['iv']; tc+=vc; ta+=va
    ratio=d['iv']/max(1,vc)
    if d['iv']==vc: c='A'
    elif abs(d['iv']-vc)<=2: c='B'
    elif d['sys']-d['ok']>0: c='D'
    else: c='C'
    n={'A':0,'B':0,'C':0,'D':0}; n[c]+=1
    nA+=n['A']; nB+=n['B']; nC+=n['C']; nD+=n['D']
    print('  %-40s %7d %7d %8d %8s %7.3f  %s'%(sid,d['iv'],vc,va,'%d/%d'%(nh,va),ratio,c))
print()
print('  TOTAL pdfIV=%d  V(corpus pages)=%d  V(all pages)=%d'%(ti,tc,ta))
print('  ratio vs CORPUS pages: %.4f      ratio vs ALL pages: %.4f'%(ti/max(1,tc),ti/max(1,ta)))
print('  A=%d  B=%d  C=%d  D=%d'%(nA,nB,nC,nD))

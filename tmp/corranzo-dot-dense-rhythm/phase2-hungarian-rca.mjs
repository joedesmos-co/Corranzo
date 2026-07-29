#!/usr/bin/env node
/**
 * Phase 2A/B: Hungarian dense rhythm verified-case RCA — find first failing stage.
 * No production changes.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  renderPdfToPages,
  makeRenderPageCallback,
  makePdfTextExtractor,
  makePdfCurveExtractor,
} from '../../scripts/lib/renderPdfPages.mjs'

const root = join(import.meta.dirname, '../..')
const out = join(root, 'tmp/corranzo-dot-dense-rhythm/phase2-hungarian')
await mkdir(out, { recursive: true })
const pdf = join(homedir(), 'Downloads', 'hungarian-dance-no5.pdf')

function typeHist(xml) {
  const h = {}
  for (const b of xml.split('<note').slice(1)) {
    if (b.includes('<rest') || b.includes('<grace')) continue
    const t = (b.match(/<type>([^<]+)/) || [])[1] || '?'
    const d = (b.match(/<dot/g) || []).length
    const beams = (b.match(/<beam/g) || []).length
    h[t + (d ? '.'.repeat(d) : '')] = (h[t + (d ? '.'.repeat(d) : '')] || 0) + 1
    if (beams) h._beamNotes = (h._beamNotes || 0) + 1
  }
  return h
}

console.log('OMR Hungarian...')
const rendered = await renderPdfToPages(pdf)
const extractPageText = await makePdfTextExtractor(pdf)
const extractPageCurves = await makePdfCurveExtractor(pdf)
const result = await runPdfOmrPipeline(pdf, {
  renderPage: makeRenderPageCallback(rendered.pages),
  extractPageText,
  extractPageCurves,
  numPages: rendered.numPages,
  maxPages: 24,
  preprocessPages: true,
  title: basename(pdf),
})
await writeFile(join(out, 'hungarian-baseline.musicxml'), result.musicXml)
const genHist = typeHist(result.musicXml)
console.log('gen', genHist)

const py = spawnSync(
  'python3',
  ['-'],
  {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
    input: `
import xml.etree.ElementTree as ET, zipfile, json
from pathlib import Path
from collections import Counter, defaultdict

def load(path):
    path=Path(path)
    if path.suffix=='.mxl':
        with zipfile.ZipFile(path) as z:
            names=[n for n in z.namelist() if n.endswith(('.xml','.musicxml')) and 'META' not in n]
            root=ET.fromstring(z.read(names[0]))
    else:
        root=ET.fromstring(path.read_text())
    for el in root.iter():
        if '}' in el.tag: el.tag=el.tag.split('}',1)[1]
    return root

truth=load(Path.home()/'Downloads'/'hungarian-dance-no5.mxl')
gen=load(Path(${JSON.stringify(join(out, 'hungarian-baseline.musicxml'))}))

def note_rows(root, limit_measures=None):
    rows=[]
    for mi,m in enumerate(root.find('part').findall('measure'),1):
        if limit_measures and mi>limit_measures: break
        onset=0
        for n in m.findall('note'):
            if n.find('backup') is not None: continue
            # handle backup/forward via sequential - simplified
        # restart with proper onset tracking
    return rows

def parse_part(root, max_m=60):
    rows=[]
    for mi,m in enumerate(root.find('part').findall('measure'),1):
        if mi>max_m: break
        cursor=0
        last_onset=0
        for el in list(m):
            if el.tag=='backup':
                d=int(el.findtext('duration') or 0); cursor=max(0,cursor-d); continue
            if el.tag=='forward':
                d=int(el.findtext('duration') or 0); cursor+=d; continue
            if el.tag!='note': continue
            if el.find('rest') is not None:
                d=int(el.findtext('duration') or 0)
                if el.find('chord') is None: cursor+=d
                continue
            if el.find('grace') is not None: continue
            chord=el.find('chord') is not None
            if not chord: last_onset=cursor
            t=el.findtext('type') or '?'
            dots=len(el.findall('dot'))
            beams=[b.text for b in el.findall('beam')]
            pitch=el.find('pitch')
            step=pitch.findtext('step') if pitch is not None else '?'
            oct=pitch.findtext('octave') if pitch is not None else '?'
            voice=el.findtext('voice') or '?'
            staff=el.findtext('staff') or '?'
            dur=int(el.findtext('duration') or 0)
            rows.append({
                'm':mi,'onset':last_onset,'type':t,'dots':dots,'beams':beams,
                'pitch':f'{step}{oct}','voice':voice,'staff':staff,'dur':dur,'chord':chord,
            })
            if not chord: cursor+=dur
    return rows

tr=parse_part(truth, 55)
ge=parse_part(gen, 55)

def hist(rows):
    c=Counter()
    for r in rows:
        k=r['type']+('.'*r['dots'] if r['dots'] else '')
        c[k]+=1
    return dict(c)

# Match gen note to truth by measure+pitch+approx onset bucket
ge_by_m=defaultdict(list)
for r in ge: ge_by_m[r['m']].append(r)

cases=[]
# Sample short notes from truth
shorts=[r for r in tr if r['type'] in ('eighth','16th','sixteenth') and not r['chord']]
# diversify measures
by_m=defaultdict(list)
for r in shorts: by_m[r['m']].append(r)
sampled=[]
for m in sorted(by_m):
    sampled.extend(by_m[m][:3])
    if len(sampled)>=55: break
sampled=sampled[:55]

# Also add quarter controls
quarters=[r for r in tr if r['type']=='quarter' and r['dots']==0 and not r['chord']]
for r in quarters[:10]:
    sampled.append(r)

promotions=0
correct_short=0
missing=0
for r in sampled:
    cands=ge_by_m.get(r['m'],[])
    # nearest same pitch
    same=[g for g in cands if g['pitch']==r['pitch']]
    if not same:
        # any near onset
        same=sorted(cands, key=lambda g: abs(g['onset']-r['onset']))[:1]
    if not same:
        missing+=1
        cases.append({**r,'gen':None,'class':'missing'})
        continue
    g=min(same, key=lambda x: abs(x['onset']-r['onset']))
    expected=r['type']+('.'*r['dots'] if r['dots'] else '')
    actual=g['type']+('.'*g['dots'] if g['dots'] else '')
    if r['type'] in ('eighth','16th','sixteenth') and g['type']=='quarter' and g['dots']==0:
        promotions+=1
        cls='promoted_to_quarter'
    elif expected==actual or (r['type'] in ('16th','sixteenth') and g['type'] in ('16th','sixteenth')):
        correct_short+=1
        cls='correct'
    else:
        cls=f'{expected}->{actual}'
    cases.append({
        'm':r['m'],'onset':r['onset'],'pitch':r['pitch'],'voice':r['voice'],'staff':r['staff'],
        'truthType':expected,'truthBeams':r['beams'],
        'genType':actual,'genBeams':g['beams'],'class':cls,
    })

# Beam presence
tr_beam=sum(1 for r in tr if r['beams'])
ge_beam=sum(1 for r in ge if r['beams'])

print(json.dumps({
  'truthHist55': hist(tr),
  'genHist55': hist(ge),
  'sampled': len(sampled),
  'promotionsToQuarter': promotions,
  'correctShortOrExact': correct_short,
  'missingPitch': missing,
  'truthBeamNotes': tr_beam,
  'genBeamNotes': ge_beam,
  'classCounts': dict(Counter(c['class'] for c in cases)),
  'cases': cases,
}, indent=2))
`,
  },
)
if (py.status !== 0) {
  console.error(py.stderr || py.stdout)
  process.exit(1)
}
const audit = JSON.parse(py.stdout)
await writeFile(join(out, 'VERIFIED_CASES.json'), JSON.stringify(audit, null, 2))
console.log({
  promotions: audit.promotionsToQuarter,
  correct: audit.correctShortOrExact,
  missing: audit.missingPitch,
  classCounts: audit.classCounts,
  beams: [audit.truthBeamNotes, audit.genBeamNotes],
  truthHist55: audit.truthHist55,
  genHist55: audit.genHist55,
})

// Glyph/beam codepoint audit on page 1
import { textGlyphsToImage } from '../../src/features/omr/processVectorOmrPage.js'
const items = await extractPageText(null, 1)
const glyphs = textGlyphsToImage(items, {
  width: rendered.pages[0].width,
  height: rendered.pages[0].height,
})
const cp = {}
for (const g of glyphs) {
  const k = [...(g.text || '')].map((c) => 'U+' + c.codePointAt(0).toString(16)).join(' ')
  if (!k) continue
  // noteheads and likely beams/flags
  const code = k.split(' ')[0]
  const n = parseInt(code.slice(2), 16)
  if ((n >= 0xe0a0 && n <= 0xe0ff) || (n >= 0xe1f0 && n <= 0xe2ff) || (n >= 0xe240 && n <= 0xe26f)) {
    cp[k] = (cp[k] || 0) + 1
  }
}
await writeFile(join(out, 'page1-rhythm-glyphs.json'), JSON.stringify(cp, null, 2))
console.log('page1 rhythm-ish glyphs', cp)

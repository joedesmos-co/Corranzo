#!/usr/bin/env node
/**
 * Phase 1A: Minecraft verified diagnostic — dots + open/filled glyph audit.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  renderPdfToPages,
  makeRenderPageCallback,
  makePdfTextExtractor,
  makePdfCurveExtractor,
} from '../../scripts/lib/renderPdfPages.mjs'
import { textGlyphsToImage } from '../../src/features/omr/processVectorOmrPage.js'
import {
  RHYTHM_DOT_GLYPH,
  isAugmentationDotRelativeToNote,
} from '../../src/features/omr/detectVectorStaccato.js'

const root = join(import.meta.dirname, '../..')
const out = join(root, 'tmp/corranzo-dot-dense-rhythm/phase1-minecraft')
await mkdir(out, { recursive: true })
const pdf = join(homedir(), 'Downloads', 'beginner-minecraft-piano-themes-in-c-minecraft.pdf')

const NOTEHEAD = {
  '\ue0a4': 'black',
  '\ue0a3': 'half',
  '\ue0a2': 'whole',
  '\ue0a0': 'whole',
  '\ue0a1': 'half',
}

function typeHist(xml) {
  const h = {}
  for (const b of xml.split('<note').slice(1)) {
    if (b.includes('<rest') || b.includes('<grace')) continue
    const t = (b.match(/<type>([^<]+)/) || [])[1] || '?'
    const d = (b.match(/<dot/g) || []).length
    h[t + (d ? '.'.repeat(d) : '')] = (h[t + (d ? '.'.repeat(d) : '')] || 0) + 1
  }
  return h
}

const rendered = await renderPdfToPages(pdf)
const extractPageText = await makePdfTextExtractor(pdf)
const extractPageCurves = await makePdfCurveExtractor(pdf)
console.log('OMR...')
const result = await runPdfOmrPipeline(pdf, {
  renderPage: makeRenderPageCallback(rendered.pages),
  extractPageText,
  extractPageCurves,
  numPages: rendered.numPages,
  maxPages: 24,
  preprocessPages: true,
  title: basename(pdf),
})
await writeFile(join(out, 'minecraft-baseline.musicxml'), result.musicXml)
const hist = typeHist(result.musicXml)
console.log('gen hist', hist)

const pageAudits = []
const allDots = []
const allHeads = []

for (let p = 0; p < rendered.pages.length; p += 1) {
  const img = rendered.pages[p]
  const imageData = { width: img.width, height: img.height }
  const items = await extractPageText(null, p + 1)
  const glyphs = textGlyphsToImage(items, imageData)
  const heads = glyphs
    .filter((g) => NOTEHEAD[g.text])
    .map((g) => ({
      page: p + 1,
      x: g.x,
      y: g.y,
      w: g.width,
      h: g.height,
      codepoint: `U+${g.text.codePointAt(0).toString(16)}`,
      kind: NOTEHEAD[g.text],
      text: g.text,
    }))
  const dots = glyphs
    .filter((g) => g.text === RHYTHM_DOT_GLYPH || g.text === '.')
    .map((g) => ({
      page: p + 1,
      x: g.x,
      y: g.y,
      w: g.width,
      h: g.height,
      text: g.text === RHYTHM_DOT_GLYPH ? 'e1e7' : '.',
    }))

  const attachment = []
  for (const dot of dots) {
    let best = null
    let bestScore = Infinity
    const near = []
    for (const note of heads) {
      const dx = dot.x - note.x
      const dy = Math.abs(dot.y - note.y)
      const ok = isAugmentationDotRelativeToNote(dot, { cx: note.x, cy: note.y })
      const score = Math.abs(dx) + dy * 0.5
      near.push({
        kind: note.kind,
        dx: +dx.toFixed(2),
        dy: +dy.toFixed(2),
        ok,
        score: +score.toFixed(2),
        x: +note.x.toFixed(1),
        y: +note.y.toFixed(1),
        codepoint: note.codepoint,
      })
      if (!ok) continue
      if (score < bestScore) {
        bestScore = score
        best = note
      }
    }
    near.sort((a, b) => a.score - b.score)
    const nearest = near[0]
    let fail = null
    if (!best && nearest) {
      if (nearest.dx < 3) fail = 'dxTooSmall'
      else if (nearest.dx > 24) fail = 'dxTooLarge'
      else fail = 'dyFail'
    }
    attachment.push({
      page: p + 1,
      dot: { x: +dot.x.toFixed(1), y: +dot.y.toFixed(1) },
      matched: best
        ? {
            kind: best.kind,
            x: +best.x.toFixed(1),
            y: +best.y.toFixed(1),
            codepoint: best.codepoint,
          }
        : null,
      fail,
      nearest5: near.slice(0, 5),
    })
  }

  pageAudits.push({
    page: p + 1,
    heads: heads.length,
    dots: dots.length,
    kindCounts: heads.reduce((a, h) => {
      a[h.kind] = (a[h.kind] || 0) + 1
      return a
    }, {}),
    matchedDots: attachment.filter((a) => a.matched).length,
    unmatchedDots: attachment.filter((a) => !a.matched).length,
    failReasons: attachment.reduce((a, x) => {
      if (x.fail) a[x.fail] = (a[x.fail] || 0) + 1
      return a
    }, {}),
    matchedByKind: attachment.reduce((a, x) => {
      if (x.matched) a[x.matched.kind] = (a[x.matched.kind] || 0) + 1
      return a
    }, {}),
  })
  allDots.push(...attachment)
  allHeads.push(...heads)
  await writeFile(join(out, `page-${p + 1}-attachments.json`), JSON.stringify(attachment, null, 2))
}

const py = spawnSync(
  'python3',
  ['-'],
  {
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

truth=load(Path.home()/'Downloads'/'beginner-minecraft-piano-themes-in-c-minecraft.mxl')
gen=load(Path(${JSON.stringify(join(out, 'minecraft-baseline.musicxml'))}))

def notes(root):
    rows=[]
    for mi,m in enumerate(root.find('part').findall('measure'),1):
        for n in m.findall('note'):
            if n.find('rest') is not None or n.find('grace') is not None: continue
            t=n.find('type'); tt=t.text if t is not None else '?'
            dots=len(n.findall('dot'))
            pitch=n.find('pitch')
            step=pitch.find('step').text if pitch is not None else '?'
            oct=pitch.find('octave').text if pitch is not None else '?'
            chord=n.find('chord') is not None
            rows.append({'m':mi,'type':tt,'dots':dots,'pitch':f'{step}{oct}','chord':chord})
    return rows

tr,ge=notes(truth),notes(gen)
def hist(rows):
    c=Counter()
    for r in rows:
        k=r['type']+('.'*r['dots'] if r['dots'] else '')
        c[k]+=1
    return dict(c)

tr_dq=[r for r in tr if r['type']=='quarter' and r['dots']==1]
ge_dq=[r for r in ge if r['type']=='quarter' and r['dots']==1]
tr_m=defaultdict(list); ge_m=defaultdict(list)
for r in tr_dq: tr_m[r['m']].append(r)
for r in ge_dq: ge_m[r['m']].append(r)
missing=[m for m in sorted(tr_m) if m not in ge_m]
partial=[m for m in sorted(tr_m) if m in ge_m and len(ge_m[m])<len(tr_m[m])]
print(json.dumps({
  'truthHist': hist(tr),
  'genHist': hist(ge),
  'truthDQ': len(tr_dq),
  'genDQ': len(ge_dq),
  'truthWhole': hist(tr).get('whole',0),
  'genWhole': hist(ge).get('whole',0),
  'truthHalf': hist(tr).get('half',0),
  'genHalf': hist(ge).get('half',0),
  'truthHalfDot': hist(tr).get('half.',0),
  'genHalfDot': hist(ge).get('half.',0),
  'missingDQMeasures': missing,
  'partialDQMeasures': partial,
  'sampleMissing': {str(m): tr_m[m] for m in missing[:15]},
  'hitMeasures': [m for m in sorted(tr_m) if m in ge_m][:20],
}))
`,
    encoding: 'utf8',
    maxBuffer: 10_000_000,
  },
)
if (py.status !== 0) {
  console.error(py.stderr || py.stdout)
  process.exit(1)
}
const truthAudit = JSON.parse(py.stdout)
await writeFile(join(out, 'truth-vs-gen.json'), JSON.stringify(truthAudit, null, 2))

const summary = {
  baselineCommit: '541f607e230611e37f377f4a106f42ab57822c65',
  genHist: hist,
  pageAudits,
  totals: {
    heads: allHeads.length,
    dots: allDots.length,
    matched: allDots.filter((d) => d.matched).length,
    unmatched: allDots.filter((d) => !d.matched).length,
    failReasons: allDots.reduce((a, x) => {
      if (x.fail) a[x.fail] = (a[x.fail] || 0) + 1
      return a
    }, {}),
    matchedByKind: allDots.reduce((a, x) => {
      if (x.matched) a[x.matched.kind] = (a[x.matched.kind] || 0) + 1
      return a
    }, {}),
    headKinds: allHeads.reduce((a, h) => {
      a[h.kind] = (a[h.kind] || 0) + 1
      return a
    }, {}),
  },
  truthAudit,
}
await writeFile(join(out, 'CASESET_SUMMARY.json'), JSON.stringify(summary, null, 2))
console.log(
  JSON.stringify(
    {
      pageAudits,
      totals: summary.totals,
      truth: {
        truthDQ: truthAudit.truthDQ,
        genDQ: truthAudit.genDQ,
        missingMeasures: truthAudit.missingDQMeasures?.length,
        wholes: [truthAudit.truthWhole, truthAudit.genWhole],
      },
    },
    null,
    2,
  ),
)

#!/usr/bin/env node
/**
 * Diagnostics-only freeze gate: provenance OFF must not change recognition output.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { runPdfOmrPipeline } from '../../../src/features/omr/runPdfOmrPipeline.js'
import {
  OMR_DIAGNOSTIC_FLAG,
  setOmrDiagnosticFlag,
  getOmrDiagnosticFlags,
} from '../../../src/features/omr/omrDiagnosticFlags.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../../scripts/lib/renderPdfPages.mjs'

const ROOT = process.cwd()
const DOWNLOADS = join(homedir(), 'Downloads')
const OUT = join(ROOT, 'tmp/corranzo-dot-dense-rhythm/gate')
const FIXTURES = join(ROOT, 'public/fixtures')

function sha(text) {
  return createHash('sha256').update(text).digest('hex')
}

function typeHist(xml = '') {
  const types = {}
  const re = /<type(?:\s[^>]*)?>([^<]+)<\/type>/g
  let match
  while ((match = re.exec(xml))) {
    const key = match[1].trim()
    types[key] = (types[key] ?? 0) + 1
  }
  let dottedQuarter = 0
  let dottedHalf = 0
  for (const note of xml.match(/<note\b[\s\S]*?<\/note>/g) ?? []) {
    const type = note.match(/<type(?:\s[^>]*)?>([^<]+)<\/type>/)?.[1]?.trim()
    const dots = (note.match(/<dot\b/g) ?? []).length
    if (type === 'quarter' && dots >= 1) dottedQuarter += 1
    if (type === 'half' && dots >= 1) dottedHalf += 1
  }
  return {
    types,
    dottedQuarter,
    dottedHalf,
    dots: (xml.match(/<dot\b/g) ?? []).length,
    beams: (xml.match(/<beam\b/g) ?? []).length,
    ties: (xml.match(/<tie\b/g) ?? []).length,
    tied: (xml.match(/<tied\b/g) ?? []).length,
    tempos: [...xml.matchAll(/<sound[^>]*tempo="([^"]+)"/g)].map((m) => Number(m[1])),
    measures: (xml.match(/<measure\b/g) ?? []).length,
  }
}

function rhythmFingerprint(hist) {
  return {
    whole: hist.types.whole ?? 0,
    half: hist.types.half ?? 0,
    quarter: hist.types.quarter ?? 0,
    eighth: hist.types.eighth ?? 0,
    sixteenth: hist.types.sixteenth ?? 0,
    dottedQuarter: hist.dottedQuarter,
    dottedHalf: hist.dottedHalf,
    dots: hist.dots,
    beams: hist.beams,
    measures: hist.measures,
  }
}

function normalizeXml(xml) {
  return String(xml)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function runPdf(pdfPath, maxPages) {
  const rendered = await renderPdfToPages(pdfPath, {
    rootDir: ROOT,
    ...(Number.isInteger(maxPages) ? { maxPages } : {}),
  })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  return runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    ...(Number.isInteger(maxPages) ? { maxPages } : {}),
    instrumentId: 'piano',
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
  })
}

function resolve(path, fallback = null) {
  if (existsSync(path)) return path
  if (fallback && existsSync(fallback)) return fallback
  return null
}

const cases = [
  {
    id: 'minecraft',
    pdf: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.pdf'),
    maxPages: null,
    baseline: join(
      ROOT,
      'tmp/corranzo-dot-dense-rhythm/phase1-minecraft/minecraft-baseline.musicxml',
    ),
    expect: {
      dottedQuarter: 17,
      whole: 144,
      dots: 154,
    },
  },
  {
    id: 'evangelion',
    pdf: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'),
    maxPages: null,
    // evangelion-after*.musicxml were mid-campaign captures; freeze gate uses
    // smoke control expectations against HEAD baseline behavior instead.
    expect: {
      dottedQuarter: 15,
      measuresMin: 120,
      beamsMin: 500,
    },
  },
  {
    id: 'hungarian',
    pdf: join(DOWNLOADS, 'hungarian-dance-no5.pdf'),
    fallback: join(FIXTURES, 'hungarian-dance-no5/hungarian-dance-no5.pdf'),
    maxPages: null,
    baseline: join(
      ROOT,
      'tmp/corranzo-dot-dense-rhythm/phase2-hungarian/hungarian-baseline.musicxml',
    ),
  },
  {
    id: 'fantaisie',
    pdf: join(DOWNLOADS, 'fantaisie-impromptu-in-c-minor-chopin.pdf'),
    maxPages: null,
    expect: {
      tempoHas: [84, 50, 108, 168],
    },
  },
]

setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)
setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)

if (getOmrDiagnosticFlags().provenance) {
  console.error('FAIL: provenance must be disabled for equivalence gate')
  process.exit(1)
}

await mkdir(OUT, { recursive: true })
const report = {
  provenanceEnabled: getOmrDiagnosticFlags().provenance,
  cases: [],
  checks: [],
}

function check(name, ok, detail = '') {
  report.checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`)
}

for (const entry of cases) {
  const pdf = resolve(entry.pdf, entry.fallback)
  if (!pdf) {
    check(`${entry.id}:pdf`, false, 'missing')
    continue
  }
  console.error(`gate: ${entry.id}…`)
  const result = await runPdf(pdf, entry.maxPages)
  const xml = result.musicXml ?? ''
  const hist = typeHist(xml)
  const livePath = join(OUT, `${entry.id}-live.musicxml`)
  await writeFile(livePath, xml)

  const row = {
    id: entry.id,
    noteCount: result.noteCount,
    measureCount: result.measureCount ?? hist.measures,
    hist,
    sha: sha(normalizeXml(xml)),
    hasRhythmProvenance: Boolean(result.diagnostics?.rhythmProvenance),
  }

  check(`${entry.id}:no-provenance-payload`, !row.hasRhythmProvenance)
  check(`${entry.id}:notes`, row.noteCount > 0, `notes=${row.noteCount}`)

  if (entry.baseline && existsSync(entry.baseline)) {
    const baselineXml = await readFile(entry.baseline, 'utf8')
    const baseHist = typeHist(baselineXml)
    const liveFp = rhythmFingerprint(hist)
    const baseFp = rhythmFingerprint(baseHist)
    row.fingerprint = liveFp
    row.baselineFingerprint = baseFp
    const equalFp = JSON.stringify(liveFp) === JSON.stringify(baseFp)
    check(
      `${entry.id}:rhythm-fingerprint-equiv`,
      equalFp,
      equalFp
        ? 'match'
        : `live=${JSON.stringify(liveFp)} base=${JSON.stringify(baseFp)}`,
    )
  }

  if (entry.expect?.dottedQuarter != null) {
    check(
      `${entry.id}:dotted-quarter`,
      hist.dottedQuarter === entry.expect.dottedQuarter,
      `dottedQuarter=${hist.dottedQuarter}`,
    )
  }
  if (entry.expect?.whole != null) {
    check(
      `${entry.id}:whole`,
      (hist.types.whole ?? 0) === entry.expect.whole,
      `whole=${hist.types.whole ?? 0}`,
    )
  }
  if (entry.expect?.dots != null) {
    check(
      `${entry.id}:dots`,
      hist.dots === entry.expect.dots,
      `dots=${hist.dots}`,
    )
  }
  if (entry.expect?.dottedQuarterMax != null) {
    check(
      `${entry.id}:dotted-quarter-cap`,
      hist.dottedQuarter <= entry.expect.dottedQuarterMax,
      `dottedQuarter=${hist.dottedQuarter}`,
    )
  }
  if (entry.expect?.beamsMin != null) {
    check(
      `${entry.id}:beams`,
      hist.beams >= entry.expect.beamsMin,
      `beams=${hist.beams}`,
    )
  }
  if (entry.expect?.measuresMin != null) {
    check(
      `${entry.id}:measures`,
      hist.measures >= entry.expect.measuresMin,
      `measures=${hist.measures}`,
    )
  }
  if (entry.expect?.tempoHas) {
    const tempos = new Set(hist.tempos.map((t) => Math.round(t)))
    for (const bpm of entry.expect.tempoHas) {
      const hit = [...tempos].some((t) => Math.abs(t - bpm) <= 2)
      check(`${entry.id}:tempo-${bpm}`, hit, `tempos=${[...tempos].join(',')}`)
    }
  }

  report.cases.push(row)
}

const failed = report.checks.filter((c) => !c.ok).length

// A/B: enabling provenance must not change MusicXML when results are compared
// after a disabled run fingerprint is captured (same PDF, minecraft).
{
  const mc = cases.find((c) => c.id === 'minecraft')
  const pdf = resolve(mc.pdf, mc.fallback)
  if (pdf) {
    console.error('gate: provenance A/B musicxml…')
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)
    const off = await runPdf(pdf, null)
    const offFp = rhythmFingerprint(typeHist(off.musicXml ?? ''))
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, true)
    const on = await runPdf(pdf, null)
    const onFp = rhythmFingerprint(typeHist(on.musicXml ?? ''))
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)
    const equal = JSON.stringify(offFp) === JSON.stringify(onFp)
    check(
      'provenance-ab:musicxml-fingerprint',
      equal,
      equal ? 'off===on' : `off=${JSON.stringify(offFp)} on=${JSON.stringify(onFp)}`,
    )
    check(
      'provenance-ab:payload-only-when-on',
      Boolean(on.diagnostics?.rhythmProvenance) && !off.diagnostics?.rhythmProvenance,
    )
  }
}

const failedFinal = report.checks.filter((c) => !c.ok).length
await writeFile(join(OUT, 'GATE_REPORT.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ failed: failedFinal, total: report.checks.length, out: OUT }, null, 2))
process.exit(failedFinal ? 1 : 0)

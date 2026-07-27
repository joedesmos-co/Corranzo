#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { evaluateOmrAccuracy } from '../../src/features/omr/omrAccuracyEvaluator.js'
import { serializeOmrV3MusicXml } from '../../src/features/omr/v3/omrV3MusicXml.js'
import { makeRenderPageCallback, renderPdfToPages } from '../../scripts/lib/renderPdfPages.mjs'
import {
  summarizePitchErrorRootCauses,
  summarizePitchErrors,
} from '../../src/features/omr/omrPitchErrorAnalysis.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
mkdirSync(join(ROOT, 'tmp/cursor-pitch-sprint'), { recursive: true })

// Enforced recognition fixtures (skip reject-honestly + diagnostic-only)
const FIXTURES = [
  { id: 'piano-beginner-single-vector', instrumentId: 'piano', stavesPerSystem: 1 },
  { id: 'piano-grand-voices-vector', instrumentId: 'piano', stavesPerSystem: 2 },
  { id: 'piano-rhythm-tuplets-vector', instrumentId: 'piano', stavesPerSystem: 2 },
  { id: 'piano-articulation-scan', instrumentId: 'piano', stavesPerSystem: 2 },
  { id: 'piano-dense-advanced-vector', instrumentId: 'piano', stavesPerSystem: 2 },
  { id: 'guitar-tab-sparse-vector', instrumentId: 'guitar', stavesPerSystem: 1 },
  { id: 'guitar-standard-chords-vector', instrumentId: 'guitar', stavesPerSystem: 1 },
  { id: 'guitar-paired-chords-vector', instrumentId: 'guitar', stavesPerSystem: 2 },
  { id: 'guitar-techniques-paired-vector', instrumentId: 'guitar', stavesPerSystem: 2 },
]

async function makePdfTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_pdfSource, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1, rotation: 0 })
    const content = await page.getTextContent()
    return (content.items ?? [])
      .map((item) => ({
        text: item.str ?? '', x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0,
        width: item.width ?? 0, height: item.height ?? 0, fontName: item.fontName ?? '',
        pageWidth: viewport.width, pageHeight: viewport.height,
      }))
      .filter((item) => item.text.trim().length > 0)
  }
}

const results = []
for (const fx of FIXTURES) {
  const base = join(ROOT, 'benchmarks/omr-fixtures', fx.id, fx.id)
  const pdfPath = `${base}.pdf`
  const truthPath = `${base}.musicxml`
  let truth
  try {
    truth = readFileSync(truthPath, 'utf8')
  } catch {
    continue
  }
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages: 4 })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  let result
  try {
    result = await runPdfOmrPipeline(pdfPath, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      maxPages: 4,
      preprocessPages: true,
      includeScoreGraph: false,
      instrumentId: fx.instrumentId,
      stavesPerSystem: fx.stavesPerSystem,
      omrV3Shadow: true,
    })
  } catch (error) {
    result = error?.omrV3IndependentShadow
      ? { omrV3IndependentShadow: error.omrV3IndependentShadow, musicXml: null }
      : null
    if (!result) {
      results.push({ id: fx.id, error: String(error?.message ?? error) })
      continue
    }
  }

  const shadow = result.omrV3IndependentShadow
  const doc = shadow?.document
  const runtimeEval = result.musicXml
    ? evaluateOmrAccuracy({ generatedMusicXml: result.musicXml, groundTruthMusicXml: truth })
    : null
  const serialized = doc ? serializeOmrV3MusicXml(doc) : null
  const v3Eval = serialized?.musicXml
    ? evaluateOmrAccuracy({ generatedMusicXml: serialized.musicXml, groundTruthMusicXml: truth })
    : null

  const wrongPitches = v3Eval?.debug?.wrongPitches ?? []
  const rootCauses = summarizePitchErrorRootCauses(wrongPitches)
  const deltaSummary = summarizePitchErrors(wrongPitches)

  // Where is the pitch coming from? Inspect independent document symbols.
  const symbols = (doc?.pages ?? []).flatMap((page) =>
    (page.systems ?? []).flatMap((system) =>
      (system.staffGroups ?? []).flatMap((group) =>
        (group.staves ?? []).flatMap((staff) => staff.symbols ?? []),
      ),
    ),
  )
  const pitchSources = symbols.reduce((acc, s) => {
    const src = s.pitch?.source ?? 'none'
    acc[src] = (acc[src] ?? 0) + 1
    return acc
  }, {})

  results.push({
    id: fx.id,
    instrumentId: fx.instrumentId,
    v2PitchAccuracy: runtimeEval?.metrics?.pitchAccuracy ?? null,
    v3PitchAccuracy: v3Eval?.metrics?.pitchAccuracy ?? null,
    v3PitchAtCorrectOnset: v3Eval?.metrics?.pitchAccuracyAtCorrectOnset ?? null,
    wrongPitchCount: wrongPitches.length,
    rootCauses: rootCauses.ranked,
    atCorrectOnsetHistogram: rootCauses.atCorrectOnsetHistogram,
    atCorrectOnsetCount: rootCauses.atCorrectOnsetCount,
    deltaHistogram: deltaSummary.histogram,
    signedDeltas: deltaSummary.signed,
    pitchSources,
    samples: wrongPitches.slice(0, 25).map((w) => ({
      m: w.measureNumber,
      delta: w.pitchDeltaSemitones,
      onsetDiff: w.onsetDiffQuarters,
      truth: w.truth?.label,
      gen: w.generated?.label,
      truthVoice: w.truth?.voice,
      genVoice: w.generated?.voice,
    })),
  })
}

writeFileSync(
  join(ROOT, 'tmp/cursor-pitch-sprint/probe-pitch.json'),
  JSON.stringify(results, null, 2),
)

// Aggregate root causes at correct onset (excludes grouping artifacts)
const agg = {}
let totalAtOnset = 0
for (const r of results) {
  if (!r.atCorrectOnsetHistogram) continue
  for (const [k, v] of Object.entries(r.atCorrectOnsetHistogram)) {
    agg[k] = (agg[k] ?? 0) + v
    if (k !== 'grouping-artifact') totalAtOnset += v
  }
}

console.log('=== Per-fixture pitch summary ===')
for (const r of results) {
  if (r.error) {
    console.log(`${r.id}: ERROR ${r.error}`)
    continue
  }
  console.log(
    `${r.id}: v2=${r.v2PitchAccuracy} v3=${r.v3PitchAccuracy} atOnset=${r.v3PitchAtCorrectOnset} wrong=${r.wrongPitchCount}`,
  )
  console.log(`  rootCauses: ${JSON.stringify(r.rootCauses)}`)
  console.log(`  atCorrectOnset: ${JSON.stringify(r.atCorrectOnsetHistogram)}`)
  console.log(`  pitchSources: ${JSON.stringify(r.pitchSources)}`)
}
console.log('\n=== Aggregate root-cause histogram (all wrong pitches) ===')
console.log(JSON.stringify(agg, null, 2))

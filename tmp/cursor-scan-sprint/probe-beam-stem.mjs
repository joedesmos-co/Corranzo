#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { evaluateOmrAccuracy } from '../../src/features/omr/omrAccuracyEvaluator.js'
import { serializeOmrV3MusicXml } from '../../src/features/omr/v3/omrV3MusicXml.js'
import { makeRenderPageCallback, renderPdfToPages } from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pdfPath = join(
  ROOT,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
)
const truthPath = join(
  ROOT,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml',
)

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
        text: item.str ?? '',
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 0,
        fontName: item.fontName ?? '',
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      }))
      .filter((item) => item.text.trim().length > 0)
  }
}

const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages: 1 })
const extractPageText = await makePdfTextExtractor(pdfPath)
const result = await runPdfOmrPipeline(pdfPath, {
  renderPage: makeRenderPageCallback(rendered.pages),
  extractPageText,
  maxPages: 1,
  preprocessPages: true,
  includeScoreGraph: true,
  omrV3Shadow: true,
})

const truth = readFileSync(truthPath, 'utf8')
const shadow = result.omrV3IndependentShadow
const doc = shadow?.document
const serialized = doc ? serializeOmrV3MusicXml(doc) : null
const v3Eval = serialized?.musicXml
  ? evaluateOmrAccuracy({
      generatedMusicXml: serialized.musicXml,
      groundTruthMusicXml: truth,
    })
  : null

// Detector-side beam/stem diagnostics from page analysis.
const pages = result.diagnostics?.pages ?? result.pageResults ?? []
const beamStemSummaries = []
for (const page of pages) {
  for (const system of page.systems ?? page.analysis?.systems ?? []) {
    for (const measure of system.measures ?? []) {
      const graph = measure.beamStemGraph
      if (!graph) continue
      const noteheads = graph.noteheads ?? []
      const ownedStem = noteheads.filter((n) => n.beamOwnership?.attachedStemId)
      const highStem = ownedStem.filter((n) => (n.beamOwnership?.stemConfidence ?? 0) >= 0.7)
      const highBeam = noteheads.filter(
        (n) =>
          (n.beamOwnership?.stemConfidence ?? 0) >= 0.7 &&
          (n.beamOwnership?.beamCandidateCount ?? 0) > 0 &&
          (n.beamOwnership?.beamConfidence ?? 0) >= 0.7,
      )
      beamStemSummaries.push({
        measureNumber: measure.measureNumber,
        noteheadCount: noteheads.length,
        stemCount: graph.stems?.length ?? 0,
        beamCount: graph.beams?.length ?? 0,
        ownedStemCount: ownedStem.length,
        highStemCount: highStem.length,
        highBeamCount: highBeam.length,
        stemAttachRate: noteheads.length ? highStem.length / noteheads.length : null,
        beamAttachRate: noteheads.length ? highBeam.length / noteheads.length : null,
      })
    }
  }
}

// Also pull from scoreGraph if present
const scoreGraphMeasures = []
const sg = result.diagnostics?.scoreGraphFull ?? result.scoreGraph ?? null
if (sg?.measures) {
  for (const m of sg.measures) {
    scoreGraphMeasures.push({
      measureNumber: m.measureNumber,
      hasBeamStemGraph: Boolean(m.beamStemGraph || m.geometry?.hasBeamStemGraph),
      noteCount: m.nodes?.filter?.((n) => n.kind === 'notehead')?.length ?? m.noteCount,
    })
  }
}

function symbolStats(document) {
  const symbols = (document?.pages ?? []).flatMap((page) =>
    (page.systems ?? []).flatMap((system) =>
      (system.staffGroups ?? []).flatMap((group) =>
        (group.staves ?? []).flatMap((staff) => staff.symbols ?? []),
      ),
    ),
  )
  const notes = symbols.filter((s) => s.kind === 'notehead' || s.kind === 'note')
  return {
    symbolCount: symbols.length,
    noteCount: notes.length,
    withStemGroup: notes.filter((n) => n.stemGroupId).length,
    withBeamGroup: notes.filter((n) => n.beamGroupId).length,
    withExactOnset: notes.filter((n) => Number.isFinite(n.onsetDivisions)).length,
    withExactDuration: notes.filter((n) => n.duration?.exact === true || Number.isFinite(n.durationDivisions)).length,
    stemDirections: notes.reduce((acc, n) => {
      const d = n.stemDirection ?? 'none'
      acc[d] = (acc[d] ?? 0) + 1
      return acc
    }, {}),
  }
}

function measureVoiceTrace(document, measureNumber) {
  const measures = (document?.pages ?? []).flatMap((page) =>
    (page.systems ?? []).flatMap((system) => system.measureColumns ?? []),
  )
  const measure = measures.find((entry) => entry.measureNumber === measureNumber)
  if (!measure) return null
  const voices = (measure.voices ?? []).filter((v) => v.candidateRank === 0)
  return {
    measureNumber,
    onsetColumnCount: measure.onsetColumns?.length ?? 0,
    ambiguous: voices.some((v) => v.ambiguous),
    voices: voices.map((voice) => ({
      laneIndex: voice.laneIndex,
      eventCount: voice.events?.length ?? 0,
      events: (voice.events ?? []).slice(0, 12).map((event) => ({
        midi: event.writtenPitch?.midi ?? event.pitch?.midi ?? null,
        onset: event.onset?.divisions,
        duration: event.duration?.divisions,
        onsetExact: event.onset?.exact,
        durationExact: event.duration?.exact,
        durationRecovery: event.duration?.recovery,
        stemGroupId: event.technical?.stemGroupId ?? null,
        beamGroupId: event.technical?.beamGroupId ?? null,
        chordGroupId: event.chordGroupId ?? null,
      })),
    })),
  }
}

const wrong = v3Eval?.debug?.wrongDurations ?? []
const wrongChords = v3Eval?.debug?.chordGroupMismatches ?? []

const out = {
  v2: {
    duration: 0.4685,
    onset: 0.6126,
    chord: 0.6048,
    f1: 0.804,
  },
  v3Independent: {
    metrics: v3Eval?.metrics ?? null,
    musical: shadow?.stages?.musical ?? null,
    wrongDurationCount: wrong.length,
    wrongDurations: wrong.slice(0, 15),
    wrongChordCount: wrongChords.length,
    wrongChords: wrongChords.slice(0, 10),
    symbolStats: symbolStats(doc),
    measureTraces: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => measureVoiceTrace(doc, n)),
  },
  beamStemSummaries,
  scoreGraphMeasures,
  rawPageKeys: Object.keys(result.diagnostics ?? {}),
}

writeFileSync(
  join(ROOT, 'tmp/cursor-scan-sprint/probe-beam-stem.json'),
  JSON.stringify(out, null, 2),
)
console.log(JSON.stringify({
  metrics: out.v3Independent.metrics,
  musical: out.v3Independent.musical,
  symbolStats: out.v3Independent.symbolStats,
  wrongDurationCount: out.v3Independent.wrongDurationCount,
  wrongChordCount: out.v3Independent.wrongChordCount,
  beamStemSummaries: out.beamStemSummaries,
  beamStemSummaryCount: out.beamStemSummaries.length,
  rawPageKeys: out.rawPageKeys,
}, null, 2))

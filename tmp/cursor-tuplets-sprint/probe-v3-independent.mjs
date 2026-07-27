#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { evaluateOmrAccuracy } from '../../src/features/omr/omrAccuracyEvaluator.js'
import { serializeOmrV3MusicXml } from '../../src/features/omr/v3/omrV3MusicXml.js'
import { makeRenderPageCallback, renderPdfToPages } from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pdfPath = join(ROOT, 'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf')
const truthPath = join(ROOT, 'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml')

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
  includeScoreGraph: false,
  omrV3Shadow: true,
})

const truth = readFileSync(truthPath, 'utf8')
const runtimeEval = evaluateOmrAccuracy({
  generatedMusicXml: result.musicXml,
  groundTruthMusicXml: truth,
})

const shadow = result.omrV3IndependentShadow
const doc = shadow?.document
const serialized = doc ? serializeOmrV3MusicXml(doc) : null
const v3Eval = serialized?.musicXml
  ? evaluateOmrAccuracy({
      generatedMusicXml: serialized.musicXml,
      groundTruthMusicXml: truth,
    })
  : null

function measureTrace(document, measureNumber) {
  const measures = (document?.pages ?? []).flatMap((page) =>
    (page.systems ?? []).flatMap((system) => system.measureColumns ?? []),
  )
  const measure = measures.find((entry) => entry.measureNumber === measureNumber)
  if (!measure) return null
  const voices = (measure.voices ?? []).filter((voice) => voice.candidateRank === 0)
  return {
    measureNumber,
    beats: measure.beats,
    totalDivisions: measure.totalDivisions,
    onsetColumnCount: measure.onsetColumns?.length ?? 0,
    onsetColumns: (measure.onsetColumns ?? []).map((column) => ({
      id: column.onsetColumnId,
      position: column.measureRelativePosition,
      grace: column.grace ?? false,
    })),
    voices: voices.map((voice) => ({
      voiceId: voice.voiceId,
      laneIndex: voice.laneIndex,
      ambiguous: voice.ambiguous,
      events: (voice.events ?? []).map((event) => ({
        pitch: event.writtenPitch ?? event.pitch,
        onset: event.onset?.divisions,
        duration: event.duration?.divisions,
        durationRecovery: event.duration?.recovery,
        onsetRecovery: event.onset?.recovery,
        tuplet: event.technical?.tuplet ?? null,
        stemGroupId: event.technical?.stemGroupId ?? null,
      })),
    })),
  }
}

const summary = {
  runtime: {
    metrics: runtimeEval.metrics,
    wrongDurationCount: runtimeEval.debug?.wrongDurations?.length ?? 0,
    wrongDurations: runtimeEval.debug?.wrongDurations ?? [],
  },
  v3Independent: {
    status: shadow?.status,
    metrics: v3Eval?.metrics ?? null,
    wrongDurationCount: v3Eval?.debug?.wrongDurations?.length ?? 0,
    wrongDurations: v3Eval?.debug?.wrongDurations ?? [],
    stages: shadow?.stages?.musical ?? null,
    measureTraces: [1, 2, 3, 4, 5].map((n) => measureTrace(doc, n)),
  },
}

console.log(JSON.stringify(summary, null, 2))

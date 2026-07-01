#!/usr/bin/env node
/**
 * Offline opening lead-note merge simulation (m113-class opening chord split).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { evaluateOmrAccuracy } from '../src/features/omr/omrAccuracyEvaluator.js'
import { applyInnerVoicePhaseCorrection, NARROW_MIN_STACK_NOTES } from '../src/features/omr/innerVoicePhaseCorrection.js'
import { applyPhantomColumnCorrection } from '../src/features/omr/phantomColumnSimulation.js'
import {
  DEFAULT_MIN_STACK_NOTES,
  simulateOpeningLeadNoteMerge,
} from '../src/features/omr/openingLeadNoteMerge.js'
import { applyTerminalSameClefChordQuarterDurations } from '../src/features/omr/processVectorOmrPage.js'
import { OMR_DIVISIONS_PER_QUARTER } from '../src/features/omr/omrRhythmConstants.js'
import { makeRenderPageCallback, renderPdfToPages } from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = join(ROOT, 'benchmarks/omr-benchmark.manifest.json')
const DEFAULT_OUT_DIR = join(ROOT, 'tmp/omr-benchmark-iter/m57-opening-lead')
const TARGET_MEASURE = 57
const CONTROL_MEASURES = [7, 25, 33, 34, 61, 94, 113]

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function resolvePath(path) {
  if (!path) return path
  if (path.startsWith('~/')) return `${process.env.HOME ?? ''}${path.slice(1)}`
  return path.startsWith('/') ? path : join(ROOT, path)
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true })
}

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) return data.toString('utf8')
  const zip = await JSZip.loadAsync(data)
  const container = await zip.file('META-INF/container.xml')
  const xml = container ? await container.async('string') : ''
  const rootPath = xml.match(/full-path="([^"]+)"/)?.[1]
  return zip.file(rootPath).async('string')
}

function applyPostCorrections(measures, beats = 4, beatType = 4) {
  const measureDivisions = Math.round(beats * OMR_DIVISIONS_PER_QUARTER * (4 / beatType))
  let working = applyInnerVoicePhaseCorrection(measures, {
    totalDivisions: measureDivisions,
    minStackNotes: NARROW_MIN_STACK_NOTES,
  }).measures
  working = applyPhantomColumnCorrection(working, { totalDivisions: measureDivisions }).measures
  return working.map((measure) => ({
    ...measure,
    events: applyTerminalSameClefChordQuarterDurations(measure.events ?? [], measureDivisions),
  }))
}

function metricSummary(report) {
  return {
    chordMismatchCount: report.totals.chordMismatchCount,
    wrongOnsetCount: report.totals.wrongOnsetCount,
    wrongDurationCount: report.totals.wrongDurationCount,
    wrongPitchCount: report.totals.wrongPitchCount,
    generatedNoteCount: report.totals.generatedNoteCount,
  }
}

async function runFixture(fixture, { minStackNotes }) {
  const pdfPath = resolvePath(fixture.pdf)
  const truthPath = resolvePath(fixture.truth)
  const pageResults = []
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const extractPageText = async (_pdfSource, pageNumber) => {
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
  const omrResult = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: fixture.maxPages ?? 24,
    preprocessPages: true,
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
    analyzePage: (imageData, pageOptions) => {
      const pageResult = processOmrPageAnalysis(imageData, pageOptions)
      pageResults.push(pageResult)
      return pageResult
    },
  })
  const rawMeasures = pageResults.flatMap((pageResult) => pageResult.measureRhythms ?? [])
  const truthXml = await readScoreXml(truthPath)
  const baselineMeasures = applyPostCorrections(rawMeasures)
  const merge = simulateOpeningLeadNoteMerge(rawMeasures, { minStackNotes })
  const simulatedMeasures = applyPostCorrections(merge.measures)
  const baselineReport = evaluateOmrAccuracy({
    generatedMusicXml: buildOmrMusicXml({
      title: 'baseline',
      measures: baselineMeasures,
      musical: omrResult.musical,
      includeDisclaimer: true,
    }),
    groundTruthMusicXml: truthXml,
    generatedFileName: 'baseline.musicxml',
    groundTruthFileName: basename(truthPath),
    options: { exampleLimit: 99999 },
  })
  const simulatedReport = evaluateOmrAccuracy({
    generatedMusicXml: buildOmrMusicXml({
      title: 'simulated',
      measures: simulatedMeasures,
      musical: omrResult.musical,
      includeDisclaimer: true,
    }),
    groundTruthMusicXml: truthXml,
    generatedFileName: 'simulated.musicxml',
    groundTruthFileName: basename(truthPath),
    options: { exampleLimit: 99999 },
  })
  const watch = [...new Set([TARGET_MEASURE, ...CONTROL_MEASURES])].map((measureNumber) => {
    const baselineMeasure = baselineReport.perMeasure.find((entry) => entry.measureNumber === measureNumber)
    const simulatedMeasure = simulatedReport.perMeasure.find((entry) => entry.measureNumber === measureNumber)
    return {
      measureNumber,
      baseline: baselineMeasure,
      simulated: simulatedMeasure,
      delta: {
        chordMismatchCount:
          (simulatedMeasure?.chordMismatchCount ?? 0) - (baselineMeasure?.chordMismatchCount ?? 0),
        wrongOnsetCount:
          (simulatedMeasure?.wrongOnsetCount ?? 0) - (baselineMeasure?.wrongOnsetCount ?? 0),
        wrongDurationCount:
          (simulatedMeasure?.wrongDurationCount ?? 0) - (baselineMeasure?.wrongDurationCount ?? 0),
        wrongPitchCount:
          (simulatedMeasure?.wrongPitchCount ?? 0) - (baselineMeasure?.wrongPitchCount ?? 0),
      },
    }
  })
  return {
    fixture: fixture.id,
    baseline: metricSummary(baselineReport),
    simulated: metricSummary(simulatedReport),
    watch,
    merge: merge.summary,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const outDir = resolvePath(argValue(args, '--out-dir') ?? DEFAULT_OUT_DIR)
  const minStackNotes = Math.max(
    1,
    Number(argValue(args, '--min-stack-notes') ?? DEFAULT_MIN_STACK_NOTES),
  )
  ensureDir(outDir)
  const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, 'utf8'))
  const results = []
  for (const fixture of manifest.fixtures ?? []) {
    if (!existsSync(resolvePath(fixture.pdf))) continue
    results.push(await runFixture(fixture, { minStackNotes }))
  }
  const dense = results.find((entry) => entry.fixture === 'dense')
  const clean = results.find((entry) => entry.fixture === 'clean')
  const promote =
    dense &&
    dense.simulated.chordMismatchCount < dense.baseline.chordMismatchCount &&
    dense.simulated.wrongOnsetCount <= dense.baseline.wrongOnsetCount &&
    dense.simulated.wrongDurationCount <= dense.baseline.wrongDurationCount &&
    dense.simulated.wrongPitchCount <= dense.baseline.wrongPitchCount &&
    (!clean ||
      (clean.simulated.chordMismatchCount <= clean.baseline.chordMismatchCount &&
        clean.simulated.wrongOnsetCount <= clean.baseline.wrongOnsetCount &&
        clean.simulated.wrongDurationCount <= clean.baseline.wrongDurationCount &&
        clean.simulated.wrongPitchCount <= clean.baseline.wrongPitchCount &&
        clean.simulated.generatedNoteCount === clean.baseline.generatedNoteCount))
  const summary = {
    generatedAt: new Date().toISOString(),
    minStackNotes,
    promote,
    fixtures: results,
  }
  writeFileSync(join(outDir, 'simulation.json'), `${JSON.stringify(summary, null, 2)}\n`)
  const lines = [
    '# Opening Lead-Note Merge Simulation',
    '',
    `Generated: ${summary.generatedAt}`,
    `Min stack notes: ${minStackNotes}`,
    `Promotion gates: ${promote ? 'PASS' : 'FAIL'}`,
    '',
    '## Metrics',
    '',
    '| Fixture | Run | Chord | Onset | Duration | Pitch |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
  ]
  for (const result of results) {
    lines.push(
      `| ${result.fixture} | baseline | ${result.baseline.chordMismatchCount} | ${result.baseline.wrongOnsetCount} | ${result.baseline.wrongDurationCount} | ${result.baseline.wrongPitchCount} |`,
      `| ${result.fixture} | simulated | ${result.simulated.chordMismatchCount} | ${result.simulated.wrongOnsetCount} | ${result.simulated.wrongDurationCount} | ${result.simulated.wrongPitchCount} |`,
    )
  }
  lines.push('', '## Watch measures (dense)', '')
  if (dense) {
    for (const row of dense.watch) {
      lines.push(
        `- m${row.measureNumber}: chord ${row.baseline?.chordMismatchCount ?? 'n/a'} → ${row.simulated?.chordMismatchCount ?? 'n/a'} (Δ ${row.delta.chordMismatchCount})`,
      )
    }
    lines.push('', `Applied measures: ${dense.merge.appliedMeasures}`, '')
    for (const sample of dense.merge.samples ?? []) {
      lines.push(`- m${sample.measureNumber}: div ${sample.fromDivision} → ${sample.toDivision} (stack ${sample.stackNoteCount})`)
    }
  }
  writeFileSync(join(outDir, 'simulation.md'), `${lines.join('\n')}\n`)
  console.log(`Wrote ${join(outDir, 'simulation.md')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

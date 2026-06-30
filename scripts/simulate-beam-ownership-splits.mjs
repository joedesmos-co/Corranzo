#!/usr/bin/env node
/**
 * Offline Beam Ownership Phase 2 simulation.
 *
 * Runs normal OMR, captures measure records through the existing analyzePage
 * hook, simulates ownership-safe event splits on cloned records, and evaluates
 * simulated MusicXML separately. Runtime MusicXML generation is not changed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import {
  evaluateOmrAccuracy,
  formatOmrAccuracyReport,
} from '../src/features/omr/omrAccuracyEvaluator.js'
import { simulateBeamOwnershipSplits } from '../src/features/omr/beamOwnershipSimulation.js'
import {
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = join(ROOT, 'benchmarks/omr-benchmark.manifest.json')
const DEFAULT_OUT_DIR = join(ROOT, 'tmp/omr-benchmark-iter/beam-ownership2')

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function usage() {
  return [
    'Beam Ownership split simulation',
    '',
    'Options:',
    '  --manifest <path>    Benchmark manifest',
    '  --out <dir>          Output directory',
    '  --fixture <id>       Run only one fixture id',
    '  --max-pages <n>      Override fixture max pages',
    '  --no-preprocess      Disable preprocessing',
    '  --help               Show this help',
  ].join('\n')
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true })
}

function writeText(filePath, content) {
  ensureDir(dirname(filePath))
  writeFileSync(filePath, content)
}

function resolvePath(path) {
  if (!path) {
    return path
  }
  if (path.startsWith('~/')) {
    return `${process.env.HOME ?? ''}${path.slice(1)}`
  }
  return path.startsWith('/') ? path : join(ROOT, path)
}

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }

  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  let rootPath = null
  if (container) {
    const xml = await container.async('string')
    rootPath = xml.match(/full-path="([^"]+)"/)?.[1] ?? null
  }
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
  }
  if (!rootPath || !zip.file(rootPath)) {
    throw new Error(`MXL archive has no MusicXML root: ${scorePath}`)
  }
  return zip.file(rootPath).async('string')
}

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

function metricSummary(report) {
  return {
    pitchAccuracy: report.metrics.pitchAccuracy,
    durationAccuracy: report.metrics.durationAccuracy,
    onsetAccuracy: report.metrics.onsetAccuracy,
    chordGroupingAccuracy: report.metrics.chordGroupingAccuracy,
    noteDetectionF1: report.metrics.noteDetectionF1,
    wrongPitchCount: report.totals.wrongPitchCount,
    wrongDurationCount: report.totals.wrongDurationCount,
    wrongOnsetCount: report.totals.wrongOnsetCount,
    chordMismatchCount: report.totals.chordMismatchCount,
    generatedNoteCount: report.totals.generatedNoteCount,
    generatedMeasureCount: report.totals.generatedMeasureCount,
  }
}

function metricDelta(simulated, baseline) {
  const keys = [
    'pitchAccuracy',
    'durationAccuracy',
    'onsetAccuracy',
    'chordGroupingAccuracy',
    'noteDetectionF1',
    'wrongPitchCount',
    'wrongDurationCount',
    'wrongOnsetCount',
    'chordMismatchCount',
    'generatedNoteCount',
    'generatedMeasureCount',
  ]
  return Object.fromEntries(keys.map((key) => [key, simulated[key] - baseline[key]]))
}

function perMeasureDeltas(baselineReport, simulatedReport) {
  const baselineByMeasure = new Map(
    (baselineReport.perMeasure ?? []).map((measure) => [measure.measureNumber, measure]),
  )
  const keys = [
    'wrongDurationCount',
    'wrongOnsetCount',
    'wrongPitchCount',
    'chordMismatchCount',
    'errorCount',
  ]
  const totals = Object.fromEntries(keys.map((key) => [key, 0]))
  const measures = []

  for (const simulatedMeasure of simulatedReport.perMeasure ?? []) {
    const baselineMeasure = baselineByMeasure.get(simulatedMeasure.measureNumber)
    if (!baselineMeasure) {
      continue
    }
    const delta = Object.fromEntries(
      keys.map((key) => [key, (simulatedMeasure[key] ?? 0) - (baselineMeasure[key] ?? 0)]),
    )
    if (!keys.some((key) => delta[key] !== 0)) {
      continue
    }
    for (const key of keys) {
      totals[key] += delta[key]
    }
    measures.push({
      measureNumber: simulatedMeasure.measureNumber,
      delta,
      baseline: Object.fromEntries(keys.map((key) => [key, baselineMeasure[key] ?? 0])),
      simulated: Object.fromEntries(keys.map((key) => [key, simulatedMeasure[key] ?? 0])),
    })
  }

  return {
    changedMeasureCount: measures.length,
    totals,
    measures,
    worseDuration: measures.filter((measure) => measure.delta.wrongDurationCount > 0),
    betterDuration: measures.filter((measure) => measure.delta.wrongDurationCount < 0),
    onsetWorse: measures.filter((measure) => measure.delta.wrongOnsetCount > 0),
    onsetBetter: measures.filter((measure) => measure.delta.wrongOnsetCount < 0),
  }
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`
}

function formatSigned(value, digits = 0) {
  const rendered = digits > 0 ? value.toFixed(digits) : String(value)
  return value > 0 ? `+${rendered}` : rendered
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function fixtureRow(result, kind) {
  const metrics = kind === 'baseline' ? result.baseline.metrics : result.simulated.metrics
  const delta = result.delta
  return [
    result.fixture.id,
    kind,
    formatPercent(metrics.durationAccuracy),
    kind === 'simulated' ? formatSigned(delta.durationAccuracy, 4) : '0',
    String(metrics.wrongDurationCount),
    kind === 'simulated' ? formatSigned(delta.wrongDurationCount) : '0',
    formatPercent(metrics.onsetAccuracy),
    kind === 'simulated' ? formatSigned(delta.onsetAccuracy, 4) : '0',
    formatPercent(metrics.chordGroupingAccuracy),
    kind === 'simulated' ? formatSigned(delta.chordGroupingAccuracy, 4) : '0',
    formatPercent(metrics.pitchAccuracy),
    kind === 'simulated' ? formatSigned(delta.pitchAccuracy, 4) : '0',
    formatPercent(metrics.noteDetectionF1),
    kind === 'simulated' ? formatSigned(delta.noteDetectionF1, 4) : '0',
    `${metrics.generatedNoteCount}/${metrics.generatedMeasureCount}`,
  ]
}

function sampleRows(samples = []) {
  return samples.map((sample) => [
    String(sample.measureNumber),
    String(sample.eventIndex),
    String(sample.startDivision),
    `${sample.originalDurationDivisions}->${sample.beamedDurationDivisions}`,
    String(sample.movingNoteCount),
    String(sample.sustainedNoteCount),
    sample.stemDirections.join(', ') || 'none',
    sample.reasons.join(', '),
  ])
}

function changedMeasureRows(result) {
  return (result?.perMeasureDelta?.measures ?? []).map((measure) => [
    String(measure.measureNumber),
    formatSigned(measure.delta.wrongDurationCount),
    `${measure.baseline.wrongDurationCount}->${measure.simulated.wrongDurationCount}`,
    formatSigned(measure.delta.wrongOnsetCount),
    `${measure.baseline.wrongOnsetCount}->${measure.simulated.wrongOnsetCount}`,
    formatSigned(measure.delta.wrongPitchCount),
    formatSigned(measure.delta.chordMismatchCount),
    formatSigned(measure.delta.errorCount),
  ])
}

function makeMarkdown(summary) {
  const dense = summary.fixtures.find((fixture) => fixture.fixture.id === 'dense')
  const clean = summary.fixtures.find((fixture) => fixture.fixture.id === 'clean')
  const lines = [
    '# Beam Ownership Reconstruction Phase 2 Simulation',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '## Metric comparison',
    '',
    table(
      [
        'Fixture',
        'Run',
        'Duration',
        'Dur Δ',
        'Wrong dur',
        'Wrong dur Δ',
        'Onset',
        'Onset Δ',
        'Chord',
        'Chord Δ',
        'Pitch',
        'Pitch Δ',
        'F1',
        'F1 Δ',
        'Notes/measures',
      ],
      summary.fixtures.flatMap((result) => [
        fixtureRow(result, 'baseline'),
        fixtureRow(result, 'simulated'),
      ]),
    ),
    '',
    '## Simulation summary',
    '',
    table(
      ['Fixture', 'Candidates', 'Applied', 'Moving notes', 'Sustained notes', 'Note count changed', 'Measure count changed'],
      summary.fixtures.map((result) => [
        result.fixture.id,
        String(result.simulation.candidateEvents),
        String(result.simulation.appliedEvents),
        String(result.simulation.appliedMovingNotes),
        String(result.simulation.appliedSustainedNotes),
        String(result.simulation.noteCountChanged),
        String(result.simulation.measureCountChanged),
      ]),
    ),
    '',
    '## Dense applied samples',
    '',
    dense?.simulation.samples?.length
      ? table(
          [
            'Measure',
            'Event',
            'Start',
            'Duration',
            'Moving notes',
            'Sustained notes',
            'Stem dirs',
            'Reasons',
          ],
          sampleRows(dense.simulation.samples),
        )
      : 'No dense split samples were applied.',
    '',
    '## Dense changed measures',
    '',
    dense?.perMeasureDelta?.changedMeasureCount
      ? table(
          [
            'Measure',
            'Wrong dur Δ',
            'Wrong dur',
            'Wrong onset Δ',
            'Wrong onset',
            'Wrong pitch Δ',
            'Chord mismatch Δ',
            'Error Δ',
          ],
          changedMeasureRows(dense),
        )
      : 'No dense per-measure evaluator counts changed.',
    '',
    '## Interpretation',
    '',
  ]

  if (dense) {
    const improvedDuration = dense.delta.durationAccuracy > 0 &&
      dense.delta.wrongDurationCount < 0
    const stableGrouping =
      dense.delta.onsetAccuracy >= 0 &&
      dense.delta.chordGroupingAccuracy >= 0 &&
      dense.delta.pitchAccuracy >= 0
    const cleanStable = !clean || (
      clean.delta.durationAccuracy === 0 &&
      clean.delta.onsetAccuracy === 0 &&
      clean.delta.chordGroupingAccuracy === 0 &&
      clean.delta.pitchAccuracy === 0 &&
      clean.delta.generatedNoteCount === 0 &&
      clean.delta.generatedMeasureCount === 0
    )
    if (improvedDuration && stableGrouping && cleanStable) {
      lines.push(
        'Simulation improved dense duration without onset/chord/pitch regression and clean stayed unchanged.',
        '',
        '## Recommended Phase 3 runtime slice',
        '',
        'Promote only the simulated discriminator: split events with exactly one beamed ownership group, at least one stemmed unbeamed sustain note, no ties, one finite beam duration, and no note/measure count change. Keep this behind the same evaluator gate and revert on any dense onset/chord/pitch or clean regression.',
      )
    } else {
      lines.push(
        'Simulation is not clean enough to promote as-is.',
        '',
        '## Why not Phase 3 yet',
        '',
        `Dense duration delta: ${formatSigned(dense.delta.durationAccuracy, 4)}, wrong-duration delta: ${formatSigned(dense.delta.wrongDurationCount)}.`,
        `Dense onset delta: ${formatSigned(dense.delta.onsetAccuracy, 4)}, chord delta: ${formatSigned(dense.delta.chordGroupingAccuracy, 4)}, pitch delta: ${formatSigned(dense.delta.pitchAccuracy, 4)}.`,
        `Only ${dense.perMeasureDelta.changedMeasureCount} dense measures changed. Duration improved in ${dense.perMeasureDelta.betterDuration.length} candidate measure(s) and worsened in ${dense.perMeasureDelta.worseDuration.length}; onset improved in ${dense.perMeasureDelta.onsetBetter.length} measure(s).`,
        'The simulation preserves note/measure count, but the same-start split is still not a reliable proxy for true voice serialization. It can over-shorten the beamed note in MusicXML where the current event duration was already the best matched written duration, while a small onset gain comes from backup/forward ordering rather than a cleaner chord grouping result.',
        'The split model should remain offline until the simulated XML improves duration while preserving onset/chord/pitch and clean metrics.',
      )
    }
  }

  return `${lines.join('\n')}\n`
}

async function runFixture(fixture, options) {
  const pdfPath = resolvePath(fixture.pdf)
  const truthPath = resolvePath(fixture.truth)
  if (!existsSync(pdfPath)) {
    throw new Error(`Missing PDF for ${fixture.id}: ${pdfPath}`)
  }
  if (!existsSync(truthPath)) {
    throw new Error(`Missing truth for ${fixture.id}: ${truthPath}`)
  }

  const maxPages = Math.max(1, Number(options.maxPages ?? fixture.maxPages ?? 24))
  const preprocessPages = options.preprocessPages !== false
  const outDir = join(options.outDir, fixture.id)
  ensureDir(outDir)
  const pageResults = []
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  const omrResult = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages,
    preprocessPages,
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
    analyzePage: (imageData, pageOptions) => {
      const pageResult = processOmrPageAnalysis(imageData, pageOptions)
      pageResults.push(pageResult)
      return pageResult
    },
  })

  const baselineMeasures = pageResults.flatMap((pageResult) => pageResult.measureRhythms ?? [])
  const simulation = simulateBeamOwnershipSplits(baselineMeasures)
  const simulatedXml = buildOmrMusicXml({
    title: `${basename(pdfPath).replace(/\.pdf$/i, '')} beam ownership simulation`,
    measures: simulation.measures,
    musical: omrResult.musical,
    includeDisclaimer: true,
  })
  const truthXml = await readScoreXml(truthPath)
  const baselineReport = evaluateOmrAccuracy({
    generatedMusicXml: omrResult.musicXml,
    groundTruthMusicXml: truthXml,
    generatedFileName: `${basename(pdfPath)}.baseline.omr.musicxml`,
    groundTruthFileName: basename(truthPath),
    generatedOmrDiagnostics: omrResult.diagnostics,
    options: { exampleLimit: 99999 },
  })
  const simulatedDiagnostics = {
    ...omrResult.diagnostics,
    beamOwnershipSimulation: simulation.summary,
  }
  const simulatedReport = evaluateOmrAccuracy({
    generatedMusicXml: simulatedXml,
    groundTruthMusicXml: truthXml,
    generatedFileName: `${basename(pdfPath)}.beam-ownership-sim.musicxml`,
    groundTruthFileName: basename(truthPath),
    generatedOmrDiagnostics: simulatedDiagnostics,
    options: { exampleLimit: 99999 },
  })

  writeText(join(outDir, 'baseline.xml'), omrResult.musicXml)
  writeText(join(outDir, 'simulated.xml'), simulatedXml)
  writeText(join(outDir, 'baseline.json'), `${JSON.stringify({
    ...baselineReport,
    run: { pdfPath, truthPath, maxPages, preprocessPages },
  }, null, 2)}\n`)
  writeText(join(outDir, 'simulated.json'), `${JSON.stringify({
    ...simulatedReport,
    run: { pdfPath, truthPath, maxPages, preprocessPages },
    beamOwnershipSimulation: simulation.summary,
  }, null, 2)}\n`)
  writeText(join(outDir, 'baseline.txt'), `${formatOmrAccuracyReport(baselineReport)}\n`)
  writeText(join(outDir, 'simulated.txt'), `${formatOmrAccuracyReport(simulatedReport)}\n`)

  const baselineMetrics = metricSummary(baselineReport)
  const simulatedMetrics = metricSummary(simulatedReport)
  const perMeasureDelta = perMeasureDeltas(baselineReport, simulatedReport)
  return {
    fixture: {
      id: fixture.id,
      label: fixture.label ?? fixture.id,
      pdfPath,
      truthPath,
    },
    baseline: { metrics: baselineMetrics },
    simulated: { metrics: simulatedMetrics },
    delta: metricDelta(simulatedMetrics, baselineMetrics),
    perMeasureDelta,
    simulation: simulation.summary,
    outputs: {
      baselineXml: join(outDir, 'baseline.xml'),
      simulatedXml: join(outDir, 'simulated.xml'),
      baselineJson: join(outDir, 'baseline.json'),
      simulatedJson: join(outDir, 'simulated.json'),
    },
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(usage())
    return
  }
  const manifestPath = resolvePath(argValue(args, '--manifest') ?? DEFAULT_MANIFEST)
  const outDir = resolvePath(argValue(args, '--out') ?? DEFAULT_OUT_DIR)
  const fixtureFilter = argValue(args, '--fixture')
  const maxPages = argValue(args, '--max-pages')
  const preprocessPages = !hasFlag(args, '--no-preprocess')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const fixtures = (manifest.fixtures ?? []).filter(
    (fixture) => !fixtureFilter || fixture.id === fixtureFilter,
  )
  if (!fixtures.length) {
    throw new Error(`No fixtures matched ${fixtureFilter ?? '(all)'}`)
  }

  ensureDir(outDir)
  const results = []
  for (const fixture of fixtures) {
    console.error(`Simulating beam ownership splits: ${fixture.label ?? fixture.id}`)
    results.push(await runFixture(fixture, {
      outDir,
      maxPages: maxPages ? Number(maxPages) : undefined,
      preprocessPages,
    }))
  }

  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    manifestPath,
    outDir,
    fixtures: results,
  }
  writeText(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(join(outDir, 'summary.md'), makeMarkdown(summary))
  console.log(makeMarkdown(summary))
  console.error(`Wrote ${join(outDir, 'summary.json')}`)
  console.error(`Wrote ${join(outDir, 'summary.md')}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  console.error('')
  console.error(usage())
  process.exitCode = 1
})

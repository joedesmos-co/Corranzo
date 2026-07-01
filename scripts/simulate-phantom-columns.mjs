#!/usr/bin/env node
/**
 * Offline Family B phantom-column simulation.
 *
 * Runs normal OMR (+ shipped inner-voice correction baseline), applies linked-stack
 * realignment on cloned measure records, evaluates simulated MusicXML separately.
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
import { applyInnerVoicePhaseCorrection } from '../src/features/omr/innerVoicePhaseCorrection.js'
import {
  DEFAULT_MIN_STACK_NOTES,
  diagnoseMeasurePhantomColumns,
  simulatePhantomColumnCorrection,
} from '../src/features/omr/phantomColumnSimulation.js'
import {
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = join(ROOT, 'benchmarks/omr-benchmark.manifest.json')
const DEFAULT_OUT_DIR = join(ROOT, 'tmp/omr-benchmark-iter/phantom-column')
const PRIMARY_TARGET_MEASURE = 25
const CONTROL_MEASURES = [7, 33, 34, 61]
const TARGET_MEASURES = [25]

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function usage() {
  return [
    'Family B phantom-column simulation',
    '',
    'Options:',
    '  --manifest <path>    Benchmark manifest',
    '  --out <dir>          Output directory',
    '  --fixture <id>       Run only one fixture id',
    '  --max-pages <n>      Override fixture max pages',
    '  --no-preprocess      Disable preprocessing',
    '  --min-stack-notes <n> Minimum linked stack notes (default: 4)',
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
    missingNoteCount: report.totals.missingNoteCount,
    extraNoteCount: report.totals.extraNoteCount,
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
    'missingNoteCount',
    'extraNoteCount',
    'generatedNoteCount',
    'generatedMeasureCount',
  ]
  return Object.fromEntries(keys.map((key) => [key, simulated[key] - baseline[key]]))
}

function perMeasureDeltas(baselineReport, simulatedReport, measureNumbers = null) {
  const baselineByMeasure = new Map(
    (baselineReport.perMeasure ?? []).map((measure) => [measure.measureNumber, measure]),
  )
  const keys = [
    'wrongDurationCount',
    'wrongOnsetCount',
    'wrongPitchCount',
    'chordMismatchCount',
    'missingNoteCount',
    'extraNoteCount',
    'errorCount',
  ]
  const measures = []
  for (const simulatedMeasure of simulatedReport.perMeasure ?? []) {
    if (measureNumbers && !measureNumbers.includes(simulatedMeasure.measureNumber)) {
      continue
    }
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
    measures.push({
      measureNumber: simulatedMeasure.measureNumber,
      delta,
      baseline: Object.fromEntries(keys.map((key) => [key, baselineMeasure[key] ?? 0])),
      simulated: Object.fromEntries(keys.map((key) => [key, simulatedMeasure[key] ?? 0])),
    })
  }
  return measures
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

function measureWatchRows(result, measureNumbers) {
  return measureNumbers.map((measureNumber) => {
    const row = (result?.watchMeasures ?? []).find((entry) => entry.measureNumber === measureNumber)
    if (!row) {
      return [String(measureNumber), 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a']
    }
    return [
      String(measureNumber),
      formatSigned(row.delta.chordMismatchCount),
      `${row.baseline.chordMismatchCount}->${row.simulated.chordMismatchCount}`,
      formatSigned(row.delta.wrongOnsetCount),
      formatSigned(row.delta.wrongPitchCount),
      formatSigned(row.delta.wrongDurationCount),
      formatSigned(row.delta.missingNoteCount),
    ]
  })
}

function makeMarkdown(summary) {
  const dense = summary.fixtures.find((fixture) => fixture.fixture.id === 'dense')
  const clean = summary.fixtures.find((fixture) => fixture.fixture.id === 'clean')
  const minStackNotes = summary.minStackNotes ?? DEFAULT_MIN_STACK_NOTES
  const lines = [
    '# Family B Phantom-Column Simulation',
    '',
    `Generated: ${summary.generatedAt}`,
    `Strategy: shift linked stacks −0.25q (keep phantom solos)`,
    `Min linked stack notes: ${minStackNotes}`,
    '',
    '## Metric comparison',
    '',
    table(
      [
        'Fixture',
        'Run',
        'Chord',
        'Chord Δ',
        'Onset',
        'Onset Δ',
        'Pitch',
        'Pitch Δ',
        'Duration',
        'Duration Δ',
        'Wrong chord',
        'Wrong onset',
      ],
      summary.fixtures.flatMap((result) => [
        [
          result.fixture.id,
          'baseline',
          formatPercent(result.baseline.metrics.chordGroupingAccuracy),
          '0',
          formatPercent(result.baseline.metrics.onsetAccuracy),
          '0',
          formatPercent(result.baseline.metrics.pitchAccuracy),
          '0',
          formatPercent(result.baseline.metrics.durationAccuracy),
          '0',
          String(result.baseline.metrics.chordMismatchCount),
          String(result.baseline.metrics.wrongOnsetCount),
        ],
        [
          result.fixture.id,
          'simulated',
          formatPercent(result.simulated.metrics.chordGroupingAccuracy),
          formatSigned(result.delta.chordGroupingAccuracy, 4),
          formatPercent(result.simulated.metrics.onsetAccuracy),
          formatSigned(result.delta.onsetAccuracy, 4),
          formatPercent(result.simulated.metrics.pitchAccuracy),
          formatSigned(result.delta.pitchAccuracy, 4),
          formatPercent(result.simulated.metrics.durationAccuracy),
          formatSigned(result.delta.durationAccuracy, 4),
          formatSigned(result.delta.chordMismatchCount),
          formatSigned(result.delta.wrongOnsetCount),
        ],
      ]),
    ),
    '',
    '## Simulation summary',
    '',
    table(
      ['Fixture', 'Candidates', 'Applied', 'Note count changed', 'Samples'],
      summary.fixtures.map((result) => [
        result.fixture.id,
        String(result.simulation.candidateMeasures),
        String(result.simulation.appliedMeasures),
        String(result.simulation.noteCountChanged),
        String(result.simulation.samples?.length ?? 0),
      ]),
    ),
    '',
    '## Dense watch measures',
    '',
    table(
      ['Measure', 'Chord Δ', 'Chord', 'Onset Δ', 'Pitch Δ', 'Duration Δ', 'Missing Δ'],
      measureWatchRows(dense, [...TARGET_MEASURES, ...CONTROL_MEASURES]),
    ),
    '',
    '## Applied samples',
    '',
    dense?.simulation.samples?.length
      ? table(
          ['Measure', 'Phantom divs', 'Stack shifts'],
          dense.simulation.samples.map((sample) => [
            String(sample.measureNumber),
            (sample.phantomStarts ?? []).join(','),
            (sample.stackShifts ?? [])
              .map(({ fromDivision, toDivision }) => `${fromDivision}->${toDivision}`)
              .join('; '),
          ]),
        )
      : 'No samples applied on dense.',
    '',
    '## Rejected strategies (diagnosis)',
    '',
    'Naive phantom **removal** (with or without stack shift) regressed global chord and missing-note counts. Duplicate-only removal after shift also regressed (221→226 chord). Only linked-stack realignment passes gates.',
    '',
  ]

  if (dense) {
    const m25Improved = (() => {
      const row = dense.watchMeasures.find((entry) => entry.measureNumber === PRIMARY_TARGET_MEASURE)
      return row && row.delta.chordMismatchCount < 0
    })()
    const controlsStable = CONTROL_MEASURES.every((measureNumber) => {
      const row = dense.watchMeasures.find((entry) => entry.measureNumber === measureNumber)
      return !row || (
        row.delta.chordMismatchCount <= 0 &&
        row.delta.wrongOnsetCount <= 0 &&
        row.delta.wrongPitchCount <= 0 &&
        row.delta.wrongDurationCount <= 0 &&
        row.delta.missingNoteCount <= 0 &&
        row.delta.extraNoteCount <= 0
      )
    })
    const cleanStable = !clean || (
      clean.delta.chordGroupingAccuracy === 0 &&
      clean.delta.onsetAccuracy === 0 &&
      clean.delta.pitchAccuracy === 0 &&
      clean.delta.durationAccuracy === 0 &&
      clean.delta.generatedNoteCount === 0
    )
    const globalNoRegression =
      dense.delta.chordMismatchCount < 0 &&
      dense.delta.wrongOnsetCount <= 0 &&
      dense.delta.wrongPitchCount <= 0 &&
      dense.delta.wrongDurationCount <= 0 &&
      dense.delta.missingNoteCount <= 0

    if (m25Improved && controlsStable && cleanStable && globalNoRegression) {
      lines.push(
        '## Recommendation',
        '',
        'Simulation passes acceptance gates.',
        '',
        'Proposed runtime slice: after inner-voice phase correction, detect Family B phantom signature (≥2 solo columns at div%4===3 each followed two sixteenths later by a stack at div%4===1 with ≥4 notes). Shift each linked stack **−1 division** (−0.25q). Do **not** delete phantom solos — removal regresses missing/chord counts.',
        '',
        'Gate on dense m25 chord gain + global chord/onset/pitch/duration stability + clean unchanged.',
      )
    } else {
      lines.push(
        '## Recommendation',
        '',
        'Do not promote to runtime yet.',
        '',
        `- Global dense chord mismatch delta: ${formatSigned(dense.delta.chordMismatchCount)}`,
        `- Global dense onset delta: ${formatSigned(dense.delta.wrongOnsetCount)}`,
        `- Global dense pitch delta: ${formatSigned(dense.delta.wrongPitchCount)}`,
        `- Global dense duration delta: ${formatSigned(dense.delta.wrongDurationCount)}`,
        `- m25 improved: ${m25Improved ? 'yes' : 'no'}`,
        `- Controls stable: ${controlsStable ? 'yes' : 'no'}`,
        `- Clean stable: ${cleanStable ? 'yes' : 'no'}`,
      )
    }
  }

  return `${lines.join('\n')}\n`
}

function makeDiagnosisMarkdown(measureDiagnosis, baselineReport) {
  const measureStats = baselineReport?.perMeasure?.find(
    (measure) => measure.measureNumber === PRIMARY_TARGET_MEASURE,
  )
  const truthOnsets = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
  const lines = [
    '# m25 Phantom-Column Diagnosis (Family B)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Measure stats (baseline, post inner-voice)',
    '',
    `- Chord mismatches: ${measureStats?.chordMismatchCount ?? 'n/a'}`,
    `- Wrong onset: ${measureStats?.wrongOnsetCount ?? 'n/a'}`,
    `- Wrong pitch/duration/missing/extra: ${measureStats?.wrongPitchCount ?? 0}/${measureStats?.wrongDurationCount ?? 0}/${measureStats?.missingNoteCount ?? 0}/${measureStats?.extraNoteCount ?? 0}`,
    '',
    '## Truth onsets vs generated columns',
    '',
    `Truth onsets (quarters): ${truthOnsets.join(', ')} (8 columns).`,
    '',
    table(
      ['Div', 'Onset (q)', 'Notes', 'Role', 'Midis (sample)'],
      (measureDiagnosis?.columns ?? []).map((column) => [
        String(column.startDivision),
        column.onsetQuarter.toFixed(2),
        String(column.noteCount),
        column.role,
        column.midis.slice(0, 4).join(',') + (column.midis.length > 4 ? ',…' : ''),
      ]),
    ),
    '',
    '## Phantom identification',
    '',
    'Phantom solos sit at div%4===3 (0.75q, 1.75q, 2.75q). Linked stacks at div%4===1 (1.25q, 2.25q) are +0.25q early vs truth beats at 1.0q and 2.0q.',
    '',
  ]

  if (measureDiagnosis?.correction?.pairs?.length) {
    lines.push(
      '## Phantom/stack pairs',
      '',
      table(
        ['Phantom div', 'Stack div', 'Stack size', 'Duplicate midis', 'Splits attack?'],
        measureDiagnosis.correction.pairs.map((pair) => [
          String(pair.phantomStartDivision),
          String(pair.stackStartDivision),
          String(pair.stackNoteCount),
          pair.duplicateMidis.join(',') || '—',
          pair.splitsAttack ? 'yes (dup in stack)' : 'solo only',
        ]),
      ),
      '',
      'Mechanism: x-position gaps between truth sixteenths insert phantom solo columns; the following harmony stack lands one sixteenth early. Shifting stacks −1 division realigns chord sizes without deleting notes.',
      '',
    )
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

  const innerVoiceMeasures = applyInnerVoicePhaseCorrection(
    pageResults.flatMap((pageResult) => pageResult.measureRhythms ?? []),
  ).measures
  const minStackNotes = Math.max(1, Number(options.minStackNotes ?? DEFAULT_MIN_STACK_NOTES))
  const simulation = simulatePhantomColumnCorrection(innerVoiceMeasures, { minStackNotes })
  const simulatedXml = buildOmrMusicXml({
    title: `${basename(pdfPath).replace(/\.pdf$/i, '')} phantom-column simulation`,
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
  const simulatedReport = evaluateOmrAccuracy({
    generatedMusicXml: simulatedXml,
    groundTruthMusicXml: truthXml,
    generatedFileName: `${basename(pdfPath)}.phantom-column-sim.musicxml`,
    groundTruthFileName: basename(truthPath),
    generatedOmrDiagnostics: {
      ...omrResult.diagnostics,
      phantomColumnSimulation: simulation.summary,
    },
    options: { exampleLimit: 99999 },
  })

  writeText(join(outDir, 'baseline.xml'), omrResult.musicXml)
  writeText(join(outDir, 'simulated.xml'), simulatedXml)
  writeText(join(outDir, 'baseline.json'), `${JSON.stringify(baselineReport, null, 2)}\n`)
  writeText(join(outDir, 'simulated.json'), `${JSON.stringify(simulatedReport, null, 2)}\n`)
  writeText(join(outDir, 'baseline.txt'), `${formatOmrAccuracyReport(baselineReport)}\n`)
  writeText(join(outDir, 'simulated.txt'), `${formatOmrAccuracyReport(simulatedReport)}\n`)

  const baselineMetrics = metricSummary(baselineReport)
  const simulatedMetrics = metricSummary(simulatedReport)
  const watchMeasureNumbers = [...TARGET_MEASURES, ...CONTROL_MEASURES]
  const watchMeasures = watchMeasureNumbers.map((measureNumber) => {
    const baselineMeasure = baselineReport.perMeasure?.find(
      (measure) => measure.measureNumber === measureNumber,
    )
    const simulatedMeasure = simulatedReport.perMeasure?.find(
      (measure) => measure.measureNumber === measureNumber,
    )
    if (!baselineMeasure || !simulatedMeasure) {
      return null
    }
    const keys = [
      'wrongDurationCount',
      'wrongOnsetCount',
      'wrongPitchCount',
      'chordMismatchCount',
      'missingNoteCount',
      'extraNoteCount',
      'errorCount',
    ]
    const delta = Object.fromEntries(
      keys.map((key) => [key, (simulatedMeasure[key] ?? 0) - (baselineMeasure[key] ?? 0)]),
    )
    return {
      measureNumber,
      delta,
      baseline: Object.fromEntries(keys.map((key) => [key, baselineMeasure[key] ?? 0])),
      simulated: Object.fromEntries(keys.map((key) => [key, simulatedMeasure[key] ?? 0])),
    }
  }).filter(Boolean)

  let measureDiagnosis = null
  if (fixture.id === 'dense') {
    const targetMeasure = innerVoiceMeasures.find(
      (measure) => measure.measureNumber === PRIMARY_TARGET_MEASURE,
    )
    if (targetMeasure) {
      measureDiagnosis = diagnoseMeasurePhantomColumns(targetMeasure, { minStackNotes })
      writeText(
        join(ROOT, 'tmp/omr-benchmark-dashboard/m25-phantom-diagnosis.json'),
        `${JSON.stringify(measureDiagnosis, null, 2)}\n`,
      )
      writeText(
        join(ROOT, 'tmp/omr-benchmark-dashboard/m25-phantom-diagnosis.md'),
        makeDiagnosisMarkdown(measureDiagnosis, baselineReport),
      )
    }
  }

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
    watchMeasures,
    simulation: simulation.summary,
    measureDiagnosis,
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
  const minStackNotes = Math.max(1, Number(argValue(args, '--min-stack-notes') ?? DEFAULT_MIN_STACK_NOTES))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const fixtures = (manifest.fixtures ?? []).filter((fixture) =>
    fixtureFilter ? fixture.id === fixtureFilter : true,
  )
  if (!fixtures.length) {
    throw new Error(`No fixtures selected from ${manifestPath}`)
  }

  const results = []
  for (const fixture of fixtures) {
    results.push(
      await runFixture(fixture, {
        outDir,
        maxPages,
        preprocessPages,
        minStackNotes,
      }),
    )
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    minStackNotes,
    fixtures: results,
  }
  writeText(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(join(outDir, 'summary.md'), makeMarkdown(summary))
  console.log(`Wrote ${join(outDir, 'summary.md')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

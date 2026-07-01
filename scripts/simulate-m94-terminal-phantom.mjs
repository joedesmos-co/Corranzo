#!/usr/bin/env node
/**
 * m94 terminal Family B phantom/stack simulation.
 * Diagnosis + variant probe only — no runtime promotion.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { evaluateOmrAccuracy } from '../src/features/omr/omrAccuracyEvaluator.js'
import { applyInnerVoicePhaseCorrection, NARROW_MIN_STACK_NOTES, extractOnsetColumns } from '../src/features/omr/innerVoicePhaseCorrection.js'
import { applyOpeningLeadNoteMerge } from '../src/features/omr/openingLeadNoteMerge.js'
import {
  PHANTOM_COLUMN_STRATEGIES,
  diagnoseMeasurePhantomColumns,
  simulatePhantomColumnVariant,
} from '../src/features/omr/phantomColumnSimulation.js'
import { summarizeVectorChordGrouping } from '../src/features/omr/omrChordGroupingDiagnostics.js'
import { applyTerminalSameClefChordQuarterDurations } from '../src/features/omr/processVectorOmrPage.js'
import { OMR_DIVISIONS_PER_QUARTER } from '../src/features/omr/omrRhythmConstants.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { makeRenderPageCallback, renderPdfToPages } from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = join(ROOT, 'benchmarks/omr-benchmark.manifest.json')
const DEFAULT_OUT_DIR = join(ROOT, 'tmp/omr-benchmark-iter/m94-terminal')
const TARGET_MEASURE = 94
const CONTROL_MEASURES = [7, 25, 29, 33, 57, 61, 89, 113]

const VARIANTS = [
  { id: 'baseline', strategy: null, label: 'runtime baseline (no terminal variant)' },
  {
    id: 'drop-terminal-phantom',
    strategy: PHANTOM_COLUMN_STRATEGIES.DROP_TERMINAL_PHANTOM,
    label: 'drop solo @2.25q only',
  },
  {
    id: 'shift-terminal-early-forward',
    strategy: PHANTOM_COLUMN_STRATEGIES.SHIFT_TERMINAL_EARLY_FORWARD,
    label: 'shift terminal early columns +0.25q',
  },
  {
    id: 'drop-and-shift-terminal',
    strategy: PHANTOM_COLUMN_STRATEGIES.DROP_AND_SHIFT_TERMINAL,
    label: 'drop solo @2.25q + shift stacks +0.25q',
  },
]

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true })
}

function resolvePath(path) {
  if (!path) return path
  if (path.startsWith('~/')) return `${process.env.HOME ?? ''}${path.slice(1)}`
  return path.startsWith('/') ? path : join(ROOT, path)
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

function truthChordGroups(truthXml, measureNumber) {
  const timingMap = parseMusicXml(truthXml)
  const notes = timingMap.notes
    .filter((note) => note.measureNumber === measureNumber && !note.isRest && note.midi != null)
    .sort((left, right) => left.quarterTime - right.quarterTime || left.midi - right.midi)
  const measureStart = Math.min(...notes.map((note) => note.quarterTime))
  const groups = new Map()
  for (const note of notes) {
    const onset = +(note.quarterTime - measureStart).toFixed(2)
    if (!groups.has(onset)) {
      groups.set(onset, [])
    }
    groups.get(onset).push(note.midi)
  }
  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([onsetQuarters, midis]) => ({ onsetQuarters, noteCount: midis.length, midis }))
}

function columnSummary(measure) {
  return extractOnsetColumns(measure?.events ?? []).map((column) => ({
    div: column.startDivision,
    q: +((column.startDivision ?? 0) / OMR_DIVISIONS_PER_QUARTER).toFixed(2),
    noteCount: column.noteCount,
    midis: column.events
      .flatMap((event) => event.notes ?? [])
      .map((note) => note.midi)
      .sort((left, right) => left - right),
  }))
}

function applyPostCorrections(rawMeasures, { extraPhantomStrategy = null, beats = 4, beatType = 4 } = {}) {
  const measureDivisions = Math.round(beats * OMR_DIVISIONS_PER_QUARTER * (4 / beatType))
  let working = applyOpeningLeadNoteMerge(rawMeasures).measures
  working = applyInnerVoicePhaseCorrection(working, {
    totalDivisions: measureDivisions,
    minStackNotes: NARROW_MIN_STACK_NOTES,
  }).measures
  working = simulatePhantomColumnVariant(working, {
    totalDivisions: measureDivisions,
    strategy: PHANTOM_COLUMN_STRATEGIES.LINKED_STACK_REALIGN,
  }).measures
  if (extraPhantomStrategy) {
    working = simulatePhantomColumnVariant(working, {
      totalDivisions: measureDivisions,
      strategy: extraPhantomStrategy,
    }).measures
  }
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

function passesGates(baseline, simulated, cleanBaseline, cleanSimulated, targetMeasure) {
  const denseImproved =
    simulated.chordMismatchCount < baseline.chordMismatchCount &&
    simulated.wrongOnsetCount <= baseline.wrongOnsetCount &&
    simulated.wrongDurationCount <= baseline.wrongDurationCount &&
    simulated.wrongPitchCount <= baseline.wrongPitchCount
  const cleanStable =
    !cleanBaseline ||
    (cleanSimulated.chordMismatchCount <= cleanBaseline.chordMismatchCount &&
      cleanSimulated.wrongOnsetCount <= cleanBaseline.wrongOnsetCount &&
      cleanSimulated.wrongDurationCount <= cleanBaseline.wrongDurationCount &&
      cleanSimulated.wrongPitchCount <= cleanBaseline.wrongPitchCount &&
      cleanSimulated.generatedNoteCount === cleanBaseline.generatedNoteCount)
  const targetImproved = (simulated.watch?.find((row) => row.measureNumber === targetMeasure)?.delta
    ?.chordMismatchCount ?? 0) < 0
  const controlsStable = CONTROL_MEASURES.every((measureNumber) => {
    const row = simulated.watch?.find((entry) => entry.measureNumber === measureNumber)
    return (
      !row ||
      (row.delta.chordMismatchCount <= 0 &&
        row.delta.wrongOnsetCount <= 0 &&
        row.delta.wrongPitchCount <= 0 &&
        row.delta.wrongDurationCount <= 0 &&
        row.delta.missingNoteCount <= 0 &&
        row.delta.extraNoteCount <= 0)
    )
  })
  return {
    pass: denseImproved && cleanStable && targetImproved && controlsStable,
    denseImproved,
    cleanStable,
    targetImproved,
    controlsStable,
  }
}

async function runFixture(fixture, rawMeasures, omrResult, truthXml, variant) {
  const measures = applyPostCorrections(rawMeasures, {
    extraPhantomStrategy: variant.strategy,
  })
  const report = evaluateOmrAccuracy({
    generatedMusicXml: buildOmrMusicXml({
      title: `${fixture.id}-${variant.id}`,
      measures,
      musical: omrResult.musical,
      includeDisclaimer: true,
    }),
    groundTruthMusicXml: truthXml,
    generatedFileName: `${variant.id}.musicxml`,
    groundTruthFileName: basename(fixture.truth),
    options: { exampleLimit: 99999 },
  })
  const watch = [...new Set([TARGET_MEASURE, ...CONTROL_MEASURES])].map((measureNumber) => {
    const baselineMeasure = report.perMeasure.find((entry) => entry.measureNumber === measureNumber)
    return {
      measureNumber,
      baseline: baselineMeasure,
      simulated: baselineMeasure,
      delta: {
        chordMismatchCount: 0,
        wrongOnsetCount: 0,
        wrongDurationCount: 0,
        wrongPitchCount: 0,
        missingNoteCount: 0,
        extraNoteCount: 0,
      },
    }
  })
  return {
    fixture: fixture.id,
    metrics: metricSummary(report),
    watch,
    m94: {
      columns: columnSummary(measures.find((measure) => measure.measureNumber === TARGET_MEASURE)),
      vectorGroups: summarizeVectorChordGrouping(
        measures.find((measure) => measure.measureNumber === TARGET_MEASURE)?.events ?? [],
      ),
      chordMismatches: (report.debug?.chordGroupMismatches ?? []).filter(
        (entry) => entry.measureNumber === TARGET_MEASURE,
      ),
      phantomDiag: diagnoseMeasurePhantomColumns(
        measures.find((measure) => measure.measureNumber === TARGET_MEASURE) ?? { events: [] },
      ),
    },
  }
}

async function main() {
  const args = process.argv.slice(2)
  const outDir = resolvePath(argValue(args, '--out-dir') ?? DEFAULT_OUT_DIR)
  ensureDir(outDir)
  const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, 'utf8'))
  const denseFixture = (manifest.fixtures ?? []).find((fixture) => fixture.id === 'dense')
  if (!denseFixture || !existsSync(resolvePath(denseFixture.pdf))) {
    throw new Error('dense fixture unavailable')
  }

  const pdfPath = resolvePath(denseFixture.pdf)
  const truthPath = resolvePath(denseFixture.truth)
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
    maxPages: denseFixture.maxPages ?? 24,
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
  const truthGroups = truthChordGroups(truthXml, TARGET_MEASURE)

  const variantResults = []
  let baselineDense = null
  let baselineClean = null
  let cleanTruthXml = null

  for (const fixture of manifest.fixtures ?? []) {
    if (!existsSync(resolvePath(fixture.pdf))) continue
    const truth = await readScoreXml(resolvePath(fixture.truth))
    if (fixture.id === 'clean') {
      cleanTruthXml = truth
    }

    let fixtureRawMeasures = rawMeasures
    let fixtureMusical = omrResult.musical
    if (fixture.id === 'clean') {
      const cleanPageResults = []
      const cleanRendered = await renderPdfToPages(resolvePath(fixture.pdf), { rootDir: ROOT })
      const cleanExtractor = await (async () => {
        const cleanPdf = resolvePath(fixture.pdf)
        const cleanData = new Uint8Array(readFileSync(cleanPdf))
        const cleanDoc = await pdfjs.getDocument({ data: cleanData, isEvalSupported: false }).promise
        return async (_pdfSource, pageNumber) => {
          const page = await cleanDoc.getPage(pageNumber)
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
      })()
      const cleanOmr = await runPdfOmrPipeline(resolvePath(fixture.pdf), {
        renderPage: makeRenderPageCallback(cleanRendered.pages),
        extractPageText: cleanExtractor,
        numPages: cleanRendered.numPages,
        maxPages: fixture.maxPages ?? 24,
        preprocessPages: true,
        title: basename(fixture.pdf).replace(/\.pdf$/i, ''),
        analyzePage: (imageData, pageOptions) => {
          const pageResult = processOmrPageAnalysis(imageData, pageOptions)
          cleanPageResults.push(pageResult)
          return pageResult
        },
      })
      fixtureRawMeasures = cleanPageResults.flatMap((pageResult) => pageResult.measureRhythms ?? [])
      fixtureMusical = cleanOmr.musical
    }

    for (const variant of VARIANTS) {
      const measures = applyPostCorrections(fixtureRawMeasures, {
        extraPhantomStrategy: variant.strategy,
      })
      const report = evaluateOmrAccuracy({
        generatedMusicXml: buildOmrMusicXml({
          title: `${fixture.id}-${variant.id}`,
          measures,
          musical: fixtureMusical,
          includeDisclaimer: true,
        }),
        groundTruthMusicXml: truth,
        generatedFileName: `${variant.id}.musicxml`,
        groundTruthFileName: basename(fixture.truth),
        options: { exampleLimit: 99999 },
      })
      const result = {
        variant: variant.id,
        label: variant.label,
        fixture: fixture.id,
        metrics: metricSummary(report),
        watch: [...new Set([TARGET_MEASURE, ...CONTROL_MEASURES])].map((measureNumber) => {
          const measure = report.perMeasure.find((entry) => entry.measureNumber === measureNumber)
          return {
            measureNumber,
            chordMismatchCount: measure?.chordMismatchCount ?? null,
          }
        }),
      }
      if (fixture.id === 'dense') {
        result.m94 = {
          columns: columnSummary(measures.find((measure) => measure.measureNumber === TARGET_MEASURE)),
          chordMismatches: (report.debug?.chordGroupMismatches ?? []).filter(
            (entry) => entry.measureNumber === TARGET_MEASURE,
          ),
          phantomVariant: variant.strategy
            ? simulatePhantomColumnVariant(
                applyPostCorrections(rawMeasures, { extraPhantomStrategy: null })
                  .map((measure) => ({ ...measure, events: [...(measure.events ?? [])] })),
                { strategy: variant.strategy },
              ).summary
            : null,
        }
        if (variant.id === 'baseline') {
          baselineDense = result.metrics
        }
      }
      if (fixture.id === 'clean' && variant.id === 'baseline') {
        baselineClean = result.metrics
      }
      variantResults.push(result)
    }
  }

  const compared = VARIANTS.filter((variant) => variant.id !== 'baseline').map((variant) => {
    const dense = variantResults.find(
      (entry) => entry.fixture === 'dense' && entry.variant === variant.id,
    )
    const clean = variantResults.find(
      (entry) => entry.fixture === 'clean' && entry.variant === variant.id,
    )
    const baselineDenseResult = variantResults.find(
      (entry) => entry.fixture === 'dense' && entry.variant === 'baseline',
    )
    const watch = [...new Set([TARGET_MEASURE, ...CONTROL_MEASURES])].map((measureNumber) => {
      const baseMeasure = baselineDenseResult?.watch?.find((row) => row.measureNumber === measureNumber)
      const curMeasure = dense?.watch?.find((row) => row.measureNumber === measureNumber)
      return {
        measureNumber,
        baselineChord: baseMeasure?.chordMismatchCount ?? null,
        simulatedChord: curMeasure?.chordMismatchCount ?? null,
        delta: {
          chordMismatchCount:
            (curMeasure?.chordMismatchCount ?? 0) - (baseMeasure?.chordMismatchCount ?? 0),
        },
      }
    })
    const m94Base = baselineDenseResult?.m94
    const m94Sim = dense?.m94
    const gates = passesGates(
      baselineDense,
      dense.metrics,
      baselineClean,
      clean?.metrics ?? null,
      TARGET_MEASURE,
    )
    gates.watch = watch
    gates.targetMeasure = watch.find((row) => row.measureNumber === TARGET_MEASURE)
    const m94Before = m94Base?.chordMismatches?.reduce(
      (sum, entry) => sum + Math.abs((entry.truthCount ?? 0) - (entry.generatedCount ?? 0)),
      0,
    ) ?? 8
    const m94After = m94Sim?.chordMismatches?.reduce(
      (sum, entry) => sum + Math.abs((entry.truthCount ?? 0) - (entry.generatedCount ?? 0)),
      0,
    ) ?? m94Before
    gates.m94ChordDelta = m94After - m94Before
    gates.metrics = {
      baseline: baselineDense,
      simulated: dense.metrics,
      delta: {
        chordMismatchCount: dense.metrics.chordMismatchCount - baselineDense.chordMismatchCount,
        wrongOnsetCount: dense.metrics.wrongOnsetCount - baselineDense.wrongOnsetCount,
        wrongDurationCount: dense.metrics.wrongDurationCount - baselineDense.wrongDurationCount,
        wrongPitchCount: dense.metrics.wrongPitchCount - baselineDense.wrongPitchCount,
        generatedNoteCount: dense.metrics.generatedNoteCount - baselineDense.generatedNoteCount,
      },
    }
    gates.targetImproved = (gates.targetMeasure?.delta?.chordMismatchCount ?? 0) < 0
    gates.controlsStable = CONTROL_MEASURES.every((measureNumber) => {
      const row = watch.find((entry) => entry.measureNumber === measureNumber)
      return !row || row.delta.chordMismatchCount <= 0
    })
    gates.pass =
      gates.metrics.delta.chordMismatchCount < 0 &&
      gates.metrics.delta.wrongOnsetCount <= 0 &&
      gates.metrics.delta.wrongDurationCount <= 0 &&
      gates.metrics.delta.wrongPitchCount <= 0 &&
      gates.metrics.delta.generatedNoteCount === 0 &&
      gates.targetImproved &&
      (gates.targetMeasure?.simulatedChord ?? 8) === 0 &&
      gates.controlsStable &&
      (!clean?.metrics ||
        (clean.metrics.chordMismatchCount <= (baselineClean?.chordMismatchCount ?? 0) &&
          clean.metrics.wrongOnsetCount <= (baselineClean?.wrongOnsetCount ?? 0) &&
          clean.metrics.wrongDurationCount <= (baselineClean?.wrongDurationCount ?? 0) &&
          clean.metrics.wrongPitchCount <= (baselineClean?.wrongPitchCount ?? 0) &&
          clean.metrics.generatedNoteCount === (baselineClean?.generatedNoteCount ?? 0)))
    return { variant: variant.id, label: variant.label, gates, m94: m94Sim }
  })

  const diagnosis = {
    measureNumber: TARGET_MEASURE,
    truthChordGroups: truthGroups,
    baselineGenerated: variantResults.find(
      (entry) => entry.fixture === 'dense' && entry.variant === 'baseline',
    )?.m94,
    terminalPattern: {
      phantomSoloAt225: 'gen bass solo @2.25q; truth wants @2.5q',
      trebleStackAt25: 'gen 2-note stack @2.5q; truth wants @2.75q',
      quarterAnchorAt30: 'gen 2-note bass @3.0q matches truth',
      terminalStackAt325: 'gen 4-note stack @3.25q; truth wants @3.5q',
    },
  }

  const promote = compared.find((entry) => entry.gates.pass) ?? null
  const summary = {
    generatedAt: new Date().toISOString(),
    diagnosis,
    variants: compared,
    promote: promote
      ? { variant: promote.variant, label: promote.label, gates: promote.gates }
      : null,
    results: variantResults,
  }

  writeFileSync(join(outDir, 'simulation.json'), `${JSON.stringify(summary, null, 2)}\n`)

  const lines = [
    '# m94 Terminal Phantom/Stack Simulation',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '## Diagnosis',
    '',
    '### Truth chord groups (m94)',
    '',
    '| Beat (q) | Notes | Midis |',
    '|---------:|------:|-------|',
    ...truthGroups.map(
      (group) =>
        `| ${group.onsetQuarters} | ${group.noteCount} | ${group.midis.join(', ')} |`,
    ),
    '',
    '### Generated baseline columns (post runtime corrections)',
    '',
    '| Div | Beat (q) | Notes | Midis |',
    '|----:|---------:|------:|-------|',
    ...(diagnosis.baselineGenerated?.columns ?? []).map(
      (column) =>
        `| ${column.div} | ${column.q} | ${column.noteCount} | ${column.midis.join(', ')} |`,
    ),
    '',
    '### Chord mismatches (baseline)',
    '',
    '| Beat (q) | Truth | Gen |',
    '|---------:|------:|----:|',
    ...(diagnosis.baselineGenerated?.chordMismatches ?? []).map(
      (entry) => `| ${entry.onsetQuarters} | ${entry.truthCount} | ${entry.generatedCount} |`,
    ),
    '',
    'Terminal pattern: last 1.5 beats are one sixteenth early — solo @2.25q, treble pair @2.5q→2.75q, terminal stack @3.25q→3.5q.',
    '',
    '## Variant results',
    '',
    '| Variant | Dense chord | Δ chord | m94 chord | Δ onset | Δ pitch | Δ dur | Note Δ | Gates |',
    '|---------|------------:|--------:|----------:|--------:|--------:|------:|-------:|:-----:|',
    ...compared.map((entry) => {
      const g = entry.gates
      const m94Chord = (entry.m94?.chordMismatches ?? []).reduce(
        (sum, mismatch) => sum + Math.abs(mismatch.truthCount - mismatch.generatedCount),
        0,
      )
      return `| ${entry.variant} | ${g.metrics.simulated.chordMismatchCount} | ${g.metrics.delta.chordMismatchCount} | ${m94Chord} | ${g.metrics.delta.wrongOnsetCount} | ${g.metrics.delta.wrongPitchCount} | ${g.metrics.delta.wrongDurationCount} | ${g.metrics.delta.generatedNoteCount} | ${g.pass ? 'PASS' : 'FAIL'} |`
    }),
    '',
    '## Control measures (dense chord Δ)',
    '',
    ...compared.map((entry) => {
      const rows = entry.gates.watch
        .map(
          (row) =>
            `- m${row.measureNumber}: ${row.baselineChord} → ${row.simulatedChord} (Δ ${row.delta.chordMismatchCount})`,
        )
        .join('\n')
      return `### ${entry.variant}\n${rows}\n`
    }),
    '',
    promote
      ? `## Recommendation\n\nSimulation **PASS** for \`${promote.variant}\`: ${promote.label}. Ready for promotion review.`
      : '## Recommendation\n\n**Do not promote** — no variant passed all benchmark gates.',
  ]

  writeFileSync(join(outDir, 'simulation.md'), `${lines.join('\n')}\n`)
  writeFileSync(join(outDir, 'diagnosis.json'), `${JSON.stringify(diagnosis, null, 2)}\n`)
  console.log(`Wrote ${join(outDir, 'simulation.md')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

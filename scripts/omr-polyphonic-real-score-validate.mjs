#!/usr/bin/env node
/**
 * Diagnostic-only real-score validation for joint polyphonic rhythm packing.
 *
 * Usage:
 *   node scripts/omr-polyphonic-real-score-validate.mjs \
 *     --runtime-root /path/to/source/tree \
 *     --output /path/to/output \
 *     --label baseline
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const runtimeRoot = resolve(option('runtime-root', process.cwd()))
const output = resolve(option('output', join(process.cwd(), 'tmp/omr-polyphonic-rhythm/real-scores')))
const label = option('label', 'candidate')
const downloads = join(homedir(), 'Downloads')

const sources = [
  {
    id: 'gymnopedie',
    title: 'Sustained overlapping voices',
    pdf: join(downloads, 'gymnopedie-no-1-satie.pdf'),
    pages: 1,
  },
  {
    id: 'la-campanella',
    title: 'Dense polyphonic piano',
    pdf: join(downloads, 'etude-s-1413-in-g-minor-la-campanella-liszt.pdf'),
    pages: 2,
  },
]

function moduleUrl(relativePath) {
  return pathToFileURL(join(runtimeRoot, relativePath)).href
}

const [
  { runPdfOmrPipeline },
  { processOmrPageAnalysis },
  { parseMusicXml },
  { estimateLedgerLineCount, midiFromStaffPosition },
  renderTools,
] =
  await Promise.all([
    import(moduleUrl('src/features/omr/runPdfOmrPipeline.js')),
    import(moduleUrl('src/features/omr/processOmrPage.js')),
    import(moduleUrl('src/features/musicxml/parseMusicXml.js')),
    import(moduleUrl('src/features/omr/pitchFromStaffPosition.js')),
    import(moduleUrl('scripts/lib/renderPdfPages.mjs')),
  ])

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function voiceKey(note) {
  return `${note.partId ?? 'P1'}:staff-${note.staff ?? 1}:voice-${note.voice ?? 1}`
}

function eventRows(timing) {
  const rows = new Map()
  for (const note of timing.notes ?? []) {
    const key = [
      note.partId ?? 'P1',
      note.measureNumber,
      note.staff ?? 1,
      note.voice ?? 1,
      round(note.quarterTime, 6),
      round(note.durationQuarters, 6),
      note.isRest ? 'rest' : 'note',
    ].join('|')
    const row = rows.get(key) ?? {
      voice: voiceKey(note),
      measureNumber: note.measureNumber,
      onset: note.quarterTime,
      duration: note.durationQuarters,
      isRest: Boolean(note.isRest),
      toneCount: 0,
      midis: [],
    }
    if (!note.isRest) {
      row.toneCount += 1
      row.midis.push(note.midi)
    }
    rows.set(key, row)
  }
  return [...rows.values()]
}

function countValues(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]))
}

function summarizePagePitchEvidence(pageResults) {
  const notes = pageResults
    .flatMap((page) => page?.measureRhythms ?? [])
    .flatMap((measure) => measure.events ?? [])
    .filter((event) => event.type === 'note')
    .flatMap((event) => event.notes ?? [])
  let ledgerNotes = 0
  let ledgerLines = 0
  const selectedAnchors = []
  for (const note of notes) {
    const ledger = estimateLedgerLineCount(note.yNorm, note.pitchMapping?.lineYs ?? [])
    if (ledger.count > 0) ledgerNotes += 1
    ledgerLines += ledger.count
    if (note.noteheadAnchor?.source === 'ink-notehead-geometry') {
      const metricNaturalMidi = midiFromStaffPosition(
        note.noteheadAnchor.fallbackYNorm,
        note.pitchMapping?.lineYs ?? [],
        note.pitchMapping?.clefSign ?? 'treble',
      )
      selectedAnchors.push({
        page: note.page ?? null,
        measure: note.measureNumber ?? null,
        x: round(note.cx, 2),
        rawY: round(note.cy, 2),
        visualYNorm: round(note.noteheadAnchor.yNorm, 6),
        metricYNorm: round(note.noteheadAnchor.fallbackYNorm, 6),
        naturalMidiBefore: metricNaturalMidi,
        naturalMidiAfter: note.naturalMidi,
        emittedMidiAfter: note.midi,
        clefSign: note.pitchMapping?.clefSign ?? null,
        staffRole: note.pitchMapping?.staffRole ?? null,
        ledgerLines: ledger.count,
        fontName: note.noteheadFont?.fontName ?? null,
        glyph: note.noteheadFont?.glyph ?? null,
        bounds: note.noteheadAnchor.visualBounds ?? null,
      })
    }
  }
  return {
    ledgerNoteCount: ledgerNotes,
    ledgerLineCount: ledgerLines,
    detectedStaffRoles: countValues(notes.map((note) => note.pitchMapping?.staffRole ?? 'unknown')),
    pitchAnchorSources: countValues(notes.map((note) => note.noteheadAnchor?.source ?? 'legacy-or-raster')),
    rejectedPitchAnchorReasons: countValues(
      notes.map((note) => note.noteheadAnchor?.rejectedReason).filter(Boolean),
    ),
    selectedAnchors,
  }
}

function summarizeRestEvidence(pageResults) {
  const measures = pageResults.flatMap((page) => page?.measureRhythms ?? [])
  const skippedReasons = {}
  for (const measure of measures) {
    for (const skipped of measure.vectorRestDiagnostics?.skipped ?? []) {
      const reason = skipped.reason ?? 'unspecified'
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1
    }
  }
  return {
    detectedGlyphs: measures.reduce(
      (sum, measure) => sum + (measure.vectorRestGlyphCount ?? 0),
      0,
    ),
    appliedGlyphs: measures.reduce(
      (sum, measure) => sum + (measure.vectorRestDiagnostics?.appliedCount ?? 0),
      0,
    ),
    skippedGlyphs: Object.values(skippedReasons).reduce((sum, count) => sum + count, 0),
    skippedReasons,
  }
}

function summarize(xml, result, pageResults) {
  const timing = parseMusicXml(xml, `${label}.musicxml`)
  const events = eventRows(timing)
  const measuresByNumber = new Map(
    (timing.measures ?? []).map((measure) => [measure.number, measure]),
  )
  const perVoice = {}
  for (const event of events) {
    const measure = measuresByNumber.get(event.measureNumber)
    const localOnset = round(event.onset - (measure?.startQuarters ?? 0))
    const voice = (perVoice[event.voice] ??= {
      eventCount: 0,
      pitchedEventCount: 0,
      restCount: 0,
      durationTotalQuarters: 0,
      onsetDistribution: {},
    })
    voice.eventCount += 1
    voice.pitchedEventCount += event.isRest ? 0 : 1
    voice.restCount += event.isRest ? 1 : 0
    voice.durationTotalQuarters = round(voice.durationTotalQuarters + event.duration)
    voice.onsetDistribution[localOnset] = (voice.onsetDistribution[localOnset] ?? 0) + 1
  }

  const notes = (timing.notes ?? []).filter((note) => !note.isRest)
  const tieStarts = notes.filter((note) => note.tieStart).length
  const tieStops = notes.filter((note) => note.tieStop).length
  return {
    measureCount: result.measureCount,
    rhythmicMeasureCount: result.rhythmicMeasureCount,
    noteCount: result.noteCount,
    eventCount: events.length,
    chordCount: events.filter((event) => !event.isRest && event.toneCount > 1).length,
    pitchClassDistribution: countValues(
      notes.map((note) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((note.midi % 12) + 12) % 12]),
    ),
    octaveDistribution: countValues(notes.map((note) => Math.floor(note.midi / 12) - 1)),
    broadStaffRangeOutlierCount: notes.filter((note) =>
      note.staff === 2 ? note.midi < 24 || note.midi > 76 : note.midi < 48 || note.midi > 96,
    ).length,
    explicitAccidentalCount: notes.filter((note) => note.accidental != null).length,
    staffAssignment: countValues(notes.map((note) => `staff-${note.staff ?? 1}`)),
    chordPitchSets: countValues(
      events
        .filter((event) => !event.isRest && event.toneCount > 1)
        .map((event) => [...event.midis].sort((left, right) => left - right).join(',')),
    ),
    pagePitchEvidence: summarizePagePitchEvidence(pageResults),
    restCount: events.filter((event) => event.isRest).length,
    visualRestEvidence: summarizeRestEvidence(pageResults),
    tieBalance: {
      starts: tieStarts,
      stops: tieStops,
      delta: tieStarts - tieStops,
    },
    playbackDurationSeconds: round(timing.durationSeconds),
    acceptance: result.acceptance,
    acceptanceWarnings: result.warnings ?? [],
    flaggedPlaybackMeasures:
      result.measurePlaybackReport?.flaggedMeasures?.map((entry) => entry.measureNumber) ?? [],
    perVoice,
  }
}

async function runSource(source) {
  const rendered = await renderTools.renderPdfToPages(source.pdf, {
    rootDir: runtimeRoot,
    maxPages: source.pages,
  })
  const extractPageText = await renderTools.makePdfTextExtractor(source.pdf, {
    rootDir: runtimeRoot,
  })
  const pageResults = []
  const result = await runPdfOmrPipeline(source.pdf, {
    renderPage: renderTools.makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: source.pages,
    title: `polyphonic-rhythm-${source.id}-${label}`,
    omrV3Confidence: false,
    analyzePage(imageData, context) {
      const pageResult = processOmrPageAnalysis(imageData, context)
      pageResults[context.page - 1] = pageResult
      return pageResult
    },
  })
  await writeFile(join(output, `${source.id}-${label}.musicxml`), result.musicXml)
  return {
    id: source.id,
    title: source.title,
    pages: source.pages,
    summary: summarize(result.musicXml, result, pageResults),
  }
}

await mkdir(output, { recursive: true })
const original = {
  log: console.log,
  info: console.info,
  debug: console.debug,
}
console.log = () => {}
console.info = () => {}
console.debug = () => {}
const records = []
try {
  for (const source of sources) {
    records.push(await runSource(source))
  }
} finally {
  console.log = original.log
  console.info = original.info
  console.debug = original.debug
}

const report = {
  label,
  sources: records,
}
await writeFile(join(output, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`)
console.error(JSON.stringify(report, null, 2))

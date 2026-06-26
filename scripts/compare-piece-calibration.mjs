/**
 * Compare auto-calibration and runtime cursor mapping for two real pieces.
 *
 * Defaults to the Winter and Cruel Angel files in ~/Downloads. The renderer
 * intentionally matches the app's PDF-analysis policy: raw page pixels with
 * rotation: 0, leaving orientation correction to the app pipeline.
 *
 * Usage:
 *   node scripts/compare-piece-calibration.mjs
 *   node scripts/compare-piece-calibration.mjs --json tmp/piece-calibration-comparison.json
 *   node scripts/compare-piece-calibration.mjs --text tmp/piece-calibration-comparison.txt
 *   node scripts/compare-piece-calibration.mjs --time 12.5
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getMeasureAtTime } from '../src/features/musicxml/timingQuery.js'
import {
  getMeasurePlaybackWindow,
  usesPerformedTimeline,
} from '../src/features/musicxml/performedTimeline.js'
import { mergeAutomaticAnchors } from '../src/features/score-follow/anchorUtils.js'
import { filterTrustedAnchors, resolveTrustedAnchorForMeasure } from '../src/features/score-follow/trustedAnchors.js'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  buildCalibrationGeometry,
} from '../src/features/score-follow/smartScoreCalibration.js'
import {
  buildCursorMotionTimeline,
  resolveCursorMotion,
} from '../src/features/score-follow/cursorMotionTimeline.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import {
  buildCursorMappingDebug,
  deriveAnchorMeasureBox,
} from '../src/features/score-follow/scoreFollowCursorMappingDebug.js'
import { computeAlignmentDiagnostics } from '../src/features/practice/computeAlignmentDiagnostics.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOWNLOADS = join(process.env.HOME ?? '/Users/ryland', 'Downloads')
const ANALYSIS_WIDTH = 1000
const require = createRequire(import.meta.url)
const toneMidiModule = require('@tonejs/midi')
const Midi = toneMidiModule.Midi ?? toneMidiModule.default?.Midi ?? toneMidiModule.default

const DEFAULT_PIECES = [
  {
    id: 'cruel-angel',
    label: "A Cruel Angel's Thesis",
    pdfPath: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'),
    mxlPath: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.mxl'),
    midiPath: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.mid'),
  },
  {
    id: 'winter',
    label: 'Winter',
    pdfPath: join(DOWNLOADS, 'vivaldi-winter-rousseau-version-original.pdf'),
    mxlPath: join(DOWNLOADS, 'vivaldi-winter-rousseau-version-original.mxl'),
    midiPath: join(DOWNLOADS, 'vivaldi-winter-rousseau-version-original.mid'),
  },
]

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) {
    return null
  }
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function compactBox(box) {
  if (!box) {
    return null
  }
  return {
    x0: round(box.x0),
    y0: round(box.y0),
    x1: round(box.x1),
    y1: round(box.y1),
    source: box.source ?? null,
  }
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

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

async function loadPdfRenderDependencies() {
  const { createCanvas } = await import(join(ROOT, 'node_modules/@napi-rs/canvas/index.js'))
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = fileURLToPath(
      new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url),
    )
  } catch {
    // The legacy build can render without an explicit worker in this script.
  }
  return { createCanvas, pdfjs }
}

async function renderRawPdfPages(pdfPath) {
  const { createCanvas, pdfjs } = await loadPdfRenderDependencies()
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []
  const pageMeta = []

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1, rotation: 0 })
    const scale = ANALYSIS_WIDTH / base.width
    const viewport = page.getViewport({ scale, rotation: 0 })
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    pages.push({
      pageNumber,
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
    })
    pageMeta.push({
      page: pageNumber,
      nativeRotate: page.rotate ?? 0,
      rawWidth: round(base.width, 2),
      rawHeight: round(base.height, 2),
      analysisWidth: imageData.width,
      analysisHeight: imageData.height,
    })
  }

  return {
    numPages: doc.numPages,
    pages,
    pageMeta,
    renderPolicy: 'raw-pdf-pixels rotation=0',
  }
}

function makeRenderPageCallback(rendered) {
  return async (_pdfSource, pageNumber) => {
    const page = rendered.pages[pageNumber - 1]
    return {
      imageData: {
        width: page.width,
        height: page.height,
        data: page.data,
      },
    }
  }
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!nums.length) {
    return null
  }
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

function timingSummary(timingMap) {
  const measures = timingMap.measures ?? []
  const entries = timingMap.performedMeasureTimeline?.entries ?? []
  const first = measures[0] ?? null
  const regularLength = median(measures.slice(1).map((measure) => measure.notatedLengthQuarters))
  const firstShort =
    first && Number.isFinite(regularLength) && regularLength > 0
      ? first.notatedLengthQuarters < regularLength * 0.75
      : false
  const repeatedWrittenMeasures = new Set()
  const seen = new Set()
  for (const entry of entries) {
    if (seen.has(entry.writtenMeasureNumber)) {
      repeatedWrittenMeasures.add(entry.writtenMeasureNumber)
    }
    seen.add(entry.writtenMeasureNumber)
  }

  return {
    title: timingMap.title ?? null,
    fileName: timingMap.fileName ?? null,
    measureCount: measures.length,
    durationSeconds: round(timingMap.durationSeconds, 3),
    writtenDurationSeconds: round(timingMap.writtenDurationSeconds, 3),
    stavesPerSystem: timingMap.stavesPerSystem ?? null,
    usesPerformedTimeline: usesPerformedTimeline(timingMap),
    performedEntryCount: entries.length,
    repeatsLikely:
      entries.length !== measures.length ||
      entries.some((entry) => Number(entry.repeatPass) > 1) ||
      repeatedWrittenMeasures.size > 0,
    repeatedWrittenMeasures: [...repeatedWrittenMeasures].slice(0, 20),
    tempoChangeCount: timingMap.tempoChanges?.length ?? 0,
    tempoChanges: (timingMap.tempoChanges ?? []).map((tempo) => ({
      quarterTime: round(tempo.quarterTime, 3),
      bpm: round(tempo.bpm, 3),
    })),
    timeSignatureCount: timingMap.timeSignatures?.length ?? 0,
    firstMeasure: first
      ? {
          number: first.number,
          implicit: Boolean(first.implicit),
          lengthQuarters: round(first.lengthQuarters, 4),
          notatedLengthQuarters: round(first.notatedLengthQuarters, 4),
          regularLengthQuarters: round(regularLength, 4),
          pickupLikely: Boolean(first.implicit || firstShort),
        }
      : null,
    systemStarts: measures
      .filter((measure) => measure.systemBreakBefore)
      .map((measure) => measure.number),
  }
}

function timeForMeasure(timingMap, measureNumber, fraction = 0.35) {
  if (usesPerformedTimeline(timingMap)) {
    const entry = timingMap.performedMeasureTimeline?.entries?.find(
      (candidate) => candidate.writtenMeasureNumber === measureNumber,
    )
    if (entry) {
      return entry.startTimeSeconds + Math.max(0, entry.endTimeSeconds - entry.startTimeSeconds) * fraction
    }
  }
  const measure = timingMap.measures?.find((candidate) => candidate.number === measureNumber)
  if (!measure) {
    return null
  }
  return measure.startTimeSeconds + Math.max(0, measure.endTimeSeconds - measure.startTimeSeconds) * fraction
}

function runtimeCursorAt({ timingMap, anchors, autoSetupReport, motionTimeline, time }) {
  const trustedAnchors = filterTrustedAnchors(anchors)
  const trust = assessScoreFollowTrust({ anchors, timingMap })
  const resolved = resolveScoreFollowCursor({
    timingMap,
    practiceTime: time,
    trustedAnchors,
    trust,
  })
  const motion = motionTimeline ? resolveCursorMotion(motionTimeline, time) : null
  const cursor =
    resolved.cursor?.visible && motion
      ? {
          ...resolved.cursor,
          x: motion.x,
          y: motion.y,
          page: motion.page,
          measureNumber: motion.measureNumber ?? resolved.cursor.measureNumber,
          systemIndex: motion.systemIndex ?? resolved.cursor.systemIndex,
          progressMode: motion.segmentType ?? resolved.cursor.progressMode,
          interpolationSource: `motion-timeline:${motion.segmentType ?? 'phrase'}`,
          fallbackTier: 'motion-timeline',
        }
      : resolved.cursor
  const debug = buildCursorMappingDebug({
    timingMap,
    practiceTime: time,
    trustedAnchors,
    cursor,
    autoSetupReport,
  })
  const currentMeasure = getMeasureAtTime(timingMap, time)
  const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, currentMeasure?.number)
  const window = currentMeasure?.number != null
    ? getMeasurePlaybackWindow(timingMap, currentMeasure.number, time)
    : null

  return {
    time: round(time, 4),
    measureNumber: currentMeasure?.number ?? null,
    measureIndex: debug.measureIndex,
    pageNumber: debug.pageNumber,
    systemIndex: debug.systemIndex,
    cursorX: round(cursor?.x),
    cursorY: round(cursor?.y),
    measureBoundingBox: debug.measureBoundingBox,
    interpolationSource: debug.interpolationSource,
    fallbackTier: debug.fallbackTier,
    anchorSource: debug.anchorSource,
    anchorSchemaVersion: debug.anchorSchemaVersion,
    anchorX: round(anchor?.x),
    playableStartX: round(anchor?.meta?.playableStartX),
    playableEndX: round(anchor?.meta?.playableEndX),
    measureStartX: round(anchor?.meta?.measureStartX),
    systemEndX: round(anchor?.meta?.systemEndX),
    xSource: anchor?.meta?.xSource ?? null,
    repeatPass: window?.repeatPass ?? null,
    performedIndex: window?.performedIndex ?? null,
  }
}

function nearestMidiPlaybackMeasure(noteEvents, time) {
  if (!noteEvents?.length || !Number.isFinite(time)) {
    return null
  }
  let before = null
  let after = null
  for (const event of noteEvents) {
    if (event.scoreTimeSeconds <= time + 0.001) {
      before = event
      continue
    }
    after = event
    break
  }
  const chosen =
    before && after
      ? Math.abs(time - before.scoreTimeSeconds) <= Math.abs(after.scoreTimeSeconds - time)
        ? before
        : after
      : before ?? after
  if (!chosen) {
    return null
  }
  return {
    measureNumber: chosen.measureNumber ?? null,
    scoreTimeSeconds: round(chosen.scoreTimeSeconds, 4),
    deltaSeconds: round(time - chosen.scoreTimeSeconds, 4),
    source: chosen.source ?? null,
  }
}

function rawMidiMeasureAtSameSeconds(rawMidiNotes, time) {
  if (!rawMidiNotes?.length || !Number.isFinite(time)) {
    return null
  }
  let candidate = rawMidiNotes[0]
  for (const note of rawMidiNotes) {
    if (note.timeSeconds <= time + 0.001) {
      candidate = note
      continue
    }
    break
  }
  return {
    measureIndex: candidate.measureIndex,
    measureNumber: candidate.measureIndex != null ? candidate.measureIndex + 1 : null,
    timeSeconds: round(candidate.timeSeconds, 4),
    deltaSeconds: round(time - candidate.timeSeconds, 4),
  }
}

async function midiDiagnostics(midiPath, timingMap) {
  if (!midiPath || !existsSync(midiPath)) {
    return {
      available: false,
      path: midiPath ?? null,
      rawMidiNotes: [],
      playbackNoteEvents: [],
    }
  }

  const arrayBuffer = toArrayBuffer(readFileSync(midiPath))
  const midi = new Midi(arrayBuffer)
  const ticksToMeasures =
    typeof midi.header?.ticksToMeasures === 'function'
      ? (ticks) => midi.header.ticksToMeasures(ticks)
      : null
  const rawMidiNotes = []
  for (const [trackIndex, track] of midi.tracks.entries()) {
    for (const note of track.notes ?? []) {
      const measurePosition =
        ticksToMeasures && Number.isFinite(note.ticks) ? ticksToMeasures(note.ticks) : null
      rawMidiNotes.push({
        timeSeconds: note.time,
        durationSeconds: note.duration,
        midi: note.midi,
        trackIndex,
        measurePosition,
        measureIndex: Number.isFinite(measurePosition) ? Math.floor(measurePosition) : null,
      })
    }
  }
  rawMidiNotes.sort((a, b) => a.timeSeconds - b.timeSeconds || a.midi - b.midi)
  const profileNotes = rawMidiNotes.map((note) => ({
    midi: note.midi,
    timeSeconds: note.timeSeconds,
  }))
  const tempos = midi.header.tempos.map((tempo) => ({
    bpm: Math.round(tempo.bpm * 10) / 10,
    timeSeconds: midi.header.ticksToSeconds(tempo.ticks),
  }))
  if (tempos.length === 0) {
    tempos.push({ bpm: 120, timeSeconds: 0 })
  }
  const profile = {
    noteCount: profileNotes.length,
    durationSeconds: midi.duration,
    tempos,
    notes: profileNotes,
    firstNote: profileNotes[0] ?? null,
  }
  const alignment = computeAlignmentDiagnostics(profile, timingMap)

  const positioned = rawMidiNotes.filter((note) => Number.isFinite(note.measurePosition))
  const maxMeasurePosition = positioned.length
    ? Math.max(...positioned.map((note) => note.measurePosition))
    : null
  const performedEntries =
    timingMap.performedMeasureTimeline?.entries?.length > 0
      ? timingMap.performedMeasureTimeline.entries
      : (timingMap.measures ?? []).map((measure, index) => ({
          performedIndex: index,
          writtenMeasureNumber: measure.number,
          startTimeSeconds: measure.startTimeSeconds,
          endTimeSeconds: measure.endTimeSeconds,
        }))
  const performedDuration =
    timingMap.durationSeconds ?? timingMap.writtenDurationSeconds ?? midi.duration ?? 0
  const playbackNoteEvents = rawMidiNotes
    .map((note) => {
      if (Number.isFinite(note.measurePosition) && performedEntries.length > 0) {
        const idx = Math.min(
          performedEntries.length - 1,
          Math.max(0, Math.floor(note.measurePosition)),
        )
        const entry = performedEntries[idx]
        const localT = Math.max(0, Math.min(1, note.measurePosition - Math.floor(note.measurePosition)))
        const span = Math.max(entry.endTimeSeconds - entry.startTimeSeconds, 1e-6)
        return {
          scoreTimeSeconds: entry.startTimeSeconds + localT * span,
          source: 'midi',
          measureNumber: entry.writtenMeasureNumber,
        }
      }
      const scale = midi.duration > 0 && performedDuration > 0 ? performedDuration / midi.duration : 1
      return {
        scoreTimeSeconds: note.timeSeconds * scale,
        source: 'midi',
        measureNumber: null,
      }
    })
    .sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)
  const tracks = midi.tracks.map((track, index) => ({
    id: index,
    name: track.name?.trim() || track.instrument?.name?.trim() || `Track ${index + 1}`,
    noteCount: track.notes?.length ?? 0,
    muted: false,
  }))

  return {
    available: true,
    path: midiPath,
    durationSeconds: round(profile.durationSeconds, 3),
    noteCount: profile.noteCount,
    tracks,
    tempoCount: profile.tempos.length,
    tempos: profile.tempos.map((tempo) => ({
      bpm: round(tempo.bpm, 2),
      timeSeconds: round(tempo.timeSeconds, 3),
    })),
    alignment: alignment
      ? {
          assessment: alignment.assessment,
          durationDeltaSeconds: round(alignment.durationDeltaSeconds, 3),
          firstNoteDeltaSeconds: round(alignment.firstNoteDeltaSeconds, 3),
          pitchOverlapPercent: round(alignment.pitchOverlapPercent, 2),
          pitchOverlapAdjustedPercent: round(alignment.pitchOverlapAdjustedPercent, 2),
          midiNoteCount: alignment.midiNoteCount,
          musicXmlNoteCount: alignment.musicXmlNoteCount,
          noteCountDelta: alignment.noteCountDelta,
          midiTempoSummary: alignment.midiTempoSummary,
          musicXmlTempoSummary: alignment.musicXmlTempoSummary,
        }
      : null,
    measureGrid: {
      available: Boolean(ticksToMeasures),
      notePositions: positioned.length,
      estimatedMeasureCount:
        Number.isFinite(maxMeasurePosition) ? Math.floor(maxMeasurePosition) + 1 : null,
      firstNotes: rawMidiNotes.slice(0, 8).map((note) => ({
        timeSeconds: round(note.timeSeconds, 4),
        midi: note.midi,
        measurePosition: round(note.measurePosition, 4),
        measureIndex: note.measureIndex,
      })),
      lastNotes: rawMidiNotes.slice(-8).map((note) => ({
        timeSeconds: round(note.timeSeconds, 4),
        midi: note.midi,
        measurePosition: round(note.measurePosition, 4),
        measureIndex: note.measureIndex,
      })),
    },
    playbackSchedule: {
      usesMidi: playbackNoteEvents.length > 0,
      mappingMethod: positioned.length > 0 ? 'measure-aligned' : 'proportional',
      mappingWarning:
        alignment?.assessment === 'unlikely-match'
          ? 'MIDI and MusicXML diagnostics mark this as an unlikely match.'
          : null,
      durationSeconds: round(performedDuration, 3),
      eventCount: playbackNoteEvents.length,
    },
    rawMidiNotes,
    playbackNoteEvents,
  }
}

function groupCounts(values) {
  const counts = new Map()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

function systemsPerPage(systems) {
  const counts = new Map()
  for (const system of systems) {
    counts.set(system.page, (counts.get(system.page) ?? 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0])))
}

function summarizeSystems({ preview, geometry, anchors }) {
  const anchorsByMeasure = new Map(anchors.map((anchor) => [anchor.measureNumber, anchor]))
  const debugByIndex = new Map((preview.debugReport?.systems ?? []).map((system) => [system.index, system]))
  return preview.spans.map((span, index) => {
    const detected = debugByIndex.get(index) ?? {}
    const geom = geometry.systems[index] ?? {}
    const firstAnchor = anchorsByMeasure.get(span.measureStart)
    const lastAnchor = anchorsByMeasure.get(span.measureEnd)
    const firstBox = deriveAnchorMeasureBox(firstAnchor)
    const lastBox = deriveAnchorMeasureBox(lastAnchor)
    const expectedBarlines = span.measuresInSpan + 1
    const detectedBarlines = geom.barlines?.length ?? detected.barlineCount ?? null
    const barlineDelta =
      Number.isFinite(detectedBarlines) && Number.isFinite(expectedBarlines)
        ? detectedBarlines - expectedBarlines
        : null
    return {
      index,
      page: detected.page ?? geom.page ?? span.page,
      y0: round(detected.y0 ?? geom.y0),
      y1: round(detected.y1 ?? geom.y1),
      measureStart: span.measureStart,
      measureEnd: span.measureEnd,
      measureCount: span.measuresInSpan,
      barlineCount: detectedBarlines,
      expectedBarlineCount: expectedBarlines,
      barlineDelta,
      barlineConfident: detected.barlineConfident ?? geom.barlineConfident ?? null,
      barlineReliabilityReason:
        detected.barlineReliabilityReason ?? geom.barlineReliabilityReason ?? null,
      barlineCandidatesRaw: detected.barlineCandidatesRaw ?? null,
      barlineAccepted: detected.barlineAccepted ?? null,
      barlineRejected: detected.barlineRejected ?? null,
      barlineXs: (geom.barlines ?? []).map((x) => round(x)),
      contentBounds: {
        x0: round(geom.contentBoundsX0),
        x1: round(geom.contentBoundsX1),
      },
      inkBounds: {
        left: round(geom.inkLeft),
        right: round(geom.inkRight),
        found: Boolean(geom.inkFound),
      },
      firstMeasureBox: compactBox(firstBox),
      lastMeasureBox: compactBox(lastBox),
      firstAnchorX: round(firstAnchor?.x),
      lastAnchorX: round(lastAnchor?.x),
      firstXSource: firstAnchor?.meta?.xSource ?? null,
      lastXSource: lastAnchor?.meta?.xSource ?? null,
      suspect:
        barlineDelta !== 0 ||
        detected.barlineConfident === false ||
        geom.barlineConfident === false,
    }
  })
}

function selectTextSampleMeasures({ timingMap, systems, explicitTime }) {
  if (Number.isFinite(explicitTime)) {
    const measure = getMeasureAtTime(timingMap, explicitTime)
    return measure ? [measure.number] : []
  }
  const selected = new Set()
  for (const system of systems) {
    selected.add(system.measureStart)
    if (system.suspect) {
      selected.add(system.measureEnd)
    }
  }
  return [...selected].sort((a, b) => a - b)
}

async function analyzePiece(piece, { explicitTime = null } = {}) {
  for (const path of [piece.pdfPath, piece.mxlPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing ${path}`)
    }
  }

  const xml = await readScoreXml(piece.mxlPath)
  const timingMap = parseMusicXml(xml, basename(piece.mxlPath))
  const midi = await midiDiagnostics(piece.midiPath, timingMap)
  const rendered = await renderRawPdfPages(piece.pdfPath)
  const result = await analyzeSemiAutoScoreSetup({
    pdfSource: piece.pdfPath,
    numPages: rendered.numPages,
    timingMap,
    renderPage: makeRenderPageCallback(rendered),
  })
  if (!result.ok) {
    return {
      ...piece,
      ok: false,
      error: result.message ?? 'analysis failed',
    }
  }

  const preview = result.preview
  const anchors = mergeAutomaticAnchors([
    preview.proposedAnchors ?? [],
    preview.supplementalMeasureAnchors ?? [],
  ])
  const trustedAnchors = filterTrustedAnchors(anchors)
  const geometry = buildCalibrationGeometry(preview.systemEntries, preview.spans, timingMap)
  const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors })
  const systems = summarizeSystems({
    preview,
    geometry,
    anchors: preview.supplementalMeasureAnchors ?? [],
  })
  const sampleMeasures = selectTextSampleMeasures({ timingMap, systems, explicitTime })
  const selectedSamples = sampleMeasures
    .map((measureNumber) => timeForMeasure(timingMap, measureNumber))
    .filter((time) => Number.isFinite(time))
    .map((time) => runtimeCursorAt({
      timingMap,
      anchors,
      autoSetupReport: preview.debugReport,
      motionTimeline,
      time,
    }))
    .map((sample) => ({
      ...sample,
      midiPlaybackMeasure: nearestMidiPlaybackMeasure(midi.playbackNoteEvents, sample.time),
      rawMidiMeasureAtSameSeconds: rawMidiMeasureAtSameSeconds(midi.rawMidiNotes, sample.time),
    }))
  const allMeasureSamples = (timingMap.measures ?? [])
    .map((measure) => timeForMeasure(timingMap, measure.number))
    .filter((time) => Number.isFinite(time))
    .map((time) => runtimeCursorAt({
      timingMap,
      anchors,
      autoSetupReport: preview.debugReport,
      motionTimeline,
      time,
    }))
    .map((sample) => ({
      ...sample,
      midiPlaybackMeasure: nearestMidiPlaybackMeasure(midi.playbackNoteEvents, sample.time),
      rawMidiMeasureAtSameSeconds: rawMidiMeasureAtSameSeconds(midi.rawMidiNotes, sample.time),
    }))

  return {
    id: piece.id,
    label: piece.label,
    ok: true,
    pdfPath: piece.pdfPath,
    mxlPath: piece.mxlPath,
    midiPath: piece.midiPath,
    pdf: {
      numPages: rendered.numPages,
      renderPolicy: rendered.renderPolicy,
      pages: rendered.pageMeta,
    },
    timing: timingSummary(timingMap),
    midi: midi.available
      ? {
          available: true,
          path: midi.path,
          durationSeconds: midi.durationSeconds,
          noteCount: midi.noteCount,
          tracks: midi.tracks,
          tempoCount: midi.tempoCount,
          tempos: midi.tempos,
          alignment: midi.alignment,
          measureGrid: midi.measureGrid,
          playbackSchedule: midi.playbackSchedule,
        }
      : midi,
    calibration: {
      stage: preview.stage,
      allocationMode: preview.allocationMode,
      confidence: round(preview.confidence, 4),
      lowConfidence: Boolean(preview.lowConfidence),
      plausible: Boolean(preview.plausible),
      precise: Boolean(preview.precise),
      approximate: Boolean(preview.approximate),
      detectedSystemCount: preview.systemCount,
      expectedSystemCount: preview.expectedSystemCount ?? null,
      systemCountHint: preview.systemCountHint ?? null,
      systemsPerPage: systemsPerPage(systems),
      layoutMismatch: preview.layoutMismatch ?? null,
      orientation: preview.orientation ?? null,
      smartCalibration: preview.smartCalibration
        ? {
            chosenStrategy: preview.smartCalibration.chosenStrategy,
            chosenStrategyLabel: preview.smartCalibration.chosenStrategyLabel,
            overallConfidence: round(preview.smartCalibration.overallConfidence, 4),
            baselineConfidence: round(preview.smartCalibration.baselineConfidence, 4),
            improvedOverBaseline: Boolean(preview.smartCalibration.improvedOverBaseline),
            strategyScores: preview.smartCalibration.strategyScores?.map((score) => ({
              strategy: score.strategy,
              overall: round(score.overall, 4),
            })) ?? [],
            strategySelectionNote: preview.smartCalibration.strategySelectionNote ?? null,
          }
        : null,
      anchorSourceCounts: preview.debugReport?.anchorSourceCounts ?? null,
      xSourceCounts: groupCounts((preview.supplementalMeasureAnchors ?? []).map((anchor) => anchor.meta?.xSource ?? 'unknown')),
    },
    systems,
    suspectSystems: systems.filter((system) => system.suspect),
    runtime: {
      explicitTime: Number.isFinite(explicitTime) ? explicitTime : null,
      selectedSamples,
      allMeasureSamples,
    },
  }
}

function comparePieces(pieces) {
  const [a, b] = pieces
  if (!a?.ok || !b?.ok) {
    return null
  }
  return {
    measureCountDelta: b.timing.measureCount - a.timing.measureCount,
    systemCountDelta:
      b.calibration.detectedSystemCount - a.calibration.detectedSystemCount,
    suspectSystemCountDelta: b.suspectSystems.length - a.suspectSystems.length,
    allocationModes: Object.fromEntries(pieces.map((piece) => [piece.id, piece.calibration.allocationMode])),
    chosenStrategies: Object.fromEntries(
      pieces.map((piece) => [piece.id, piece.calibration.smartCalibration?.chosenStrategy ?? null]),
    ),
    repeatsLikely: Object.fromEntries(pieces.map((piece) => [piece.id, piece.timing.repeatsLikely])),
    pickupLikely: Object.fromEntries(
      pieces.map((piece) => [piece.id, piece.timing.firstMeasure?.pickupLikely ?? null]),
    ),
    midiAlignment: Object.fromEntries(
      pieces.map((piece) => [piece.id, piece.midi?.alignment?.assessment ?? null]),
    ),
    midiDurationDeltaSeconds: Object.fromEntries(
      pieces.map((piece) => [piece.id, piece.midi?.alignment?.durationDeltaSeconds ?? null]),
    ),
  }
}

function formatSystemLine(system) {
  const box = system.firstMeasureBox
  const boxText = box ? `${box.x0}-${box.x1}` : 'n/a'
  const suspect = system.suspect ? ' !' : ''
  return [
    `p${system.page}s${system.index}`,
    `m${system.measureStart}-${system.measureEnd}`,
    `count=${system.measureCount}`,
    `bars=${system.barlineCount}/${system.expectedBarlineCount}`,
    `y=${system.y0}-${system.y1}`,
    `box=${boxText}`,
    `xsrc=${system.firstXSource ?? 'n/a'}`,
    suspect,
  ].join(' ')
}

function formatSampleLine(sample) {
  const box = sample.measureBoundingBox
  const boxText = box ? `${box.x0}-${box.x1}@${box.y0}-${box.y1}` : 'n/a'
  const midiText = sample.midiPlaybackMeasure
    ? `midiMapped=${sample.midiPlaybackMeasure.measureNumber}@${sample.midiPlaybackMeasure.deltaSeconds}`
    : 'midiMapped=n/a'
  return [
    `t=${sample.time}`,
    `m=${sample.measureNumber}`,
    `idx=${sample.measureIndex}`,
    `p=${sample.pageNumber}`,
    `sys=${sample.systemIndex}`,
    `cursor=${sample.cursorX},${sample.cursorY}`,
    `box=${boxText}`,
    `interp=${sample.interpolationSource}`,
    `tier=${sample.fallbackTier}`,
    `schema=${sample.anchorSchemaVersion ?? 'n/a'}`,
    `xsrc=${sample.xSource ?? 'n/a'}`,
    midiText,
  ].join(' ')
}

function formatTextReport(report) {
  const lines = []
  lines.push('Corranzo per-piece calibration comparison')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Render policy: ${report.renderPolicy}`)
  lines.push('')

  for (const piece of report.pieces) {
    lines.push(`== ${piece.label} ==`)
    if (!piece.ok) {
      lines.push(`ERROR: ${piece.error}`)
      lines.push('')
      continue
    }
    lines.push(
      [
        `measures=${piece.timing.measureCount}`,
        `systems=${piece.calibration.detectedSystemCount}`,
        `pages=${piece.pdf.numPages}`,
        `systems/page=${JSON.stringify(piece.calibration.systemsPerPage)}`,
        `allocation=${piece.calibration.allocationMode}`,
        `strategy=${piece.calibration.smartCalibration?.chosenStrategy ?? 'n/a'}`,
        `confidence=${piece.calibration.confidence}`,
      ].join(' '),
    )
    lines.push(
      [
        `pickupLikely=${piece.timing.firstMeasure?.pickupLikely ?? false}`,
        `repeatsLikely=${piece.timing.repeatsLikely}`,
        `tempoChanges=${piece.timing.tempoChangeCount}`,
        `midiAlign=${piece.midi?.alignment?.assessment ?? 'n/a'}`,
        `midiDelta=${piece.midi?.alignment?.durationDeltaSeconds ?? 'n/a'}`,
        `fallbackSources=${JSON.stringify(piece.calibration.xSourceCounts)}`,
      ].join(' '),
    )
    lines.push(`layoutMismatch=${piece.calibration.layoutMismatch?.mismatch ?? false}`)
    lines.push(`suspect systems: ${piece.suspectSystems.length}`)
    for (const system of piece.suspectSystems.slice(0, 12)) {
      lines.push(`  ${formatSystemLine(system)}`)
    }
    if (piece.suspectSystems.length > 12) {
      lines.push(`  ... ${piece.suspectSystems.length - 12} more`)
    }
    lines.push('runtime samples:')
    for (const sample of piece.runtime.selectedSamples.slice(0, 24)) {
      lines.push(`  ${formatSampleLine(sample)}`)
    }
    if (piece.runtime.selectedSamples.length > 24) {
      lines.push(`  ... ${piece.runtime.selectedSamples.length - 24} more`)
    }
    lines.push('')
  }

  if (report.comparison) {
    lines.push('== Difference ==')
    lines.push(JSON.stringify(report.comparison, null, 2))
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2)
  const jsonOut = argValue(args, '--json')
  const textOut = argValue(args, '--text')
  const explicitTimeValue = argValue(args, '--time')
  const explicitTime = explicitTimeValue == null ? null : Number(explicitTimeValue)
  if (explicitTimeValue != null && !Number.isFinite(explicitTime)) {
    throw new Error(`Invalid --time value: ${explicitTimeValue}`)
  }

  const pieces = []
  for (const piece of DEFAULT_PIECES) {
    pieces.push(await analyzePiece(piece, { explicitTime }))
  }

  const report = {
    generatedAt: new Date().toISOString(),
    renderPolicy: `analysis width ${ANALYSIS_WIDTH}, raw PDF pixels, rotation=0`,
    pieces,
    comparison: comparePieces(pieces),
  }

  const text = formatTextReport(report)
  if (!hasFlag(args, '--quiet')) {
    process.stdout.write(text)
  }
  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true })
    writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (textOut) {
    mkdirSync(dirname(textOut), { recursive: true })
    writeFileSync(textOut, text)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

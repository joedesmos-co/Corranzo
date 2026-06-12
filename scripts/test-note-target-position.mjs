/**
 * QA checks for Wait For You note-target positioning.
 * Run: node scripts/test-note-target-position.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints, CHECKPOINT_KIND } from '../src/features/practice/waitForYouCheckpoints.js'
import {
  resolveNoteTargetPosition,
  NOTE_TARGET_SOURCE,
} from '../src/features/practice/noteTargetPosition.js'
import { buildMeasureAnchorGeometry } from '../src/features/practice/noteTargetContext.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function makeTimingMap(notes, measures) {
  return {
    measures,
    notes,
    beats: [],
  }
}

function anchor(measureNumber, page, x, y, meta = {}) {
  return {
    id: `a-${measureNumber}`,
    measureNumber,
    page,
    x,
    y,
    source: 'manual',
    meta,
  }
}

// --- measure bracket geometry ---
const anchors = [anchor(1, 1, 0.12, 0.3), anchor(3, 1, 0.58, 0.3)]
const measures = [
  { number: 1, startTimeSeconds: 0, durationSeconds: 2 },
  { number: 2, startTimeSeconds: 2, durationSeconds: 2 },
  { number: 3, startTimeSeconds: 4, durationSeconds: 2 },
]
const timingMap = makeTimingMap([], measures)

const geo2 = buildMeasureAnchorGeometry(anchors, timingMap, 2)
assert(geo2.placement === 'measure-bracket', 'measure 2 should use bracket placement')
assert(geo2.xMeasureStart >= 0.3 && geo2.xMeasureEnd <= 0.58, 'measure 2 x band between anchors')
assert(geo2.page === 1, 'measure 2 on page 1')

const geoExact = buildMeasureAnchorGeometry([anchor(2, 1, 0.35, 0.3)], timingMap, 2)
assert(geoExact.placement === 'exact-anchor', 'tap on measure uses exact anchor')

// --- staff split ---
const checkpoint = {
  kind: CHECKPOINT_KIND.NOTE,
  measureNumber: 1,
  timeSeconds: 0,
  isChord: false,
  notes: [
    {
      measureNumber: 1,
      timeSeconds: 0,
      midi: 60,
      isRest: false,
      staff: 1,
      defaultX: 40,
      defaultY: -10,
    },
  ],
}
const systemAnchors = [
  {
    id: 's1',
    measureNumber: 1,
    page: 1,
    x: 0.1,
    y: 0.4,
    source: 'auto',
    meta: { role: 'system-start', systemIndex: 0, measuresInSpan: 2 },
  },
  {
    id: 's1e',
    measureNumber: 2,
    page: 1,
    x: 0.7,
    y: 0.4,
    source: 'auto',
    meta: { role: 'system-end', systemIndex: 0, measuresInSpan: 2 },
  },
]
const notesTiming = makeTimingMap(
  [
    {
      measureNumber: 1,
      timeSeconds: 0,
      midi: 60,
      staff: 1,
      defaultX: 40,
      defaultY: -10,
      isRest: false,
    },
    {
      measureNumber: 1,
      timeSeconds: 0,
      midi: 36,
      staff: 2,
      defaultX: 40,
      defaultY: 10,
      isRest: false,
    },
  ],
  measures.slice(0, 2),
)

const treble = resolveNoteTargetPosition({
  checkpoint: {
    ...checkpoint,
    notes: [notesTiming.notes[0]],
  },
  timingMap: notesTiming,
  anchors: systemAnchors,
})
const bass = resolveNoteTargetPosition({
  checkpoint: {
    ...checkpoint,
    notes: [notesTiming.notes[1]],
  },
  timingMap: notesTiming,
  anchors: systemAnchors,
})

assert(treble.visible && bass.visible, 'staff targets visible')
assert(treble.y < bass.y, 'staff 1 should be above staff 2 on page')

// --- chord centroid ---
const chordCheckpoint = {
  kind: CHECKPOINT_KIND.NOTE,
  measureNumber: 1,
  timeSeconds: 0,
  isChord: true,
  notes: notesTiming.notes,
}
const chordTarget = resolveNoteTargetPosition({
  checkpoint: chordCheckpoint,
  timingMap: notesTiming,
  anchors: systemAnchors,
})
assert(chordTarget.isChord, 'chord flag')
assert(chordTarget.y > treble.y && chordTarget.y < bass.y, 'chord y between staves')

// --- page inference ---
const page2Anchor = [
  anchor(5, 2, 0.2, 0.5, { role: 'system-start', systemIndex: 1, measuresInSpan: 2 }),
  anchor(6, 2, 0.8, 0.5, { role: 'system-end', systemIndex: 1, measuresInSpan: 2 }),
]
const multiPageMeasures = [
  { number: 1, startTimeSeconds: 0, systemBreakBefore: false },
  { number: 5, startTimeSeconds: 8, systemBreakBefore: true },
  { number: 6, startTimeSeconds: 10, systemBreakBefore: false },
].map((m, i) => ({
  ...m,
  durationSeconds: 2,
  startTimeSeconds: m.startTimeSeconds ?? i * 2,
}))

const pageTarget = resolveNoteTargetPosition({
  checkpoint: {
    kind: CHECKPOINT_KIND.NOTE,
    measureNumber: 5,
    timeSeconds: 8,
    isChord: false,
    notes: [{ measureNumber: 5, timeSeconds: 8, midi: 64, isRest: false }],
  },
  timingMap: makeTimingMap([], multiPageMeasures),
  anchors: [...anchors, ...page2Anchor],
})

assert(pageTarget.page === 2, 'system break should map measure 5 to page 2')

// --- parse real fixture ---
const xmlPath = join(__dirname, '../tests/fixtures/sample.musicxml')
const xml = readFileSync(xmlPath, 'utf8')
const parsed = parseMusicXml(xml)
const noteCheckpoints = buildNoteCheckpoints(parsed, null)
assert(noteCheckpoints.length >= 4, 'sample has note checkpoints')
const first = noteCheckpoints[0]
assert(first.notes?.length >= 1, 'checkpoint carries notes')

const sampleTarget = resolveNoteTargetPosition({
  checkpoint: first,
  timingMap: parsed,
  anchors: [anchor(1, 1, 0.15, 0.35), anchor(2, 1, 0.5, 0.35)],
})
assert(sampleTarget.visible, 'sample resolves with anchors')
assert(
  sampleTarget.source === NOTE_TARGET_SOURCE.MEASURE_BEAT ||
    sampleTarget.source === NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC,
  'sample without layout uses beat/heuristic',
)

console.log('note-target-position: all checks passed')

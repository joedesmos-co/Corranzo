#!/usr/bin/env node
/**
 * Score saved neural-model notes through the PRODUCTION pipeline stages
 * (stream filters + hybrid confirmation) — node-only, deterministic, fast.
 *
 * Input: JSON from benchmark-neural-corpus.mjs --save-notes (per-clip,
 * per-window raw model notes). Applies the same rules as the live hook:
 * edge suppression, short-note drop, cross-window dedup, octave-ghost
 * filter, chord grouping, then confirmNeuralNotes against TRUE and WRONG
 * expectations (wrong-note false-award scenarios).
 *
 * Usage:
 *   node scripts/score-neural-notes.mjs --notes /tmp/neural-notes.json
 *     [--edge 80] [--octave-ratio 0.7] [--tolerance 50]
 */
import { readFileSync } from 'node:fs'
import {
  createNeuralStreamState,
  emitNeuralStreamNotes,
  drainNeuralStreamEvents,
  getNeuralStreamSustained,
} from '../src/features/microphone-input/micNeuralStream.js'
import { confirmNeuralNotes } from '../src/features/practice/micNeuralHybrid.js'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const NOTES_PATH = arg('notes', null)
const EDGE_MS = Number(arg('edge', '80'))
const OCTAVE_RATIO = Number(arg('octave-ratio', '0.7'))
const TOLERANCE = Number(arg('tolerance', '50'))
const WINDOW_SECONDS = Number(arg('window', '0.5'))

if (!NOTES_PATH) {
  console.error('usage: score-neural-notes.mjs --notes <path> [--edge 80] [--octave-ratio 0.7] [--tolerance 50]')
  process.exit(1)
}

const { clips } = JSON.parse(readFileSync(NOTES_PATH, 'utf8'))

function wrongExpectations(expected) {
  const scenarios = []
  for (const midi of expected) {
    scenarios.push({ name: `neighbor+1-of-${midi}`, expected: expected.map((value) => (value === midi ? value + 1 : value)) })
    scenarios.push({ name: `neighbor-1-of-${midi}`, expected: expected.map((value) => (value === midi ? value - 1 : value)) })
    scenarios.push({ name: `octave-up-of-${midi}`, expected: expected.map((value) => (value === midi ? value + 12 : value)) })
  }
  if (expected.length > 1) {
    const rotated = [...expected.slice(1), expected[0] + 12 > 127 ? expected[0] : expected[0]]
    scenarios.push({ name: 'wrong-chord-same-count', expected: expected.map((value) => value + 2) })
    void rotated
  } else {
    scenarios.push({ name: 'wrong-single-plus-2', expected: expected.map((value) => value + 2) })
  }
  return scenarios
}

const report = []
for (const clip of clips) {
  const state = createNeuralStreamState({
    windowSeconds: WINDOW_SECONDS,
    hopSeconds: 0.25,
    edgeSuppressMs: EDGE_MS,
    octaveOverlapRatio: OCTAVE_RATIO,
  })
  const windowMs = WINDOW_SECONDS * 1000
  const pool = new Map()
  // Stream windows in time order (clip-relative ms + 1000 lead offset).
  const windows = [...clip.windows].sort((a, b) => a.windowStartMs - b.windowStartMs)
  for (const window of windows) {
    emitNeuralStreamNotes(state, window.notes.map((note) => ({
      midi: Math.round(note.midi),
      startOffsetSeconds: note.start,
      endOffsetSeconds: note.end,
    })), window.windowStartMs)
    for (const attack of drainNeuralStreamEvents(state)) {
      pool.set(`${attack.midi}@${Math.round(attack.onsetCaptureMs)}`, {
        midi: attack.midi,
        start: attack.onsetCaptureMs / 1000,
        end: attack.endCaptureMs / 1000,
        sustained: false,
      })
    }
  }
  for (const sustained of getNeuralStreamSustained(state)) {
    const key = `${sustained.midi}@${Math.round(sustained.onsetMs)}`
    if (!pool.has(key)) {
      pool.set(key, { midi: sustained.midi, start: sustained.onsetMs / 1000, end: sustained.onsetMs / 1000 + 1, sustained: true })
    }
  }
  const poolNotes = [...pool.values()]
  // Anchor = last heard attack + 0.1 s: models a checkpoint that is still
  // open (Wait For You waits indefinitely). A fixed early anchor would
  // understate live behavior for late-emerging fundamentals (weak bass
  // detected on the ring, not the attack) — and it would HIDE late-ghost
  // false confirmations. This anchor exposes both honestly.
  const anchor = poolNotes.reduce((max, note) => Math.max(max, note.start), 0) + 0.1
  // Live confirmation windows (useNeuralMicInput): 4 s pool retention.
  const CONFIRM_OPTS = { centsTolerance: TOLERANCE, windowBeforeSeconds: 4.0, windowAfterSeconds: 0.5 }
  const trueVerdict = confirmNeuralNotes(poolNotes, clip.expected, anchor, CONFIRM_OPTS)
  const falseCompletes = []
  const scenarios = wrongExpectations(clip.expected)
  for (const scenario of scenarios) {
    const verdict = confirmNeuralNotes(poolNotes, scenario.expected, anchor, CONFIRM_OPTS)
    if (verdict.complete) {
      falseCompletes.push(scenario.name)
    }
  }
  report.push({
    id: clip.id,
    instrument: clip.instrument,
    split: clip.split,
    trueComplete: trueVerdict.complete,
    trueConfirmed: trueVerdict.confirmedMidis,
    trueMissing: trueVerdict.missingMidis,
    unexpected: trueVerdict.unexpectedMidis,
    falseCompletes,
    scenarioCount: scenarios.length,
  })
  console.log(
    `${clip.id} true=${trueVerdict.complete ? 'COMPLETE' : `missing[${trueVerdict.missingMidis.join(',')}]`} ` +
    `unexpected=[${trueVerdict.unexpectedMidis.join(',') || '—'}] falseCompletes=[${falseCompletes.join(',') || '—'}]`,
  )
}

const complete = report.filter((row) => row.trueComplete).length
const falseTotal = report.reduce((sum, row) => sum + row.falseCompletes.length, 0)
const scenarios = report.reduce((sum, row) => sum + row.scenarioCount, 0)
console.log(JSON.stringify({
  config: { edgeMs: EDGE_MS, octaveRatio: OCTAVE_RATIO, tolerance: TOLERANCE, window: WINDOW_SECONDS },
  clips: report.length,
  trueCompleteRate: complete / report.length,
  falseCompletes: falseTotal,
  scenarios,
}, null, 1))

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

function wrongExpectations(expected, truthMidis = null) {
  const truth = truthMidis ? new Set(truthMidis) : null
  // A scenario is only meaningful when its MUTATED pitches never sound
  // in the clip: otherwise a "false" complete is just the piece's own
  // true notes matching (dense performances contain dozens of pitches).
  // Scenarios colliding with truth are skipped, never counted.
  const scenarios = []
  const consider = (name, mutated) => {
    if (truth && mutated.some((midi) => truth.has(midi))) {
      return
    }
    scenarios.push({ name, expected: mutated })
  }
  for (const midi of expected) {
    consider(`neighbor+1-of-${midi}`, expected.map((value) => (value === midi ? value + 1 : value)))
    consider(`neighbor-1-of-${midi}`, expected.map((value) => (value === midi ? value - 1 : value)))
    consider(`octave-up-of-${midi}`, expected.map((value) => (value === midi ? value + 12 : value)))
  }
  if (expected.length > 1) {
    consider('wrong-chord-same-count', expected.map((value) => value + 2))
  } else {
    consider('wrong-single-plus-2', expected.map((value) => value + 2))
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
  // Anytime completion (live-faithful): Wait For You advances at the
  // FIRST window-time the pool completes — never at end-of-clip. A fixed
  // late anchor understates live behavior for early attacks (pool aging
  // drops them) and mis-times false completions. Evaluate at every
  // window time; report earliest completion (or never).
  const windowTimes = [...new Set(windows.map((window) => window.windowStartMs / 1000))].sort((a, b) => a - b)
  // Live confirmation windows (useNeuralMicInput): 4 s pool retention.
  const CONFIRM_OPTS = { centsTolerance: TOLERANCE, windowBeforeSeconds: 4.0, windowAfterSeconds: 0.5 }
  let trueCompleteAt = null
  let trueVerdict = null
  for (const anchor of windowTimes) {
    const verdict = confirmNeuralNotes(poolNotes, clip.expected, anchor, CONFIRM_OPTS)
    if (verdict.complete) {
      trueCompleteAt = anchor
      trueVerdict = verdict
      break
    }
    trueVerdict = verdict
  }
  // For dense performances, "unexpected" means absent from the whole
  // piece truth — not merely absent from the anchor set (other true
  // notes are evidence, not hallucinations).
  const truthSet = clip.truthMidis ? new Set(clip.truthMidis) : null
  const unexpected = truthSet
    ? [...new Set(trueVerdict.unexpectedMidis.filter((midi) => !truthSet.has(midi)))]
    : trueVerdict.unexpectedMidis
  const falseCompletes = []
  const scenarios = wrongExpectations(clip.expected, clip.truthMidis ?? null)
  for (const scenario of scenarios) {
    let completedAt = null
    for (const anchor of windowTimes) {
      const verdict = confirmNeuralNotes(poolNotes, scenario.expected, anchor, CONFIRM_OPTS)
      if (verdict.complete) {
        completedAt = anchor
        break
      }
    }
    if (completedAt !== null) {
      falseCompletes.push(`${scenario.name}@${completedAt.toFixed(2)}`)
    }
  }
  report.push({
    id: clip.id,
    instrument: clip.instrument,
    split: clip.split,
    trueComplete: trueVerdict.complete,
    trueCompleteAt,
    trueConfirmed: trueVerdict.confirmedMidis,
    trueMissing: trueVerdict.missingMidis,
    unexpected,
    vetoed: trueVerdict.vetoed ?? [],
    falseCompletes,
    scenarioCount: scenarios.length,
  })
  console.log(
    `${clip.id} true=${trueVerdict.complete ? `COMPLETE@${trueCompleteAt.toFixed(2)}` : `missing[${trueVerdict.missingMidis.join(',')}]`} ` +
    `unexpected=[${unexpected.join(',') || '—'}] vetoed=[${(trueVerdict.vetoed ?? []).map((v) => v.midi).join(',') || '—'}] falseCompletes=[${falseCompletes.join(',') || '—'}]`,
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

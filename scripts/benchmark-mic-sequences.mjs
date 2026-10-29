#!/usr/bin/env node
/**
 * Multi-checkpoint production microphone benchmark (real Chromium, real
 * capture code, real production hook).
 *
 * Unlike benchmark-production-corpus.mjs (one checkpoint per clip), this
 * replays a scheduled SEQUENCE of checkpoints against a continuous audio
 * stream. It is the harness for the behaviours a single-event benchmark
 * cannot observe:
 *
 *   - a sustained note/chord must not consume the next checkpoint
 *   - repeated identical notes/chords need a fresh attack and must still land
 *   - a wrong note must not leave the checkpoint permanently deaf
 *   - a missed note/pause must not poison the next event
 *   - fast passages and rolled chords must advance in order
 *
 * Usage:
 *   node scripts/benchmark-mic-sequences.mjs
 *   node scripts/benchmark-mic-sequences.mjs --scenario repeat --json out.json
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSequenceAudio, loadClip } from './lib/micSequenceAudio.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SETTLE_MS = 20_000

function arg(name, fallback = null) {
  const prefix = `--${name}`
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === prefix) return process.argv[i + 1] ?? fallback
    if (process.argv[i].startsWith(`${prefix}=`)) return process.argv[i].slice(prefix.length + 1)
  }
  return fallback
}

const JSON_OUT = arg('json', null)
const V3_OFF = arg('v3', '1') === '0'
const FILTERS = (arg('scenario', null) ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

const REAL = 'benchmarks/mic-real/clips'
const POLY = 'benchmarks/mic-polyphony/clips'
const ACC = 'benchmarks/mic-accuracy/clips'
const COMP = 'benchmarks/mic-composites/clips'

const clipCache = new Map()
function clip(relativePath, options = {}) {
  const key = `${relativePath}:${JSON.stringify(options)}`
  if (!clipCache.has(key)) {
    clipCache.set(key, loadClip(join(ROOT, relativePath), options))
  }
  return clipCache.get(key)
}

function step(id, {
  onsetMs,
  expectedMidis,
  expectAdvance,
  instrument,
  deadlineMs = 900,
  label = '',
}) {
  return {
    id,
    label,
    onsetMs: Math.round(onsetMs),
    expectedMidis,
    expectAdvance,
    instrument,
    deadlineMs,
    rollingWindowMs: expectedMidis.length > 1
      ? (instrument === 'guitar' ? 900 : 720)
      : undefined,
  }
}

function build(placements, steps, { preludeSeconds = 4, tailSeconds = 1.5 } = {}) {
  const segments = placements.map((placement) => ({
    samples: placement.clip.samples,
    sampleRate: placement.clip.sampleRate,
    startMs: placement.startMs,
    gain: placement.gain ?? 1,
  }))
  const audio = buildSequenceAudio({ segments, preludeSeconds, tailSeconds })
  return { audio, steps }
}

/**
 * Scenario recipes. Provenance is explicit:
 *  - `natural` = mic-real (independent JAMS/MIDI annotations, CC-BY-4.0)
 *  - `composite` = mic-composites / uiowa polyphony (construction truth, not
 *    natural polyphony; used for one-attack lifecycle controls)
 */
const SCENARIOS = [
  {
    id: 'piano-single-repeat-gap',
    kind: 'natural-single-lifecycle',
    instrument: 'piano',
    notes: 'Real piano C4 isolated fixture, three attacks with a gap; the fourth step holds during the tail.',
    build() {
      const source = clip(`${ACC}/real-piano-c4.wav`, { durationSeconds: 0.9 })
      const onsets = [0.12, 1.32, 2.52]
      return build(
        onsets.map((onset, index) => ({ clip: source, startMs: (onset - 0.12) * 1000 + index * 0 })),
        [
          ...onsets.map((onset, index) => step(`piano-single-${index + 1}`, {
            onsetMs: onset * 1000,
            expectedMidis: [60],
            expectAdvance: true,
            instrument: 'piano',
            deadlineMs: 800,
          })),
          step('piano-single-tail-hold', {
            onsetMs: 3.5 * 1000,
            expectedMidis: [60],
            expectAdvance: false,
            instrument: 'piano',
            deadlineMs: 800,
          }),
        ],
      )
    },
  },
  {
    id: 'guitar-single-repeat-gap',
    kind: 'natural-single-lifecycle',
    instrument: 'guitar',
    notes: 'Real guitar G3 isolated fixture, three attacks; no new attack during the final hold.',
    build() {
      const source = clip(`${ACC}/real-guitar-g3.wav`, { durationSeconds: 0.9 })
      const onsets = [0.1, 1.3, 2.5]
      return build(
        onsets.map((onset) => ({ clip: source, startMs: (onset - 0.1) * 1000 })),
        [
          ...onsets.map((onset, index) => step(`guitar-single-${index + 1}`, {
            onsetMs: onset * 1000,
            expectedMidis: [55],
            expectAdvance: true,
            instrument: 'guitar',
            deadlineMs: 800,
          })),
          step('guitar-single-tail-hold', {
            onsetMs: 3.45 * 1000,
            expectedMidis: [55],
            expectAdvance: false,
            instrument: 'guitar',
            deadlineMs: 800,
          }),
        ],
      )
    },
  },
  {
    id: 'piano-fast-c4-e4-c4',
    kind: 'natural-single-fast',
    instrument: 'piano',
    notes: 'Fast passage from isolated real piano notes (C4, E4, C4 at 350 ms spacing).',
    build() {
      const c4 = clip(`${ACC}/real-piano-c4.wav`, { durationSeconds: 0.6 })
      const e4 = clip(`${ACC}/real-piano-e4.wav`, { durationSeconds: 0.6 })
      return build(
        [
          { clip: c4, startMs: 0 },
          { clip: e4, startMs: 350 },
          { clip: c4, startMs: 700 },
        ],
        [
          step('fast-c4', { onsetMs: 120, expectedMidis: [60], expectAdvance: true, instrument: 'piano', deadlineMs: 340 }),
          step('fast-e4', { onsetMs: 470, expectedMidis: [64], expectAdvance: true, instrument: 'piano', deadlineMs: 340 }),
          step('fast-c4-return', { onsetMs: 820, expectedMidis: [60], expectAdvance: true, instrument: 'piano', deadlineMs: 340 }),
        ],
      )
    },
  },
  {
    id: 'guitar-fast-g3-g3',
    kind: 'natural-single-fast',
    instrument: 'guitar',
    notes: 'Two real guitar G3 attacks 400 ms apart (same note retrigger).',
    build() {
      const g3 = clip(`${ACC}/real-guitar-g3.wav`, { durationSeconds: 0.7 })
      return build(
        [
          { clip: g3, startMs: 0 },
          { clip: g3, startMs: 400 },
        ],
        [
          step('fast-g3-1', { onsetMs: 100, expectedMidis: [55], expectAdvance: true, instrument: 'guitar', deadlineMs: 380 }),
          step('fast-g3-2', { onsetMs: 500, expectedMidis: [55], expectAdvance: true, instrument: 'guitar', deadlineMs: 380 }),
        ],
      )
    },
  },
  {
    id: 'piano-chord-sustain-no-skip',
    kind: 'composite-chord-lifecycle',
    instrument: 'piano',
    notes: 'One C-major triad attack (real piano samples mixed by construction); subsequent checkpoints hold during the ring.',
    build() {
      const source = clip(`${POLY}/uiowa-piano-mf-c-major-triad.wav`)
      return build(
        [{ clip: source, startMs: 0 }],
        [
          step('piano-chord-attack', { onsetMs: 120, expectedMidis: [60, 64, 67], expectAdvance: true, instrument: 'piano', deadlineMs: 1000 }),
          step('piano-chord-sustain-1', { onsetMs: 900, expectedMidis: [60, 64, 67], expectAdvance: false, instrument: 'piano', deadlineMs: 700 }),
          step('piano-chord-sustain-2', { onsetMs: 1600, expectedMidis: [60, 64, 67], expectAdvance: false, instrument: 'piano', deadlineMs: 500 }),
        ],
      )
    },
  },
  {
    id: 'piano-chord-repeat',
    kind: 'composite-chord-lifecycle',
    instrument: 'piano',
    notes: 'The same C-major triad attacked twice with a short gap, then a hold.',
    build() {
      const source = clip(`${POLY}/uiowa-piano-mf-c-major-triad.wav`, { durationSeconds: 1.8 })
      return build(
        [
          { clip: source, startMs: 0, gain: 0.9 },
          { clip: source, startMs: 2200, gain: 0.9 },
        ],
        [
          step('piano-chord-repeat-1', { onsetMs: 120, expectedMidis: [60, 64, 67], expectAdvance: true, instrument: 'piano', deadlineMs: 1000 }),
          step('piano-chord-repeat-2', { onsetMs: 2320, expectedMidis: [60, 64, 67], expectAdvance: true, instrument: 'piano', deadlineMs: 1000 }),
          step('piano-chord-repeat-hold', { onsetMs: 3500, expectedMidis: [60, 64, 67], expectAdvance: false, instrument: 'piano', deadlineMs: 600 }),
        ],
      )
    },
  },
  {
    id: 'guitar-open-em-sustain',
    kind: 'composite-chord-lifecycle',
    instrument: 'guitar',
    notes: 'One open-Em strum (six-string composite) with the real open-string shape; following checkpoint holds during the ring.',
    build() {
      const source = clip(`${POLY}/uiowa-guitar-mf-open-em-strum.wav`)
      const em = [
        { midi: 40, string: 6, fret: 0 },
        { midi: 45, string: 5, fret: 2 },
        { midi: 50, string: 4, fret: 2 },
        { midi: 55, string: 3, fret: 0 },
        { midi: 59, string: 2, fret: 0 },
        { midi: 64, string: 1, fret: 0 },
      ]
      return build(
        [{ clip: source, startMs: 0 }],
        [
          step('guitar-em-attack', { onsetMs: 120, expectedMidis: [40, 45, 50, 55, 59, 64], expectAdvance: true, instrument: 'guitar', deadlineMs: 1400, stringFrets: em }),
          step('guitar-em-sustain', { onsetMs: 1200, expectedMidis: [40, 45, 50, 55, 59, 64], expectAdvance: false, instrument: 'guitar', deadlineMs: 700, stringFrets: em }),
        ],
      )
    },
  },
  {
    id: 'guitar-open-em-repeat',
    kind: 'composite-chord-lifecycle',
    instrument: 'guitar',
    notes: 'The open-Em strum attacked twice with a gap, then a hold (real shape metadata).',
    build() {
      const source = clip(`${POLY}/uiowa-guitar-mf-open-em-strum.wav`, { durationSeconds: 1.9 })
      const em = [
        { midi: 40, string: 6, fret: 0 },
        { midi: 45, string: 5, fret: 2 },
        { midi: 50, string: 4, fret: 2 },
        { midi: 55, string: 3, fret: 0 },
        { midi: 59, string: 2, fret: 0 },
        { midi: 64, string: 1, fret: 0 },
      ]
      return build(
        [
          { clip: source, startMs: 0, gain: 0.9 },
          { clip: source, startMs: 2400, gain: 0.9 },
        ],
        [
          step('guitar-em-repeat-1', { onsetMs: 120, expectedMidis: [40, 45, 50, 55, 59, 64], expectAdvance: true, instrument: 'guitar', deadlineMs: 1400, stringFrets: em }),
          step('guitar-em-repeat-2', { onsetMs: 2520, expectedMidis: [40, 45, 50, 55, 59, 64], expectAdvance: true, instrument: 'guitar', deadlineMs: 1400, stringFrets: em }),
          step('guitar-em-repeat-hold', { onsetMs: 4000, expectedMidis: [40, 45, 50, 55, 59, 64], expectAdvance: false, instrument: 'guitar', deadlineMs: 600, stringFrets: em }),
        ],
      )
    },
  },
  {
    id: 'piano-triad-natural-repeats',
    kind: 'natural-chord-sequence',
    instrument: 'piano',
    notes: 'Vienna Mozart natural performance: the [57,64,73] triad is struck at 0.50 s and 1.40 s.',
    build() {
      const source = clip(`${REAL}/piano-mozart-triad.wav`)
      return build(
        [{ clip: source, startMs: 0 }],
        [
          step('mozart-triad-1', { onsetMs: 500, expectedMidis: [57, 64, 73], expectAdvance: true, instrument: 'piano', deadlineMs: 900 }),
          step('mozart-triad-2', { onsetMs: 1400, expectedMidis: [57, 64, 73], expectAdvance: true, instrument: 'piano', deadlineMs: 900 }),
        ],
      )
    },
  },
  {
    id: 'guitar-power-chord-natural-repeats',
    kind: 'natural-chord-sequence',
    instrument: 'guitar',
    notes: 'Real acoustic GuitarSet power dyad [49,56] struck at 0.24 s, 0.50 s, 0.95 s and 1.25 s.',
    build() {
      const source = clip(`${REAL}/acoustic-power-dyad.wav`, { startSeconds: 0.2, durationSeconds: 1.25 })
      const shape = [
        { midi: 49, string: 5, fret: 4 },
        { midi: 56, string: 4, fret: 6 },
      ]
      return build(
        [{ clip: source, startMs: 0 }],
        [
          step('power-1', { onsetMs: 40, expectedMidis: [49, 56], expectAdvance: true, instrument: 'guitar', deadlineMs: 900, stringFrets: shape }),
          step('power-2', { onsetMs: 300, expectedMidis: [49, 56], expectAdvance: true, instrument: 'guitar', deadlineMs: 900, stringFrets: shape }),
          step('power-3', { onsetMs: 750, expectedMidis: [49, 56], expectAdvance: true, instrument: 'guitar', deadlineMs: 900, stringFrets: shape }),
          step('power-4', { onsetMs: 1050, expectedMidis: [49, 56], expectAdvance: true, instrument: 'guitar', deadlineMs: 900, stringFrets: shape }),
        ],
      )
    },
  },
  {
    id: 'guitar-strum-triad-natural',
    kind: 'natural-chord-legit',
    instrument: 'guitar',
    notes: 'Real acoustic GuitarSet strummed G-major shape [50,55,59] with string/fret metadata.',
    build() {
      const source = clip(`${REAL}/acoustic-strum-triad.wav`, { startSeconds: 0.45, durationSeconds: 1.0 })
      const shape = [
        { midi: 50, string: 4, fret: 0 },
        { midi: 55, string: 3, fret: 0 },
        { midi: 59, string: 2, fret: 0 },
      ]
      return build(
        [{ clip: source, startMs: 0 }],
        [
          step('strum-triad', { onsetMs: 50, expectedMidis: [50, 55, 59], expectAdvance: true, instrument: 'guitar', deadlineMs: 1000, stringFrets: shape }),
        ],
      )
    },
  },
  {
    id: 'piano-dyad-repeat-slow',
    kind: 'composite-chord-lifecycle',
    instrument: 'piano',
    notes: 'Two C4+E4 dyad attacks (real piano samples, construction truth) separated by 2.2 s; tests repeated-chord attacks without tempo stress.',
    build() {
      const source = clip(`${POLY}/uiowa-piano-mf-c4-e4-dyad.wav`, { durationSeconds: 1.8 })
      return build(
        [
          { clip: source, startMs: 0, gain: 0.9 },
          { clip: source, startMs: 2200, gain: 0.9 },
        ],
        [
          step('piano-dyad-1', { onsetMs: 80, expectedMidis: [60, 64], expectAdvance: true, instrument: 'piano', deadlineMs: 1200 }),
          step('piano-dyad-2', { onsetMs: 2280, expectedMidis: [60, 64], expectAdvance: true, instrument: 'piano', deadlineMs: 1200 }),
          step('piano-dyad-hold', { onsetMs: 3600, expectedMidis: [60, 64], expectAdvance: false, instrument: 'piano', deadlineMs: 600 }),
        ],
      )
    },
  },
  {
    id: 'guitar-dyad-repeat-slow',
    kind: 'composite-chord-lifecycle',
    instrument: 'guitar',
    notes: 'Two G3+B3 dyad attacks (real guitar samples, construction truth) separated by 2.2 s.',
    build() {
      const source = clip(`${POLY}/uiowa-guitar-mf-adjacent-g3-b3.wav`, { durationSeconds: 1.8 })
      const shape = [
        { midi: 55, string: 3, fret: 0 },
        { midi: 59, string: 2, fret: 0 },
      ]
      return build(
        [
          { clip: source, startMs: 0, gain: 0.9 },
          { clip: source, startMs: 2200, gain: 0.9 },
        ],
        [
          step('guitar-dyad-1', { onsetMs: 80, expectedMidis: [55, 59], expectAdvance: true, instrument: 'guitar', deadlineMs: 1200, stringFrets: shape }),
          step('guitar-dyad-2', { onsetMs: 2280, expectedMidis: [55, 59], expectAdvance: true, instrument: 'guitar', deadlineMs: 1200, stringFrets: shape }),
          step('guitar-dyad-hold', { onsetMs: 3600, expectedMidis: [55, 59], expectAdvance: false, instrument: 'guitar', deadlineMs: 600, stringFrets: shape }),
        ],
      )
    },
  },
  {
    id: 'piano-wrong-then-correct',
    kind: 'recovery',
    instrument: 'piano',
    notes: 'Expect D4, play C4 (wrong); then expect E4 and play it; then expect C4 and play it. Recovery must not deadlock.',
    build() {
      const c4 = clip(`${ACC}/real-piano-c4.wav`, { durationSeconds: 1.0 })
      const e4 = clip(`${ACC}/real-piano-e4.wav`, { durationSeconds: 1.0 })
      return build(
        [
          { clip: c4, startMs: 0 },
          { clip: e4, startMs: 1200 },
          { clip: c4, startMs: 2400 },
        ],
        [
          step('wrong-expect-d4', { onsetMs: 120, expectedMidis: [62], expectAdvance: false, instrument: 'piano', deadlineMs: 700 }),
          step('correct-e4', { onsetMs: 1320, expectedMidis: [64], expectAdvance: true, instrument: 'piano', deadlineMs: 800 }),
          step('correct-c4', { onsetMs: 2520, expectedMidis: [60], expectAdvance: true, instrument: 'piano', deadlineMs: 800 }),
        ],
      )
    },
  },
  {
    id: 'piano-missed-then-correct',
    kind: 'recovery',
    instrument: 'piano',
    notes: 'First checkpoint is silent (missed); then the correct C4 must advance the next checkpoint.',
    build() {
      const c4 = clip(`${ACC}/real-piano-c4.wav`, { durationSeconds: 1.0 })
      return build(
        [{ clip: c4, startMs: 1200 }],
        [
          step('missed-silence', { onsetMs: 100, expectedMidis: [60], expectAdvance: false, instrument: 'piano', deadlineMs: 700 }),
          step('missed-then-c4', { onsetMs: 1320, expectedMidis: [60], expectAdvance: true, instrument: 'piano', deadlineMs: 800 }),
        ],
      )
    },
  },
  {
    id: 'piano-jazz-natural-repeated-note',
    kind: 'natural-single-lifecycle',
    instrument: 'guitar',
    notes: 'GuitarSet solo: F3 at 0.50 s and 2.65 s, with other non-target notes between. Both checkpoints must advance.',
    build() {
      const source = clip(`${REAL}/acoustic-jazz-single.wav`)
      return build(
        [{ clip: source, startMs: 0 }],
        [
          step('jazz-f3-1', { onsetMs: 501, expectedMidis: [53], expectAdvance: true, instrument: 'guitar', deadlineMs: 800 }),
          step('jazz-f3-2', { onsetMs: 2648, expectedMidis: [53], expectAdvance: true, instrument: 'guitar', deadlineMs: 800 }),
        ],
      )
    },
  },
  {
    id: 'piano-partial-chord-negative',
    kind: 'negative',
    instrument: 'piano',
    notes: 'C-major triad played while the score expects Cmaj7 (B4 absent). Must not advance.',
    build() {
      const source = clip(`${POLY}/uiowa-piano-mf-c-major-triad.wav`)
      return build(
        [{ clip: source, startMs: 0 }],
        [step('piano-cmaj7-negative', {
          onsetMs: 120,
          expectedMidis: [60, 64, 67, 71],
          expectAdvance: false,
          instrument: 'piano',
          deadlineMs: 1200,
        })],
      )
    },
  },
  {
    id: 'guitar-partial-chord-negative',
    kind: 'negative',
    instrument: 'guitar',
    notes: 'Open-Em strum while the score expects an extra G#4 (absent). Must not advance.',
    build() {
      const source = clip(`${POLY}/uiowa-guitar-mf-open-em-strum.wav`)
      return build(
        [{ clip: source, startMs: 0 }],
        [step('guitar-em-extra-negative', {
          onsetMs: 120,
          expectedMidis: [40, 45, 50, 55, 59, 64, 68],
          expectAdvance: false,
          instrument: 'guitar',
          deadlineMs: 1400,
        })],
      )
    },
  },
  {
    id: 'piano-wrong-same-checkpoint-recovery',
    kind: 'recovery',
    instrument: 'piano',
    notes: 'Expect C4, play E4 (wrong), then play C4 without changing checkpoint. The wrong report must not leave the checkpoint deaf.',
    build() {
      const e4 = clip(`${ACC}/real-piano-e4.wav`, { durationSeconds: 1.0 })
      const c4 = clip(`${ACC}/real-piano-c4.wav`, { durationSeconds: 1.0 })
      return build(
        [
          { clip: e4, startMs: 0 },
          { clip: c4, startMs: 1200 },
        ],
        [
          step('wrong-e4-c4-recovery', {
            onsetMs: 1320,
            expectedMidis: [60],
            expectAdvance: true,
            instrument: 'piano',
            deadlineMs: 900,
          }),
        ],
      )
    },
  },
  {
    id: 'piano-octave-ghost-then-correct',
    kind: 'negative-recovery',
    instrument: 'piano',
    notes: 'Expect C5 while C4 is played (octave ghost) then expect/replay C4. The ghost must not advance; the real C4 must.',
    build() {
      const c4 = clip(`${ACC}/real-piano-c4.wav`, { durationSeconds: 1.0 })
      return build(
        [
          { clip: c4, startMs: 0 },
          { clip: c4, startMs: 1200 },
        ],
        [
          step('octave-ghost-negative', { onsetMs: 120, expectedMidis: [72], expectAdvance: false, instrument: 'piano', deadlineMs: 800 }),
          step('octave-ghost-then-c4', { onsetMs: 1320, expectedMidis: [60], expectAdvance: true, instrument: 'piano', deadlineMs: 800 }),
        ],
      )
    },
  },
  {
    id: 'piano-legit-octave-then-hold',
    kind: 'natural-chord-legit',
    instrument: 'piano',
    notes: 'A genuine octave chord (C4+C5) must advance; its ring must not consume the next checkpoint.',
    build() {
      const source = clip(`${COMP}/octave-piano-c4-c5.wav`)
      return build(
        [{ clip: source, startMs: 0 }],
        [
          step('octave-chord', { onsetMs: 113, expectedMidis: [60, 72], expectAdvance: true, instrument: 'piano', deadlineMs: 1000 }),
          step('octave-chord-hold', { onsetMs: 1200, expectedMidis: [60, 72], expectAdvance: false, instrument: 'piano', deadlineMs: 600 }),
        ],
      )
    },
  },
  {
    id: 'piano-legit-rolled-octave',
    kind: 'natural-chord-legit',
    instrument: 'piano',
    notes: 'A genuinely rolled octave (113 ms spread) must advance.',
    build() {
      const source = clip(`${COMP}/rolled-octave-piano-c4-c5.wav`)
      return build(
        [{ clip: source, startMs: 0 }],
        [step('rolled-octave', {
          onsetMs: 113,
          expectedMidis: [60, 72],
          expectAdvance: true,
          instrument: 'piano',
          deadlineMs: 1200,
        })],
      )
    },
  },
  {
    id: 'guitar-legit-fifth',
    kind: 'natural-chord-legit',
    instrument: 'guitar',
    notes: 'A real power dyad (root+fifth, not a chord tone) must advance.',
    build() {
      const source = clip(`${REAL}/acoustic-power-dyad.wav`, { startSeconds: 0.2, durationSeconds: 1.0 })
      const shape = [
        { midi: 49, string: 5, fret: 4 },
        { midi: 56, string: 4, fret: 6 },
      ]
      return build(
        [{ clip: source, startMs: 0 }],
        [
          step('fifth-chord', { onsetMs: 40, expectedMidis: [49, 56], expectAdvance: true, instrument: 'guitar', deadlineMs: 900, stringFrets: shape }),
        ],
      )
    },
  },
  {
    id: 'noise-negative',
    kind: 'negative',
    instrument: 'piano',
    notes: 'Real room noise while C4 is expected. Must never advance.',
    build() {
      const source = clip(`${ACC}/real-room-noisy.wav`, { durationSeconds: 3 })
      return build(
        [{ clip: source, startMs: 0 }],
        [step('noise-negative', { onsetMs: 200, expectedMidis: [60], expectAdvance: false, instrument: 'piano', deadlineMs: 1500 })],
      )
    },
  },
]

const viteServer = await createServer({
  root: ROOT,
  configFile: resolve(ROOT, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
await viteServer.listen()
const baseUrl = `http://127.0.0.1:${viteServer.httpServer.address().port}`
const browser = await chromium.launch({
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
})

const selected = FILTERS.length
  ? SCENARIOS.filter((scenario) => FILTERS.some((filter) => scenario.id.includes(filter)))
  : SCENARIOS

const rows = []
for (const scenario of selected) {
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  let result = null
  let error = null
  try {
    const pageUrl = `${baseUrl}/scripts/mic-live/sequence.html${V3_OFF ? '?v3=0' : ''}`
    await page.goto(pageUrl, { waitUntil: 'load' })
    const { audio, steps } = scenario.build()
    await page.evaluate(
      (payload) => window.__liveApi.injectSequence(payload),
      {
        samples: Array.from(audio.samples),
        sampleRate: audio.sampleRate,
        steps,
        preludeSeconds: audio.preludeSeconds,
        instrumentId: scenario.instrument,
      },
    )
    result = await page.evaluate((timeout) => window.__liveApi.waitDone(timeout), 60_000)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  } finally {
    await page.evaluate(() => window.__liveTeardown?.()).catch(() => {})
    await page.close()
  }

  const steps = result?.steps ?? scenario.build().steps
  const results = result?.results ?? []
  const byId = new Map(results.map((entry) => [entry.stepId, entry]))
  const stepRows = steps.map((step) => {
    const entry = byId.get(step.id) ?? null
    const early = Boolean(entry?.advanced && entry.latencyMs != null && entry.latencyMs < -200)
    return {
      stepId: step.id,
      expectedMidis: step.expectedMidis,
      expectAdvance: Boolean(step.expectAdvance),
      advanced: Boolean(entry?.advanced),
      earlyAdvance: early,
      pass: entry
        ? Boolean(step.expectAdvance)
          ? Boolean(entry.advanced) && !early
          : !entry.advanced
        : false,
      latencyMs: entry?.latencyMs ?? null,
      advanceAtMs: entry?.advanceAtMs ?? null,
      wrongReports: entry?.wrongReports ?? 0,
      detectedMidis: entry?.detectedMidis ?? [],
      feedback: entry?.feedback ?? null,
      decisionReason: entry?.decision?.reason ?? null,
      decision: entry?.decision ?? null,
      trace: entry?.trace ?? [],
    }
  })
  const falseAdvances = stepRows.filter((entry) => !entry.expectAdvance && entry.advanced).length
  const earlyAdvances = stepRows.filter((entry) => entry.earlyAdvance).length
  const missed = stepRows.filter((entry) => entry.expectAdvance && !entry.advanced).length
  const passed = stepRows.filter((entry) => entry.pass).length
  const row = {
    id: scenario.id,
    kind: scenario.kind,
    instrument: scenario.instrument,
    notes: scenario.notes,
    provenance: scenario.kind.startsWith('natural') ? 'natural (mic-real / CC-BY-4.0; isolated fixture for single notes)' : 'construction-truth composite / deterministic sequence',
    stepCount: stepRows.length,
    passed,
    failed: stepRows.length - passed,
    falseAdvances,
    earlyAdvances,
    missed,
    steps: stepRows,
    pageErrors,
    error,
  }
  rows.push(row)
  const latency = stepRows.filter((entry) => entry.latencyMs != null).map((entry) => entry.latencyMs)
  console.log(
    `${scenario.id.padEnd(38)} pass=${passed}/${stepRows.length} false=${falseAdvances} early=${earlyAdvances} missed=${missed}`
    + ` latency=[${latency.join(',') || '—'}]${error ? ` ERROR=${error}` : ''}`,
  )
  for (const entry of stepRows.filter((stepEntry) => !stepEntry.pass)) {
    console.log(`   FAIL ${entry.stepId}: expected=${entry.expectAdvance ? 'advance' : 'hold'} advanced=${entry.advanced} latency=${entry.latencyMs ?? '—'} reason=${entry.decisionReason ?? '—'} detected=[${entry.detectedMidis.join(',')}]`)
  }
}

const allSteps = rows.flatMap((row) => row.steps)
const latencies = allSteps
  .filter((entry) => entry.expectAdvance && entry.advanced && entry.latencyMs != null)
  .map((entry) => entry.latencyMs)
  .sort((a, b) => a - b)
const summary = {
  scenarios: rows.length,
  steps: allSteps.length,
  passed: allSteps.filter((entry) => entry.pass).length,
  falseAdvances: rows.reduce((sum, row) => sum + row.falseAdvances, 0),
  earlyAdvances: rows.reduce((sum, row) => sum + (row.earlyAdvances ?? 0), 0),
  missed: rows.reduce((sum, row) => sum + row.missed, 0),
  failedScenarios: rows.filter((row) => row.failed > 0 || row.pageErrors.length || row.error).map((row) => row.id),
  latency: latencies.length
    ? {
        n: latencies.length,
        min: latencies[0],
        p50: latencies[Math.floor(latencies.length * 0.5)],
        p95: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))],
        max: latencies[latencies.length - 1],
      }
    : null,
  pageErrorCount: rows.reduce((sum, row) => sum + row.pageErrors.length, 0),
}

console.log('\n=== PRODUCTION MIC SEQUENCES ===')
console.log(JSON.stringify(summary, null, 1))
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ summary, rows }, null, 1))
}

await browser.close()
await viteServer.close()

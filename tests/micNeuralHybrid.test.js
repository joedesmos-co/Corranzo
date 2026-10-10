/**
 * Neural hybrid prototype (Stage 5, N4) — Basic Pitch candidates through
 * confirmation into canonical events and the bounded WFY evaluator.
 * Test-only: nothing here wires production.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { confirmNeuralNotes, harmonicGhostVetoes } from '../src/features/practice/micNeuralHybrid.js'
import { toCanonicalMicrophoneEvent } from '../src/features/practice/micCanonicalBridge.js'
import { evaluateCanonicalWaitForYouInput } from '../src/features/practice/canonicalInputEvent.js'
import {
  createChordMatchState,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOTES_PATH = join(ROOT, 'tmp', 'basicpitch', 'notes.json')
const MANIFEST_PATH = join(ROOT, 'benchmarks', 'mic-real', 'manifest.json')
const settings = normalizeMatchSettings({})
const hasNotes = existsSync(NOTES_PATH)

function loadClip(id) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const clip = manifest.clips.find((entry) => entry.id === id)
  const notes = JSON.parse(readFileSync(NOTES_PATH, 'utf8'))[id]?.notes ?? []
  return { clip, notes }
}

describe.skipIf(!hasNotes)('mic neural hybrid (Basic Pitch candidates)', () => {
  it('completes a real dense chord into canonical COMPLETE', () => {
    const { clip, notes } = loadClip('electric-eg10-dense')
    const expected = clip.truth.anchorTones
    const verdict = confirmNeuralNotes(notes, expected, clip.truth.anchorOnset)
    expect(verdict.complete).toBe(true)
    const chordState = createChordMatchState()
    const checkpoint = { id: 'neural-dense', expectedMidis: expected }
    let outcome = null
    for (const midi of verdict.confirmedMidis) {
      const event = toCanonicalMicrophoneEvent(
        { midi, midiFloat: midi, v2DetectedMidis: verdict.confirmedMidis, clarity: 0.85 },
        {
          wallTimestampMs: 1000,
          rawTimestamp: verdict.neuralOnsets[midi],
          attemptId: 'att-neural-1',
          chordGroupId: 'grp-neural-1',
        },
      )
      expect(event.source).toBe('microphone')
      outcome = evaluateCanonicalWaitForYouInput(checkpoint, event, chordState, settings)
    }
    expect(outcome.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('refuses a transposed chord without manufacturing', () => {
    const { clip, notes } = loadClip('electric-eg10-dense')
    const verdict = confirmNeuralNotes(notes, [41, 48, 53, 56, 60, 65], clip.truth.anchorOnset)
    expect(verdict.complete).toBe(false)
  })

  it('builds no events on silence', () => {
    const { clip, notes } = loadClip('pause-mozart')
    const verdict = confirmNeuralNotes(notes, [60, 64, 67], clip.truth.anchorOnset)
    expect(verdict.complete).toBe(false)
    expect(verdict.confirmedMidis).toEqual([])
  })

  it('preserves neural onsets on canonical events', () => {
    const { clip, notes } = loadClip('electric-eg07-dyad')
    const verdict = confirmNeuralNotes(notes, clip.truth.anchorTones, clip.truth.anchorOnset)
    expect(verdict.confirmedMidis.length).toBeGreaterThan(0)
    for (const midi of verdict.confirmedMidis) {
      expect(verdict.neuralOnsets[midi]).not.toBeNull()
    }
  })

  it('confirms sustained tones outside the attack window without manufacturing', () => {    // A sustained tone heard now (bypass) + a fresh attack in-window.
    const verdict = confirmNeuralNotes(
      [
        { midi: 60, start: 100.0, end: 101.0, sustained: true },
        { midi: 64, start: 10.5, end: 11.0 },
      ],
      [60, 64],
      10.5,
    )
    expect(verdict.confirmedMidis).toEqual([60, 64])
    // Sustained ghosts with no expected match still never confirm.
    const ghost = confirmNeuralNotes(
      [{ midi: 61, start: 100.0, end: 101.0, sustained: true }],
      [60],
      10.5,
    )
    expect(ghost.confirmedMidis).toEqual([])
    expect(ghost.complete).toBe(false)
  })
})

describe('harmonicGhostVetoes', () => {
  // Measured ghost shape: C3@0.13+0.86 spawns C4@0.13+0.56 (same onset,
  // same-quantized span, exact pitch). No timing/duration/pitch cue
  // separates it — only the unexpected simultaneous fundamental does.
  const ghostPool = [
    { midi: 48, start: 1.13, end: 1.99 },
    { midi: 64, start: 1.13, end: 1.46 },
    { midi: 60, start: 1.13, end: 1.49 },
  ]

  it('vetoes a simultaneous unexpected-fundamental octave ghost (single-note checkpoint)', () => {
    expect([...harmonicGhostVetoes(ghostPool, [60]).keys()]).toEqual([60])
  })

  it('stays silent for multi-pitch checkpoints (dense music must flow)', () => {
    expect([...harmonicGhostVetoes(ghostPool, [60, 64]).keys()]).toEqual([])
    expect([...harmonicGhostVetoes(ghostPool, [48, 60, 64]).keys()]).toEqual([])
  })

  it('never vetoes true doublings where both octaves are expected', () => {
    const doubling = [
      { midi: 48, start: 1.0, end: 2.0 },
      { midi: 60, start: 1.0, end: 2.0 },
    ]
    expect([...harmonicGhostVetoes(doubling, [48]).keys()]).toEqual([])
    expect([...harmonicGhostVetoes(doubling, [60]).keys()]).toEqual([60])
  })

  it('ignores pedal ring: earlier fundamentals do not veto', () => {
    const pool = [
      { midi: 48, start: 0.5, end: 2.5 },
      { midi: 60, start: 1.5, end: 2.0 },
    ]
    expect([...harmonicGhostVetoes(pool, [60]).keys()]).toEqual([])
  })

  it('blocks the false award end to end without touching true singles', () => {
    const blocked = confirmNeuralNotes(ghostPool, [60], 1.2, { windowBeforeSeconds: 4, windowAfterSeconds: 0.5 })
    expect(blocked.complete).toBe(false)
    expect(blocked.missingMidis).toEqual([60])
    expect(blocked.vetoed.map((entry) => entry.midi)).toEqual([60])
    const clean = confirmNeuralNotes([{ midi: 60, start: 1.0, end: 2.0 }], [60], 1.2)
    expect(clean.complete).toBe(true)
  })
})

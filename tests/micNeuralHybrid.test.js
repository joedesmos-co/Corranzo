/**
 * Neural hybrid prototype (Stage 5, N4) — Basic Pitch candidates through
 * confirmation into canonical events and the bounded WFY evaluator.
 * Test-only: nothing here wires production.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { confirmNeuralNotes } from '../src/features/practice/micNeuralHybrid.js'
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
})

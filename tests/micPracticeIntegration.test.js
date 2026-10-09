/**
 * Practice integration (Stage 4 P6) — the complete experimental path on
 * REAL audio, test-only (nothing here wires production):
 *
 *   microphone audio → blind groups → hybrid confirmation
 *   → canonicalInputEvent → bounded WFY evaluator → feedback outcome
 *
 * No pitch-only shortcuts: confirmation evidence is required before any
 * canonical event exists, and the evaluator decides COMPLETE/WRONG.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'
import { replayBlindPolyphonyEvents } from '../src/features/microphone-input/v2/blindPolyphonicDetector.js'
import { confirmBlindCandidates } from '../src/features/microphone-input/micHybridConfirmation.js'
import { toCanonicalMicrophoneEvent } from '../src/features/practice/micCanonicalBridge.js'
import { evaluateCanonicalWaitForYouInput } from '../src/features/practice/canonicalInputEvent.js'
import {
  createChordMatchState,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const settings = normalizeMatchSettings({})

function manifest() {
  return JSON.parse(readFileSync(join(ROOT, 'benchmarks', 'mic-real', 'manifest.json'), 'utf8'))
}

function loadClip(id) {
  const clip = manifest().clips.find((entry) => entry.id === id)
  const wav = readWavPcm(join(ROOT, 'benchmarks', 'mic-real', clip.audio.file))
  return { clip, samples: wav.samples, sampleRate: wav.sampleRate }
}

/** Experimental recognition: onset-anchored group tones near the anchor. */
function recognize(clip, samples, sampleRate, expectedMidis) {
  const replay = replayBlindPolyphonyEvents(samples, sampleRate, { exhaustive: true })
  const anchor = clip.truth.anchorOnset
  const pool = []
  for (const group of replay.groups) {
    const onset = group.groupOnsetMs / 1000
    if (anchor != null && (onset < anchor - 0.3 || onset > anchor + 1.0)) {
      continue
    }
    for (const note of group.notes) {
      pool.push({ midi: note.midi, midiFloat: note.midi, confidence: note.maxConfidence ?? 0.5, detected: true })
    }
  }
  return confirmBlindCandidates(pool, expectedMidis)
}

function feedEvaluator(checkpoint, confirmedMidis) {
  const chordState = createChordMatchState()
  let outcome = null
  for (const midi of confirmedMidis) {
    const event = toCanonicalMicrophoneEvent(
      { midi, midiFloat: midi, v2DetectedMidis: confirmedMidis, clarity: 0.8 },
      { wallTimestampMs: 1000 + midi, attemptId: 'att-integration-test', chordGroupId: 'grp-test-1' },
    )
    expect(event.source).toBe('microphone')
    expect(event.detectedMidis).toEqual([...confirmedMidis].sort((a, b) => a - b))
    outcome = evaluateCanonicalWaitForYouInput(checkpoint, event, chordState, settings)
  }
  return outcome
}

describe('mic practice integration (real audio, experimental path)', () => {
  it('advances a real power chord through canonical events to COMPLETE', () => {
    const { clip, samples, sampleRate } = loadClip('acoustic-power-dense')
    const expected = clip.truth.anchorTones
    const verdict = recognize(clip, samples, sampleRate, expected)
    expect(verdict.complete).toBe(true)
    const checkpoint = { id: 'integration-chord', expectedMidis: expected }
    const outcome = feedEvaluator(checkpoint, verdict.confirmedMidis)
    expect(outcome.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('refuses a wrong chord: no events, no completion', () => {
    const { clip, samples, sampleRate } = loadClip('acoustic-power-dense')
    const verdict = recognize(clip, samples, sampleRate, [43, 50, 53, 59])
    // The award question is completeness: isolated ghost confirmations
    // may appear, but the wrong set must never complete.
    expect(verdict.complete).toBe(false)
    expect(verdict.confirmedMidis.length).toBeLessThan(4)
  })

  it('reports partial confirmation without completing', () => {
    const { clip, samples, sampleRate } = loadClip('acoustic-power-dense')
    // Expect three true tones plus one absent tone: partial, never COMPLETE.
    const verdict = recognize(clip, samples, sampleRate, [42, 49, 52, 61])
    expect(verdict.complete).toBe(false)
    expect(verdict.confirmedMidis).toEqual([42, 49, 52])
    const checkpoint = { id: 'integration-partial', expectedMidis: [42, 49, 52, 61] }
    const outcome = feedEvaluator(checkpoint, verdict.confirmedMidis)
    expect(outcome.outcome).not.toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('builds no events on silence', () => {
    const { clip, samples, sampleRate } = loadClip('pause-mozart')
    const verdict = recognize(clip, samples, sampleRate, [60, 64, 67])
    expect(verdict.complete).toBe(false)
    expect(verdict.confirmedMidis).toEqual([])
  })

  it('preserves onset timestamps and attempt identity on events', () => {
    const event = toCanonicalMicrophoneEvent(
      { midi: 57, midiFloat: 57.02, v2DetectedMidis: [57], clarity: 0.8, timeMs: 512 },
      { wallTimestampMs: 2048, attemptId: 'att-ts-1', iterationIndex: 2, chordGroupId: 'grp-ts-9' },
    )
    expect(event.wallTimestampMs).toBe(2048)
    expect(event.rawTimestamp).toBe(512)
    expect(event.attemptId).toBe('att-ts-1')
    expect(event.iterationIndex).toBe(2)
    expect(event.chordGroupId).toBe('grp-ts-9')
  })
})

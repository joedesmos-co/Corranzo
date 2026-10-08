/**
 * Neural live-path scenarios (Stage 8, L5/L6) — pure, no model, no DOM.
 *
 * Drives the exact live decision chain (stream attacks → confirmation →
 * canonical events → bounded evaluator) through every scenario the
 * mission requires: singles, wrong notes, chords, partials, repeats,
 * staggered strums, silence, and checkpoint changes (pause/seek/loop).
 */
import { describe, expect, it } from 'vitest'
import {
  createNeuralStreamState,
  emitNeuralStreamNotes,
} from '../src/features/microphone-input/micNeuralStream.js'
import { confirmNeuralNotes } from '../src/features/practice/micNeuralHybrid.js'
import { toCanonicalMicrophoneEvent } from '../src/features/practice/micCanonicalBridge.js'
import { evaluateCanonicalWaitForYouInput } from '../src/features/practice/canonicalInputEvent.js'
import {
  createChordMatchState,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import {
  createNeuralConfirmTracker,
  takeNewlyConfirmed,
} from '../src/features/practice/micNeuralConfirmTracker.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const settings = normalizeMatchSettings({})
const CONFIDENCE = 0.85

function attack(midi, onsetSeconds) {
  return { midi, startOffsetSeconds: onsetSeconds, endOffsetSeconds: onsetSeconds + 1.0 }
}

/** Full live chain for one window of attacks against one expectation. */
function runLiveChain({ attacks, expectedMidis, checkpointId, tracker, chordState, captureStartMs = 10_000 }) {
  // Scenarios below feed single windows, so a fresh stream state is exact
  // (cross-window dedup is covered in micNeuralStream.test.js).
  const emitted = emitNeuralStreamNotes(
    createNeuralStreamState(),
    attacks,
    captureStartMs,
  )
  const pool = emitted.map((event) => ({
    midi: event.midi,
    start: event.onsetCaptureMs / 1000,
    end: event.endCaptureMs / 1000,
  }))
  const anchorSeconds = captureStartMs / 1000 + 0.5
  const verdict = confirmNeuralNotes(pool, expectedMidis, anchorSeconds)
  const fresh = takeNewlyConfirmed(tracker, checkpointId, verdict.confirmedMidis)
  let outcome = null
  for (const midi of fresh) {
    const event = toCanonicalMicrophoneEvent(
      { midi, midiFloat: midi, v2DetectedMidis: [midi], clarity: CONFIDENCE },
      { wallTimestampMs: captureStartMs + 500, attemptId: 'att-live-1', chordGroupId: 'grp-live-1' },
    )
    outcome = evaluateCanonicalWaitForYouInput({ id: checkpointId, expectedMidis }, event, chordState, settings)
  }
  return { emitted, verdict, fresh, outcome }
}

describe('mic neural live scenarios', () => {
  it('completes a correct single note', () => {
    const tracker = createNeuralConfirmTracker()
    const chordState = createChordMatchState()
    const { outcome, fresh } = runLiveChain({
      attacks: [attack(60, 0.5)],
      expectedMidis: [60],
      checkpointId: 'cp-single',
      tracker,
      chordState,
    })
    expect(fresh).toEqual([60])
    expect(outcome.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('rejects a wrong single note without completing', () => {
    const tracker = createNeuralConfirmTracker()
    const chordState = createChordMatchState()
    const { outcome, fresh } = runLiveChain({
      attacks: [attack(62, 0.5)],
      expectedMidis: [60],
      checkpointId: 'cp-wrong-single',
      tracker,
      chordState,
    })
    expect(fresh).toEqual([])
    expect(outcome).toBeNull()
  })

  it('completes a simultaneous chord', () => {
    const tracker = createNeuralConfirmTracker()
    const chordState = createChordMatchState()
    const { outcome, emitted } = runLiveChain({
      attacks: [attack(60, 0.5), attack(64, 0.5), attack(67, 0.5)],
      expectedMidis: [60, 64, 67],
      checkpointId: 'cp-chord',
      tracker,
      chordState,
    })
    expect(emitted.map((event) => event.chordGroupId)).toEqual([
      emitted[0].chordGroupId,
      emitted[0].chordGroupId,
      emitted[0].chordGroupId,
    ])
    expect(outcome.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('holds a partial chord below completion', () => {
    const tracker = createNeuralConfirmTracker()
    const chordState = createChordMatchState()
    const { outcome, verdict } = runLiveChain({
      attacks: [attack(60, 0.5), attack(64, 0.52)],
      expectedMidis: [60, 64, 67],
      checkpointId: 'cp-partial',
      tracker,
      chordState,
    })
    expect(verdict.complete).toBe(false)
    expect(verdict.confirmedMidis).toEqual([60, 64])
    expect(outcome == null || outcome.outcome !== MATCH_OUTCOME.COMPLETE).toBe(true)
  })

  it('groups a naturally staggered strum into one chord event', () => {
    const tracker = createNeuralConfirmTracker()
    const chordState = createChordMatchState()
    const { outcome, emitted } = runLiveChain({
      attacks: [attack(40, 0.5), attack(45, 0.58), attack(50, 0.66)],
      expectedMidis: [40, 45, 50],
      checkpointId: 'cp-strum',
      tracker,
      chordState,
    })
    const groups = new Set(emitted.map((event) => event.chordGroupId))
    expect(groups.size).toBe(1)
    expect(outcome.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('treats a repeated chord as a new attack after checkpoint change', () => {
    const tracker = createNeuralConfirmTracker()
    const first = runLiveChain({
      attacks: [attack(60, 0.5)],
      expectedMidis: [60],
      checkpointId: 'cp-repeat-1',
      tracker,
      chordState: createChordMatchState(),
    })
    expect(first.outcome.outcome).toBe(MATCH_OUTCOME.COMPLETE)
    // Seek/loop/restart = new checkpoint identity: the same pitch must
    // prove itself again, and the old confirmation must not leak across.
    const second = runLiveChain({
      attacks: [attack(60, 0.5)],
      expectedMidis: [60],
      checkpointId: 'cp-repeat-2',
      tracker,
      chordState: createChordMatchState(),
    })
    expect(second.fresh).toEqual([60])
    expect(second.outcome.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('emits nothing on silence (pause)', () => {
    const tracker = createNeuralConfirmTracker()
    const chordState = createChordMatchState()
    const { emitted, outcome, fresh } = runLiveChain({
      attacks: [],
      expectedMidis: [60, 64, 67],
      checkpointId: 'cp-silence',
      tracker,
      chordState,
    })
    expect(emitted).toEqual([])
    expect(fresh).toEqual([])
    expect(outcome).toBeNull()
  })
})

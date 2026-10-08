/**
 * Neural stream → canonical → bounded evaluator (Stage 6, N2/N5).
 *
 * Drives micNeuralStream attack events (stubbed neural inference shaped
 * like Basic Pitch note events) through toCanonicalMicrophoneEvent into
 * the SAME bounded WFY evaluator MIDI uses. Proves delayed inference can
 * never make a correctly played note late: onset timestamps ride the
 * capture clock, not the inference clock.
 */
import { describe, expect, it } from 'vitest'
import {
  createNeuralStreamState,
  drainNeuralStreamEvents,
  emitNeuralStreamNotes,
} from '../src/features/microphone-input/micNeuralStream.js'
import { toCanonicalMicrophoneEvent } from '../src/features/practice/micCanonicalBridge.js'
import { evaluateCanonicalWaitForYouInput } from '../src/features/practice/canonicalInputEvent.js'
import {
  createChordMatchState,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const settings = normalizeMatchSettings({})

function streamChordAttack(midis, captureStartMs, spreadSeconds = 0.05) {
  const state = createNeuralStreamState()
  const notes = midis.map((midi, index) => ({
    midi,
    startOffsetSeconds: 0.5 + index * spreadSeconds,
    endOffsetSeconds: 1.5,
  }))
  emitNeuralStreamNotes(state, notes, captureStartMs)
  const drained = drainNeuralStreamEvents(state)
  expect(drained).toHaveLength(midis.length)
  return { state, emitted: drained }
}

describe('mic neural stream practice integration', () => {
  it('completes a streamed chord through canonical events (inference delay is irrelevant)', () => {
    // Capture happened at t=10 s; "inference" returns 800 ms later. The
    // events must still carry capture-clock onsets.
    const { emitted } = streamChordAttack([49, 56], 10_000)
    expect(emitted[0].onsetCaptureMs).toBe(10_500)
    expect(emitted[1].onsetCaptureMs).toBe(10_550)
    expect(emitted[0].chordGroupId).toBe(emitted[1].chordGroupId)

    const checkpoint = { id: 'neural-stream-chord', expectedMidis: [49, 56] }
    const chordState = createChordMatchState()
    let outcome = null
    for (const attack of emitted) {
      const event = toCanonicalMicrophoneEvent(
        { midi: attack.midi, midiFloat: attack.midi, v2DetectedMidis: [attack.midi], clarity: attack.confidence },
        {
          wallTimestampMs: attack.onsetCaptureMs,
          rawTimestamp: attack.onsetCaptureMs,
          attemptId: 'att-stream-1',
          chordGroupId: attack.chordGroupId,
        },
      )
      expect(event.source).toBe('microphone')
      expect(event.rawTimestamp).toBe(attack.onsetCaptureMs)
      outcome = evaluateCanonicalWaitForYouInput(checkpoint, event, chordState, settings)
    }
    expect(outcome.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('never completes a wrong chord from streamed attacks', () => {
    const { emitted } = streamChordAttack([49, 56], 20_000)
    const checkpoint = { id: 'neural-stream-wrong', expectedMidis: [50, 57] }
    const chordState = createChordMatchState()
    let outcome = null
    for (const attack of emitted) {
      const event = toCanonicalMicrophoneEvent(
        { midi: attack.midi, midiFloat: attack.midi, v2DetectedMidis: [attack.midi], clarity: attack.confidence },
        { wallTimestampMs: attack.onsetCaptureMs, attemptId: 'att-stream-2', chordGroupId: attack.chordGroupId },
      )
      outcome = evaluateCanonicalWaitForYouInput(checkpoint, event, chordState, settings)
    }
    expect(outcome.outcome).not.toBe(MATCH_OUTCOME.COMPLETE)
  })
})

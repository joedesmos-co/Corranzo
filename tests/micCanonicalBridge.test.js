/**
 * Mic Engine rescue (M9) — shadow canonical bridge preserves the full
 * multi-pitch contract without changing matching behavior.
 */
import { describe, expect, it } from 'vitest'
import { toCanonicalMicrophoneEvent } from '../src/features/practice/micCanonicalBridge.js'
import { INPUT_SOURCE } from '../src/features/practice/canonicalInputEvent.js'

describe('toCanonicalMicrophoneEvent', () => {
  it('maps a single-note frame with source, confidence, and attempt identity', () => {
    const event = toCanonicalMicrophoneEvent(
      { midi: 60, midiFloat: 60.04, v2DetectedMidis: [], clarity: 0.82, timeMs: 1234 },
      {
        wallTimestampMs: 9000,
        attemptId: 'att-test-1',
        iterationIndex: 2,
      },
    )
    expect(event.source).toBe(INPUT_SOURCE.MICROPHONE)
    expect(event.midi).toBe(60)
    expect(event.detectedMidis).toEqual([60])
    expect(event.velocityOrConfidence).toBeCloseTo(0.82)
    expect(event.attemptId).toBe('att-test-1')
    expect(event.iterationIndex).toBe(2)
    expect(event.kind).toBe('attack')
    // Wait For You is untimed by design.
    expect(event.scoreTimeSeconds).toBeNull()
  })

  it('preserves the full simultaneous chord set instead of reducing to one pitch', () => {
    const event = toCanonicalMicrophoneEvent(
      {
        midi: 60,
        v2DetectedMidis: [60, 64, 67],
        v2MeanConfidence: 0.54,
        timeMs: 200,
      },
      { wallTimestampMs: 9100, attemptId: 'att-chord-1' },
    )
    expect(event.midi).toBe(60)
    expect(event.detectedMidis).toEqual([60, 64, 67])
    expect(event.velocityOrConfidence).toBeCloseTo(0.54)
    expect(event.chordGroupId).toBe('mic-chord-9100')
  })

  it('keeps an explicit chord group when the caller already grouped attacks', () => {
    const event = toCanonicalMicrophoneEvent(
      { midi: 55, v2DetectedMidis: [55, 59], clarity: 0.7 },
      { wallTimestampMs: 9200, chordGroupId: 'grp-strum-7' },
    )
    expect(event.detectedMidis).toEqual([55, 59])
    expect(event.chordGroupId).toBe('grp-strum-7')
  })

  it('prefers V2 mean confidence over monophonic clarity', () => {
    const event = toCanonicalMicrophoneEvent(
      { midi: 52, v2DetectedMidis: [52], v2MeanConfidence: 0.41, clarity: 0.9 },
      { wallTimestampMs: 9300 },
    )
    expect(event.velocityOrConfidence).toBeCloseTo(0.41)
  })

  it('carries Play Along score time when provided', () => {
    const event = toCanonicalMicrophoneEvent(
      { midi: 69, v2DetectedMidis: [], clarity: 0.9 },
      { wallTimestampMs: 9400, scoreTimeSeconds: 12.5 },
    )
    expect(event.scoreTimeSeconds).toBeCloseTo(12.5)
  })

  it('returns null when the frame carries no pitch at all', () => {
    expect(
      toCanonicalMicrophoneEvent(
        { midi: null, v2DetectedMidis: [], clarity: 0 },
        { wallTimestampMs: 9500 },
      ),
    ).toBeNull()
    expect(toCanonicalMicrophoneEvent(null, {})).toBeNull()
  })
})

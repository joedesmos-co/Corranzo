import { describe, expect, it } from 'vitest'
import {
  EXPECTED_EVENT_KIND,
  PERFORMANCE_MODE,
  buildPerformanceExpectation,
} from '../src/features/microphone-input/v3/performanceExpectation.js'

function checkpoint(id, timeSeconds, midis, extra = {}) {
  return {
    id,
    index: extra.index ?? 0,
    timeSeconds,
    quarterTime: timeSeconds,
    measureNumber: extra.measureNumber ?? 1,
    beat: extra.beat ?? 1,
    expectedMidi: midis[0] ?? null,
    expectedMidis: midis,
    isChord: midis.length > 1,
    notes: midis.map((midi, index) => ({
      id: `${id}-n${index}`,
      midi,
      voice: extra.voice ?? 1,
      staff: extra.staff ?? 1,
      partId: extra.partId ?? 'P1',
      timeSeconds,
      durationSeconds: extra.durationSeconds ?? 0.5,
      ...extra.noteOverrides?.[index],
    })),
    ...extra,
  }
}

describe('Mic Engine V3 performance expectation', () => {
  it('normalizes score, timing, neighbor, voice, measure, and sustain context', () => {
    const checkpoints = [
      checkpoint('previous', 1, [60]),
      checkpoint('current', 2, [60, 64, 67], {
        index: 1,
        measureNumber: 4,
        beat: 2,
        durationSeconds: 1.5,
        noteOverrides: [{ tieStart: true }, {}, {}],
      }),
      checkpoint('next', 3, [67, 71]),
    ]
    const expectation = buildPerformanceExpectation({
      checkpoint: checkpoints[1],
      checkpointIndex: 1,
      checkpoints,
      instrument: 'Piano',
      mode: PERFORMANCE_MODE.PLAY_ALONG,
    })

    expect(expectation.instrument).toBe('piano')
    expect(expectation.event.kind).toBe(EXPECTED_EVENT_KIND.CHORD)
    expect(expectation.event.requiredToneCount).toBe(3)
    expect(expectation.score.measure).toBe(4)
    expect(expectation.score.voices).toEqual([1])
    expect(expectation.timing.earlyStartMs).toBe(1850)
    expect(expectation.timing.targetEndMs).toBe(2120)
    expect(expectation.neighbors.previous.sharesToneWithCurrent).toBe(true)
    expect(expectation.neighbors.next.sharesToneWithCurrent).toBe(true)
    expect(expectation.sustain.expected).toBe(true)
    expect(expectation.policy.preserveSpeechNoiseRejection).toBe(true)
    expect(Object.isFrozen(expectation)).toBe(true)
  })

  it('requires both notes of a double-stop and preserves string/fret metadata', () => {
    const target = checkpoint('guitar-dyad', 1, [55, 59], {
      notes: [
        { id: 'g-string', midi: 55, string: 3, fret: 0, voice: 1 },
        { id: 'b-string', midi: 59, string: 2, fret: 0, voice: 1 },
      ],
      expectedStringFrets: [
        { noteId: 'g-string', midi: 55, string: 3, fret: 0 },
        { noteId: 'b-string', midi: 59, string: 2, fret: 0 },
      ],
    })
    const expectation = buildPerformanceExpectation({
      checkpoint: target,
      instrument: 'guitar',
    })

    expect(expectation.event.kind).toBe(EXPECTED_EVENT_KIND.DOUBLE_STOP)
    expect(expectation.event.requiredToneCount).toBe(2)
    expect(expectation.policy.doubleStopRequiresBoth).toBe(true)
    expect(expectation.policy.oneNoteMayComplete).toBe(false)
    expect(expectation.event.expectedNotes.map((note) => [note.string, note.fret])).toEqual([
      [3, 0],
      [2, 0],
    ])
  })

  it('uses a guitar quorum for 3+ tones while piano requires all tones', () => {
    const target = checkpoint('large-chord', 1, [40, 45, 50, 55, 59, 64], {
      minimumRequiredTones: 3,
      rollingWindowMs: 900,
    })
    const guitar = buildPerformanceExpectation({ checkpoint: target, instrument: 'guitar' })
    const piano = buildPerformanceExpectation({ checkpoint: target, instrument: 'piano' })

    expect(guitar.event.requiredToneCount).toBe(3)
    expect(guitar.policy.chordUsesQuorum).toBe(true)
    expect(guitar.event.allowsRollingCompletion).toBe(true)
    expect(piano.event.requiredToneCount).toBe(6)
    expect(piano.policy.chordUsesQuorum).toBe(false)
  })

  it('models tied continuations as held events without a fresh attack', () => {
    const target = checkpoint('tie', 2, [60], {
      isTiedContinuation: true,
      notes: [{
        id: 'tie-note',
        midi: 60,
        tieStop: true,
        suppressPlaybackAttack: true,
        durationSeconds: 1,
      }],
    })
    const expectation = buildPerformanceExpectation({ checkpoint: target, instrument: 'piano' })

    expect(expectation.event.kind).toBe(EXPECTED_EVENT_KIND.TIED_HOLD)
    expect(expectation.event.requiredToneCount).toBe(0)
    expect(expectation.ties.attackRequired).toBe(false)
    expect(expectation.policy.requiresFreshAttack).toBe(false)
  })

  it('does not mutate source checkpoints', () => {
    const target = checkpoint('immutable', 1, [60])
    const before = JSON.stringify(target)
    buildPerformanceExpectation({ checkpoint: target, instrument: 'piano' })
    expect(JSON.stringify(target)).toBe(before)
  })
})

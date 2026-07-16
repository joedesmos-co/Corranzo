import { describe, expect, it } from 'vitest'
import {
  ATTACK_PHASE,
  RECOGNITION_OUTCOME,
  RECOGNITION_TIMING,
  createRecognitionDecision,
} from '../src/features/microphone-input/v3/micRecognitionIr.js'
import {
  PERFORMANCE_MODE,
  buildPerformanceExpectation,
} from '../src/features/microphone-input/v3/performanceExpectation.js'
import {
  applyRecognitionTiming,
  classifyRecognitionTiming,
  createMusicalTimingState,
  markMusicalTimingConsumed,
  updateMusicalTiming,
} from '../src/features/microphone-input/v3/musicalTiming.js'

function expectation({
  id = 'timing-c4',
  midi = 60,
  mode = PERFORMANCE_MODE.PLAY_ALONG,
  timeSeconds = 1,
  tied = false,
} = {}) {
  const checkpoint = {
    id,
    timeSeconds,
    expectedMidi: midi,
    expectedMidis: [midi],
    isTiedContinuation: tied,
    notes: [{
      id: `${id}-note`,
      midi,
      tieStop: tied,
      suppressPlaybackAttack: tied,
    }],
  }
  return buildPerformanceExpectation({
    checkpoint,
    checkpointIndex: 0,
    checkpoints: [checkpoint],
    instrument: 'piano',
    mode,
  })
}

function frame({ timeMs = 1000, rms = 0.04, gateOpen = true, musical = true, ringingMidis = [], ...extra } = {}) {
  return {
    timeMs,
    gateOpen,
    musical,
    filteredRms: rms,
    ringingMidis,
    ...extra,
  }
}

function acceptedDecision(target, timeMs = 1000) {
  return createRecognitionDecision({
    checkpointId: target.id,
    windowId: 'window-1',
    timeMs,
    outcome: RECOGNITION_OUTCOME.ACCEPTED,
    timing: RECOGNITION_TIMING.UNTIMED,
    reason: 'expected-piano-event-complete',
    advance: true,
    matchedMidis: target.event.expectedMidis,
    confidence: { overall: 0.9, temporal: 1 },
  })
}

describe('Mic V3 musical timing windows', () => {
  it('classifies early, target, late, and outside Play Along attacks', () => {
    const target = expectation()
    expect(classifyRecognitionTiming(target, 800)).toBe(RECOGNITION_TIMING.OUTSIDE)
    expect(classifyRecognitionTiming(target, 880)).toBe(RECOGNITION_TIMING.EARLY)
    expect(classifyRecognitionTiming(target, 1000)).toBe(RECOGNITION_TIMING.TARGET)
    expect(classifyRecognitionTiming(target, 1200)).toBe(RECOGNITION_TIMING.LATE)
    expect(classifyRecognitionTiming(target, 1300)).toBe(RECOGNITION_TIMING.OUTSIDE)
  })

  it('keeps Wait For You untimed because its playhead is checkpoint-held', () => {
    const target = expectation({ mode: PERFORMANCE_MODE.WAIT_FOR_YOU })
    expect(classifyRecognitionTiming(target, 1)).toBe(RECOGNITION_TIMING.UNTIMED)
  })

  it('tracks attack, hold, ringing, and release phases', () => {
    const target = expectation()
    let state = createMusicalTimingState(target)
    const attack = updateMusicalTiming({ expectation: target, state, frame: frame(), timeMs: 1000 })
    expect(attack.phase).toBe(ATTACK_PHASE.ATTACK)
    expect(attack.fresh).toBe(true)
    expect(attack.authority.mayAdvance).toBe(true)
    state = attack.state

    const hold = updateMusicalTiming({ expectation: target, state, frame: frame({ timeMs: 1040, rms: 0.035 }), timeMs: 1040 })
    expect(hold.phase).toBe(ATTACK_PHASE.HOLD)
    expect(hold.fresh).toBe(false)
    state = hold.state

    const ringing = updateMusicalTiming({
      expectation: target,
      state,
      frame: frame({ timeMs: 1080, gateOpen: false, rms: 0.02, ringingMidis: [60] }),
      timeMs: 1080,
    })
    expect(ringing.phase).toBe(ATTACK_PHASE.RINGING)
    state = ringing.state

    for (let index = 0; index < 4; index += 1) {
      const released = updateMusicalTiming({
        expectation: target,
        state,
        frame: frame({ timeMs: 1120 + index * 20, gateOpen: false, rms: 0, ringingMidis: [] }),
        timeMs: 1120 + index * 20,
      })
      state = released.state
    }
    expect(state.phase).toBe(ATTACK_PHASE.RELEASE)
    expect(state.activeAttackId).toBeNull()
  })

  it('allows an expected attack slightly early but blocks the same match outside the score window', () => {
    const target = expectation()
    const earlyTiming = updateMusicalTiming({
      expectation: target,
      state: createMusicalTimingState(target),
      frame: frame({ timeMs: 880 }),
      timeMs: 880,
    })
    const early = applyRecognitionTiming(acceptedDecision(target, 880), earlyTiming)
    expect(early.timing).toBe(RECOGNITION_TIMING.EARLY)
    expect(early.advance).toBe(true)

    const outsideTiming = updateMusicalTiming({
      expectation: target,
      state: createMusicalTimingState(target),
      frame: frame({ timeMs: 800 }),
      timeMs: 800,
    })
    const outside = applyRecognitionTiming(acceptedDecision(target, 800), outsideTiming)
    expect(outside.timing).toBe(RECOGNITION_TIMING.OUTSIDE)
    expect(outside.outcome).toBe(RECOGNITION_OUTCOME.REJECTED)
    expect(outside.advance).toBe(false)
  })

  it('does not let a ringing transition skip the next checkpoint', () => {
    const firstTarget = expectation({ id: 'first', midi: 60 })
    const first = updateMusicalTiming({
      expectation: firstTarget,
      state: createMusicalTimingState(firstTarget),
      frame: frame({ rms: 0.08 }),
      timeMs: 1000,
    })
    const consumed = markMusicalTimingConsumed(first.state, { matchedMidis: [60] })
    const nextTarget = expectation({ id: 'next', midi: 64, timeSeconds: 1.2 })
    const ring = updateMusicalTiming({
      expectation: nextTarget,
      state: consumed,
      frame: frame({ timeMs: 1100, rms: 0.035, ringingMidis: [60] }),
      timeMs: 1100,
    })
    expect(ring.fresh).toBe(false)
    expect(ring.authority.mayAdvance).toBe(false)

    const newAttack = updateMusicalTiming({
      expectation: nextTarget,
      state: ring.state,
      frame: frame({ timeMs: 1180, rms: 0.08 }),
      timeMs: 1180,
    })
    expect(newAttack.fresh).toBe(true)
    expect(newAttack.authority.mayAdvance).toBe(true)
  })

  it('requires an energy rise for a repeated note while the old note rings', () => {
    const firstTarget = expectation({ id: 'repeat-1' })
    const first = updateMusicalTiming({
      expectation: firstTarget,
      state: createMusicalTimingState(firstTarget),
      frame: frame({ rms: 0.07 }),
      timeMs: 1000,
    })
    const repeatTarget = expectation({ id: 'repeat-2', timeSeconds: 1.2 })
    const consumed = markMusicalTimingConsumed(first.state, { matchedMidis: [60] })
    const decay = updateMusicalTiming({
      expectation: repeatTarget,
      state: consumed,
      frame: frame({ timeMs: 1100, rms: 0.03, ringingMidis: [60] }),
      timeMs: 1100,
    })
    expect(decay.fresh).toBe(false)
    const repeat = updateMusicalTiming({
      expectation: repeatTarget,
      state: decay.state,
      frame: frame({ timeMs: 1180, rms: 0.065, ringingMidis: [60] }),
      timeMs: 1180,
    })
    expect(repeat.fresh).toBe(true)
    expect(repeat.attack.debug.energyRise).toBe(true)
  })

  it('models tied notes as holds, never as fresh checkpoint advances', () => {
    const target = expectation({ tied: true })
    const held = updateMusicalTiming({
      expectation: target,
      state: createMusicalTimingState(target),
      frame: frame({ gateOpen: false, ringingMidis: [60], rms: 0.02 }),
      timeMs: 1000,
    })
    expect(held.phase).toBe(ATTACK_PHASE.RINGING)
    expect(held.authority.mayHold).toBe(true)
    expect(held.authority.mayAdvance).toBe(false)
  })

  it('returns serializable immutable attack and decision snapshots', () => {
    const target = expectation()
    const timing = updateMusicalTiming({
      expectation: target,
      state: createMusicalTimingState(target),
      frame: frame(),
      timeMs: 1000,
    })
    const decision = applyRecognitionTiming(acceptedDecision(target), timing)
    expect(Object.isFrozen(timing.attack)).toBe(true)
    expect(Object.isFrozen(decision)).toBe(true)
    expect(() => JSON.stringify({ attack: timing.attack, decision, state: timing.state })).not.toThrow()
  })
})

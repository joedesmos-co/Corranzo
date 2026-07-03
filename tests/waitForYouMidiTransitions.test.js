import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  canMarkWaitForYouCheckpoint,
  getWaitForYouStatus,
  WFY_STATUS,
} from '../src/features/practice/waitForYouEngine.js'
import {
  createMusicalEventBufferState,
  evaluateNoteInput,
  MATCH_OUTCOME,
  resetMusicalEventBufferState,
  resolveRolledChordSlideWindowMs,
  resolveRolledChordTotalCapMs,
} from '../src/features/practice/waitForYouNoteMatch.js'
import {
  normalizeMatchSettings,
  ROLLED_CHORD_TOTAL_CAP_MS,
  WFY_MATCH_DEFAULTS,
} from '../src/features/practice/waitForYouMatchSettings.js'
import { CHECKPOINT_KIND } from '../src/features/practice/waitForYouCheckpoints.js'

const C4 = 60
const E4 = 64
const G4 = 67
const F4 = 65

const settings = normalizeMatchSettings(WFY_MATCH_DEFAULTS)

function noteCheckpoint(midis, id = 'cp-1') {
  return {
    id,
    expectedMidis: midis,
    expectedMidi: midis[0],
    isChord: midis.length > 1,
    kind: CHECKPOINT_KIND.NOTE,
  }
}

describe('Wait For You — MIDI rolled chords (input timing)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses chordWindowMs for slide gaps, not musicalEventWindowMs', () => {
    expect(resolveRolledChordSlideWindowMs(settings)).toBe(500)
    expect(resolveRolledChordTotalCapMs(settings)).toBe(ROLLED_CHORD_TOTAL_CAP_MS)
  })

  it('completes a rolled chord when tones arrive within the sliding gap', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])

    vi.setSystemTime(0)
    expect(evaluateNoteInput(cp, C4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)

    vi.setSystemTime(400)
    expect(evaluateNoteInput(cp, E4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)

    vi.setSystemTime(850)
    expect(evaluateNoteInput(cp, G4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('resets partial progress after the slide window expires', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])

    vi.setSystemTime(0)
    evaluateNoteInput(cp, C4, state, settings)

    vi.setSystemTime(600)
    const afterGap = evaluateNoteInput(cp, E4, state, settings)
    expect(afterGap.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(afterGap.matchedIndices.size).toBe(1)
    expect([...afterGap.matchedIndices]).toEqual([1])
  })

  it('resets partial progress when the total cap is exceeded', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])

    vi.setSystemTime(0)
    evaluateNoteInput(cp, C4, state, settings)

    vi.setSystemTime(400)
    evaluateNoteInput(cp, E4, state, settings)

    vi.setSystemTime(ROLLED_CHORD_TOTAL_CAP_MS + 50)
    const late = evaluateNoteInput(cp, G4, state, settings)
    expect(late.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(late.matchedIndices.size).toBe(1)
  })

  it('still tolerates duplicate chord tones', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])

    evaluateNoteInput(cp, C4, state, settings)
    const dup = evaluateNoteInput(cp, C4, state, settings)
    expect(dup.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(dup.duplicate).toBe(true)
  })

  it('still flags wrong notes outside the chord', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])
    const wrong = evaluateNoteInput(cp, F4, state, settings)
    expect(wrong.outcome).toBe(MATCH_OUTCOME.WRONG)
  })
})

describe('Wait For You — MIDI checkpoint transitions', () => {
  it('no-ops on null or empty checkpoints', () => {
    const state = createMusicalEventBufferState()
    expect(evaluateNoteInput(null, C4, state, settings).outcome).toBe(MATCH_OUTCOME.NO_EXPECTED)
    expect(
      evaluateNoteInput({ expectedMidis: [] }, C4, state, settings).outcome,
    ).toBe(MATCH_OUTCOME.NO_EXPECTED)
  })

  it('clears chord buffer when the checkpoint changes', () => {
    const state = createMusicalEventBufferState()
    const cpA = noteCheckpoint([C4, E4, G4], 'cp-a')
    const cpB = noteCheckpoint([F4], 'cp-b')

    evaluateNoteInput(cpA, C4, state, settings)
    expect(state.matchedIndices.size).toBe(1)

    resetMusicalEventBufferState(state)
    const next = evaluateNoteInput(cpB, F4, state, settings)
    expect(next.outcome).toBe(MATCH_OUTCOME.COMPLETE)
    expect(state.matchedIndices.size).toBe(0)
  })

  it('does not allow marking when complete or when there are no checkpoints', () => {
    expect(
      canMarkWaitForYouCheckpoint({
        active: true,
        checkpointCount: 0,
        checkpointIndex: 0,
      }),
    ).toBe(false)
    expect(
      getWaitForYouStatus({ active: true, checkpointCount: 3, checkpointIndex: 3 }),
    ).toBe(WFY_STATUS.COMPLETE)
    expect(
      canMarkWaitForYouCheckpoint({
        active: true,
        checkpointCount: 3,
        checkpointIndex: 3,
      }),
    ).toBe(false)
    expect(
      getWaitForYouStatus({ active: true, checkpointCount: 0, checkpointIndex: 0 }),
    ).toBe(WFY_STATUS.NO_CHECKPOINTS)
  })

  it('ignores stale input feedback after simulating advance to the next checkpoint', () => {
    const state = createMusicalEventBufferState()
    const cpA = noteCheckpoint([C4], 'cp-a')
    const cpB = noteCheckpoint([E4], 'cp-b')

    expect(evaluateNoteInput(cpA, C4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
    resetMusicalEventBufferState(state)

    const stale = evaluateNoteInput(cpB, C4, state, settings)
    expect(stale.outcome).toBe(MATCH_OUTCOME.WRONG)

    const correct = evaluateNoteInput(cpB, E4, state, settings)
    expect(correct.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })
})

describe('Wait For You — piano and guitar checkpoints share MIDI matching', () => {
  it('matches piano-style polyphonic checkpoints', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])
    evaluateNoteInput(cp, C4, state, settings)
    evaluateNoteInput(cp, E4, state, settings)
    expect(evaluateNoteInput(cp, G4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('matches guitar-style chord voicings (open G spread)', () => {
    const state = createMusicalEventBufferState()
    const G3 = 55
    const B3 = 59
    const D4 = 62
    const cp = noteCheckpoint([G3, B3, D4])

    vi.setSystemTime(0)
    evaluateNoteInput(cp, G3, state, settings)
    vi.setSystemTime(300)
    evaluateNoteInput(cp, B3, state, settings)
    vi.setSystemTime(700)
    expect(evaluateNoteInput(cp, D4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })
})

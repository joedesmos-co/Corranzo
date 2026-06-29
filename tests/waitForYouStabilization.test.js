import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { resolvePageFollowTarget } from '../src/features/practice/usePracticePageFollow.js'
import {
  buildNoteCheckpoints,
  NOTE_TIME_GROUP_SECONDS,
} from '../src/features/practice/waitForYouCheckpoints.js'
import {
  createMusicalEventBufferState,
  evaluateNoteInput,
  MATCH_OUTCOME,
  resolveMusicalEventWindowMs,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings, WFY_MATCH_DEFAULTS } from '../src/features/practice/waitForYouMatchSettings.js'

const C4 = 60
const E4 = 64
const G4 = 67
const A4 = 69
const settings = normalizeMatchSettings(WFY_MATCH_DEFAULTS)
const noteCheckpoint = (midis) => ({
  expectedMidis: midis,
  expectedMidi: midis[0],
  isChord: midis.length > 1,
})

describe('Wait For You stabilization — page follow', () => {
  it('follows the note target page when the playback cursor is hidden', () => {
    expect(
      resolvePageFollowTarget({
        cursor: { visible: false, page: 1 },
        noteFollowTarget: { active: true, page: 3 },
      }),
    ).toBe(3)
  })

  it('falls back to the visible playback cursor when no note target is active', () => {
    expect(
      resolvePageFollowTarget({
        cursor: { visible: true, page: 2 },
        noteFollowTarget: null,
      }),
    ).toBe(2)
  })
})

describe('Wait For You stabilization — checkpoint grouping', () => {
  it('groups hand-separated notes within the musical grouping window', () => {
    const timingMap = {
      notes: [
        { midi: C4, timeSeconds: 1.0, measureNumber: 1, label: 'C4', isRest: false },
        { midi: E4, timeSeconds: 1.0, measureNumber: 1, label: 'E4', isRest: false },
        { midi: G4, timeSeconds: 1.0 + NOTE_TIME_GROUP_SECONDS * 0.5, measureNumber: 1, label: 'G4', isRest: false },
        { midi: A4, timeSeconds: 2.0, measureNumber: 1, label: 'A4', isRest: false },
      ],
      beats: [{ measureNumber: 1, beat: 1, timeSeconds: 1.0 }],
    }

    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints[0].expectedMidis).toEqual([C4, E4, G4])
    expect(checkpoints[1].expectedMidis).toEqual([A4])
  })
})

describe('Wait For You stabilization — musical event buffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts simultaneous chord tones', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])
    expect(evaluateNoteInput(cp, C4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(cp, E4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(cp, G4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('accepts chord plus delayed single note within the window', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])
    const windowMs = resolveMusicalEventWindowMs(settings)

    expect(evaluateNoteInput(cp, C4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(cp, E4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    vi.advanceTimersByTime(windowMs * 0.6)
    expect(evaluateNoteInput(cp, G4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('does not pass when the final note arrives outside the window', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])
    const windowMs = resolveMusicalEventWindowMs(settings)

    expect(evaluateNoteInput(cp, C4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(cp, E4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    vi.advanceTimersByTime(windowMs + 20)
    const late = evaluateNoteInput(cp, G4, state, settings)
    expect(late.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(late.matchedCount).toBe(1)
  })

  it('tolerates an extra duplicate chord tone without failing', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4])
    evaluateNoteInput(cp, C4, state, settings)
    const duplicate = evaluateNoteInput(cp, C4, state, settings)
    expect(duplicate.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(duplicate.duplicate).toBe(true)
    expect(evaluateNoteInput(cp, E4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })
})

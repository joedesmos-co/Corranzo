import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  createMicCalibration,
  finalizeMicCalibration,
  forceMicCalibrationTimeout,
  MIC_CALIBRATION_STATUS,
  MIC_CALIBRATION_TIMEOUT_MS,
  pushCalibrationSample,
  shouldAcceptCalibrationSample,
} from '../src/features/microphone-input/micCalibration.js'
import { resolvePageFollowTarget } from '../src/features/practice/usePracticePageFollow.js'
import {
  buildNoteCheckpoints,
  NOTE_TIME_GROUP_SECONDS,
} from '../src/features/practice/waitForYouCheckpoints.js'
import {
  NOTE_TARGET_MARKER_OFFSET_Y,
  resolveNoteTargetPosition,
} from '../src/features/practice/noteTargetPosition.js'
import { idleFeedbackForCheckpoint } from '../src/features/practice/waitForYouInputFeedback.js'
import {
  createMusicalEventBufferState,
  evaluateMicNoteInput,
  evaluateMicNoteInputWithBuffer,
  evaluateNoteInput,
  MATCH_OUTCOME,
  resolveMicChordSequenceWindowMs,
  resolveMusicalEventWindowMs,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings, WFY_MATCH_DEFAULTS } from '../src/features/practice/waitForYouMatchSettings.js'
import { CHECKPOINT_KIND } from '../src/features/practice/waitForYouCheckpoints.js'

const C4 = 60
const E4 = 64
const G4 = 67
const A4 = 69
const D_SHARP5 = 75
const F_SHARP5 = 78
const settings = normalizeMatchSettings(WFY_MATCH_DEFAULTS)
const noteCheckpoint = (midis) => ({
  expectedMidis: midis,
  expectedMidi: midis[0],
  isChord: midis.length > 1,
  kind: CHECKPOINT_KIND.NOTE,
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

describe('Wait For You stabilization — musical event buffer (MIDI)', () => {
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

describe('Wait For You stabilization — mic chord honesty', () => {
  it('does not complete a multi-note chord on the first mic detection in any-tone mode', () => {
    const cp = noteCheckpoint([D_SHARP5, F_SHARP5])
    const result = evaluateMicNoteInput(cp, D_SHARP5, settings)
    expect(result.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
  })

  it('collects sequential mic chord tones within the longer mic window', () => {
    vi.useFakeTimers()
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([D_SHARP5, F_SHARP5])
    expect(evaluateMicNoteInputWithBuffer(cp, D_SHARP5, state, settings).outcome).toBe(
      MATCH_OUTCOME.CHORD_PROGRESS,
    )
    vi.advanceTimersByTime(resolveMicChordSequenceWindowMs(settings) * 0.4)
    expect(evaluateMicNoteInputWithBuffer(cp, F_SHARP5, state, settings).outcome).toBe(
      MATCH_OUTCOME.COMPLETE,
    )
    vi.useRealTimers()
  })
})

describe('Wait For You stabilization — chord checkpoint display', () => {
  it('shows combined pitch labels for chord checkpoints', () => {
    const feedback = idleFeedbackForCheckpoint(noteCheckpoint([D_SHARP5, F_SHARP5]))
    expect(feedback.message).toBe('Play D#5 + F#5 together')
  })
})

describe('Wait For You stabilization — marker offset', () => {
  it('places the marker above the note anchor', () => {
    const timingMap = {
      measures: [{ number: 1, timeSeconds: 0 }],
      notes: [{ midi: C4, timeSeconds: 1, measureNumber: 1, staff: 1, isRest: false }],
    }
    const anchors = [
      { page: 1, x: 0.2, y: 0.5, measureNumber: 1, source: 'manual' },
      { page: 1, x: 0.6, y: 0.5, measureNumber: 2, source: 'manual' },
    ]
    const checkpoint = {
      kind: CHECKPOINT_KIND.NOTE,
      measureNumber: 1,
      timeSeconds: 1,
      expectedMidis: [C4],
      notes: timingMap.notes,
      isChord: false,
    }
    const target = resolveNoteTargetPosition({ checkpoint, timingMap, anchors })
    expect(target.visible).toBe(true)
    expect(target.markerOffsetY).toBe(NOTE_TARGET_MARKER_OFFSET_Y)
    expect(target.y).toBeLessThan(target.noteAnchorY)
  })
})

describe('Wait For You stabilization — mic calibration timeout', () => {
  it('never leaves measuring as a final calibration status', () => {
    const state = createMicCalibration({ frames: 45 })
    forceMicCalibrationTimeout(state)
    const result = finalizeMicCalibration(state)
    expect(result.status).not.toBe(MIC_CALIBRATION_STATUS.MEASURING)
  })

  it('finishes after the timeout even with few quiet samples', () => {
    const state = createMicCalibration({ frames: 45 })
    forceMicCalibrationTimeout(state)
    const result = finalizeMicCalibration(state)
    expect(result.status).not.toBe(MIC_CALIBRATION_STATUS.MEASURING)
    expect(result.timedOut).toBe(true)
  })

  it('ignores loud pitched frames during calibration sampling', () => {
    expect(
      shouldAcceptCalibrationSample({ rms: 0.02, gateOpen: true, hasPitch: true }),
    ).toBe(false)
    expect(
      shouldAcceptCalibrationSample({ rms: 0.004, gateOpen: false, hasPitch: false }),
    ).toBe(true)
  })

  it('uses a bounded calibration timeout', () => {
    expect(MIC_CALIBRATION_TIMEOUT_MS).toBeGreaterThanOrEqual(2000)
    expect(MIC_CALIBRATION_TIMEOUT_MS).toBeLessThanOrEqual(3000)
  })
})

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
  createMicChordCollectionState,
  evaluateMicChordCollection,
  resetMicChordCollectionProgress,
  resolveMicChordCollectionWindowMs,
  resolveMicChordStableHitsRequired,
} from '../src/features/practice/waitForYouMicChordCollection.js'
import {
  createMusicalEventBufferState,
  evaluateMicNoteInput,
  evaluateMicNoteInputWithBuffer,
  evaluateNoteInput,
  MATCH_OUTCOME,
  resolveMusicalEventWindowMs,
} from '../src/features/practice/waitForYouNoteMatch.js'
import {
  MIC_CHORD_COLLECTION_WINDOW_MS,
  MIC_CHORD_STABLE_HITS_REQUIRED,
  normalizeMatchSettings,
  WFY_MATCH_DEFAULTS,
} from '../src/features/practice/waitForYouMatchSettings.js'
import { CHECKPOINT_KIND } from '../src/features/practice/waitForYouCheckpoints.js'

const C3 = 48
const C4 = 60
const E4 = 64
const E5 = 76
const G3 = 55
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

function confirmMicTone(state, expected, midi, hits = MIC_CHORD_STABLE_HITS_REQUIRED) {
  let last = null
  for (let index = 0; index < hits; index += 1) {
    last = evaluateMicChordCollection({
      expected,
      playedMidi: midi,
      state,
      settings,
      micChordMode: 'any-tone',
    })
  }
  return last
}

describe('Wait For You — mic chord collection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the configured collection window and stable-hit defaults', () => {
    expect(resolveMicChordCollectionWindowMs(settings)).toBe(MIC_CHORD_COLLECTION_WINDOW_MS)
    expect(resolveMicChordStableHitsRequired(settings)).toBe(MIC_CHORD_STABLE_HITS_REQUIRED)
  })

  it('collects chord tones sequentially with stable hits and passes', () => {
    const state = createMicChordCollectionState()
    const expected = [C3, G3, E5]
    expect(confirmMicTone(state, expected, C3).outcome).not.toBe(MATCH_OUTCOME.COMPLETE)
    expect(confirmMicTone(state, expected, G3).matchedCount).toBe(2)
    const done = confirmMicTone(state, expected, E5)
    expect(done.outcome).toBe(MATCH_OUTCOME.COMPLETE)
    expect(done.heardLabels).toEqual(['C3', 'G3', 'E5'])
  })

  it('accepts chord tones out of order', () => {
    const state = createMicChordCollectionState()
    const expected = [C3, G3, E5]
    confirmMicTone(state, expected, E5)
    confirmMicTone(state, expected, C3)
    const done = confirmMicTone(state, expected, G3)
    expect(done.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('resets partial progress when the collection window expires', () => {
    const state = createMicChordCollectionState()
    const expected = [C3, G3, E5]
    const start = Date.now()
    vi.setSystemTime(start)
    confirmMicTone(state, expected, C3)
    expect(state.matchedIndices.size).toBe(1)
    vi.setSystemTime(start + resolveMicChordCollectionWindowMs(settings) + 10)
    const afterTimeout = evaluateMicChordCollection({
      expected,
      playedMidi: G3,
      state,
      settings,
      micChordMode: 'any-tone',
    })
    expect(afterTimeout.windowReset).toBe(true)
    expect(state.matchedIndices.size).toBe(0)
  })

  it('reports a soft wrong note without wiping heard tones', () => {
    const state = createMicChordCollectionState()
    const expected = [C3, G3, E5]
    confirmMicTone(state, expected, C3)
    const wrong = evaluateMicChordCollection({
      expected,
      playedMidi: A4,
      state,
      settings,
      micChordMode: 'any-tone',
    })
    expect(wrong.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(wrong.softWrong).toBe(true)
    expect(state.matchedIndices.size).toBe(1)
    expect(wrong.heardLabels).toEqual(['C3'])
  })

  it('fails only after repeated wrong notes', () => {
    const state = createMicChordCollectionState()
    const expected = [C3, G3]
    const firstWrong = evaluateMicChordCollection({
      expected,
      playedMidi: A4,
      state,
      settings,
      micChordMode: 'any-tone',
    })
    expect(firstWrong.softWrong).toBe(true)
    const secondWrong = evaluateMicChordCollection({
      expected,
      playedMidi: A4,
      state,
      settings,
      micChordMode: 'any-tone',
    })
    expect(secondWrong.outcome).toBe(MATCH_OUTCOME.WRONG)
  })

  it('keeps single-note mic matching fast', () => {
    const cp = noteCheckpoint([E4])
    const result = evaluateMicNoteInput(cp, E4, settings)
    expect(result.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('wires collection through evaluateMicNoteInputWithBuffer', () => {
    const state = createMicChordCollectionState()
    const cp = noteCheckpoint([D_SHARP5, F_SHARP5])
    let result = null
    for (let index = 0; index < MIC_CHORD_STABLE_HITS_REQUIRED; index += 1) {
      result = evaluateMicNoteInputWithBuffer(cp, D_SHARP5, state, settings)
    }
    expect(result.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    for (let index = 0; index < MIC_CHORD_STABLE_HITS_REQUIRED; index += 1) {
      result = evaluateMicNoteInputWithBuffer(cp, F_SHARP5, state, settings)
    }
    expect(result.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })
})

describe('Wait For You — MIDI chord unchanged', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts simultaneous MIDI chord tones within 180ms', () => {
    const state = createMusicalEventBufferState()
    const cp = noteCheckpoint([C4, E4, G4])
    expect(evaluateNoteInput(cp, C4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(cp, E4, state, settings).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(cp, G4, state, settings).outcome).toBe(MATCH_OUTCOME.COMPLETE)
    expect(resolveMusicalEventWindowMs(settings)).toBe(180)
  })
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
    expect(checkpoints[0].expectedMidis).toEqual([C4, E4, G4])
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
    expect(target.y).toBeLessThan(target.noteAnchorY)
    expect(target.markerOffsetY).toBe(NOTE_TARGET_MARKER_OFFSET_Y)
  })
})

describe('Wait For You stabilization — mic calibration timeout', () => {
  it('never leaves measuring as a final calibration status', () => {
    const state = createMicCalibration({ frames: 45 })
    forceMicCalibrationTimeout(state)
    expect(finalizeMicCalibration(state).status).not.toBe(MIC_CALIBRATION_STATUS.MEASURING)
  })

  it('uses a bounded calibration timeout', () => {
    expect(MIC_CALIBRATION_TIMEOUT_MS).toBeGreaterThanOrEqual(2000)
    expect(MIC_CALIBRATION_TIMEOUT_MS).toBeLessThanOrEqual(3000)
  })
})

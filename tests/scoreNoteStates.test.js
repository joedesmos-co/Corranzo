import { describe, expect, it } from 'vitest'
import {
  SCORE_NOTE_STATE,
  expectedToneIndexForMidi,
  findScoreEventIndexAtTime,
  mapPlayAlongOutcomeToScoreState,
  resolveChordToneStates,
  resolveWfyScoreNoteStates,
} from '../src/features/practice/scoreNoteStates.js'
import { WFY_STATUS } from '../src/features/practice/waitForYouEngine.js'
import { WFY_INPUT_OUTCOME } from '../src/features/practice/waitForYouInputFeedback.js'
import { VISUAL_LANE_OUTCOME } from '../src/features/practice/visualLaneFeedback.js'

function checkpoints(count, start = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: `cp-${index}`,
    timeSeconds: start + index,
    measureNumber: 1 + Math.floor(index / 4),
    expectedMidis: [60 + index],
    expectedMidi: 60 + index,
    kind: 'note',
  }))
}

describe('WFY score note states', () => {
  it('marks completed trail + current required note', () => {
    const states = resolveWfyScoreNoteStates({
      checkpoints: checkpoints(5),
      checkpointIndex: 2,
      status: WFY_STATUS.WAITING,
      inputFeedback: { outcome: WFY_INPUT_OUTCOME.IDLE },
    })
    expect(states.get(0)).toBe(SCORE_NOTE_STATE.COMPLETED)
    expect(states.get(1)).toBe(SCORE_NOTE_STATE.COMPLETED)
    expect(states.get(2)).toBe(SCORE_NOTE_STATE.CURRENT)
    expect(states.has(3)).toBe(false)
    expect(states.has(4)).toBe(false)
  })

  it('flags wrong input on the current checkpoint without advancing', () => {
    const states = resolveWfyScoreNoteStates({
      checkpoints: checkpoints(3),
      checkpointIndex: 1,
      status: WFY_STATUS.WAITING,
      inputFeedback: { outcome: WFY_INPUT_OUTCOME.WRONG, playedMidi: 61 },
    })
    expect(states.get(0)).toBe(SCORE_NOTE_STATE.COMPLETED)
    expect(states.get(1)).toBe(SCORE_NOTE_STATE.WRONG)
    expect(states.has(2)).toBe(false)
  })

  it('distinguishes partial chords from untouched required chords', () => {
    const chord = {
      id: 'chord',
      timeSeconds: 0,
      measureNumber: 1,
      expectedMidis: [60, 64, 67],
      isChord: true,
      kind: 'chord',
    }
    const partial = resolveWfyScoreNoteStates({
      checkpoints: [chord],
      checkpointIndex: 0,
      status: WFY_STATUS.WAITING,
      inputFeedback: {
        outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
        matchedIndices: [0, 1],
      },
    })
    expect(partial.get(0)).toBe(SCORE_NOTE_STATE.CURRENT_PARTIAL)

    const untouched = resolveWfyScoreNoteStates({
      checkpoints: [chord],
      checkpointIndex: 0,
      status: WFY_STATUS.WAITING,
      inputFeedback: { outcome: WFY_INPUT_OUTCOME.CHORD_WAITING, matchedIndices: [] },
    })
    expect(untouched.get(0)).toBe(SCORE_NOTE_STATE.CURRENT)
  })

  it('returns no states when not waiting (complete / inactive)', () => {
    expect(
      resolveWfyScoreNoteStates({
        checkpoints: checkpoints(3),
        checkpointIndex: 3,
        status: WFY_STATUS.COMPLETE,
      }).size,
    ).toBe(0)
    expect(
      resolveWfyScoreNoteStates({
        checkpoints: checkpoints(3),
        checkpointIndex: 0,
        status: WFY_STATUS.INACTIVE,
      }).size,
    ).toBe(0)
  })

  it('resolves per-tone completion for C4+E4+G4 with C4+E4 played', () => {
    const chord = { expectedMidis: [60, 64, 67], isChord: true }
    const tones = resolveChordToneStates(chord, [0, 1])
    expect(tones).toEqual([
      { midi: 60, index: 0, completed: true },
      { midi: 64, index: 1, completed: true },
      { midi: 67, index: 2, completed: false },
    ])
  })

  it('accepts matched indices as Set or array', () => {
    const chord = { expectedMidis: [60, 64], isChord: true }
    expect(resolveChordToneStates(chord, new Set([1]))[1].completed).toBe(true)
    expect(resolveChordToneStates(chord, new Set([1]))[0].completed).toBe(false)
  })

  it('maps note midi to its expected tone index', () => {
    const chord = { expectedMidis: [60, 64, 67] }
    expect(expectedToneIndexForMidi(chord, 64)).toBe(1)
    expect(expectedToneIndexForMidi(chord, 61)).toBe(-1)
    expect(expectedToneIndexForMidi({ expectedMidi: 72 }, 72)).toBe(0)
  })
})

describe('timeline score events (Preview / Play Along)', () => {
  it('finds the event under the playhead', () => {
    const list = checkpoints(4)
    expect(findScoreEventIndexAtTime(list, 0)).toBe(0)
    expect(findScoreEventIndexAtTime(list, 1.5)).toBe(1)
    expect(findScoreEventIndexAtTime(list, 3.9)).toBe(3)
    expect(findScoreEventIndexAtTime(list, -1)).toBe(-1)
  })

  it('maps lane outcomes to score states', () => {
    expect(mapPlayAlongOutcomeToScoreState(VISUAL_LANE_OUTCOME.CORRECT)).toBe(
      SCORE_NOTE_STATE.COMPLETED,
    )
    expect(mapPlayAlongOutcomeToScoreState(VISUAL_LANE_OUTCOME.WRONG)).toBe(
      SCORE_NOTE_STATE.WRONG,
    )
    expect(mapPlayAlongOutcomeToScoreState(VISUAL_LANE_OUTCOME.MISSED)).toBe(
      SCORE_NOTE_STATE.WRONG,
    )
    expect(mapPlayAlongOutcomeToScoreState(null)).toBe(SCORE_NOTE_STATE.CURRENT)
    expect(mapPlayAlongOutcomeToScoreState('unknown')).toBe(SCORE_NOTE_STATE.CURRENT)
  })
})

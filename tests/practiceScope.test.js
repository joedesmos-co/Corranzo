import { describe, expect, it } from 'vitest'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import {
  PRACTICE_SCOPE,
  practiceScopeAppliesToTimingMap,
  resolveNotePracticeHand,
} from '../src/features/practice/practiceScope.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'

function note(id, midi, staff, partId, timeSeconds = 0) {
  return {
    id,
    midi,
    staff,
    partId,
    timeSeconds,
    quarterTime: timeSeconds * 2,
    measureNumber: 1,
    label: id,
    isRest: false,
  }
}

describe('piano practice scope', () => {
  it('filters one piano part with treble and bass staves by hand', () => {
    const timingMap = {
      stavesPerSystem: 2,
      parts: [
        {
          id: 'P1',
          name: 'Piano',
          staves: 2,
          clefs: [
            { staff: 1, sign: 'G' },
            { staff: 2, sign: 'F' },
          ],
        },
      ],
      notes: [
        note('E4', 64, 1, 'P1'),
        note('C3', 48, 2, 'P1'),
        note('G4', 67, 1, 'P1', 1),
        note('G2', 43, 2, 'P1', 1),
      ],
      beats: [{ measureNumber: 1, beat: 1, timeSeconds: 0 }],
    }

    expect(practiceScopeAppliesToTimingMap(timingMap, INSTRUMENT_IDS.PIANO)).toBe(true)
    expect(practiceScopeAppliesToTimingMap(timingMap, INSTRUMENT_IDS.GUITAR)).toBe(false)

    expect(
      buildNoteCheckpoints(timingMap, null, {
        practiceScope: PRACTICE_SCOPE.RIGHT_HAND,
      }).map((checkpoint) => checkpoint.expectedMidis),
    ).toEqual([[64], [67]])
    expect(
      buildNoteCheckpoints(timingMap, null, {
        practiceScope: PRACTICE_SCOPE.LEFT_HAND,
      }).map((checkpoint) => checkpoint.expectedMidis),
    ).toEqual([[48], [43]])
    expect(
      buildNoteCheckpoints(timingMap, null, {
        practiceScope: PRACTICE_SCOPE.BOTH_HANDS,
      })[0].expectedMidis,
    ).toEqual([64, 48])
  })

  it('recognizes treble and bass as separate exported piano parts', () => {
    const timingMap = {
      stavesPerSystem: 2,
      parts: [
        { id: 'P1', name: 'Piano treble', staves: 1, clefs: [{ staff: 1, sign: 'G' }] },
        { id: 'P2', name: 'Piano bass', staves: 1, clefs: [{ staff: 1, sign: 'F' }] },
      ],
      notes: [
        note('A4', 69, 1, 'P1'),
        note('A2', 45, 1, 'P2'),
      ],
      beats: [{ measureNumber: 1, beat: 1, timeSeconds: 0 }],
    }

    expect(practiceScopeAppliesToTimingMap(timingMap, INSTRUMENT_IDS.PIANO)).toBe(true)
    expect(resolveNotePracticeHand(timingMap.notes[0], timingMap)).toBe('right')
    expect(resolveNotePracticeHand(timingMap.notes[1], timingMap)).toBe('left')
    expect(
      buildNoteCheckpoints(timingMap, null, {
        practiceScope: PRACTICE_SCOPE.LEFT_HAND,
      })[0].expectedMidis,
    ).toEqual([45])
  })
})

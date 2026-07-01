import { describe, expect, it } from 'vitest'
import {
  detectOpeningLeadNoteMerge,
  simulateOpeningLeadNoteMerge,
} from '../src/features/omr/openingLeadNoteMerge.js'
import { extractOnsetColumns } from '../src/features/omr/innerVoicePhaseCorrection.js'

function noteEvent(startDivision, notes) {
  return {
    type: 'note',
    startDivision,
    durationDivisions: 4,
    durationType: 'quarter',
    notes,
  }
}

function note(midi, clef = 'treble') {
  return { midi, clef, beams: 0 }
}

describe('opening lead note merge', () => {
  it('detects m113-like opening solo plus adjacent stack', () => {
    const events = [
      noteEvent(0, [note(77, 'treble')]),
      noteEvent(1, [note(55, 'bass'), note(50, 'bass'), note(43, 'bass'), note(79, 'treble'), note(72, 'treble'), note(69, 'treble')]),
    ]
    const merge = detectOpeningLeadNoteMerge(extractOnsetColumns(events))
    expect(merge).toEqual({
      fromDivision: 0,
      toDivision: 1,
      stackNoteCount: 6,
    })
  })

  it('merges the lead note forward without changing note count', () => {
    const measures = [
      {
        measureNumber: 113,
        events: [
          noteEvent(0, [note(77, 'treble')]),
          noteEvent(1, [note(55, 'bass'), note(50, 'bass'), note(43, 'bass'), note(79, 'treble')]),
          noteEvent(4, [note(43, 'bass')]),
        ],
      },
    ]
    const result = simulateOpeningLeadNoteMerge(measures)
    expect(result.summary.appliedMeasures).toBe(1)
    expect(result.summary.noteCountChanged).toBe(false)
    expect(result.measures[0].events.map((event) => event.startDivision)).toEqual([1, 1, 4])
  })

  it('detects m57-like opening solo plus 3-note stack', () => {
    const events = [
      noteEvent(0, [note(77, 'treble')]),
      noteEvent(1, [note(55, 'bass'), note(50, 'bass'), note(43, 'bass')]),
    ]
    expect(detectOpeningLeadNoteMerge(extractOnsetColumns(events))).toEqual({
      fromDivision: 0,
      toDivision: 1,
      stackNoteCount: 3,
    })
    expect(detectOpeningLeadNoteMerge(extractOnsetColumns(events), { minStackNotes: 4 })).toBeNull()
  })

  it('skips measures without an opening solo and adjacent stack', () => {
    const measures = [
      {
        measureNumber: 33,
        events: [
          noteEvent(0, [note(69), note(62), note(58), note(77)]),
          noteEvent(4, [note(55), note(50), note(43), note(67)]),
        ],
      },
    ]
    const result = simulateOpeningLeadNoteMerge(measures)
    expect(result.summary.appliedMeasures).toBe(0)
  })
})

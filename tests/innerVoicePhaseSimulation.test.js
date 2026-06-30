import { describe, expect, it } from 'vitest'
import {
  applyInnerVoicePhaseCorrection,
  detectInnerVoicePhaseWindow,
  extractOnsetColumns,
  NARROW_MIN_STACK_NOTES,
  simulateInnerVoicePhaseCorrection,
} from '../src/features/omr/innerVoicePhaseCorrection.js'

function noteEvent(startDivision, notes, overrides = {}) {
  return {
    type: 'note',
    startDivision,
    durationDivisions: 2,
    durationType: 'eighth',
    notes,
    ...overrides,
  }
}

function note(midi, clef = 'treble', overrides = {}) {
  return { midi, clef, beams: 0, ...overrides }
}

describe('inner voice phase simulation', () => {
  it('detects m33-like solo/stack run spaced by sixteenths', () => {
    const events = [
      noteEvent(0, [note(69), note(62), note(58), note(77)]),
      noteEvent(4, [note(55), note(50), note(43), note(67), note(62), note(59)]),
      noteEvent(7, [note(43), note(31), note(79), note(74), note(71)]),
      noteEvent(9, [note(31, 'bass')]),
      noteEvent(10, [note(43, 'bass'), note(31, 'bass'), note(81), note(77), note(72)]),
      noteEvent(12, [note(31, 'bass')]),
      noteEvent(13, [note(43, 'bass'), note(31, 'bass'), note(83), note(79), note(74)]),
    ]
    const columns = extractOnsetColumns(events)
    const window = detectInnerVoicePhaseWindow(columns)
    expect(window).not.toBeNull()
    expect(window.shiftDivisions).toBe(1)
    expect(window.run.map((column) => column.noteCount)).toEqual([1, 5, 1, 5])
    expect(window.startDivision).toBe(9)
    expect(window.endDivision).toBe(13)
  })

  it('shifts the candidate window +0.25q without changing note count', () => {
    const measures = [
      {
        measureNumber: 33,
        events: [
          noteEvent(9, [note(31, 'bass')]),
          noteEvent(10, [note(43, 'bass'), note(31, 'bass'), note(81), note(77), note(72)]),
          noteEvent(12, [note(31, 'bass')]),
          noteEvent(13, [note(43, 'bass'), note(31, 'bass'), note(83), note(79), note(74)]),
        ],
      },
    ]
    const result = simulateInnerVoicePhaseCorrection(measures)
    expect(result.summary.appliedMeasures).toBe(1)
    expect(result.summary.noteCountChanged).toBe(false)
    const starts = result.measures[0].events.map((event) => event.startDivision)
    expect(starts).toEqual([10, 11, 13, 14])
  })

  it('skips sparse quarter-grid measures without alternating solo/stack pairs', () => {
    const measures = [
      {
        measureNumber: 7,
        events: [
          noteEvent(0, [note(41), note(46), note(34), note(65), note(62), note(58)]),
          noteEvent(5, [note(34), note(65)]),
          noteEvent(9, [note(46), note(41), note(70), note(62)]),
          noteEvent(12, [note(50), note(38), note(68)]),
          noteEvent(15, [note(51), note(46), note(39), note(67), note(63)]),
        ],
      },
    ]
    const result = simulateInnerVoicePhaseCorrection(measures)
    expect(result.summary.appliedMeasures).toBe(0)
    expect(result.measures[0].events.map((event) => event.startDivision)).toEqual([0, 5, 9, 12, 15])
  })

  it('skips phantom-column measures with uniform stack sizes', () => {
    const measures = [
      {
        measureNumber: 25,
        events: [
          noteEvent(0, [note(55), note(50), note(43), note(67), note(62), note(59)]),
          noteEvent(3, [note(55), note(50), note(43), note(65), note(60), note(57)]),
          noteEvent(5, [note(55), note(50), note(43), note(64), note(59), note(56)]),
          noteEvent(7, [note(55), note(50), note(43), note(62), note(57), note(54)]),
          noteEvent(9, [note(55), note(50), note(43), note(60), note(55), note(52)]),
          noteEvent(11, [note(55), note(50), note(43), note(58), note(53), note(50)]),
          noteEvent(12, [note(55), note(50), note(43), note(57), note(52), note(49)]),
          noteEvent(14, [note(55), note(50), note(43), note(55), note(50), note(47)]),
        ],
      },
    ]
    const result = simulateInnerVoicePhaseCorrection(measures)
    expect(result.summary.appliedMeasures).toBe(0)
  })

  it('detects runs when the last stack uses a longer duration than the remaining measure', () => {
    const events = [
      noteEvent(9, [note(31, 'bass')], { durationDivisions: 1 }),
      noteEvent(10, [note(43, 'bass'), note(31, 'bass'), note(81), note(77), note(72)], { durationDivisions: 3 }),
      noteEvent(12, [note(31, 'bass')], { durationDivisions: 1 }),
      noteEvent(13, [note(43, 'bass'), note(31, 'bass'), note(83), note(79), note(74)], { durationDivisions: 3 }),
    ]
    expect(detectInnerVoicePhaseWindow(extractOnsetColumns(events))).not.toBeNull()
  })

  it('trims a trailing solo when the full alternating run reaches the measure end', () => {
    const events = [
      noteEvent(8, [note(31, 'bass')], { durationDivisions: 1 }),
      noteEvent(9, [note(43, 'bass'), note(31, 'bass'), note(81), note(77), note(72)], { durationDivisions: 2 }),
      noteEvent(10, [note(31, 'bass')], { durationDivisions: 1 }),
      noteEvent(11, [note(43, 'bass'), note(31, 'bass'), note(83), note(79), note(74)], { durationDivisions: 2 }),
      noteEvent(13, [note(31, 'bass')], { durationDivisions: 1 }),
      noteEvent(14, [note(43, 'bass'), note(31, 'bass'), note(86), note(81), note(77)], { durationDivisions: 2 }),
      noteEvent(15, [note(31, 'bass')], { durationDivisions: 1 }),
    ]
    const columns = extractOnsetColumns(events)
    const window = detectInnerVoicePhaseWindow(columns)
    expect(window).not.toBeNull()
    expect(window.startDivision).toBe(8)
    expect(window.endDivision).toBe(14)
    expect(window.run.map((column) => column.noteCount)).toEqual([1, 5, 1, 5, 1, 5])
  })

  it('skips m61-like alternating runs with 4-note stacks when minStackNotes is 5', () => {
    const events = [
      noteEvent(8, [note(31, 'bass')], { durationDivisions: 1 }),
      noteEvent(9, [note(43, 'bass'), note(31, 'bass'), note(81), note(77)], { durationDivisions: 2 }),
      noteEvent(10, [note(31, 'bass')], { durationDivisions: 1 }),
      noteEvent(11, [note(43, 'bass'), note(31, 'bass'), note(83), note(79)], { durationDivisions: 2 }),
      noteEvent(13, [note(31, 'bass')], { durationDivisions: 1 }),
      noteEvent(14, [note(43, 'bass'), note(31, 'bass'), note(86), note(81)], { durationDivisions: 2 }),
    ]
    const columns = extractOnsetColumns(events)
    expect(detectInnerVoicePhaseWindow(columns, { minStackNotes: NARROW_MIN_STACK_NOTES })).toBeNull()
    expect(detectInnerVoicePhaseWindow(columns)).not.toBeNull()
  })

  it('applyInnerVoicePhaseCorrection defaults to narrow stack size >= 5', () => {
    const measures = [
      {
        measureNumber: 33,
        events: [
          noteEvent(9, [note(31, 'bass')]),
          noteEvent(10, [note(43, 'bass'), note(31, 'bass'), note(81), note(77), note(72)]),
          noteEvent(12, [note(31, 'bass')]),
          noteEvent(13, [note(43, 'bass'), note(31, 'bass'), note(83), note(79), note(74)]),
        ],
      },
    ]
    const result = applyInnerVoicePhaseCorrection(measures)
    expect(result.summary.minStackNotes).toBe(NARROW_MIN_STACK_NOTES)
    expect(result.summary.appliedMeasures).toBe(1)
    expect(result.measures[0].events.map((event) => event.startDivision)).toEqual([10, 11, 13, 14])
    expect(result.measures[0].innerVoicePhaseCorrection?.applied).toBe(true)
  })

  it('rejects solo columns with beam evidence', () => {
    const events = [
      noteEvent(9, [note(31, 'bass', { beams: 1 })]),
      noteEvent(10, [note(43, 'bass'), note(31, 'bass'), note(81), note(77), note(72)]),
      noteEvent(12, [note(31, 'bass')]),
      noteEvent(13, [note(43, 'bass'), note(31, 'bass'), note(83), note(79), note(74)]),
    ]
    expect(detectInnerVoicePhaseWindow(extractOnsetColumns(events))).toBeNull()
  })
})

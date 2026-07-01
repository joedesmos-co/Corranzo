import { describe, expect, it } from 'vitest'
import {
  applyPhantomColumnCorrection,
  DEFAULT_MIN_STACK_NOTES,
  detectPhantomColumnCorrection,
  diagnoseMeasurePhantomColumns,
  simulatePhantomColumnCorrection,
} from '../src/features/omr/phantomColumnSimulation.js'
import { extractOnsetColumns } from '../src/features/omr/innerVoicePhaseCorrection.js'

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

describe('phantom column simulation', () => {
  it('detects m25-like phantom/stack pairs at div%4===3 and div%4===1', () => {
    const events = [
      noteEvent(0, [note(60), note(64), note(67), note(72), note(76)]),
      noteEvent(2, [note(43, 'bass')]),
      noteEvent(3, [note(43, 'bass')]),
      noteEvent(5, [note(43, 'bass'), note(48), note(55), note(60), note(64), note(67)]),
      noteEvent(7, [note(43, 'bass')]),
      noteEvent(9, [note(43, 'bass'), note(48), note(55), note(60), note(64), note(67)]),
    ]
    const correction = detectPhantomColumnCorrection(extractOnsetColumns(events))
    expect(correction).not.toBeNull()
    expect(correction.phantomColumns.map((column) => column.startDivision)).toEqual([3, 7])
    expect(correction.stackShifts).toEqual([
      { fromDivision: 5, toDivision: 4 },
      { fromDivision: 9, toDivision: 8 },
    ])
    expect(correction.pairs.every((pair) => pair.duplicateMidis.includes(43))).toBe(true)
  })

  it('shifts linked stacks one sixteenth earlier without changing note count', () => {
    const measures = [
      {
        measureNumber: 25,
        events: [
          noteEvent(0, [note(60), note(64), note(67), note(72), note(76)]),
          noteEvent(2, [note(43, 'bass')]),
          noteEvent(3, [note(43, 'bass')]),
          noteEvent(5, [note(43, 'bass'), note(48), note(55), note(60), note(64), note(67)]),
          noteEvent(7, [note(43, 'bass')]),
          noteEvent(9, [note(43, 'bass'), note(48), note(55), note(60), note(64), note(67)]),
        ],
      },
    ]
    const result = simulatePhantomColumnCorrection(measures)
    expect(result.summary.appliedMeasures).toBe(1)
    expect(result.summary.noteCountChanged).toBe(false)
    const starts = result.measures[0].events.map((event) => event.startDivision)
    expect(starts).toEqual([0, 2, 3, 4, 7, 8])
  })

  it('applies the runtime correction and tags shifted stack events', () => {
    const measures = [
      {
        measureNumber: 25,
        events: [
          noteEvent(0, [note(60), note(64), note(67), note(72), note(76)]),
          noteEvent(2, [note(43, 'bass')]),
          noteEvent(3, [note(43, 'bass')]),
          noteEvent(5, [note(43, 'bass'), note(48), note(55), note(60), note(64), note(67)]),
          noteEvent(7, [note(43, 'bass')]),
          noteEvent(9, [note(43, 'bass'), note(48), note(55), note(60), note(64), note(67)]),
        ],
      },
    ]
    const result = applyPhantomColumnCorrection(measures)
    expect(result.summary.appliedMeasures).toBe(1)
    expect(result.summary.noteCountChanged).toBe(false)
    expect(result.summary.measureCountChanged).toBe(false)
    const shifted = result.measures[0].events.filter((event) => event.phantomColumnAdjusted)
    expect(shifted.map((event) => event.startDivision)).toEqual([4, 8])
    expect(shifted.every((event) => event.phantomColumnReasons.includes('linked-stack-phantom-realign'))).toBe(
      true,
    )
  })

  it('skips measures with fewer than two phantom/stack pairs', () => {
    const measures = [
      {
        measureNumber: 7,
        events: [
          noteEvent(0, [note(41), note(46), note(34), note(65), note(62), note(58)]),
          noteEvent(3, [note(43, 'bass')]),
          noteEvent(5, [note(43, 'bass'), note(48), note(55), note(60), note(64), note(67)]),
        ],
      },
    ]
    const result = simulatePhantomColumnCorrection(measures)
    expect(result.summary.appliedMeasures).toBe(0)
    expect(result.measures[0].events.map((event) => event.startDivision)).toEqual([0, 3, 5])
  })

  it('skips inner-voice Family C alternation (solo at div%4===1, stack +1 later)', () => {
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
    const result = simulatePhantomColumnCorrection(measures, { minStackNotes: DEFAULT_MIN_STACK_NOTES })
    expect(result.summary.appliedMeasures).toBe(0)
  })

  it('diagnoses column roles for reporting', () => {
    const measure = {
      measureNumber: 25,
      events: [
        noteEvent(3, [note(43, 'bass')]),
        noteEvent(5, [note(43, 'bass'), note(48), note(55), note(60), note(64), note(67)]),
      ],
    }
    const diagnosis = diagnoseMeasurePhantomColumns(measure)
    expect(diagnosis.columns.map((column) => column.role)).toEqual(['phantom-solo', 'linked-stack'])
    expect(diagnosis.correction).toBeNull()
  })
})

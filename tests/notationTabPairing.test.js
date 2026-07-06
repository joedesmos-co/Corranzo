import { describe, expect, it } from 'vitest'
import {
  NOTATION_TAB_PAIRING_LOW_CONFIDENCE_MESSAGE,
  pairNotationTabInMeasure,
} from '../src/features/omr/pairNotationTabEvents.js'

function noteEvent(startDivision, notes, cx = null) {
  return {
    type: 'note',
    startDivision,
    cx: cx ?? notes[0]?.cx ?? 100,
    durationDivisions: 4,
    notes,
  }
}

function tabNote({ string, fret, midi, x, positionInMeasure }) {
  return { string, fret, midi, x, positionInMeasure, measureNumber: 1 }
}

describe('notation + TAB pairing engine', () => {
  it('pairs a chord stack by rhythmic position and midi, not pitch-to-string order', () => {
    const events = [
      noteEvent(
        0,
        [
          { midi: 60, cx: 100 },
          { midi: 64, cx: 102 },
          { midi: 67, cx: 104 },
        ],
        102,
      ),
    ]
    const tabNotes = [
      tabNote({ string: 2, fret: 1, midi: 60, x: 101, positionInMeasure: 0.02 }),
      tabNote({ string: 3, fret: 0, midi: 64, x: 103, positionInMeasure: 0.02 }),
      tabNote({ string: 1, fret: 3, midi: 67, x: 105, positionInMeasure: 0.02 }),
    ]

    const { events: paired, diagnostics } = pairNotationTabInMeasure(events, tabNotes)
    expect(diagnostics.pairedNotes).toBe(3)
    expect(diagnostics.unusedTabDigits).toBe(0)
    expect(paired[0].notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ midi: 60, string: 2, fret: 1 }),
        expect.objectContaining({ midi: 64, string: 3, fret: 0 }),
        expect.objectContaining({ midi: 67, string: 1, fret: 3 }),
      ]),
    )
  })

  it('accepts slightly staggered TAB onsets in one beat cluster', () => {
    const events = [noteEvent(4, [{ midi: 55, cx: 200 }, { midi: 59, cx: 202 }], 201)]
    const tabNotes = [
      tabNote({ string: 3, fret: 5, midi: 55, x: 198, positionInMeasure: 0.24 }),
      tabNote({ string: 2, fret: 5, midi: 59, x: 206, positionInMeasure: 0.27 }),
    ]

    const { events: paired, diagnostics } = pairNotationTabInMeasure(events, tabNotes)
    expect(diagnostics.pairedNotes).toBe(2)
    expect(paired[0].notes.every((note) => note.fret === 5)).toBe(true)
  })

  it('does not emit duplicate TAB-only playback notes', () => {
    const events = [noteEvent(0, [{ midi: 64, cx: 120 }], 120)]
    const tabNotes = [
      tabNote({ string: 1, fret: 0, midi: 64, x: 120, positionInMeasure: 0.05 }),
      tabNote({ string: 2, fret: 1, midi: 59, x: 400, positionInMeasure: 0.8 }),
    ]

    const { events: paired, diagnostics } = pairNotationTabInMeasure(events, tabNotes)
    expect(paired).toHaveLength(1)
    expect(diagnostics.pairedNotes).toBe(1)
    expect(diagnostics.unusedTabDigits).toBe(1)
    expect(paired[0].notes[0]).toEqual(expect.objectContaining({ string: 1, fret: 0 }))
  })

  it('preserves notation articulation and tie metadata on combined notes', () => {
    const events = [
      noteEvent(0, [
        {
          midi: 67,
          cx: 150,
          tieStart: true,
          articulation: { type: 'staccato' },
          beams: 1,
        },
      ]),
    ]
    const tabNotes = [tabNote({ string: 1, fret: 3, midi: 67, x: 151, positionInMeasure: 0.04 })]

    const { events: paired } = pairNotationTabInMeasure(events, tabNotes)
    expect(paired[0].notes[0]).toEqual(
      expect.objectContaining({
        tieStart: true,
        articulation: { type: 'staccato' },
        beams: 1,
        string: 1,
        fret: 3,
      }),
    )
  })

  it('marks low-confidence measures when notation and TAB cannot align', () => {
    const events = [noteEvent(0, [{ midi: 60, cx: 100 }], 100)]
    const tabNotes = [tabNote({ string: 1, fret: 8, midi: 72, x: 500, positionInMeasure: 0.9 })]

    const { events: paired, diagnostics } = pairNotationTabInMeasure(events, tabNotes)
    expect(diagnostics.pairedNotes).toBe(0)
    expect(diagnostics.measureConfidence).toBeLessThan(0.55)
    expect(paired[0].notes[0].notationTabUnpaired).toBe(true)
    expect(NOTATION_TAB_PAIRING_LOW_CONFIDENCE_MESSAGE).toContain('could not be paired')
  })

  it('keeps rhythm from notation startDivision when pairing', () => {
    const events = [noteEvent(8, [{ midi: 62, cx: 180 }], 180)]
    const tabNotes = [tabNote({ string: 2, fret: 3, midi: 62, x: 181, positionInMeasure: 0.5 })]

    const { events: paired } = pairNotationTabInMeasure(events, tabNotes)
    expect(paired[0].startDivision).toBe(8)
    expect(paired[0].notes[0].fret).toBe(3)
  })
})

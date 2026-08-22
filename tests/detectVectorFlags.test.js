import { describe, expect, it } from 'vitest'
import {
  applyVectorFlagDurationsToEvents,
  assignVectorFlagsToNoteheads,
} from '../src/features/omr/detectVectorFlags.js'

function note(overrides = {}) {
  return {
    cx: 100,
    cy: 100,
    noteheadGlyph: 'black',
    dotted: false,
    durationType: 'quarter',
    durationDivisions: 4,
    stem: { x: 105, tipY: 70, direction: 'up' },
    pitchMapping: { lineYs: [0.2, 0.21, 0.22, 0.23, 0.24] },
    ...overrides,
  }
}

const imageData = { width: 600, height: 500 }

describe('vector SMuFL flag ownership', () => {
  it('uses a source-positioned eighth flag as authoritative written duration', () => {
    const notes = [note()]
    const result = assignVectorFlagsToNoteheads({
      glyphs: [{ text: '\ue240', x: 110, y: 70 }],
      notes,
      imageData,
    })

    expect(result).toMatchObject({
      detectedFlagGlyphCount: 1,
      appliedFlagGlyphCount: 1,
      appliedNoteCount: 1,
    })
    expect(notes[0]).toMatchObject({
      flags: 1,
      flagDirection: 'up',
      flagSource: 'smufl-vector-glyph',
      durationType: 'eighth',
      durationDivisions: 2,
    })
  })

  it('applies one flag to every notehead sharing the printed chord stem', () => {
    const notes = [note(), note({ cy: 108 })]
    const result = assignVectorFlagsToNoteheads({
      glyphs: [{ text: '\ue242', x: 110, y: 70 }],
      notes,
      imageData,
    })

    expect(result.appliedNoteCount).toBe(2)
    expect(notes.map((entry) => entry.durationType)).toEqual([
      'sixteenth',
      'sixteenth',
    ])
  })

  it('does not attach a flag on the wrong stem direction', () => {
    const notes = [note()]
    const result = assignVectorFlagsToNoteheads({
      glyphs: [{ text: '\ue241', x: 110, y: 70 }],
      notes,
      imageData,
    })

    expect(result.appliedFlagGlyphCount).toBe(0)
    expect(notes[0].flags).toBeUndefined()
    expect(notes[0].durationType).toBe('quarter')
  })

  it('abstains when a neighboring flag is more than one staff space from the stem', () => {
    const notes = [
      note({
        cx: 230,
        stem: { x: 224, tipY: 562, direction: 'down' },
        pitchMapping: { lineYs: [0.4, 0.416, 0.432, 0.448, 0.464] },
      }),
    ]
    const result = assignVectorFlagsToNoteheads({
      glyphs: [{ text: '\ue241', x: 212.5, y: 565.5 }],
      notes,
      imageData,
    })

    expect(result.detectedFlagGlyphCount).toBe(1)
    expect(result.appliedFlagGlyphCount).toBe(0)
    expect(notes[0].durationType).toBe('quarter')
  })

  it('does not turn a grace-sized note into a sounding eighth', () => {
    const notes = [
      note({
        glyphBBox: { width: 5.9, height: 13.2 },
        pitchMapping: { lineYs: [0.2, 0.2145, 0.229, 0.2435, 0.258] },
      }),
    ]
    const result = assignVectorFlagsToNoteheads({
      glyphs: [{ text: '\ue240', x: 110, y: 70 }],
      notes,
      imageData,
    })

    expect(result.detectedFlagGlyphCount).toBe(1)
    expect(result.appliedFlagGlyphCount).toBe(0)
    expect(notes[0].durationType).toBe('quarter')
  })

  it('reports deeper flags as unsupported instead of approximating them', () => {
    const notes = [note()]
    const result = assignVectorFlagsToNoteheads({
      glyphs: [{ text: '\ue244', x: 110, y: 70 }],
      notes,
      imageData,
    })

    expect(result.unsupportedFlagGlyphCount).toBe(1)
    expect(result.appliedFlagGlyphCount).toBe(0)
    expect(notes[0].durationType).toBe('quarter')
  })

  it('applies the source-owned value without repacking neighboring events', () => {
    const flagged = note()
    assignVectorFlagsToNoteheads({
      glyphs: [{ text: '\ue240', x: 110, y: 70 }],
      notes: [flagged],
      imageData,
    })
    const events = [
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [flagged],
      },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [note({ cx: 180, stem: { x: 185, tipY: 70, direction: 'up' } })],
      },
    ]

    const result = applyVectorFlagDurationsToEvents(events)

    expect(result.appliedCount).toBe(1)
    expect(result.events[0]).toMatchObject({
      startDivision: 4,
      durationDivisions: 2,
      durationType: 'eighth',
      vectorFlagDurationApplied: true,
    })
    expect(result.events[1]).toEqual(events[1])
  })
})

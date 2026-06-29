import { describe, expect, it } from 'vitest'
import {
  ORPHAN_REJECTION,
  assignVectorOrphanNoteheads,
  collectAssignedNoteheadGlyphKeys,
  noteheadGlyphKey,
  orphanHorizontalDistance,
} from '../src/features/omr/vectorOrphanNoteheads.js'
import { vectorGlyphInMeasure } from '../src/features/omr/vectorGlyphMeasureBounds.js'

const imageData = { width: 1000, height: 1415 }
const staffLines = {
  treble: [0.31, 0.33, 0.35, 0.37, 0.39],
  bass: [0.41, 0.43, 0.45, 0.47, 0.49],
  splitY: 0.4,
}

describe('noteheadGlyphKey', () => {
  it('buckets nearby coordinates together', () => {
    const left = { text: '\ue0a4', x: 682.4, y: 565.6 }
    const right = { text: '\ue0a4', x: 683.1, y: 565.9 }
    expect(noteheadGlyphKey(left)).toBe(noteheadGlyphKey(right))
  })
})

describe('assignVectorOrphanNoteheads', () => {
  const systemMeasureBoxes = [
    [
      {
        measureNumber: 6,
        page: 1,
        systemIndex: 0,
        x0: 0.687,
        x1: 0.967,
        y0: 0.3,
        y1: 0.387,
        staffLines,
      },
    ],
  ]

  it('reassigns noteheads in the inter-system horizontal gap', () => {
    const glyph = { text: '\ue0a4', x: 682.4, y: 565.6 }
    const glyphs = [glyph]
    const assignedKeys = collectAssignedNoteheadGlyphKeys(glyphs, systemMeasureBoxes, imageData)
    expect(assignedKeys.size).toBe(0)

    const { assignments, diagnostics } = assignVectorOrphanNoteheads({
      glyphs,
      imageData,
      systemMeasureBoxes,
      staffClefsBySystem: new Map([[0, { upper: 'treble', lower: 'bass' }]]),
      assignedKeys,
    })

    expect(diagnostics.orphanNoteheadCount).toBe(1)
    expect(diagnostics.reassignedOrphanCount).toBe(1)
    expect(assignments.get(6)).toHaveLength(1)
  })

  it('rejects glyphs far from any staff line', () => {
    const glyph = { text: '\ue0a4', x: 500, y: 100 }
    const { diagnostics } = assignVectorOrphanNoteheads({
      glyphs: [glyph],
      imageData,
      systemMeasureBoxes,
      staffClefsBySystem: new Map([[0, { upper: 'treble', lower: 'bass' }]]),
    })
    expect(diagnostics.reassignedOrphanCount).toBe(0)
    expect(diagnostics.rejectedOrphanReasons[ORPHAN_REJECTION.FAR_FROM_STAFF]).toBe(1)
  })

  it('ignores non-notehead glyphs', () => {
    const glyph = { text: 'A', x: 682.4, y: 565.6 }
    const { diagnostics } = assignVectorOrphanNoteheads({
      glyphs: [glyph],
      imageData,
      systemMeasureBoxes,
      staffClefsBySystem: new Map(),
    })
    expect(diagnostics.orphanNoteheadCount).toBe(0)
  })
})

describe('vector glyph bounds + orphan gap', () => {
  it('keeps ordinary in-box assignment separate from orphan gap reassignment', () => {
    const measureBox = {
      x0: 0.687,
      x1: 0.967,
      y0: 0.3,
      y1: 0.387,
      staffLines,
    }
    const gapGlyph = { text: '\ue0a4', x: 682.4, y: 565.6 }
    expect(vectorGlyphInMeasure(gapGlyph, measureBox, imageData)).toBe(false)
    expect(
      orphanHorizontalDistance(0.6824, measureBox, { isFirstInSystem: true }),
    ).toBeLessThanOrEqual(0.025)
  })
})

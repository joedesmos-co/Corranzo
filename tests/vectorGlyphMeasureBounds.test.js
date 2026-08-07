import { describe, expect, it } from 'vitest'
import {
  vectorGlyphAllocationBounds,
  vectorGlyphInMeasure,
} from '../src/features/omr/vectorGlyphMeasureBounds.js'

const imageData = { width: 1000, height: 1415 }
const staffLines = {
  treble: [0.31, 0.33, 0.35, 0.37, 0.39],
  bass: [0.41, 0.43, 0.45, 0.47, 0.49],
  splitY: 0.4,
}

describe('vectorGlyphAllocationBounds', () => {
  it('extends the last system measure to the right for trailing noteheads', () => {
    const box = {
      x0: 0.42,
      x1: 0.662,
      y0: 0.3,
      y1: 0.387,
      staffLines,
    }
    const interior = vectorGlyphAllocationBounds(box, { isLastInSystem: false })
    const last = vectorGlyphAllocationBounds(box, { isLastInSystem: true })
    expect(last.x1).toBeCloseTo(0.662 + 0.028, 4)
    expect(interior.x1).toBe(0.662)
    expect(last.x0).toBe(box.x0)
  })

  it('pads vertical bounds for ledger noteheads', () => {
    const box = {
      x0: 0.1,
      x1: 0.5,
      y0: 0.3,
      y1: 0.387,
      staffLines,
    }
    const bounds = vectorGlyphAllocationBounds(box)
    expect(bounds.y0).toBeLessThan(box.y0)
    expect(bounds.y1).toBeGreaterThan(box.y1)
  })
})

describe('vectorGlyphInMeasure', () => {
  const measureBox = {
    x0: 0.42,
    x1: 0.662,
    playableX0: 0.5,
    y0: 0.3,
    y1: 0.387,
    staffLines,
  }

  it('accepts noteheads just past the last measure barline', () => {
    const glyph = { x: 682.4, y: 565.6, text: '\ue0a4' }
    expect(vectorGlyphInMeasure(glyph, measureBox, imageData, { isLastInSystem: false })).toBe(
      false,
    )
    expect(vectorGlyphInMeasure(glyph, measureBox, imageData, { isLastInSystem: true })).toBe(true)
  })

  it('accepts noteheads left of playableX0 when still inside measure x0', () => {
    const glyph = { x: 430, y: 500, text: '\ue0a4' }
    expect(vectorGlyphInMeasure(glyph, measureBox, imageData)).toBe(true)
  })
})

describe('vector system ownership clips', () => {
  const nextStaffLines = {
    treble: [0.56, 0.58, 0.6, 0.62, 0.64],
    bass: [0.68, 0.7, 0.72, 0.74, 0.76],
    splitY: 0.66,
  }

  it('keeps the full extreme-ledger allocation range', () => {
    const box = {
      x0: 0.1,
      x1: 0.5,
      y0: 0.3,
      y1: 0.49,
      staffLines,
      ownershipY1: 0.525,
      ownershipNextStaffLines: nextStaffLines,
    }

    const bounds = vectorGlyphAllocationBounds(box)
    const unclipped = vectorGlyphAllocationBounds({
      ...box,
      ownershipY1: undefined,
      ownershipNextStaffLines: undefined,
    })

    expect(bounds.y1).toBe(unclipped.y1)
  })

  it('rejects a padded notehead when the next system is geometrically closer', () => {
    const box = {
      x0: 0.1,
      x1: 0.5,
      y0: 0.3,
      y1: 0.49,
      staffLines,
      ownershipY1: 0.525,
      ownershipNextStaffLines: nextStaffLines,
    }

    const stolenFromNextSystem = {
      x: 300,
      y: 0.57 * imageData.height,
      text: '\ue0a4',
    }

    expect(vectorGlyphInMeasure(stolenFromNextSystem, box, imageData)).toBe(false)
  })

  it('keeps an extreme ledger note past the midpoint when its own staff is closer', () => {
    const distantNextStaff = {
      treble: [0.62, 0.64, 0.66, 0.68, 0.7],
      bass: [0.74, 0.76, 0.78, 0.8, 0.82],
      splitY: 0.72,
    }

    const box = {
      x0: 0.1,
      x1: 0.5,
      y0: 0.3,
      y1: 0.49,
      staffLines,
      ownershipY1: 0.525,
      ownershipNextStaffLines: distantNextStaff,
    }

    const legitimateLedgerNote = {
      x: 300,
      y: 0.53 * imageData.height,
      text: '\ue0a4',
    }

    expect(vectorGlyphInMeasure(legitimateLedgerNote, box, imageData)).toBe(true)
  })
})

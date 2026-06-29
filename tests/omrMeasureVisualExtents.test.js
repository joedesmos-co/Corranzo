import { describe, expect, it } from 'vitest'
import {
  collectOmrEventXPositions,
  computeOmrMeasureVisualExtents,
} from '../src/features/omr/omrMeasureVisualExtents.js'

describe('omrMeasureVisualExtents', () => {
  const measureBox = {
    page: 1,
    systemIndex: 0,
    measureNumber: 1,
    x0: 0.2,
    x1: 0.5,
    y0: 0.1,
    y1: 0.3,
    playableX0: 0.22,
  }

  it('collects normalized and pixel note x positions', () => {
    const positions = collectOmrEventXPositions(
      [
        { type: 'note', xNorm: 0.31, notes: [{ xNorm: 0.31 }, { cx: 320 }] },
        { type: 'rest', cx: 400 },
      ],
      1000,
    )
    expect(positions).toEqual([0.31, 0.32, 0.4])
  })

  it('aligns visual start/end to first and last note columns with padding', () => {
    const visual = computeOmrMeasureVisualExtents({
      measureBox,
      events: [
        { type: 'note', cx: 280, notes: [{ cx: 280 }] },
        { type: 'note', cx: 430, notes: [{ cx: 430 }] },
      ],
      imageWidth: 1000,
    })

    expect(visual.rawMeasureXStart).toBe(0.2)
    expect(visual.rawMeasureXEnd).toBe(0.5)
    expect(visual.firstNoteX).toBe(0.28)
    expect(visual.lastNoteX).toBe(0.43)
    expect(visual.visualMeasureStartX).toBeGreaterThan(0.2)
    expect(visual.visualMeasureStartX).toBeLessThan(visual.firstNoteX)
    expect(visual.visualMeasureEndX).toBeGreaterThan(visual.lastNoteX)
    expect(visual.visualMeasureEndX).toBeLessThanOrEqual(0.5)
  })

  it('falls back to the measure box when no note positions are available', () => {
    const visual = computeOmrMeasureVisualExtents({
      measureBox,
      events: [],
      imageWidth: 1000,
    })

    expect(visual.firstNoteX).toBeNull()
    expect(visual.visualMeasureStartX).toBe(0.22)
    expect(visual.visualMeasureEndX).toBe(0.5)
  })
})

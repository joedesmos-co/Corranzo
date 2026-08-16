import { describe, expect, it } from 'vitest'
import {
  centerErrorInStaffGapUnits,
  evaluateSourceVisualSample,
  summarizeSourceVisualMetrics,
} from './helpers/sourceVisualMetrics.js'

describe('source visual metrics', () => {
  it('normalizes center error by page aspect and local staff gap', () => {
    const error = centerErrorInStaffGapUnits({
      expectedCenter: { x: 0.4, y: 0.3 },
      actualCenter: { x: 0.42, y: 0.31 },
      staffGap: 0.01,
      pageWidth: 1000,
      pageHeight: 2000,
    })

    // 0.02 page-width units = 0.01 page-height units; dy is also 0.01.
    expect(error).toBeCloseTo(Math.sqrt(2), 8)
  })

  it('summarizes identity, abstention, and deterministic error percentiles', () => {
    const exact = evaluateSourceVisualSample({
      expectedCenter: { x: 0.25, y: 0.4 },
      actualCenter: { x: 0.25, y: 0.4 },
      staffGap: 0.01,
      pageWidth: 1000,
      pageHeight: 2000,
      expectedSourceNoteheadIds: ['b', 'a'],
      actualSourceNoteheadIds: ['a', 'b'],
      precise: true,
    })
    const wrongPrecise = evaluateSourceVisualSample({
      expectedCenter: { x: 0.25, y: 0.4 },
      actualCenter: { x: 0.27, y: 0.4 },
      staffGap: 0.01,
      pageWidth: 1000,
      pageHeight: 2000,
      expectedSourceNoteheadIds: ['expected'],
      actualSourceNoteheadIds: ['neighbor'],
      precise: true,
    })
    const fallback = evaluateSourceVisualSample({
      expectedCenter: { x: 0.7, y: 0.6 },
      actualCenter: null,
      staffGap: 0.01,
      pageWidth: 1000,
      pageHeight: 2000,
      expectedSourceNoteheadIds: ['low-confidence'],
      actualSourceNoteheadIds: [],
      fallback: true,
    })

    expect(summarizeSourceVisualMetrics([exact, wrongPrecise, fallback])).toEqual({
      sampleCount: 3,
      preciseCount: 2,
      fallbackCount: 1,
      missingTargetCount: 1,
      sourceIdMatchCount: 1,
      wrongPreciseCount: 1,
      preciseCoverage: 2 / 3,
      centerErrorStaffGaps: {
        measuredCount: 2,
        median: 0,
        p95: 1,
        max: 1,
        withinHalfGap: 1,
        withinOneGap: 2,
        withinTwoGaps: 2,
      },
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  categorizeDurationError,
  DURATION_ERROR_CATEGORY,
} from '../src/features/omr/omrDurationErrorAnalysis.js'

describe('categorizeDurationError', () => {
  it('labels quarter truth shortened to eighth as too-short', () => {
    expect(
      categorizeDurationError({
        durationDiffQuarters: 0.5,
        truth: { durationQuarters: 1, label: 'C4' },
        generated: { durationQuarters: 0.5, label: 'C4' },
        onsetDiffQuarters: 0,
      }),
    ).toBe(DURATION_ERROR_CATEGORY.TOO_SHORT)
  })

  it('labels beamed eighth truth stretched to half as beamed-subdivision', () => {
    expect(
      categorizeDurationError({
        durationDiffQuarters: -1.5,
        truth: { durationQuarters: 0.5, label: 'F2' },
        generated: { durationQuarters: 2, label: 'F2' },
        onsetDiffQuarters: 0,
      }),
    ).toBe(DURATION_ERROR_CATEGORY.BEAMED_SUBDIVISION)
  })
})

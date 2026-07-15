import { describe, expect, it } from 'vitest'

import {
  buildOmrDiagnostics,
  measureConfidenceBreakdown,
} from '../src/features/omr/buildOmrDiagnostics.js'

describe('OMR confidence breakdown', () => {
  it('keeps pitch and rhythm confidence separate', () => {
    const confidence = measureConfidenceBreakdown(
      { uncertain: true },
      [{ pitchConfidence: 0.9 }, { pitchConfidence: 0.8 }],
    )

    expect(confidence.pitchConfidence).toBeCloseTo(0.85)
    expect(confidence.rhythmConfidence).toBe(0.55)
    expect(confidence.overallConfidence).toBeCloseTo(0.685)
  })

  it('exposes both values in developer diagnostics', () => {
    const diagnostics = buildOmrDiagnostics({
      pages: [
        {
          page: 1,
          systems: [
            {
              systemIndex: 0,
              confidence: 0.7,
              measures: [
                {
                  measureNumber: 1,
                  confidence: 0.7,
                  pitchConfidence: 0.85,
                  rhythmConfidence: 0.55,
                  rhythmApproximate: true,
                  events: [],
                },
              ],
            },
          ],
        },
      ],
    })

    const measure = diagnostics.pages[0].systems[0].measures[0]
    expect(measure).toMatchObject({
      pitchConfidence: 0.85,
      rhythmConfidence: 0.55,
      rhythmApproximate: true,
    })
  })
})

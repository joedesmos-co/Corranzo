import { describe, expect, it } from 'vitest'
import { reasonAboutOmrV3Confidence } from '../src/features/omr/v3/omrV3Confidence.js'

function voice(measureId, index, { ambiguous = false, overlap = false } = {}) {
  return {
    voiceId: `voice-${measureId}-${index}`,
    staffId: 'staff-1',
    ambiguous,
    confidence: { overall: ambiguous ? 0.5 : 0.86 },
    overlapConstraints: [{ kind: 'monophonic-no-overlap', satisfied: !overlap }],
    events: [
      {
        onset: 0,
        duration: { divisions: 4, exact: true },
      },
      {
        onset: overlap ? 2 : 4,
        duration: { divisions: 4, exact: true },
      },
    ],
  }
}

function measure(number, xStart, xEnd) {
  const measureId = `measure-${number}`
  return {
    measureId,
    measureNumber: number,
    xStart,
    xEnd,
    expectedStaffParticipation: ['staff-1'],
    barlineEvidence: [
      { kind: 'observed-barline', confidence: 0.9, supportRatio: 1 },
      { kind: 'observed-barline', confidence: 0.9, supportRatio: 1 },
    ],
    onsetColumns: [
      { x: xStart + 0.02 },
      { x: xStart + 0.08 },
    ],
    voices: [voice(measureId, 0)],
  }
}

function documentFixture() {
  return {
    pages: [
      {
        pageIndex: 0,
        systems: [
          {
            systemId: 'system-1',
            boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.12 },
            staffGroups: [{ type: 'single-notation', staves: [{ staffId: 'staff-1' }] }],
            measureColumns: [
              measure(1, 0.1, 0.3),
              measure(2, 0.3, 0.5),
              measure(3, 0.5, 0.7),
              measure(4, 0.7, 0.9),
            ],
          },
        ],
      },
    ],
  }
}

describe('OMR V3 hierarchical confidence reasoning', () => {
  it('rewards consistent structure while keeping detector calibration bounded', () => {
    const result = reasonAboutOmrV3Confidence(documentFixture(), { legacyConfidence: 0.7 })

    expect(result.method).toBe('omr-v3-hierarchical-bottleneck-v1')
    expect(result.structuralConfidence).toBeGreaterThan(0.7)
    expect(result.overallConfidence).toBeGreaterThan(0.7)
    expect(result.overallConfidence).toBeLessThanOrEqual(0.77)
    expect(result.distribution.lowMeasureCount).toBe(0)
  })

  it('uses local continuity bottlenecks instead of a flat confidence average', () => {
    const clean = documentFixture()
    const damaged = structuredClone(clean)
    const badMeasure = damaged.pages[0].systems[0].measureColumns[1]
    badMeasure.xEnd = 0.62
    badMeasure.barlineEvidence = []
    badMeasure.expectedStaffParticipation = ['missing-staff']
    badMeasure.voices = [voice(badMeasure.measureId, 0, { ambiguous: true, overlap: true })]
    badMeasure.onsetColumns.reverse()

    const cleanResult = reasonAboutOmrV3Confidence(clean, { legacyConfidence: 0.7 })
    const damagedResult = reasonAboutOmrV3Confidence(damaged, { legacyConfidence: 0.7 })

    expect(damagedResult.structuralConfidence).toBeLessThan(cleanResult.structuralConfidence)
    expect(damagedResult.overallConfidence).toBeLessThan(cleanResult.overallConfidence)
    expect(damagedResult.distribution.lowerQuantile).toBeLessThan(
      cleanResult.distribution.lowerQuantile,
    )
    expect(damagedResult.lowMeasures[0].measureNumber).toBe(2)
  })
})

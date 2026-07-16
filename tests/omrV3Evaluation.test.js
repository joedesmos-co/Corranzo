import { describe, expect, it } from 'vitest'
import {
  assessOmrV3PromotionGate,
  evaluateOmrV3Shadow,
} from '../src/features/omr/v3/omrV3Evaluation.js'
import {
  createOmrDocumentIR,
  OMR_V3_NOTATION_TYPE,
  OMR_V3_STAFF_GROUP_TYPE,
} from '../src/features/omr/v3/omrV3Ir.js'

function structuralDocument() {
  return createOmrDocumentIR({
    documentId: 'evaluation-fixture',
    pages: [
      {
        pageId: 'page',
        pageIndex: 0,
        width: 1000,
        height: 1400,
        systems: [
          {
            systemId: 'system',
            boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1, space: 'normalized' },
            staffGroups: [
              {
                staffGroupId: 'group',
                type: OMR_V3_STAFF_GROUP_TYPE.SINGLE_NOTATION,
                staves: [
                  {
                    staffId: 'staff',
                    lineCount: 5,
                    notationType: OMR_V3_NOTATION_TYPE.NOTATION,
                    measureMembership: ['measure'],
                  },
                ],
              },
            ],
            measureColumns: [
              {
                measureId: 'measure',
                measureNumber: 1,
                xStart: 0.1,
                xEnd: 0.9,
                expectedStaffParticipation: ['staff'],
              },
            ],
          },
        ],
      },
    ],
  })
}

function metrics(overrides = {}) {
  return {
    pitchAccuracy: 0.8,
    durationAccuracy: 0.7,
    onsetAccuracy: 0.75,
    chordGroupingAccuracy: 0.7,
    noteDetectionF1: 0.78,
    ...overrides,
  }
}

describe('OMR V3 shadow evaluation and promotion gates', () => {
  it('reports structure, measure error, validity, and promotion-neutral serializer state', () => {
    const report = evaluateOmrV3Shadow({
      document: structuralDocument(),
      expectedStructure: {
        systemCount: 1,
        measureCount: 1,
        staffGroupTypes: [OMR_V3_STAFF_GROUP_TYPE.SINGLE_NOTATION],
      },
    })

    expect(report.structure).toMatchObject({
      systemCount: 1,
      measureCount: 1,
      systemCountAccuracy: 1,
      staffGroupAccuracy: 1,
      absoluteMeasureCountError: 0,
    })
    expect(report.validity).toMatchObject({ invalidEventRate: 0, voiceOverlapViolations: 0 })
    expect(report.serializer.promotedToRuntime).toBe(false)
  })

  it('allows review only after two enforced fixtures improve with no regression', () => {
    const gate = assessOmrV3PromotionGate([
      {
        id: 'piano-a',
        current: { metrics: metrics(), structure: { absoluteMeasureCountError: 2 } },
        v3: { metrics: metrics(), structure: { absoluteMeasureCountError: 0 } },
      },
      {
        id: 'guitar-b',
        current: { metrics: metrics({ noteDetectionF1: 0.7 }) },
        v3: { metrics: metrics({ noteDetectionF1: 0.76 }) },
      },
    ])

    expect(gate.pass).toBe(true)
    expect(gate.status).toBe('eligible-for-partial-promotion-review')
    expect(gate.improvedFixtureCount).toBe(2)
    expect(gate.regressionCount).toBe(0)
    expect(gate.promotedToRuntime).toBe(false)
    expect(gate.candidates.fullV3).toBe('not-promoted')
  })

  it('blocks enforced regression, threshold lowering, hardcoding, and confidence inflation', () => {
    const gate = assessOmrV3PromotionGate(
      [
        {
          id: 'regressed',
          current: { metrics: metrics({ pitchAccuracy: 0.9 }) },
          v3: { metrics: metrics({ pitchAccuracy: 0.89 }) },
        },
        {
          id: 'improved',
          current: { metrics: metrics({ onsetAccuracy: 0.7 }) },
          v3: { metrics: metrics({ onsetAccuracy: 0.8 }) },
        },
      ],
      {
        thresholdLowered: true,
        fixtureHardcodingDetected: true,
        confidenceInflationDetected: true,
      },
    )

    expect(gate.pass).toBe(false)
    expect(gate.status).toBe('shadow-only')
    expect(gate.regressionCount).toBe(1)
    expect(gate.policyViolations).toEqual([
      'threshold-lowered',
      'fixture-hardcoding',
      'confidence-inflation',
    ])
    expect(Object.values(gate.candidates).every((status) => status === 'not-promoted')).toBe(true)
  })
})

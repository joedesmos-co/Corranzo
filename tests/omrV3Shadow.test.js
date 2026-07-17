import { describe, expect, it } from 'vitest'
import {
  observeOmrV3RejectedImport,
  OMR_V3_SYMBOL_EVIDENCE_MODE,
  runOmrV3Shadow,
} from '../src/features/omr/v3/omrV3Shadow.js'

function pageInput() {
  return {
    page: 1,
    width: 1000,
    height: 1400,
    contentBounds: { x0: 0.08, x1: 0.92 },
    systems: [
      {
        y0: 0.19,
        y1: 0.25,
        center: 0.22,
        staves: [
          {
            y0: 0.19,
            y1: 0.25,
            center: 0.22,
            lineYs: [0.2, 0.21, 0.22, 0.23, 0.24],
            lineCount: 5,
          },
        ],
      },
    ],
    systemMeasureBoxes: [[{ measureNumber: 1, x0: 0.1, x1: 0.9 }]],
    measureGrid: [{ measureNumber: 1, xStart: 0.1, xEnd: 0.9 }],
    measureRhythms: [
      {
        measureNumber: 1,
        systemIndex: 0,
        confidence: 0.8,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            durationType: 'quarter',
            notes: [{ midi: 72, clef: 'treble', cy: 280 }],
          },
        ],
      },
    ],
    rawDetectorSymbols: [
      {
        id: 'raw-note',
        kind: 'notehead',
        systemIndex: 0,
        clef: 'treble',
        midi: 72,
        durationDivisions: 4,
        durationType: 'quarter',
        beamExpectedDivisions: 2,
        beamOwnershipConfidence: 0.8,
        beamGroupId: 'raw-beam-group',
        geometry: { x: 197, y: 277, width: 6, height: 6, space: 'pixels' },
        confidence: 0.9,
        evidenceSource: 'detector-vector-notehead',
      },
    ],
  }
}

describe('OMR V3 shadow evidence provenance', () => {
  it('marks the compatibility adapter as legacy-derived evidence', () => {
    const result = runOmrV3Shadow({
      documentId: 'legacy-shadow',
      title: 'Legacy shadow',
      pageInputs: [pageInput()],
    })

    expect(result.status).toBe('ready')
    expect(result.evidence).toMatchObject({
      mode: OMR_V3_SYMBOL_EVIDENCE_MODE.LEGACY_RUNTIME_EVENTS,
      primaryEventCount: 1,
      independentPrimaryEventCount: 0,
      independentPrimaryEventRate: 0,
    })
  })

  it('builds a serializable independent shadow from raw detector observations', () => {
    const result = runOmrV3Shadow({
      documentId: 'independent-shadow',
      title: 'Independent shadow',
      pageInputs: [pageInput()],
      symbolEvidenceMode: OMR_V3_SYMBOL_EVIDENCE_MODE.RAW_DETECTOR_SYMBOLS,
    })

    expect(result.status).toBe('ready')
    expect(result.engine).toBe('omr-v3-independent-shadow')
    expect(result.serializer.primaryEventCount).toBe(1)
    expect(result.evidence).toMatchObject({
      mode: OMR_V3_SYMBOL_EVIDENCE_MODE.RAW_DETECTOR_SYMBOLS,
      sourceSymbolCount: 1,
      independentSourceSymbolCount: 1,
      independentSourceSymbolRate: 1,
      primaryEventCount: 1,
      independentPrimaryEventCount: 1,
      independentPrimaryEventRate: 1,
    })
    const event = result.document.pages[0].systems[0].measureColumns[0].voices
      .find((voice) => voice.candidateRank === 0)
      .events[0]
    expect(event.duration).toMatchObject({ divisions: 2, type: 'eighth', exact: false })
    expect(event.technical).toMatchObject({
      beamExpectedDivisions: 2,
      beamOwnershipConfidence: 0.8,
    })
  })

  it('does not claim an independent rejection when raw musical evidence exists', () => {
    const result = observeOmrV3RejectedImport({
      documentId: 'nonempty-rejection-observation',
      title: 'Nonempty rejection observation',
      pageInputs: [pageInput()],
      symbolEvidenceMode: OMR_V3_SYMBOL_EVIDENCE_MODE.RAW_DETECTOR_SYMBOLS,
      failureReason: 'low-confidence',
    })

    expect(result.evidence.sourceSymbolCount).toBe(1)
    expect(result.decision).toMatchObject({
      status: 'observe-production-rejection',
      ownedBy: 'v2-policy',
      independent: false,
      failureReason: 'low-confidence',
    })
  })

  it('leaves guitar duration evidence to the guitar fusion solver', () => {
    const result = runOmrV3Shadow({
      documentId: 'guitar-independent-shadow',
      title: 'Guitar independent shadow',
      instrumentId: 'guitar',
      pageInputs: [pageInput()],
      symbolEvidenceMode: OMR_V3_SYMBOL_EVIDENCE_MODE.RAW_DETECTOR_SYMBOLS,
    })
    const event = result.document.pages[0].systems[0].measureColumns[0].voices[0].events[0]

    expect(event.duration).toMatchObject({ divisions: 4, type: 'quarter', exact: false })
    expect(event.technical.beamExpectedDivisions).toBeNull()
  })
})

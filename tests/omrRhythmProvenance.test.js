import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  OMR_DIAGNOSTIC_FLAG,
  getOmrDiagnosticFlags,
  setOmrDiagnosticFlag,
} from '../src/features/omr/omrDiagnosticFlags.js'
import { assignVectorAugmentationDots } from '../src/features/omr/detectVectorStaccato.js'
import {
  createMeasureRhythmProvenance,
  summarizeRhythmProvenance,
} from '../src/features/omr/omrRhythmProvenance.js'
import {
  buildOmrProvenancePackage,
  downloadOmrProvenancePackage,
} from '../src/features/omr/omrDevTools.js'

const RHYTHM_DOT_GLYPH = '\ue1e7'
const measureBox = { x0: 0, x1: 1, y0: 0, y1: 1, playableX0: 0 }
const imageData = { width: 1000, height: 1000 }

describe('omr rhythm provenance (DEV)', () => {
  beforeEach(() => {
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)
  })

  afterEach(() => {
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)
  })

  it('is disabled by default and creates no collector', () => {
    expect(getOmrDiagnosticFlags().provenance).toBe(false)
    expect(createMeasureRhythmProvenance({ measureNumber: 1 })).toBeNull()
  })

  it('keeps assignVectorAugmentationDots Map-shaped when provenance is off', () => {
    const result = assignVectorAugmentationDots(
      [{ text: RHYTHM_DOT_GLYPH, x: 318, y: 170 }],
      [{ cx: 300, cy: 170, midi: 60, clef: 'treble' }],
      measureBox,
      imageData,
    )
    expect(result instanceof Map).toBe(true)
    expect(result.get(0)).toBe(true)
  })

  it('returns dot diagnostics when provenance is on', () => {
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, true)
    const result = assignVectorAugmentationDots(
      [{ text: RHYTHM_DOT_GLYPH, x: 318, y: 170 }],
      [{ cx: 300, cy: 170, midi: 60, clef: 'treble' }],
      measureBox,
      imageData,
    )
    expect(result.assignments.get(0)).toBe(true)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].finalOwner.noteIndex).toBe(0)
    expect(result.diagnostics[0].possibleOwners.length).toBeGreaterThan(0)
  })

  it('records duration stage replacements when enabled', () => {
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, true)
    const provenance = createMeasureRhythmProvenance({ measureNumber: 3, page: 1 })
    const initial = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [{ midi: 60, clef: 'bass', beams: 1, beamStrength: 20, cx: 10 }],
      },
    ]
    provenance.recordInitialEvent(initial[0], 0, { gapType: 'quarter', gapConfidence: 0.6 })
    const after = [
      {
        ...initial[0],
        durationDivisions: 2,
        durationType: 'eighth',
        beamDurationAdjusted: true,
      },
    ]
    provenance.recordStage('beam-refine', 'refineEventDurationsFromBeamEvidence', initial, after)
    const finalized = provenance.finalize()
    expect(finalized.noteDurations[0].decisionChain.length).toBe(2)
    expect(finalized.noteDurations[0].finalSelectedType).toBe('eighth')
    expect(finalized.noteDurations[0].decisionChain[1].function).toBe(
      'refineEventDurationsFromBeamEvidence',
    )
  })

  it('builds an exportable provenance package', () => {
    const bundle = buildOmrProvenancePackage({
      diagnostics: {
        rhythmProvenance: summarizeRhythmProvenance([
          {
            noteDurations: [{ finalSelectedType: 'eighth' }],
            dotCandidates: [{ finalOwner: null }],
            beamCandidates: [],
          },
        ]),
      },
      runMeta: { noteCount: 1 },
    })
    expect(bundle.kind).toBe('omr-rhythm-provenance')
    expect(bundle.provenance.noteDurationCount).toBe(1)
    expect(bundle.provenance.unassignedDots).toBe(1)
    const downloaded = downloadOmrProvenancePackage(bundle, 'test-provenance.json')
    expect(downloaded.ok).toBe(false)
    expect(downloaded.text).toContain('omr-rhythm-provenance')
  })
})

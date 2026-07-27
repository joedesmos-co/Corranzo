import { describe, expect, it } from 'vitest'
import {
  DURATION_CATEGORY_TO_SEMANTIC_CLASS,
  NAMED_BUCKET_TO_SEMANTIC_CLASS,
  OMR_SEMANTIC_DEFECT_CLASS,
  OMR_SEMANTIC_DEFECT_PRIORITY,
  articulationGapFromDiagnostics,
  resolveSemanticDefectClass,
  summarizeSemanticDefectClasses,
} from '../src/features/omr/omrSemanticDefectClass.js'
import { groupAccuracyReportErrors } from '../src/features/omr/omrDiagnosticGrouping.js'

describe('OMR semantic defect taxonomy', () => {
  it('keeps playback-priority order with rhythm ahead of pitch', () => {
    expect(OMR_SEMANTIC_DEFECT_PRIORITY[OMR_SEMANTIC_DEFECT_CLASS.RHYTHM]).toBeLessThan(
      OMR_SEMANTIC_DEFECT_PRIORITY[OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN],
    )
    expect(OMR_SEMANTIC_DEFECT_PRIORITY[OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN]).toBeLessThan(
      OMR_SEMANTIC_DEFECT_PRIORITY[OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION],
    )
    expect(OMR_SEMANTIC_DEFECT_PRIORITY[OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION]).toBeLessThan(
      OMR_SEMANTIC_DEFECT_PRIORITY[OMR_SEMANTIC_DEFECT_CLASS.PITCH],
    )
  })

  it('maps named buckets and duration categories into semantic classes', () => {
    expect(NAMED_BUCKET_TO_SEMANTIC_CLASS.duration).toBe(OMR_SEMANTIC_DEFECT_CLASS.RHYTHM)
    expect(NAMED_BUCKET_TO_SEMANTIC_CLASS.rests).toBe(OMR_SEMANTIC_DEFECT_CLASS.RHYTHM)
    expect(NAMED_BUCKET_TO_SEMANTIC_CLASS.ties).toBe(OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN)
    expect(NAMED_BUCKET_TO_SEMANTIC_CLASS.slurs).toBe(OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION)
    expect(NAMED_BUCKET_TO_SEMANTIC_CLASS.pitch).toBe(OMR_SEMANTIC_DEFECT_CLASS.PITCH)
    expect(DURATION_CATEGORY_TO_SEMANTIC_CLASS['tie-sustain']).toBe(
      OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN,
    )
    expect(resolveSemanticDefectClass('onset')).toBe(OMR_SEMANTIC_DEFECT_CLASS.RHYTHM)
  })

  it('rolls named buckets into semantic classes and reattributes tie-sustain duration', () => {
    const summary = summarizeSemanticDefectClasses({
      namedBuckets: {
        buckets: {
          pitch: 2,
          duration: 10,
          onset: 3,
          ties: 4,
          rests: 2,
          slurs: 1,
          chord: 5,
        },
      },
      durationErrorHistogram: {
        'too-long': 6,
        'tie-sustain': 3,
        'bass-sustain': 1,
      },
      articulationGap: 2,
    })

    expect(summary.classes[OMR_SEMANTIC_DEFECT_CLASS.RHYTHM]).toBe(10 + 3 + 2 - 4) // duration+onset+rests, minus sustain move
    expect(summary.classes[OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN]).toBe(4 + 4) // ties + moved duration
    expect(summary.classes[OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION]).toBe(1 + 2)
    expect(summary.classes[OMR_SEMANTIC_DEFECT_CLASS.PITCH]).toBe(2)
    expect(summary.classes[OMR_SEMANTIC_DEFECT_CLASS.MEASURE_STRUCTURE]).toBe(5)
    expect(summary.largestClass.class).toBe(OMR_SEMANTIC_DEFECT_CLASS.RHYTHM)
    expect(summary.byPriority[0].class).toBe(OMR_SEMANTIC_DEFECT_CLASS.RHYTHM)
    expect(summary.priorityGuidance).toMatch(/rhythm → sustain/i)
  })

  it('counts articulation detect/apply gaps', () => {
    expect(
      articulationGapFromDiagnostics({
        staccato: { detectedStaccatoCount: 5, appliedStaccatoCount: 2 },
        accent: { detectedAccentCount: 3, appliedAccentCount: 3 },
      }),
    ).toBe(3)
  })

  it('attaches semantic classes on accuracy error grouping', () => {
    const grouping = groupAccuracyReportErrors({
      totals: {
        wrongPitchCount: 1,
        wrongDurationCount: 4,
        wrongOnsetCount: 2,
        chordMismatchCount: 0,
        missingNoteCount: 0,
        extraNoteCount: 0,
      },
      generatedOmrDiagnostics: {
        ties: { detectedTieCount: 3, appliedTieCount: 1, uncertainSlurCount: 0 },
        rests: { detectedRestGlyphCount: 2, appliedRestEventCount: 0, skippedMixedRestCount: 0 },
        staccato: { detectedStaccatoCount: 2, appliedStaccatoCount: 0 },
        accent: { detectedAccentCount: 0, appliedAccentCount: 0 },
      },
      debug: { wrongPitches: [], wrongDurations: [] },
      summary: { primaryErrorSource: null },
    })

    expect(grouping.semanticDefectClasses.classes[OMR_SEMANTIC_DEFECT_CLASS.RHYTHM]).toBeGreaterThan(0)
    expect(grouping.semanticDefectClasses.classes[OMR_SEMANTIC_DEFECT_CLASS.SUSTAIN]).toBe(2)
    expect(grouping.semanticDefectClasses.classes[OMR_SEMANTIC_DEFECT_CLASS.ARTICULATION]).toBe(2)
    expect(grouping.semanticDefectClasses.priorityGuidance).toMatch(/prioritize rhythm/i)
  })
})

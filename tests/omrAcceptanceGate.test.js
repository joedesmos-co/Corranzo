import { describe, expect, it } from 'vitest'
import {
  assessOmrAcceptance,
  buildOmrQualityMetadata,
  meanPageConfidence,
  OMR_ACCEPTANCE,
  OMR_QUALITY_WARNING_MESSAGE,
} from '../src/features/omr/assessOmrAcceptance.js'
import { assessOmrDifficulty, OMR_FAILURE_REASON } from '../src/features/omr/assessOmrDifficulty.js'
import { OMR_TOO_DIFFICULT_MESSAGE } from '../src/features/omr/omrConstants.js'

describe('OMR acceptance gate', () => {
  it('accepts high-confidence vector-like results', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0.9,
      pagesWithSystems: 8,
      pageCount: 8,
      noteCount: 2808,
      measureCount: 125,
      uncertainMeasures: 0,
      systems: 44,
      pages: Array.from({ length: 8 }, () => ({ confidence: 0.88 })),
      layoutConsistency: { inconsistent: false, spread: 3 },
    })
    expect(decision.acceptance).toBe(OMR_ACCEPTANCE.ACCEPTED)
    expect(decision.confidenceBand).toBe('high')
    expect(decision.message).toBeNull()
  })

  it('accepts Brahms-like mid-confidence short scores that clear the legacy gate', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0.659,
      pagesWithSystems: 1,
      pageCount: 1,
      noteCount: 53,
      measureCount: 13,
      uncertainMeasures: 12,
      systems: 2,
      pages: [{ confidence: 0.63 }],
    })
    expect(assessOmrDifficulty({
      overallConfidence: 0.659,
      pagesWithSystems: 1,
      pageCount: 1,
      noteCount: 53,
      measureCount: 13,
      uncertainMeasures: 12,
    }).tooDifficult).toBe(false)
    expect(decision.acceptance).toBe(OMR_ACCEPTANCE.ACCEPTED)
  })

  it('warns for structurally valid mid-confidence Mutopia-class vectors', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0.641,
      pagesWithSystems: 1,
      pageCount: 1,
      noteCount: 358,
      measureCount: 33,
      uncertainMeasures: 30,
      systems: 7,
      pages: [{ confidence: 0.635 }],
      layoutConsistency: { inconsistent: false, spread: null },
    })
    expect(decision.difficulty.tooDifficult).toBe(true)
    expect(decision.acceptance).toBe(OMR_ACCEPTANCE.WARNING)
    expect(decision.message).toBe(OMR_QUALITY_WARNING_MESSAGE)
    expect(decision.positiveEvidence).toContain('mid-confidence-structural-salvage')
  })

  it('rejects mid-confidence scores with invalid/low page confidence (Twinkle-class)', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0.621,
      pagesWithSystems: 1,
      pageCount: 1,
      noteCount: 667,
      measureCount: 54,
      uncertainMeasures: 36,
      systems: 10,
      pages: [{ confidence: 0.496 }],
    })
    expect(decision.acceptance).toBe(OMR_ACCEPTANCE.REJECTED)
    expect(decision.message).toBe(OMR_TOO_DIFFICULT_MESSAGE)
    expect(decision.negativeEvidence).toContain('low-page-confidence')
  })

  it('rejects absolute low-confidence results', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0.3,
      pagesWithSystems: 1,
      pageCount: 4,
      noteCount: 2,
      measureCount: 12,
      uncertainMeasures: 10,
      systems: 1,
      pages: [{ confidence: 0.3 }],
      layoutConsistency: { inconsistent: true },
    })
    expect(decision.acceptance).toBe(OMR_ACCEPTANCE.REJECTED)
    expect(decision.rejectReasons).toContain(OMR_FAILURE_REASON.LOW_CONFIDENCE)
  })

  it('rejects blank / no-note extractions', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0,
      pagesWithSystems: 0,
      pageCount: 1,
      noteCount: 0,
      measureCount: 0,
      systems: 0,
      pages: [{ confidence: 0.1 }],
    })
    expect(decision.acceptance).toBe(OMR_ACCEPTANCE.REJECTED)
    expect(decision.rejectReasons).toContain(OMR_FAILURE_REASON.NO_NOTES)
    expect(decision.rejectReasons).toContain(OMR_FAILURE_REASON.NO_SYSTEMS)
  })

  it('rejects substantial notes without valid systems', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0.65,
      pagesWithSystems: 0,
      pageCount: 1,
      noteCount: 400,
      measureCount: 20,
      uncertainMeasures: 10,
      systems: 0,
      pages: [{ confidence: 0.65 }],
    })
    expect(decision.acceptance).toBe(OMR_ACCEPTANCE.REJECTED)
    expect(decision.rejectReasons).toContain(OMR_FAILURE_REASON.NO_SYSTEMS)
  })

  it('does not accept on confidence alone without structural evidence', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0.66,
      pagesWithSystems: 1,
      pageCount: 1,
      noteCount: 10,
      measureCount: 20,
      uncertainMeasures: 18,
      systems: 1,
      pages: [{ confidence: 0.66 }],
    })
    // Legacy tooDifficult + insufficient note inventory → reject, not warn.
    expect(decision.difficulty.tooDifficult).toBe(true)
    expect(decision.acceptance).toBe(OMR_ACCEPTANCE.REJECTED)
  })

  it('attaches score-owned quality metadata without MusicXML mutation', () => {
    const decision = assessOmrAcceptance({
      overallConfidence: 0.65,
      pagesWithSystems: 3,
      pageCount: 3,
      noteCount: 2400,
      measureCount: 90,
      uncertainMeasures: 80,
      systems: 18,
      pages: [
        { confidence: 0.62 },
        { confidence: 0.63 },
        { confidence: 0.61 },
      ],
    })
    const quality = buildOmrQualityMetadata(decision, {
      ownerScoreId: 'score-abc',
      sourceIdentity: 'pdf::identity',
      safetyValidation: {
        musicXmlParsed: true,
        playbackTimelineValid: true,
      },
    })
    expect(quality.acceptance).toBe(OMR_ACCEPTANCE.WARNING)
    expect(quality.ownerScoreId).toBe('score-abc')
    expect(quality.sourceIdentity).toBe('pdf::identity')
    expect(quality.safetyChecks.musicXmlParsed).toBe(true)
    expect(quality.warningMessage).toBe(OMR_QUALITY_WARNING_MESSAGE)
  })

  it('meanPageConfidence ignores missing values', () => {
    expect(meanPageConfidence([{ confidence: 0.6 }, { confidence: null }, {}])).toBeCloseTo(0.6)
    expect(meanPageConfidence([])).toBeNull()
  })
})

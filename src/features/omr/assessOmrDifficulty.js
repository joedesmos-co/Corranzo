import { OMR_TOO_DIFFICULT_MESSAGE } from './omrConstants.js'

export const OMR_FAILURE_REASON = {
  NO_PAGES: 'no-pages',
  NO_SYSTEMS: 'no-systems',
  NO_NOTES: 'no-notes',
  LOW_CONFIDENCE: 'low-confidence',
  SPARSE_NOTES: 'sparse-notes',
  INCONSISTENT_LAYOUT: 'inconsistent-layout',
  MANY_EMPTY_PAGES: 'many-empty-pages',
  CANCELLED: 'cancelled',
}

/**
 * Decide whether a PDF is too difficult for honest local OMR playback.
 */
export function assessOmrDifficulty({
  overallConfidence = 0,
  pagesWithSystems = 0,
  pageCount = 0,
  noteCount = 0,
  measureCount = 0,
  uncertainMeasures = 0,
  layoutConsistency = null,
} = {}) {
  const reasons = []
  const notesPerMeasure = noteCount / Math.max(1, measureCount)
  const systemCoverage = pagesWithSystems / Math.max(1, pageCount)
  const uncertainRatio = uncertainMeasures / Math.max(1, measureCount)
  const wildlyVariableSystems =
    (layoutConsistency?.spread ?? 0) > 4 && overallConfidence < 0.72

  if (pageCount === 0) {
    reasons.push(OMR_FAILURE_REASON.NO_PAGES)
  }
  if (systemCoverage < 0.45) {
    reasons.push(OMR_FAILURE_REASON.MANY_EMPTY_PAGES)
  }
  if (noteCount === 0) {
    reasons.push(OMR_FAILURE_REASON.NO_NOTES)
  }
  if (notesPerMeasure < 0.35 && measureCount > 4) {
    reasons.push(OMR_FAILURE_REASON.SPARSE_NOTES)
  }
  if (overallConfidence < 0.42) {
    reasons.push(OMR_FAILURE_REASON.LOW_CONFIDENCE)
  }
  if (layoutConsistency?.inconsistent || wildlyVariableSystems) {
    reasons.push(OMR_FAILURE_REASON.INCONSISTENT_LAYOUT)
  }
  if (measureCount >= 16 && uncertainRatio > 0.6 && overallConfidence < 0.72) {
    reasons.push(OMR_FAILURE_REASON.LOW_CONFIDENCE)
  }
  if (measureCount >= 16 && notesPerMeasure > 14 && uncertainRatio > 0.5) {
    reasons.push(OMR_FAILURE_REASON.LOW_CONFIDENCE)
  }

  const lowConfidenceTooDifficult =
    reasons.includes(OMR_FAILURE_REASON.LOW_CONFIDENCE) &&
    (overallConfidence < 0.42 ||
      systemCoverage < 0.55 ||
      (measureCount >= 16 && uncertainRatio > 0.6) ||
      (measureCount >= 16 && notesPerMeasure > 14))
  const inconsistentLayoutTooDifficult =
    reasons.includes(OMR_FAILURE_REASON.INCONSISTENT_LAYOUT) && overallConfidence < 0.72

  const tooDifficult =
    reasons.includes(OMR_FAILURE_REASON.NO_NOTES) ||
    reasons.includes(OMR_FAILURE_REASON.NO_SYSTEMS) ||
    lowConfidenceTooDifficult ||
    inconsistentLayoutTooDifficult ||
    (reasons.includes(OMR_FAILURE_REASON.MANY_EMPTY_PAGES) &&
      reasons.includes(OMR_FAILURE_REASON.SPARSE_NOTES))

  return {
    tooDifficult,
    reasons,
    notesPerMeasure,
    systemCoverage,
    uncertainRatio,
    message: tooDifficult ? OMR_TOO_DIFFICULT_MESSAGE : null,
    confidence: Math.max(0, Math.min(1, overallConfidence)),
  }
}

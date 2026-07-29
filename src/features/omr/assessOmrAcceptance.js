/**
 * Structured OMR acceptance gate.
 *
 * Replaces the binary “too difficult” hard-reject for mid-confidence but
 * structurally usable extractions scores with three outcomes:
 *   accepted | warning | rejected
 *
 * Does not change recognition. Does not accept on confidence alone.
 */
import {
  assessOmrDifficulty,
  OMR_FAILURE_REASON,
} from './assessOmrDifficulty.js'
import { OMR_TOO_DIFFICULT_MESSAGE } from './omrConstants.js'

export const OMR_ACCEPTANCE = {
  ACCEPTED: 'accepted',
  WARNING: 'warning',
  REJECTED: 'rejected',
}

/** User-facing copy for ACCEPT WITH WARNING (not an error / not “corrupt”). */
export const OMR_QUALITY_WARNING_MESSAGE =
  'Corranzo generated this score, but recognition confidence was lower than usual. Some notes, rhythms, or markings may be incorrect. Compare with the original PDF while practicing.'

/** Absolute floor — below this, extraction is not salvageable. */
export const OMR_ACCEPTANCE_ABSOLUTE_CONFIDENCE_FLOOR = 0.42

/**
 * Mid-band floor used only together with structural evidence.
 * Not a standalone “confidence >= X” accept rule.
 */
export const OMR_ACCEPTANCE_STRUCTURAL_CONFIDENCE_FLOOR = 0.55

/**
 * Mean per-page layout confidence floor for warning salvage.
 * Separates usable Mutopia-class mid-confidence exports (~0.62+) from
 * low-information historical scans such as LOC Twinkle (~0.50).
 */
export const OMR_ACCEPTANCE_MIN_MEAN_PAGE_CONFIDENCE = 0.55

/** Minimum extracted notes to treat a mid-confidence result as substantial. */
export const OMR_ACCEPTANCE_MIN_SUBSTANTIAL_NOTES = 40

export function meanPageConfidence(pages = []) {
  const values = (Array.isArray(pages) ? pages : [])
    .map((page) => page?.confidence)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map((value) => Number(value))
  if (values.length === 0) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function confidenceBandFromScore(overallConfidence = 0) {
  if (overallConfidence >= 0.72) {
    return 'high'
  }
  if (overallConfidence >= OMR_ACCEPTANCE_STRUCTURAL_CONFIDENCE_FLOOR) {
    return 'mid'
  }
  return 'low'
}

function uniqueReasons(reasons = []) {
  return [...new Set((reasons ?? []).filter(Boolean))]
}

/**
 * Decide accept / warn / reject from extraction diagnostics.
 *
 * @returns {{
 *   acceptance: 'accepted'|'warning'|'rejected',
 *   confidenceBand: 'high'|'mid'|'low',
 *   tooDifficultLegacy: boolean,
 *   reasons: string[],
 *   warningReasons: string[],
 *   rejectReasons: string[],
 *   positiveEvidence: string[],
 *   negativeEvidence: string[],
 *   safetyChecks: Record<string, boolean>,
 *   extractionSummary: object,
 *   message: string|null,
 *   difficulty: object,
 * }}
 */
export function assessOmrAcceptance({
  overallConfidence = 0,
  pagesWithSystems = 0,
  pageCount = 0,
  noteCount = 0,
  measureCount = 0,
  uncertainMeasures = 0,
  layoutConsistency = null,
  systems = 0,
  pages = [],
} = {}) {
  const difficulty = assessOmrDifficulty({
    overallConfidence,
    pagesWithSystems,
    pageCount,
    noteCount,
    measureCount,
    uncertainMeasures,
    layoutConsistency,
  })

  const pageConfidence = meanPageConfidence(pages)
  const confidence = Math.max(0, Math.min(1, Number(overallConfidence) || 0))
  const confidenceBand = confidenceBandFromScore(confidence)
  const systemCoverage = difficulty.systemCoverage
  const notesPerMeasure = difficulty.notesPerMeasure
  const uncertainRatio = difficulty.uncertainRatio

  const positiveEvidence = []
  const negativeEvidence = []
  const rejectReasons = []

  if (pageCount > 0) {
    positiveEvidence.push('has-pages')
  } else {
    negativeEvidence.push('no-pages')
    rejectReasons.push(OMR_FAILURE_REASON.NO_PAGES)
  }

  if (systems > 0 && pagesWithSystems > 0) {
    positiveEvidence.push('valid-systems')
  } else {
    negativeEvidence.push('no-systems')
    rejectReasons.push(OMR_FAILURE_REASON.NO_SYSTEMS)
  }

  if (noteCount > 0) {
    positiveEvidence.push('nonzero-notes')
  } else {
    negativeEvidence.push('no-notes')
    rejectReasons.push(OMR_FAILURE_REASON.NO_NOTES)
  }

  if (systemCoverage >= 0.55) {
    positiveEvidence.push('sufficient-page-coverage')
  } else if (systemCoverage < 0.45) {
    negativeEvidence.push('insufficient-page-coverage')
  }

  if (noteCount >= OMR_ACCEPTANCE_MIN_SUBSTANTIAL_NOTES) {
    positiveEvidence.push('substantial-note-inventory')
  }

  if (pageConfidence != null && pageConfidence >= OMR_ACCEPTANCE_MIN_MEAN_PAGE_CONFIDENCE) {
    positiveEvidence.push('plausible-page-confidence')
  } else if (pageConfidence != null && pageConfidence < OMR_ACCEPTANCE_MIN_MEAN_PAGE_CONFIDENCE) {
    negativeEvidence.push('low-page-confidence')
  }

  if (confidence < OMR_ACCEPTANCE_ABSOLUTE_CONFIDENCE_FLOOR) {
    negativeEvidence.push('absolute-low-confidence')
    rejectReasons.push(OMR_FAILURE_REASON.LOW_CONFIDENCE)
  }

  if (
    difficulty.reasons.includes(OMR_FAILURE_REASON.MANY_EMPTY_PAGES) &&
    difficulty.reasons.includes(OMR_FAILURE_REASON.SPARSE_NOTES)
  ) {
    negativeEvidence.push('empty-sparse-combo')
    rejectReasons.push(OMR_FAILURE_REASON.SPARSE_NOTES)
  }

  const safetyChecks = {
    hasPages: pageCount > 0,
    hasSystems: systems > 0 && pagesWithSystems > 0,
    hasNotes: noteCount > 0,
    sufficientPageCoverage: systemCoverage >= 0.45,
    absoluteConfidenceFloor: confidence >= OMR_ACCEPTANCE_ABSOLUTE_CONFIDENCE_FLOOR,
    meanPageConfidenceFloor:
      pageConfidence == null
        ? null
        : pageConfidence >= OMR_ACCEPTANCE_MIN_MEAN_PAGE_CONFIDENCE,
  }

  const extractionSummary = {
    pageCount,
    pagesWithSystems,
    systems,
    noteCount,
    measureCount,
    uncertainMeasures,
    notesPerMeasure,
    systemCoverage,
    uncertainRatio,
    overallConfidence: confidence,
    meanPageConfidence: pageConfidence,
    layoutSpread: layoutConsistency?.spread ?? null,
    layoutInconsistent: Boolean(layoutConsistency?.inconsistent),
  }

  // Hard safety / emptiness rejects only — never reject solely for mid page-confidence
  // when the legacy difficulty gate would have accepted (e.g. short scanned fixtures).
  const hardReject = rejectReasons.length > 0
  if (hardReject) {
    return {
      acceptance: OMR_ACCEPTANCE.REJECTED,
      confidenceBand,
      tooDifficultLegacy: true,
      reasons: uniqueReasons([...difficulty.reasons, ...rejectReasons]),
      warningReasons: [],
      rejectReasons: uniqueReasons(rejectReasons),
      positiveEvidence,
      negativeEvidence,
      safetyChecks,
      extractionSummary,
      message: OMR_TOO_DIFFICULT_MESSAGE,
      difficulty,
    }
  }

  if (!difficulty.tooDifficult) {
    return {
      acceptance: OMR_ACCEPTANCE.ACCEPTED,
      confidenceBand,
      tooDifficultLegacy: false,
      reasons: difficulty.reasons,
      warningReasons: [],
      rejectReasons: [],
      positiveEvidence,
      negativeEvidence,
      safetyChecks,
      extractionSummary,
      message: null,
      difficulty,
    }
  }

  // Legacy gate would hard-reject. Salvage only with structural mid-band evidence.
  // Mean page confidence is required here to keep low-info rasters (LOC Twinkle)
  // rejected while allowing Mutopia-class mid-confidence vectors through with warning.
  const structurallyUsable =
    systems >= 1 &&
    pagesWithSystems >= 1 &&
    noteCount >= OMR_ACCEPTANCE_MIN_SUBSTANTIAL_NOTES &&
    measureCount >= 1 &&
    systemCoverage >= 0.55 &&
    confidence >= OMR_ACCEPTANCE_STRUCTURAL_CONFIDENCE_FLOOR &&
    pageConfidence != null &&
    pageConfidence >= OMR_ACCEPTANCE_MIN_MEAN_PAGE_CONFIDENCE

  if (structurallyUsable) {
    positiveEvidence.push('mid-confidence-structural-salvage')
    return {
      acceptance: OMR_ACCEPTANCE.WARNING,
      confidenceBand: 'mid',
      tooDifficultLegacy: true,
      reasons: difficulty.reasons,
      warningReasons: uniqueReasons(difficulty.reasons),
      rejectReasons: [],
      positiveEvidence,
      negativeEvidence,
      safetyChecks,
      extractionSummary,
      message: OMR_QUALITY_WARNING_MESSAGE,
      difficulty,
    }
  }

  if (pageConfidence != null && pageConfidence < OMR_ACCEPTANCE_MIN_MEAN_PAGE_CONFIDENCE) {
    rejectReasons.push(OMR_FAILURE_REASON.LOW_CONFIDENCE)
  }

  negativeEvidence.push('insufficient-structural-evidence')
  return {
    acceptance: OMR_ACCEPTANCE.REJECTED,
    confidenceBand,
    tooDifficultLegacy: true,
    reasons: uniqueReasons([...difficulty.reasons, ...rejectReasons]),
    warningReasons: [],
    rejectReasons: uniqueReasons([...difficulty.reasons, ...rejectReasons]),
    positiveEvidence,
    negativeEvidence,
    safetyChecks,
    extractionSummary,
    message: OMR_TOO_DIFFICULT_MESSAGE,
    difficulty,
  }
}

/**
 * Build score-owned quality metadata (separate from MusicXML semantics).
 */
export function buildOmrQualityMetadata(acceptanceDecision, {
  ownerScoreId = null,
  sourceIdentity = null,
  safetyValidation = null,
} = {}) {
  const acceptance = acceptanceDecision?.acceptance ?? OMR_ACCEPTANCE.REJECTED
  return {
    acceptance,
    confidenceBand: acceptanceDecision?.confidenceBand ?? 'low',
    warningReasons: acceptanceDecision?.warningReasons ?? [],
    rejectReasons: acceptanceDecision?.rejectReasons ?? [],
    positiveEvidence: acceptanceDecision?.positiveEvidence ?? [],
    negativeEvidence: acceptanceDecision?.negativeEvidence ?? [],
    safetyChecks: {
      ...(acceptanceDecision?.safetyChecks ?? {}),
      ...(safetyValidation && typeof safetyValidation === 'object' ? safetyValidation : {}),
    },
    extractionSummary: acceptanceDecision?.extractionSummary ?? null,
    ownerScoreId: ownerScoreId ?? null,
    sourceIdentity: sourceIdentity ?? null,
    warningMessage:
      acceptance === OMR_ACCEPTANCE.WARNING ? OMR_QUALITY_WARNING_MESSAGE : null,
  }
}

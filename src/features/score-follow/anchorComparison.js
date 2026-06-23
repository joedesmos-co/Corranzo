/**
 * Next-generation automatic score alignment — Phase 5a: anchor comparison framework.
 *
 * Quantifies how close the unified generator (`generateAnchorsFromLayout`) lands
 * to a trusted reference anchor set (the hand-calibrated bundled anchors). This
 * is the evidence base for *eventually* promoting generated anchors to replace
 * bundled ones — it does NOT change any runtime behaviour, drive the cursor, or
 * touch the bundled anchors. Pure functions only.
 *
 * Geometry is compared in normalized page-fraction units (x, y ∈ [0, 1]), so a
 * tolerance of 0.005 ≈ half a percent of the page width.
 */
import { ANCHOR_TRUST } from './generateAnchorsFromLayout.js'

/** Per-measure geometry fields compared between generated and reference anchors. */
export const ANCHOR_COMPARISON_FIELDS = [
  'measureStartX',
  'playableStartX',
  'playableEndX',
  'systemEndX',
]

export const PROMOTION_STATUS = {
  READY: 'ready',
  NEEDS_REVIEW: 'needs-review',
  NOT_SAFE: 'not-safe',
}

export const PROMOTION_STATUS_LABEL = {
  [PROMOTION_STATUS.READY]: 'Ready for promotion',
  [PROMOTION_STATUS.NEEDS_REVIEW]: 'Needs review',
  [PROMOTION_STATUS.NOT_SAFE]: 'Not safe to promote',
}

/**
 * Promotion tolerances, in normalized page-fraction units (documented + explicit
 * so the golden tests fail loudly if generation drifts).
 *
 *   READY        — geometry within `ready` bounds, zero page/system mismatches,
 *                  zero missing anchors, and every generated anchor TRUSTED.
 *   NEEDS_REVIEW — structurally complete (no missing anchors, no page/system
 *                  mismatch, no MANUAL trust) and geometry within `needsReview`
 *                  bounds, but looser than READY or with CONFIRM_REQUIRED trust.
 *   NOT_SAFE     — any structural gap (missing anchor, page or system mismatch),
 *                  any MANUAL trust, geometry beyond `needsReview`, or no trusted
 *                  reference to compare against. Structural gaps are a HARD gate:
 *                  a mismatched page/system would place the cursor on the wrong
 *                  staff, so they can never be merely "review-worthy".
 */
export const ANCHOR_PROMOTION_TOLERANCES = {
  ready: { maxError: 0.005, avgError: 0.002 },
  needsReview: { maxError: 0.02, avgError: 0.01 },
}

/** Read unified geometry from either a generated anchor or a bundled anchor. */
export function readAnchorGeometry(anchor) {
  const meta = anchor?.meta ?? {}
  const pick = (key) => {
    if (Number.isFinite(anchor?.[key])) {
      return anchor[key]
    }
    return Number.isFinite(meta?.[key]) ? meta[key] : null
  }
  return {
    measureNumber: Number.isFinite(anchor?.measureNumber) ? anchor.measureNumber : null,
    page: Number.isFinite(anchor?.page) ? anchor.page : null,
    systemIndex: Number.isFinite(anchor?.systemIndex)
      ? anchor.systemIndex
      : Number.isFinite(meta?.systemIndex)
        ? meta.systemIndex
        : null,
    measureStartX: pick('measureStartX'),
    playableStartX: pick('playableStartX'),
    playableEndX: pick('playableEndX'),
    systemEndX: pick('systemEndX'),
    y: Number.isFinite(anchor?.y) ? anchor.y : null,
    confidence: Number.isFinite(anchor?.confidence) ? anchor.confidence : null,
    trust: anchor?.trust ?? null,
  }
}

/** Distribution of generated-anchor trust levels + confidence summary. */
export function summarizeConfidenceDistribution(anchors = []) {
  const trust = {
    [ANCHOR_TRUST.TRUSTED]: 0,
    [ANCHOR_TRUST.CONFIRM_REQUIRED]: 0,
    [ANCHOR_TRUST.MANUAL]: 0,
    unknown: 0,
  }
  const confidences = []
  for (const anchor of anchors) {
    const level = anchor?.trust
    if (level && level in trust) {
      trust[level] += 1
    } else {
      trust.unknown += 1
    }
    if (Number.isFinite(anchor?.confidence)) {
      confidences.push(anchor.confidence)
    }
  }
  return {
    total: anchors.length,
    trust,
    minConfidence: confidences.length ? Math.min(...confidences) : null,
    meanConfidence: confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null,
  }
}

function emptyFieldStats() {
  const perField = {}
  for (const field of ANCHOR_COMPARISON_FIELDS) {
    perField[field] = { maxError: 0, avgError: 0, count: 0 }
  }
  return perField
}

/**
 * Compare a generated anchor set against a trusted reference (bundled) set.
 *
 * @param {Array} generatedAnchors  output of generateAnchorsFromLayout (`.anchors`)
 * @param {Array|null} referenceAnchors  trusted/bundled anchors, or null/empty
 * @returns {object} comparison result (see fields below). When no reference is
 *   supplied, `comparable` is false and only the confidence distribution +
 *   counts are populated.
 */
export function compareAnchorSets(generatedAnchors = [], referenceAnchors = null) {
  const generated = generatedAnchors.map(readAnchorGeometry)
  const confidenceDistribution = summarizeConfidenceDistribution(generatedAnchors)

  if (!Array.isArray(referenceAnchors) || referenceAnchors.length === 0) {
    return {
      comparable: false,
      generatedCount: generated.length,
      referenceCount: 0,
      measuresCompared: 0,
      missingFromGenerated: [],
      missingFromReference: generated
        .map((a) => a.measureNumber)
        .filter((n) => n != null),
      pageMismatchCount: 0,
      systemMismatchCount: 0,
      perField: emptyFieldStats(),
      maxError: 0,
      avgError: 0,
      perMeasure: [],
      confidenceDistribution,
    }
  }

  const reference = referenceAnchors.map(readAnchorGeometry)
  const generatedByMeasure = new Map(
    generated.filter((a) => a.measureNumber != null).map((a) => [a.measureNumber, a]),
  )
  const referenceByMeasure = new Map(
    reference.filter((a) => a.measureNumber != null).map((a) => [a.measureNumber, a]),
  )

  const missingFromGenerated = [...referenceByMeasure.keys()]
    .filter((m) => !generatedByMeasure.has(m))
    .sort((a, b) => a - b)
  const missingFromReference = [...generatedByMeasure.keys()]
    .filter((m) => !referenceByMeasure.has(m))
    .sort((a, b) => a - b)

  const sharedMeasures = [...referenceByMeasure.keys()]
    .filter((m) => generatedByMeasure.has(m))
    .sort((a, b) => a - b)

  const perField = emptyFieldStats()
  const perMeasure = []
  let pageMismatchCount = 0
  let systemMismatchCount = 0
  let errorSum = 0
  let errorCount = 0
  let overallMax = 0

  for (const measureNumber of sharedMeasures) {
    const gen = generatedByMeasure.get(measureNumber)
    const ref = referenceByMeasure.get(measureNumber)

    const pageMismatch = gen.page != null && ref.page != null && gen.page !== ref.page
    const systemMismatch =
      gen.systemIndex != null && ref.systemIndex != null && gen.systemIndex !== ref.systemIndex
    if (pageMismatch) {
      pageMismatchCount += 1
    }
    if (systemMismatch) {
      systemMismatchCount += 1
    }

    const errors = {}
    for (const field of ANCHOR_COMPARISON_FIELDS) {
      if (Number.isFinite(gen[field]) && Number.isFinite(ref[field])) {
        const error = Math.abs(gen[field] - ref[field])
        errors[field] = error
        const stats = perField[field]
        stats.count += 1
        stats.maxError = Math.max(stats.maxError, error)
        stats.avgError += error
        errorSum += error
        errorCount += 1
        overallMax = Math.max(overallMax, error)
      } else {
        errors[field] = null
      }
    }

    perMeasure.push({ measureNumber, pageMismatch, systemMismatch, errors })
  }

  for (const field of ANCHOR_COMPARISON_FIELDS) {
    const stats = perField[field]
    stats.avgError = stats.count > 0 ? stats.avgError / stats.count : 0
  }

  return {
    comparable: true,
    generatedCount: generated.length,
    referenceCount: reference.length,
    measuresCompared: sharedMeasures.length,
    missingFromGenerated,
    missingFromReference,
    pageMismatchCount,
    systemMismatchCount,
    perField,
    maxError: overallMax,
    avgError: errorCount > 0 ? errorSum / errorCount : 0,
    perMeasure,
    confidenceDistribution,
  }
}

/**
 * Classify a comparison as ready / needs-review / not-safe for promotion.
 *
 * @param {object} comparison  result of compareAnchorSets
 * @param {object} [options]
 * @param {object} [options.tolerances]  override ANCHOR_PROMOTION_TOLERANCES
 * @returns {{ status: string, label: string, reasons: string[] }}
 */
export function assessPromotionReadiness(comparison, { tolerances = ANCHOR_PROMOTION_TOLERANCES } = {}) {
  const reasons = []

  if (!comparison || comparison.comparable !== true) {
    return {
      status: PROMOTION_STATUS.NOT_SAFE,
      label: PROMOTION_STATUS_LABEL[PROMOTION_STATUS.NOT_SAFE],
      reasons: ['No trusted reference anchors to compare against.'],
    }
  }

  if (comparison.measuresCompared === 0) {
    return {
      status: PROMOTION_STATUS.NOT_SAFE,
      label: PROMOTION_STATUS_LABEL[PROMOTION_STATUS.NOT_SAFE],
      reasons: ['No measures overlapped between generated and reference anchors.'],
    }
  }

  const dist = comparison.confidenceDistribution?.trust ?? {}
  const hasManual = (dist[ANCHOR_TRUST.MANUAL] ?? 0) > 0
  const hasConfirm = (dist[ANCHOR_TRUST.CONFIRM_REQUIRED] ?? 0) > 0
  const structurallyComplete =
    comparison.missingFromGenerated.length === 0 &&
    comparison.missingFromReference.length === 0 &&
    comparison.pageMismatchCount === 0 &&
    comparison.systemMismatchCount === 0

  if (comparison.missingFromGenerated.length > 0) {
    reasons.push(`${comparison.missingFromGenerated.length} reference measure(s) have no generated anchor.`)
  }
  if (comparison.missingFromReference.length > 0) {
    reasons.push(`${comparison.missingFromReference.length} generated anchor(s) have no reference measure.`)
  }
  if (comparison.pageMismatchCount > 0) {
    reasons.push(`${comparison.pageMismatchCount} page mismatch(es).`)
  }
  if (comparison.systemMismatchCount > 0) {
    reasons.push(`${comparison.systemMismatchCount} system mismatch(es).`)
  }
  if (hasManual) {
    reasons.push('Generation fell back to MANUAL for at least one anchor.')
  }

  const withinReady =
    comparison.maxError <= tolerances.ready.maxError &&
    comparison.avgError <= tolerances.ready.avgError
  const withinReview =
    comparison.maxError <= tolerances.needsReview.maxError &&
    comparison.avgError <= tolerances.needsReview.avgError

  reasons.push(
    `max error ${comparison.maxError.toFixed(4)}, avg error ${comparison.avgError.toFixed(4)} ` +
      `(ready ≤ ${tolerances.ready.maxError}/${tolerances.ready.avgError}, ` +
      `review ≤ ${tolerances.needsReview.maxError}/${tolerances.needsReview.avgError}).`,
  )

  let status
  if (!structurallyComplete || hasManual) {
    // HARD gate: a missing anchor or a page/system mismatch would put the cursor
    // on the wrong measure/staff. That is never auto-promotable nor merely
    // "review-worthy" — it is unsafe regardless of how good the rest of the
    // overlapping geometry looks.
    status = PROMOTION_STATUS.NOT_SAFE
  } else if (withinReady && !hasConfirm) {
    status = PROMOTION_STATUS.READY
  } else if (withinReview) {
    status = PROMOTION_STATUS.NEEDS_REVIEW
  } else {
    status = PROMOTION_STATUS.NOT_SAFE
  }

  return { status, label: PROMOTION_STATUS_LABEL[status], reasons }
}

const fmt = (value) => (Number.isFinite(value) ? value.toFixed(4) : '—')

/** Human-readable comparison + promotion summary for CLIs / diagnostics. */
export function formatAnchorComparisonText(comparison, readiness = null) {
  const lines = []
  if (!comparison?.comparable) {
    lines.push('Anchor comparison: no reference anchors (not comparable).')
    const dist = comparison?.confidenceDistribution
    if (dist) {
      lines.push(
        `  generated ${dist.total} | trusted ${dist.trust[ANCHOR_TRUST.TRUSTED] ?? 0} | ` +
          `confirm ${dist.trust[ANCHOR_TRUST.CONFIRM_REQUIRED] ?? 0} | manual ${dist.trust[ANCHOR_TRUST.MANUAL] ?? 0}`,
      )
    }
    return lines.join('\n')
  }

  lines.push(
    `Anchor comparison: ${comparison.measuresCompared} measures | ` +
      `max err ${fmt(comparison.maxError)} | avg err ${fmt(comparison.avgError)}`,
  )
  lines.push(
    `  missing(gen/ref): ${comparison.missingFromGenerated.length}/${comparison.missingFromReference.length} | ` +
      `page mismatch: ${comparison.pageMismatchCount} | system mismatch: ${comparison.systemMismatchCount}`,
  )
  for (const field of ANCHOR_COMPARISON_FIELDS) {
    const stats = comparison.perField[field]
    lines.push(`  ${field.padEnd(15)} max ${fmt(stats.maxError)} | avg ${fmt(stats.avgError)} | n=${stats.count}`)
  }
  const dist = comparison.confidenceDistribution
  lines.push(
    `  trust: trusted ${dist.trust[ANCHOR_TRUST.TRUSTED] ?? 0} | ` +
      `confirm ${dist.trust[ANCHOR_TRUST.CONFIRM_REQUIRED] ?? 0} | ` +
      `manual ${dist.trust[ANCHOR_TRUST.MANUAL] ?? 0} | ` +
      `conf mean/min ${fmt(dist.meanConfidence)}/${fmt(dist.minConfidence)}`,
  )
  if (readiness) {
    lines.push(`  Promotion: ${readiness.label}`)
    for (const reason of readiness.reasons) {
      lines.push(`    · ${reason}`)
    }
  }
  return lines.join('\n')
}

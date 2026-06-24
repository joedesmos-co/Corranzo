/**
 * Next-generation automatic score alignment — Phase 5b: runtime promotion layer.
 *
 * A SMALL, pure decision layer that gates whether validated generated anchors
 * may be used at runtime, reusing the Phase 5a readiness framework. It does not
 * generate anchors, touch the cursor, replace bundled anchors, or remove manual
 * / semi-auto setup. The clear decision path is:
 *
 *   READY        → generated anchors allowed
 *   NEEDS_REVIEW → existing behavior (fall back)
 *   NOT_SAFE     → existing behavior (fall back)
 *
 * Safety defaults: promotion is only ever allowed when explicitly enabled (the
 * Phase 4 flag), the readiness is READY, generated anchors actually exist, and
 * the session is NOT the bundled demo (whose hand-calibrated anchors must never
 * be replaced). Anything uncertain falls back to the current path.
 */
import { PROMOTION_STATUS } from './anchorComparison.js'

export const ANCHOR_SOURCE_KIND = {
  GENERATED: 'generated',
  BUNDLED: 'bundled',
  MANUAL: 'manual',
  SEMI_AUTO: 'semi-auto',
  NONE: 'none',
}

export const ANCHOR_SOURCE_LABEL = {
  [ANCHOR_SOURCE_KIND.GENERATED]: 'Generated (validated)',
  [ANCHOR_SOURCE_KIND.BUNDLED]: 'Bundled demo',
  [ANCHOR_SOURCE_KIND.MANUAL]: 'Manual markers',
  [ANCHOR_SOURCE_KIND.SEMI_AUTO]: 'Semi-auto detection',
  [ANCHOR_SOURCE_KIND.NONE]: 'None',
}

export const PROMOTION_REASON = {
  DISABLED: 'flag-disabled',
  DEMO_BUNDLED: 'demo-uses-bundled',
  NO_GENERATED: 'no-generated-anchors',
  READY: 'ready',
  NEEDS_REVIEW: 'needs-review-fallback',
  NOT_SAFE: 'not-safe-fallback',
}

/**
 * Decide whether validated generated anchors may drive runtime score-follow.
 *
 * @param {object} params
 * @param {string|null} params.readinessStatus  PROMOTION_STATUS.* from Phase 5a
 * @param {boolean} params.enabled              the next-gen flag (default off)
 * @param {boolean} [params.isDemoSession]      bundled-demo session (never replace)
 * @param {boolean} [params.hasGeneratedAnchors]
 * @returns {{ useGenerated: boolean, reason: string }}
 */
export function decidePromotedAnchorUse({
  readinessStatus,
  enabled,
  isDemoSession = false,
  hasGeneratedAnchors = false,
}) {
  if (!enabled) {
    return { useGenerated: false, reason: PROMOTION_REASON.DISABLED }
  }
  // The bundled demo's hand-calibrated anchors are the source of truth and must
  // never be replaced by promotion (explicit Phase 5b constraint).
  if (isDemoSession) {
    return { useGenerated: false, reason: PROMOTION_REASON.DEMO_BUNDLED }
  }
  if (!hasGeneratedAnchors) {
    return { useGenerated: false, reason: PROMOTION_REASON.NO_GENERATED }
  }
  if (readinessStatus === PROMOTION_STATUS.READY) {
    return { useGenerated: true, reason: PROMOTION_REASON.READY }
  }
  if (readinessStatus === PROMOTION_STATUS.NEEDS_REVIEW) {
    return { useGenerated: false, reason: PROMOTION_REASON.NEEDS_REVIEW }
  }
  return { useGenerated: false, reason: PROMOTION_REASON.NOT_SAFE }
}

/**
 * Which anchor source is actually active (diagnostics only). Generated wins only
 * when promotion allowed it; otherwise the existing precedence applies:
 * manual → bundled → semi-auto → none.
 */
export function resolveActiveAnchorSource({ useGenerated = false, anchorCounts = {} } = {}) {
  if (useGenerated) {
    return ANCHOR_SOURCE_KIND.GENERATED
  }
  if ((anchorCounts.manual ?? 0) > 0) {
    return ANCHOR_SOURCE_KIND.MANUAL
  }
  if ((anchorCounts.demo ?? 0) > 0) {
    return ANCHOR_SOURCE_KIND.BUNDLED
  }
  if (
    (anchorCounts.auto ?? 0) > 0 ||
    (anchorCounts.autoSystem ?? 0) > 0 ||
    (anchorCounts.autoMeasure ?? 0) > 0 ||
    (anchorCounts.musicxmlLayout ?? 0) > 0
  ) {
    return ANCHOR_SOURCE_KIND.SEMI_AUTO
  }
  return ANCHOR_SOURCE_KIND.NONE
}

/**
 * Build the unified runtime promotion decision from a Phase 5a readiness result.
 *
 * @param {object} params
 * @param {boolean} params.enabled
 * @param {boolean} [params.isDemoSession]
 * @param {object|null} [params.comparison]    result of compareAnchorSets
 * @param {object|null} [params.readiness]     result of assessPromotionReadiness
 * @param {object} [params.anchorCounts]       countAnchorsBySource() result
 * @param {Array} [params.generatedAnchors]
 * @returns {object} { useGenerated, reason, status, comparable, activeSource, activeSourceLabel }
 */
export function buildPromotionDecision({
  enabled,
  isDemoSession = false,
  comparison = null,
  readiness = null,
  anchorCounts = {},
  generatedAnchors = [],
}) {
  const hasGeneratedAnchors = Array.isArray(generatedAnchors) && generatedAnchors.length > 0
  const decision = decidePromotedAnchorUse({
    readinessStatus: readiness?.status ?? null,
    enabled,
    isDemoSession,
    hasGeneratedAnchors,
  })
  const activeSource = resolveActiveAnchorSource({
    useGenerated: decision.useGenerated,
    anchorCounts,
  })
  return {
    enabled: Boolean(enabled),
    useGenerated: decision.useGenerated,
    reason: decision.reason,
    status: readiness?.status ?? null,
    statusReasons: readiness?.reasons ?? [],
    comparable: comparison?.comparable ?? false,
    activeSource,
    activeSourceLabel: ANCHOR_SOURCE_LABEL[activeSource],
  }
}

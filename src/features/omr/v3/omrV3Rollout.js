/** Disabled-by-default runtime controls for the OMR V3 shadow. */

export const OMR_V3_PROMOTION_KEYS = Object.freeze([
  'structure',
  'measureGeometry',
  'pianoGrouping',
  'guitarFusion',
  'fullV3',
])

export const DEFAULT_OMR_V3_ROLLOUT = Object.freeze({
  shadow: false,
  rollback: false,
  promotions: Object.freeze({
    structure: false,
    measureGeometry: false,
    pianoGrouping: false,
    guitarFusion: false,
    fullV3: false,
  }),
})

/**
 * Runtime promotion is intentionally unavailable in this sprint. Requested
 * promotion flags are retained for diagnostics, but resolve false until a
 * benchmark gate is explicitly promoted in a later change.
 */
export function resolveOmrV3RolloutOptions({
  shadow = false,
  rollback = false,
  promotions = {},
} = {}) {
  const requestedPromotions = Object.fromEntries(
    OMR_V3_PROMOTION_KEYS.map((key) => [key, Boolean(promotions?.[key])]),
  )
  const resolvedPromotions = Object.fromEntries(OMR_V3_PROMOTION_KEYS.map((key) => [key, false]))
  return {
    shadow: Boolean(shadow) && !rollback,
    rollback: Boolean(rollback),
    requestedPromotions,
    promotions: resolvedPromotions,
    anyPromotionRequested: Object.values(requestedPromotions).some(Boolean),
    anyPromotionEnabled: false,
    promotedToRuntime: false,
    mode: Boolean(shadow) && !rollback ? 'shadow' : 'off',
  }
}

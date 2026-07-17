/** Disabled-by-default runtime controls for the OMR V3 shadow and candidate. */

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
  runtimeCandidate: false,
  promotions: Object.freeze({
    structure: false,
    measureGeometry: false,
    pianoGrouping: false,
    guitarFusion: false,
    fullV3: false,
  }),
})

function resolveMode({ shadow, rollback, anyPromotionEnabled, runtimeCandidate }) {
  if (rollback) return 'rollback'
  if (anyPromotionEnabled) return 'runtime-candidate'
  if (shadow) return 'shadow'
  if (runtimeCandidate) return 'runtime-candidate-idle'
  return 'off'
}

/**
 * Resolve shadow / rollback / promotion flags.
 *
 * Promotions stay off unless `runtimeCandidate` is explicitly enabled and the
 * kill switch (`rollback`) is not engaged. Requested flags are retained for
 * diagnostics even when they do not resolve on.
 */
export function resolveOmrV3RolloutOptions({
  shadow = false,
  rollback = false,
  promotions = {},
  runtimeCandidate = false,
} = {}) {
  const killSwitch = Boolean(rollback)
  const requestedPromotions = Object.fromEntries(
    OMR_V3_PROMOTION_KEYS.map((key) => [key, Boolean(promotions?.[key])]),
  )
  const candidateArmed = Boolean(runtimeCandidate) && !killSwitch
  const resolvedPromotions = Object.fromEntries(
    OMR_V3_PROMOTION_KEYS.map((key) => [key, candidateArmed && requestedPromotions[key]]),
  )
  const anyPromotionRequested = Object.values(requestedPromotions).some(Boolean)
  const anyPromotionEnabled = Object.values(resolvedPromotions).some(Boolean)
  const shadowEnabled = Boolean(shadow) && !killSwitch
  return {
    shadow: shadowEnabled,
    rollback: killSwitch,
    runtimeCandidate: candidateArmed,
    requestedPromotions,
    promotions: resolvedPromotions,
    anyPromotionRequested,
    anyPromotionEnabled,
    promotedToRuntime: false,
    mode: resolveMode({
      shadow: shadowEnabled,
      rollback: killSwitch,
      anyPromotionEnabled,
      runtimeCandidate: candidateArmed,
    }),
  }
}

/**
 * Prove the runtime candidate is implemented as default-off with an honored
 * kill switch. Used by the production gate — never hardcode the gate flags.
 */
export function assessOmrV3RuntimeCandidateReadiness() {
  const defaults = resolveOmrV3RolloutOptions({})
  const promotionsOnly = resolveOmrV3RolloutOptions({
    promotions: {
      structure: true,
      measureGeometry: true,
      pianoGrouping: true,
      guitarFusion: true,
      fullV3: true,
    },
  })
  const candidateArmed = resolveOmrV3RolloutOptions({
    runtimeCandidate: true,
    promotions: { fullV3: true, guitarFusion: true },
  })
  const killSwitch = resolveOmrV3RolloutOptions({
    runtimeCandidate: true,
    rollback: true,
    shadow: true,
    promotions: { fullV3: true },
  })

  const defaultOff =
    defaults.runtimeCandidate === false &&
    defaults.anyPromotionEnabled === false &&
    defaults.mode === 'off'
  const promotionsStayOffWithoutCandidate =
    promotionsOnly.runtimeCandidate === false &&
    promotionsOnly.anyPromotionEnabled === false &&
    Object.values(promotionsOnly.promotions).every((value) => value === false)
  const canEnableWhenRequested =
    candidateArmed.runtimeCandidate === true &&
    candidateArmed.promotions.fullV3 === true &&
    candidateArmed.promotions.guitarFusion === true &&
    candidateArmed.anyPromotionEnabled === true &&
    candidateArmed.mode === 'runtime-candidate'
  const killSwitchHonored =
    killSwitch.rollback === true &&
    killSwitch.runtimeCandidate === false &&
    killSwitch.shadow === false &&
    killSwitch.anyPromotionEnabled === false &&
    killSwitch.mode === 'rollback'

  return {
    implemented:
      defaultOff &&
      promotionsStayOffWithoutCandidate &&
      canEnableWhenRequested &&
      killSwitchHonored,
    defaultOff,
    promotionsStayOffWithoutCandidate,
    canEnableWhenRequested,
    killSwitchHonored,
    evidence: {
      defaults,
      promotionsOnly,
      candidateArmed,
      killSwitch,
    },
  }
}

/**
 * Decide whether independent V3 MusicXML may replace the production document.
 * Category promotions other than `fullV3` arm cohort flags only; they do not
 * swap MusicXML.
 */
export function decideOmrV3RuntimePromotion({
  productionMusicXml = '',
  independentShadow = null,
  rollout = DEFAULT_OMR_V3_ROLLOUT,
  latencyMs = null,
} = {}) {
  const category = rollout?.promotions?.fullV3
    ? 'full-v3'
    : rollout?.anyPromotionEnabled
      ? 'category-cohort'
      : 'none'
  const baseTelemetry = {
    category,
    decision: 'hold',
    confidence: null,
    latencyMs: latencyMs == null ? null : Number(latencyMs),
    musicXmlChanged: false,
    musicXmlByteLengthDelta: 0,
    promotedToRuntime: false,
    reason: null,
  }

  if (rollout?.rollback) {
    return {
      musicXml: productionMusicXml,
      independentShadow,
      telemetry: { ...baseTelemetry, decision: 'hold-rollback', reason: 'kill-switch' },
    }
  }

  if (!rollout?.runtimeCandidate) {
    return {
      musicXml: productionMusicXml,
      independentShadow,
      telemetry: {
        ...baseTelemetry,
        decision: 'hold-default-off',
        reason: 'runtime-candidate-off',
      },
    }
  }

  if (!rollout?.promotions?.fullV3) {
    return {
      musicXml: productionMusicXml,
      independentShadow,
      telemetry: {
        ...baseTelemetry,
        decision: rollout.anyPromotionEnabled ? 'arm-category-cohort' : 'hold-no-full-v3',
        reason: rollout.anyPromotionEnabled ? 'category-only' : 'full-v3-not-requested',
      },
    }
  }

  const invalidEventCount = independentShadow?.serializer?.invalidEventCount
  const candidateXml = independentShadow?.musicXml
  const ready =
    independentShadow?.status === 'ready' &&
    typeof candidateXml === 'string' &&
    candidateXml.length > 0 &&
    Number(invalidEventCount ?? Number.POSITIVE_INFINITY) === 0

  if (!ready) {
    return {
      musicXml: productionMusicXml,
      independentShadow,
      telemetry: {
        ...baseTelemetry,
        decision: 'hold-invalid-or-unavailable',
        reason: independentShadow?.status ?? 'missing-independent-shadow',
        confidence: independentShadow?.evaluation?.confidence?.overall ?? null,
      },
    }
  }

  const musicXmlChanged = candidateXml !== productionMusicXml
  return {
    musicXml: candidateXml,
    independentShadow: {
      ...independentShadow,
      promotedToRuntime: true,
    },
    telemetry: {
      ...baseTelemetry,
      decision: 'promote',
      reason: 'full-v3-valid',
      confidence: independentShadow?.evaluation?.confidence?.overall ?? null,
      musicXmlChanged,
      musicXmlByteLengthDelta: candidateXml.length - String(productionMusicXml ?? '').length,
      promotedToRuntime: true,
    },
  }
}

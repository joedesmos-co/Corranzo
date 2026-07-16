import {
  ATTACK_PHASE,
  RECOGNITION_OUTCOME,
  RECOGNITION_TIMING,
  createAttack,
  createRecognitionDecision,
  createRecognitionId,
} from './micRecognitionIr.js'
import { PERFORMANCE_MODE } from './performanceExpectation.js'

export const MUSICAL_TIMING_DEFAULTS = Object.freeze({
  releaseFrames: 4,
  attackRiseRatio: 1.6,
  envelopeDecay: 0.92,
})

function finite(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp01(value) {
  return Math.min(1, Math.max(0, finite(value, 0)))
}

function uniqueMidis(values = []) {
  return [...new Set((values ?? []).map(Number).filter(Number.isFinite))]
}

function checkpointId(expectation) {
  return expectation?.id ?? expectation?.sourceCheckpointId ?? null
}

export function createMusicalTimingState(expectation = null) {
  return {
    schemaVersion: 3,
    checkpointId: checkpointId(expectation),
    phase: ATTACK_PHASE.RELEASE,
    activeAttackId: null,
    attackTimeMs: null,
    holdStartMs: null,
    peakRms: null,
    envelopeRms: null,
    lastGateOpen: false,
    releaseFrames: MUSICAL_TIMING_DEFAULTS.releaseFrames,
    releaseFrameCount: MUSICAL_TIMING_DEFAULTS.releaseFrames,
    ringingMidis: [],
    lastConsumedMidis: [],
    consumedForCheckpoint: false,
    sequence: 0,
  }
}

function cloneForCheckpoint(state, expectation, options) {
  if (!state) {
    const initial = createMusicalTimingState(expectation)
    initial.releaseFrames = options.releaseFrames
    initial.releaseFrameCount = options.releaseFrames
    return initial
  }
  const changed = state.checkpointId !== checkpointId(expectation)
  return {
    ...state,
    checkpointId: checkpointId(expectation),
    releaseFrames: options.releaseFrames,
    ringingMidis: [...(state.ringingMidis ?? [])],
    lastConsumedMidis: [...(state.lastConsumedMidis ?? [])],
    consumedForCheckpoint: changed ? false : Boolean(state.consumedForCheckpoint),
  }
}

/**
 * Classify a performance event against the score window. Wait For You holds its
 * clock at the checkpoint, so its detector is intentionally untimed; its early
 * visual travel remains a presentation concern. Play Along uses the continuous
 * playhead and receives explicit early/target/late/outside decisions.
 */
export function classifyRecognitionTiming(expectation, eventTimeMs) {
  if (expectation?.mode === PERFORMANCE_MODE.WAIT_FOR_YOU) {
    return RECOGNITION_TIMING.UNTIMED
  }
  const time = finite(eventTimeMs)
  const timing = expectation?.timing
  if (time == null || !timing) return RECOGNITION_TIMING.UNTIMED
  if (time < timing.earlyStartMs || time > timing.lateEndMs) {
    return RECOGNITION_TIMING.OUTSIDE
  }
  if (time < timing.targetStartMs) return RECOGNITION_TIMING.EARLY
  if (time <= timing.targetEndMs) return RECOGNITION_TIMING.TARGET
  return RECOGNITION_TIMING.LATE
}

function frameGateOpen(frame) {
  return Boolean(frame?.signal?.gateOpen ?? frame?.gateOpen)
}

function frameMusical(frame, explicit) {
  if (explicit != null) return Boolean(explicit)
  if (frame?.signal?.musical != null) return Boolean(frame.signal.musical)
  if (frame?.musical != null) return Boolean(frame.musical)
  return false
}

function frameRms(frame) {
  return finite(frame?.signal?.rms ?? frame?.filteredRms ?? frame?.rms)
}

function frameRinging(frame) {
  return uniqueMidis(frame?.ringingMidis ?? frame?.signal?.ringingMidis ?? [])
}

function attackConfidence({ explicitAttack, gateOpened, energyRise, rms, envelopeRms }) {
  if (explicitAttack?.confidence != null) return clamp01(explicitAttack.confidence)
  if (energyRise && rms != null && envelopeRms > 0) {
    return clamp01(0.65 + Math.min(0.35, (rms / envelopeRms - 1) * 0.2))
  }
  if (gateOpened) return 0.8
  return 0
}

/**
 * Advance the musical attack lifecycle for one microphone frame. This function
 * is pure: callers receive a new serializable state and an immutable Attack IR.
 */
export function updateMusicalTiming({
  expectation,
  frame = {},
  state = null,
  timeMs = null,
  musical = null,
  explicitAttack = null,
  options: optionOverrides = {},
} = {}) {
  if (!checkpointId(expectation)) {
    throw new TypeError('updateMusicalTiming requires a PerformanceCheckpoint')
  }
  const options = { ...MUSICAL_TIMING_DEFAULTS, ...optionOverrides }
  const now = Math.max(0, finite(timeMs ?? frame?.timeMs, 0))
  const next = cloneForCheckpoint(state, expectation, options)
  next.sequence += 1
  const gateOpen = frameGateOpen(frame)
  const musicalFrame = frameMusical(frame, musical)
  const rms = frameRms(frame)
  const ringing = frameRinging(frame)
  const previousEnvelope = next.envelopeRms
  const gateOpened = gateOpen && !next.lastGateOpen && next.releaseFrameCount >= options.releaseFrames
  const energyRise = Boolean(
    gateOpen &&
    rms != null &&
    previousEnvelope != null &&
    previousEnvelope > 0 &&
    rms >= previousEnvelope * options.attackRiseRatio,
  )
  const explicitFresh = Boolean(explicitAttack?.fresh ?? frame?.freshAttack)
  const trustedRearm = Boolean(frame?.attackRearmReason)
  const fresh = Boolean(musicalFrame && gateOpen && (explicitFresh || gateOpened || energyRise || trustedRearm))

  if (fresh) {
    next.phase = ATTACK_PHASE.ATTACK
    next.attackTimeMs = now
    next.holdStartMs = now
    next.activeAttackId = explicitAttack?.id ?? createRecognitionId(
      'timing-attack',
      checkpointId(expectation),
      now,
      next.sequence,
    )
    next.peakRms = rms
    next.envelopeRms = rms
    next.releaseFrameCount = 0
  } else if (gateOpen) {
    next.phase = ATTACK_PHASE.HOLD
    next.holdStartMs ??= now
    next.releaseFrameCount = 0
    if (rms != null) {
      next.peakRms = next.peakRms == null ? rms : Math.max(next.peakRms, rms)
      const decayed = previousEnvelope == null ? rms : previousEnvelope * options.envelopeDecay
      next.envelopeRms = Math.min(rms, decayed)
    }
  } else if (ringing.length) {
    next.phase = ATTACK_PHASE.RINGING
    next.releaseFrameCount += 1
    if (rms != null) {
      next.envelopeRms = previousEnvelope == null
        ? rms
        : Math.min(rms, previousEnvelope * options.envelopeDecay)
    }
  } else {
    next.phase = ATTACK_PHASE.RELEASE
    next.releaseFrameCount += 1
    if (next.releaseFrameCount >= options.releaseFrames) {
      next.activeAttackId = null
      next.attackTimeMs = null
      next.holdStartMs = null
      next.peakRms = null
      next.envelopeRms = null
    }
  }

  next.lastGateOpen = gateOpen
  next.ringingMidis = ringing
  const eventTimeMs = next.attackTimeMs ?? now
  const timing = classifyRecognitionTiming(expectation, eventTimeMs)
  const tiedHold = expectation?.event?.kind === 'tied-hold' || expectation?.ties?.attackRequired === false
  const mayCollect = Boolean(
    musicalFrame &&
    !next.consumedForCheckpoint &&
    (fresh || (gateOpen && next.activeAttackId) || tiedHold),
  )
  const mayAdvance = Boolean(
    mayCollect &&
    !tiedHold &&
    timing !== RECOGNITION_TIMING.OUTSIDE &&
    next.activeAttackId,
  )
  const mayHold = Boolean(
    tiedHold &&
    musicalFrame &&
    (gateOpen || ringing.length),
  )
  const confidence = attackConfidence({
    explicitAttack,
    gateOpened,
    energyRise,
    rms,
    envelopeRms: previousEnvelope,
  })
  const attack = next.activeAttackId ? createAttack({
    id: next.activeAttackId,
    timeMs: next.attackTimeMs ?? now,
    phase: next.phase,
    peakRms: next.peakRms,
    envelopeRms: next.envelopeRms,
    energyRiseRatio: energyRise && previousEnvelope > 0 ? rms / previousEnvelope : null,
    isFresh: fresh,
    confidence: { overall: confidence, attack: confidence },
    debug: {
      gateOpened,
      energyRise,
      explicitFresh,
      trustedRearm,
      releaseFrameCount: next.releaseFrameCount,
    },
  }) : null

  return {
    state: next,
    attack,
    timing,
    phase: next.phase,
    fresh,
    authority: { mayCollect, mayAdvance, mayHold },
    debug: { gateOpen, musical: musicalFrame, energyRise, gateOpened },
  }
}

export function markMusicalTimingConsumed(state, { matchedMidis = [] } = {}) {
  if (!state) return state
  return {
    ...state,
    consumedForCheckpoint: true,
    lastConsumedMidis: uniqueMidis(matchedMidis),
    ringingMidis: [...(state.ringingMidis ?? [])],
  }
}

/**
 * Attach timing to an instrument decision. Outside-window matches are retained
 * as auditable rejects but cannot advance the score.
 */
export function applyRecognitionTiming(decision, timingResult) {
  if (!decision?.checkpointId) {
    throw new TypeError('applyRecognitionTiming requires a RecognitionDecision')
  }
  const timing = timingResult?.timing ?? RECOGNITION_TIMING.UNTIMED
  const outside = timing === RECOGNITION_TIMING.OUTSIDE
  const blockedByAuthority = decision.advance && timingResult?.authority?.mayAdvance === false
  const rejected = outside || blockedByAuthority
  return createRecognitionDecision({
    id: createRecognitionId('timed-decision', decision.id, timing),
    checkpointId: decision.checkpointId,
    windowId: decision.windowId,
    timeMs: decision.timeMs,
    outcome: rejected ? RECOGNITION_OUTCOME.REJECTED : decision.outcome,
    timing,
    reason: outside
      ? 'outside-performance-window'
      : blockedByAuthority
        ? 'attack-authority-required'
        : decision.reason,
    advance: rejected ? false : decision.advance,
    matchedMidis: decision.matchedMidis,
    missingMidis: decision.missingMidis,
    unexpectedMidis: decision.unexpectedMidis,
    ringingMidis: decision.ringingMidis,
    attackId: timingResult?.attack?.id ?? decision.attackId,
    confidence: decision.confidence,
    progress: {
      ...decision.progress,
      attackPhase: timingResult?.phase ?? null,
      mayHold: Boolean(timingResult?.authority?.mayHold),
    },
    diagnostics: decision.diagnostics,
    evidenceRefs: decision.evidenceRefs,
    debug: {
      ...decision.debug,
      musicalTiming: timingResult?.debug ?? {},
    },
  })
}

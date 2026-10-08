/**
 * Five-stage electric-guitar signal probe (Stage 2, S5) — EXPERIMENTAL.
 *
 * Extends the Stage-1 three-way classifier
 * (see micInputFailure.js) into the five observable pipeline stages so a
 * real recording can be triaged to the exact gate that stopped it:
 *
 *   1. no-input-signal     — nothing usable reached the detector
 *   2. signal-below-gate   — audible energy, but under the noise gate
 *   3. pitch-rejected      — over the gate, but no pitch extracted
 *   4. event-suppressed    — pitch exists, held by a downstream gate
 *                              (musical acceptance, latch, confirm)
 *   5. evaluator-rejected  — an input event was built, but the Practice
 *                              Engine did not accept it (wrong note, …)
 *   accepted               — flowing to the evaluator
 *
 * Also ships the calibrated-gate PROTOTYPE
 * (proposeCalibratedGate): a noise-floor-aware threshold derived from the
 * measured room floor with instrument-aware floors. Prototype values only —
 * the live gate is NOT touched by this module.
 *
 * Pure + testable: no audio APIs.
 */

import { classifyMicInputFailure, MIC_INPUT_FAILURE } from './micInputFailure.js'

export const MIC_SIGNAL_STAGE = {
  NO_INPUT_SIGNAL: 'no-input-signal',
  SIGNAL_BELOW_GATE: 'signal-below-gate',
  PITCH_REJECTED: 'pitch-rejected',
  EVENT_SUPPRESSED: 'event-suppressed',
  EVALUATOR_REJECTED: 'evaluator-rejected',
  ACCEPTED: 'accepted',
}

/** Reject reasons that mean "over the gate, but extraction found nothing". */
const DETECTION_FAILURE_REASONS = new Set([
  'no-midi-detected',
  'v2-below-threshold',
  'non-musical-no-v2',
  'no-pitch-extracted',
])

/** Reasons that mean "pitch evidence existed but a gate held it". */
const SUPPRESSION_REASONS = new Set([
  'soft-note-below-gate',
  'non-musical-formant-harmonics',
  'non-musical-speech-like',
  'non-musical-noise',
  'attack-latch-holding',
  'awaiting-confirm',
])

/**
 * @param {object} input
 * @param {object} [input.frame] analyzed mic frame
 * @param {string|null} [input.rejectReason]
 * @param {number|null} [input.gateThreshold] live gate actually applied
 * @param {boolean} [input.matchingEnabled]
 * @param {number[]} [input.expectedMidis]
 * @param {boolean} [input.attackLatched]
 * @param {boolean} [input.awaitingConfirm]
 * @param {string|null} [input.evaluatorOutcome] 'complete' | 'wrong' | 'progress' | null
 */
export function probeSignalStages({
  frame = null,
  rejectReason = null,
  gateThreshold = null,
  matchingEnabled = false,
  expectedMidis = [],
  attackLatched = false,
  awaitingConfirm = false,
  evaluatorOutcome = null,
} = {}) {
  const rms = frame?.filteredRms ?? frame?.rms ?? 0
  const failure = classifyMicInputFailure({
    frame,
    rejectReason,
    matchingEnabled,
    expectedMidis,
    attackLatched,
    awaitingConfirm,
  })
  const measurements = {
    rms,
    gateThreshold,
    gateMargin: gateThreshold != null ? rms - gateThreshold : null,
    gateOpen: Boolean(frame?.gateOpen),
    hasPitch: failure.pitchEvidence,
    v2Count: Array.isArray(frame?.v2DetectedMidis) ? frame.v2DetectedMidis.length : 0,
    rejectReason,
    failureCategory: failure.category,
  }

  // An event that reached the evaluator but was not accepted is a distinct,
  // later failure than any frame gate.
  if (evaluatorOutcome != null && evaluatorOutcome !== 'complete' && evaluatorOutcome !== 'progress') {
    return { stage: MIC_SIGNAL_STAGE.EVALUATOR_REJECTED, measurements }
  }

  if (failure.category === MIC_INPUT_FAILURE.NONE) {
    return { stage: MIC_SIGNAL_STAGE.ACCEPTED, measurements }
  }
  if (failure.category === MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL) {
    if (rejectReason === 'noise-gate-closed' && rms > 0.004) {
      return { stage: MIC_SIGNAL_STAGE.SIGNAL_BELOW_GATE, measurements }
    }
    return { stage: MIC_SIGNAL_STAGE.NO_INPUT_SIGNAL, measurements }
  }
  if (failure.category === MIC_INPUT_FAILURE.PITCH_DETECTION_FAILED) {
    return { stage: MIC_SIGNAL_STAGE.PITCH_REJECTED, measurements }
  }
  if (DETECTION_FAILURE_REASONS.has(rejectReason)) {
    return { stage: MIC_SIGNAL_STAGE.PITCH_REJECTED, measurements }
  }
  if (SUPPRESSION_REASONS.has(rejectReason) || SUPPRESSION_REASONS.has(failure.reason)) {
    return { stage: MIC_SIGNAL_STAGE.EVENT_SUPPRESSED, measurements }
  }
  return { stage: MIC_SIGNAL_STAGE.EVENT_SUPPRESSED, measurements }
}

export const CALIBRATED_GATE_PROTOTYPE = {
  version: 'calibrated-prototype-v1',
  absoluteMin: 0.009,
  absoluteMax: 0.09,
  floorMultiplier: 2.2,
  floorMargin: 0.0012,
  /** Plucky decay: open slightly sooner than sustained piano. */
  guitarFloorMultiplier: 2.0,
  guitarAbsoluteMin: 0.008,
}

/**
 * Prototype calibrated gate: threshold follows the MEASURED room floor
 * instead of a fixed constant, with an instrument-aware nudge.
 * Returns { threshold, basis } — inspectable, never applied live here.
 */
export function proposeCalibratedGate({ noiseFloor = null, instrumentId = null } = {}) {
  const floor = Number.isFinite(noiseFloor) && noiseFloor > 0 ? noiseFloor : 0.006
  const isGuitar = instrumentId === 'guitar'
  const multiplier = isGuitar
    ? CALIBRATED_GATE_PROTOTYPE.guitarFloorMultiplier
    : CALIBRATED_GATE_PROTOTYPE.floorMultiplier
  const absoluteMin = isGuitar
    ? CALIBRATED_GATE_PROTOTYPE.guitarAbsoluteMin
    : CALIBRATED_GATE_PROTOTYPE.absoluteMin
  const threshold = Math.min(
    CALIBRATED_GATE_PROTOTYPE.absoluteMax,
    Math.max(absoluteMin, floor * multiplier, floor + CALIBRATED_GATE_PROTOTYPE.floorMargin),
  )
  return {
    threshold,
    basis: {
      version: CALIBRATED_GATE_PROTOTYPE.version,
      noiseFloor: floor,
      multiplier,
      absoluteMin,
      instrumentId: instrumentId ?? 'piano',
    },
  }
}

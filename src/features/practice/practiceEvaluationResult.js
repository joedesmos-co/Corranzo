/**
 * CORRANZO V1 — Explicit evaluation result model (B09 foundation).
 *
 * Truthful foundation for future practice stats (clean runs, trouble
 * spots, timing accuracy, passage performance). This module does NOT
 * implement the metrics dashboard — it records the facts metrics need.
 *
 * Outcome taxonomy (mutually exclusive per evaluated attack):
 * - correct: pitch matched inside the accepted timing window.
 * - early: pitch matched but played before the early acceptance edge.
 * - late: pitch matched but played after the late acceptance edge.
 * - missed: playhead passed the late edge with no accepted attack.
 * - extra/wrong-note: attack matched no expected pitch of the active target.
 * - ignored: non-evaluable input (no target, no pitch, wrong attempt, release).
 *
 * Each result preserves: eventId, attemptId, iterationId, expected vs
 * observed pitches, score-time delta, wall time, mode, measure/tempo, and
 * skip/manual-continue flags — enough to later compute clean runs (an
 * attempt with zero missed/wrong), trouble spots (per-measure miss rates),
 * and timing accuracy (delta distributions) without re-grading.
 */
export const EVALUATION_OUTCOME = {
  CORRECT: 'correct',
  EARLY: 'early',
  LATE: 'late',
  MISSED: 'missed',
  EXTRA: 'extra',
  WRONG: 'wrong',
  IGNORED: 'ignored',
}

export function createEvaluationResult({
  outcome = EVALUATION_OUTCOME.IGNORED,
  eventId = null,
  attemptId = null,
  iterationId = null,
  expectedMidis = [],
  playedMidi = null,
  deltaMs = null,
  scoreTimeSeconds = null,
  wallTimestampMs = null,
  mode = null,
  measureNumber = null,
  tempoBpm = null,
  skipped = false,
  manualContinue = false,
} = {}) {
  return {
    outcome,
    eventId,
    attemptId,
    iterationId,
    expectedMidis: [...(expectedMidis ?? [])],
    playedMidi: playedMidi ?? null,
    deltaMs: deltaMs == null ? null : Number(deltaMs),
    scoreTimeSeconds: scoreTimeSeconds == null ? null : Number(scoreTimeSeconds),
    wallTimestampMs: wallTimestampMs ?? Date.now(),
    mode,
    measureNumber,
    tempoBpm,
    skipped: Boolean(skipped),
    manualContinue: Boolean(manualContinue),
  }
}

/** Whether an attempt qualifies as a clean run (no misses/wrongs/extras). */
export function isCleanRunAttempt(results) {
  if (!Array.isArray(results) || results.length === 0) return false
  return results.every((result) => result.outcome === EVALUATION_OUTCOME.CORRECT)
}

/** Aggregate per-measure miss/wrong counts for future trouble-spot views. */
export function aggregateTroubleSpots(results) {
  const byMeasure = new Map()
  for (const result of results ?? []) {
    if (result.measureNumber == null) continue
    let entry = byMeasure.get(result.measureNumber)
    if (!entry) {
      entry = { measureNumber: result.measureNumber, total: 0, missed: 0, wrong: 0, correct: 0 }
      byMeasure.set(result.measureNumber, entry)
    }
    entry.total += 1
    if (result.outcome === EVALUATION_OUTCOME.MISSED) entry.missed += 1
    else if (result.outcome === EVALUATION_OUTCOME.WRONG || result.outcome === EVALUATION_OUTCOME.EXTRA) entry.wrong += 1
    else if (result.outcome === EVALUATION_OUTCOME.CORRECT) entry.correct += 1
  }
  return [...byMeasure.values()].sort((a, b) => a.measureNumber - b.measureNumber)
}

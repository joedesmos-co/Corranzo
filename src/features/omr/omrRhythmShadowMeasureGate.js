/**
 * Phase 2C — per-measure truth gate for shadow rhythm solver acceptance.
 */

export const RHYTHM_SHADOW_MEASURE_REJECT = {
  CHORD_REGRESSION: 'chord-regression',
  PITCH_REGRESSION: 'pitch-regression',
  DURATION_REGRESSION: 'duration-regression',
  NOTE_COUNT_CHANGED: 'note-count-changed',
  NO_ONSET_OR_DURATION_GAIN: 'no-onset-or-duration-gain',
}

export function compareMeasureMetrics(runtimeMeasure = {}, shadowMeasure = {}) {
  return {
    wrongOnsetDelta: (shadowMeasure.wrongOnsetCount ?? 0) - (runtimeMeasure.wrongOnsetCount ?? 0),
    wrongDurationDelta:
      (shadowMeasure.wrongDurationCount ?? 0) - (runtimeMeasure.wrongDurationCount ?? 0),
    chordMismatchDelta:
      (shadowMeasure.chordMismatchCount ?? 0) - (runtimeMeasure.chordMismatchCount ?? 0),
    wrongPitchDelta: (shadowMeasure.wrongPitchCount ?? 0) - (runtimeMeasure.wrongPitchCount ?? 0),
    generatedNoteCountDelta:
      (shadowMeasure.generatedNoteCount ?? 0) - (runtimeMeasure.generatedNoteCount ?? 0),
  }
}

/**
 * Accept a shadow measure only when onset or duration improves without chord/pitch/note regressions.
 */
export function measurePassesRhythmShadowTruthGate(runtimeMeasure = {}, shadowMeasure = {}) {
  const rejections = []

  if ((shadowMeasure.chordMismatchCount ?? 0) > (runtimeMeasure.chordMismatchCount ?? 0)) {
    rejections.push(RHYTHM_SHADOW_MEASURE_REJECT.CHORD_REGRESSION)
  }
  if ((shadowMeasure.wrongPitchCount ?? 0) > (runtimeMeasure.wrongPitchCount ?? 0)) {
    rejections.push(RHYTHM_SHADOW_MEASURE_REJECT.PITCH_REGRESSION)
  }
  if ((shadowMeasure.wrongDurationCount ?? 0) > (runtimeMeasure.wrongDurationCount ?? 0)) {
    rejections.push(RHYTHM_SHADOW_MEASURE_REJECT.DURATION_REGRESSION)
  }
  if ((shadowMeasure.generatedNoteCount ?? 0) !== (runtimeMeasure.generatedNoteCount ?? 0)) {
    rejections.push(RHYTHM_SHADOW_MEASURE_REJECT.NOTE_COUNT_CHANGED)
  }

  const onsetImproved =
    (shadowMeasure.wrongOnsetCount ?? 0) < (runtimeMeasure.wrongOnsetCount ?? 0)
  const durationImproved =
    (shadowMeasure.wrongDurationCount ?? 0) < (runtimeMeasure.wrongDurationCount ?? 0)
  if (!onsetImproved && !durationImproved) {
    rejections.push(RHYTHM_SHADOW_MEASURE_REJECT.NO_ONSET_OR_DURATION_GAIN)
  }

  return {
    pass: rejections.length === 0,
    rejections,
    delta: compareMeasureMetrics(runtimeMeasure, shadowMeasure),
  }
}

export function findMeasureEntry(report, measureNumber) {
  return (report.perMeasure ?? []).find((entry) => entry.measureNumber === measureNumber) ?? null
}

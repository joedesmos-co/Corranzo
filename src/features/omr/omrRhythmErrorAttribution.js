/**
 * Dense rhythm/voice error attribution for the OMR benchmark dashboard.
 * Diagnostic only — composes existing analyzers; does not change OMR runtime.
 *
 * @see docs/OMR_ENGINE_V2_PLAN.md Phase 1
 */

import { analyzeChordMismatchCoupling, analyzeOnsetErrorCoupling } from './omrDiagnosticGrouping.js'
import { summarizeDurationErrors } from './omrDurationErrorAnalysis.js'
import {
  NOTE_COUNT_ROOT_CAUSE,
  summarizeMissingExtraRootCauses,
} from './omrMissingExtraAnalysis.js'
import {
  ONSET_VOICE_ERROR_CLASS,
  summarizeOnsetVoicePhaseDiagnosis,
} from './omrOnsetVoiceTrace.js'
import {
  PITCH_ROOT_CAUSE,
  summarizePitchErrorRootCauses,
} from './omrPitchErrorAnalysis.js'

export const RHYTHM_ERROR_ATTRIBUTION = {
  ONSET_PHASE_SHIFT: 'onset-phase-shift',
  VOICE_SERIALIZATION_SHIFT: 'voice-serialization-shift',
  ONSET_COUPLED_DURATION: 'onset-coupled-duration',
  CHORD_GROUPING_SYMPTOM: 'chord-grouping-symptom',
  PITCH_GROUPING_SYMPTOM: 'pitch-grouping-symptom',
  BALANCED_MISSING_EXTRA_SERIALIZATION: 'balanced-missing-extra-serialization',
}

function countOnsetPhaseShifts(report = {}) {
  const coupling = analyzeOnsetErrorCoupling(report)
  const abs = coupling.absDeltaHistogram ?? {}
  return (abs['0.50'] ?? 0) + (abs['0.75'] ?? 0)
}

/**
 * Attribute dense rhythm/voice errors into V2 planning buckets.
 */
export function buildRhythmErrorAttribution(report = {}) {
  const onsetCoupling = analyzeOnsetErrorCoupling(report)
  const chordCoupling = analyzeChordMismatchCoupling(report)
  const durationHist = summarizeDurationErrors(report.debug?.wrongDurations ?? [])
  const pitchRootCauses = summarizePitchErrorRootCauses(report.debug?.wrongPitches ?? [])
  const missingExtra = summarizeMissingExtraRootCauses(report)
  const voicePhase = summarizeOnsetVoicePhaseDiagnosis(report)

  const voiceSerializationShift =
    voicePhase.errorClassHistogram?.[ONSET_VOICE_ERROR_CLASS.SERIALIZATION_VOICE_SHIFT] ?? 0
  const onsetPhaseShift = countOnsetPhaseShifts(report)
  const onsetCoupledDuration = durationHist['onset-coupled'] ?? 0
  const chordGroupingSymptom = chordCoupling.coupledExamples ?? 0
  const pitchGroupingSymptom =
    pitchRootCauses.histogram?.[PITCH_ROOT_CAUSE.GROUPING_ARTIFACT] ?? 0

  const balancedSerialization =
    missingExtra.balancedMismatch &&
    (missingExtra.histogram?.[NOTE_COUNT_ROOT_CAUSE.SERIALIZATION_MISTAKE] ?? 0) > 0
      ? missingExtra.histogram[NOTE_COUNT_ROOT_CAUSE.SERIALIZATION_MISTAKE]
      : 0

  const buckets = {
    [RHYTHM_ERROR_ATTRIBUTION.ONSET_PHASE_SHIFT]: onsetPhaseShift,
    [RHYTHM_ERROR_ATTRIBUTION.VOICE_SERIALIZATION_SHIFT]: voiceSerializationShift,
    [RHYTHM_ERROR_ATTRIBUTION.ONSET_COUPLED_DURATION]: onsetCoupledDuration,
    [RHYTHM_ERROR_ATTRIBUTION.CHORD_GROUPING_SYMPTOM]: chordGroupingSymptom,
    [RHYTHM_ERROR_ATTRIBUTION.PITCH_GROUPING_SYMPTOM]: pitchGroupingSymptom,
    [RHYTHM_ERROR_ATTRIBUTION.BALANCED_MISSING_EXTRA_SERIALIZATION]: balancedSerialization,
  }

  const ranked = Object.entries(buckets)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((left, right) => right.count - left.count)

  return {
    buckets,
    ranked,
    primaryBucket: ranked[0] ?? null,
    supporting: {
      totalWrongOnsets: report.totals?.wrongOnsetCount ?? 0,
      chordMismatchTotal: report.totals?.chordMismatchCount ?? 0,
      chordCoupledShare: chordCoupling.coupledShare,
      missingCount: missingExtra.missingCount ?? 0,
      extraCount: missingExtra.extraCount ?? 0,
      balancedMismatch: missingExtra.balancedMismatch ?? false,
      onsetStrictIndependent: onsetCoupling.strictIndependent,
      voicePhasePrimaryClass: voicePhase.primaryErrorClass,
    },
  }
}

export function formatRhythmErrorAttributionMarkdown(attribution, { indent = '' } = {}) {
  if (!attribution?.ranked?.length) {
    return `${indent}Rhythm/voice attribution: (no dense rhythm errors)\n`
  }
  const lines = [`${indent}Rhythm/voice attribution (V2 Phase 1):`]
  for (const entry of attribution.ranked) {
    lines.push(`${indent}- ${entry.bucket}: ${entry.count}`)
  }
  const support = attribution.supporting
  if (support?.chordCoupledShare != null) {
    lines.push(
      `${indent}- chord symptom coupled share: ${Math.round(support.chordCoupledShare * 100)}%`,
    )
  }
  if (support?.balancedMismatch) {
    lines.push(
      `${indent}- missing/extra balanced: ${support.missingCount}/${support.extraCount}`,
    )
  }
  return `${lines.join('\n')}\n`
}

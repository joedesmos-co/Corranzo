/**
 * Structured V2 ↔ V3 MusicXML comparison for shadow / validation mode.
 *
 * Treats production (V2) MusicXML as the user-visible reference and independent
 * V3 MusicXML as the candidate. Does not modify recognition or runtime output.
 * Never retains PDF bytes — only compact metric/example payloads.
 */

import { evaluateOmrAccuracy } from '../omrAccuracyEvaluator.js'

export const OMR_V3_COMPARISON_VERSION = 1

function round(value, places = 4) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function compactMismatch(entry) {
  if (!entry) return null
  return {
    measureNumber: entry.measureNumber ?? null,
    pitchDeltaSemitones: entry.pitchDeltaSemitones ?? null,
    onsetDiffQuarters: entry.onsetDiffQuarters ?? null,
    durationDiffQuarters: entry.durationDiffQuarters ?? null,
    v2: entry.truth
      ? {
          label: entry.truth.label ?? null,
          voice: entry.truth.voice ?? null,
          onset: entry.truth.onsetQuarters ?? null,
          duration: entry.truth.durationQuarters ?? null,
        }
      : null,
    v3: entry.generated
      ? {
          label: entry.generated.label ?? null,
          voice: entry.generated.voice ?? null,
          onset: entry.generated.onsetQuarters ?? null,
          duration: entry.generated.durationQuarters ?? null,
        }
      : null,
  }
}

function compactNote(note) {
  if (!note) return null
  return {
    measureNumber: note.measureNumber ?? null,
    label: note.label ?? null,
    voice: note.voice ?? null,
    onset: note.onsetQuarters ?? null,
    duration: note.durationQuarters ?? null,
  }
}

/**
 * Compare V2 (reference) and V3 (candidate) MusicXML documents.
 *
 * @param {object} options
 * @param {string} options.v2MusicXml
 * @param {string} options.v3MusicXml
 * @param {object} [options.v2Confidence]
 * @param {object} [options.v3Confidence]
 * @param {object} [options.v3Serializer]
 * @param {number} [options.exampleLimit]
 */
export function compareOmrV2V3MusicXml({
  v2MusicXml = '',
  v3MusicXml = '',
  v2Confidence = null,
  v3Confidence = null,
  v3Serializer = null,
  exampleLimit = 40,
} = {}) {
  const v2 = String(v2MusicXml ?? '')
  const v3 = String(v3MusicXml ?? '')
  const byteIdentical = v2 === v3

  if (!v2 || !v3) {
    return {
      version: OMR_V3_COMPARISON_VERSION,
      status: !v2 && !v3 ? 'unavailable' : 'partial',
      byteIdentical,
      musicXmlByteLengthDelta: v3.length - v2.length,
      measures: null,
      notes: null,
      rhythm: null,
      chords: null,
      pitch: null,
      confidence: summarizeConfidenceDelta(v2Confidence, v3Confidence),
      serializer: summarizeSerializer(v3Serializer),
      samples: null,
      disagreement: {
        any: !byteIdentical,
        categories: [],
      },
      reason: !v2 ? 'missing-v2-musicxml' : 'missing-v3-musicxml',
    }
  }

  if (byteIdentical) {
    return {
      version: OMR_V3_COMPARISON_VERSION,
      status: 'identical',
      byteIdentical: true,
      musicXmlByteLengthDelta: 0,
      measures: { absoluteCountDiff: 0, agreement: 1 },
      notes: {
        v2Count: null,
        v3Count: null,
        missingInV3: 0,
        extraInV3: 0,
        f1: 1,
      },
      rhythm: {
        durationAgreement: 1,
        onsetAgreement: 1,
        wrongDurationCount: 0,
        wrongOnsetCount: 0,
      },
      chords: { agreement: 1, mismatchCount: 0 },
      pitch: { agreement: 1, wrongPitchCount: 0 },
      confidence: summarizeConfidenceDelta(v2Confidence, v3Confidence),
      serializer: summarizeSerializer(v3Serializer),
      samples: {
        missingInV3: [],
        extraInV3: [],
        wrongPitches: [],
        wrongDurations: [],
        wrongOnsets: [],
        chordMismatches: [],
      },
      disagreement: { any: false, categories: [] },
      reason: null,
    }
  }

  const accuracy = evaluateOmrAccuracy({
    generatedMusicXml: v3,
    groundTruthMusicXml: v2,
    generatedFileName: 'omr-v3-candidate.musicxml',
    groundTruthFileName: 'omr-v2-reference.musicxml',
    options: { exampleLimit },
  })

  const totals = accuracy.totals ?? {}
  const metrics = accuracy.metrics ?? {}
  const debug = accuracy.debug ?? {}

  const measures = {
    absoluteCountDiff: Math.abs(Number(totals.measureCountDifference ?? 0)),
    agreement: round(metrics.measureCountAccuracy),
    v2MeasureCount: totals.truthMeasureCount ?? null,
    v3MeasureCount: totals.generatedMeasureCount ?? null,
  }

  const notes = {
    v2Count: totals.truthNoteCount ?? null,
    v3Count: totals.generatedNoteCount ?? null,
    missingInV3: totals.missingNoteCount ?? 0,
    extraInV3: totals.extraNoteCount ?? 0,
    f1: round(metrics.noteDetectionF1),
    precision: round(metrics.noteDetectionPrecision),
    recall: round(metrics.noteDetectionRecall),
  }

  const rhythm = {
    durationAgreement: round(metrics.durationAccuracy),
    onsetAgreement: round(metrics.onsetAccuracy),
    wrongDurationCount: totals.wrongDurationCount ?? 0,
    wrongOnsetCount: totals.wrongOnsetCount ?? 0,
  }

  const chords = {
    agreement: round(metrics.chordGroupingAccuracy),
    mismatchCount: totals.chordMismatchCount ?? 0,
  }

  const pitch = {
    agreement: round(metrics.pitchAccuracy),
    agreementAtCorrectOnset: round(metrics.pitchAccuracyAtCorrectOnset),
    wrongPitchCount: totals.wrongPitchCount ?? 0,
  }

  const categories = []
  if (measures.absoluteCountDiff > 0) categories.push('measures')
  if ((notes.missingInV3 ?? 0) > 0 || (notes.extraInV3 ?? 0) > 0) categories.push('notes')
  if ((rhythm.wrongDurationCount ?? 0) > 0 || (rhythm.wrongOnsetCount ?? 0) > 0) {
    categories.push('rhythm')
  }
  if ((chords.mismatchCount ?? 0) > 0) categories.push('chords')
  if ((pitch.wrongPitchCount ?? 0) > 0) categories.push('pitch')
  const confidenceDelta = summarizeConfidenceDelta(v2Confidence, v3Confidence)
  if (confidenceDelta?.disagrees) categories.push('confidence')

  return {
    version: OMR_V3_COMPARISON_VERSION,
    status: 'divergent',
    byteIdentical: false,
    musicXmlByteLengthDelta: v3.length - v2.length,
    measures,
    notes,
    rhythm,
    chords,
    pitch,
    confidence: confidenceDelta,
    serializer: summarizeSerializer(v3Serializer),
    samples: {
      missingInV3: (debug.missingNotes ?? []).map(compactNote),
      extraInV3: (debug.extraNotes ?? []).map(compactNote),
      wrongPitches: (debug.wrongPitches ?? []).map(compactMismatch),
      wrongDurations: (debug.wrongDurations ?? []).map(compactMismatch),
      wrongOnsets: (debug.wrongOnsets ?? []).map(compactMismatch),
      chordMismatches: (debug.chordGroupMismatches ?? []).slice(0, exampleLimit).map((entry) => ({
        measureNumber: entry.measureNumber ?? null,
        detail: entry.detail ?? entry.reason ?? null,
      })),
    },
    disagreement: {
      any: categories.length > 0,
      categories,
      primaryErrorSource: accuracy.summary?.primaryErrorSource ?? null,
    },
    reason: null,
  }
}

function summarizeConfidenceDelta(v2Confidence, v3Confidence) {
  const v2 =
    typeof v2Confidence === 'number'
      ? v2Confidence
      : Number(v2Confidence?.overall ?? v2Confidence?.overallConfidence)
  const v3 =
    typeof v3Confidence === 'number'
      ? v3Confidence
      : Number(v3Confidence?.overall ?? v3Confidence?.overallConfidence)
  if (!Number.isFinite(v2) && !Number.isFinite(v3)) {
    return null
  }
  const delta =
    Number.isFinite(v2) && Number.isFinite(v3) ? round(v3 - v2) : null
  return {
    v2: Number.isFinite(v2) ? round(v2) : null,
    v3: Number.isFinite(v3) ? round(v3) : null,
    delta,
    disagrees: delta != null && Math.abs(delta) >= 0.05,
  }
}

function summarizeSerializer(serializer) {
  if (!serializer || typeof serializer !== 'object') return null
  return {
    measureCount: serializer.measureCount ?? null,
    primaryEventCount: serializer.primaryEventCount ?? null,
    invalidEventCount: serializer.invalidEventCount ?? null,
    duplicateEventCount: serializer.duplicateEventCount ?? null,
    voiceOverlapViolations: serializer.voiceOverlapViolations ?? null,
    approximateQuantizationCount: serializer.approximateQuantizationCount ?? null,
  }
}

/**
 * Compact disagreement payload safe for telemetry logs (no MusicXML, no PDF).
 */
export function buildOmrV3DisagreementTelemetry(comparison) {
  if (!comparison) {
    return {
      disagreed: false,
      categories: [],
      musicXmlByteLengthDelta: 0,
    }
  }
  return {
    disagreed: Boolean(comparison.disagreement?.any || !comparison.byteIdentical),
    categories: [...(comparison.disagreement?.categories ?? [])],
    status: comparison.status ?? null,
    musicXmlByteLengthDelta: comparison.musicXmlByteLengthDelta ?? 0,
    measureDiff: comparison.measures?.absoluteCountDiff ?? null,
    missingInV3: comparison.notes?.missingInV3 ?? null,
    extraInV3: comparison.notes?.extraInV3 ?? null,
    wrongPitchCount: comparison.pitch?.wrongPitchCount ?? null,
    wrongDurationCount: comparison.rhythm?.wrongDurationCount ?? null,
    wrongOnsetCount: comparison.rhythm?.wrongOnsetCount ?? null,
    chordMismatchCount: comparison.chords?.mismatchCount ?? null,
    noteF1: comparison.notes?.f1 ?? null,
    durationAgreement: comparison.rhythm?.durationAgreement ?? null,
    onsetAgreement: comparison.rhythm?.onsetAgreement ?? null,
    pitchAgreement: comparison.pitch?.agreement ?? null,
    chordAgreement: comparison.chords?.agreement ?? null,
  }
}

export function formatOmrV3ComparisonReport(comparison) {
  if (!comparison) return 'No OMR V2↔V3 comparison.'
  const lines = ['OMR V2 ↔ V3 comparison', `Status: ${comparison.status}`]
  if (comparison.byteIdentical) {
    lines.push('MusicXML: byte-identical')
    return lines.join('\n')
  }
  lines.push(`Byte length Δ: ${comparison.musicXmlByteLengthDelta ?? 0}`)
  if (comparison.measures) {
    lines.push(
      `Measures: v2=${comparison.measures.v2MeasureCount} v3=${comparison.measures.v3MeasureCount} |Δ|=${comparison.measures.absoluteCountDiff}`,
    )
  }
  if (comparison.notes) {
    lines.push(
      `Notes: F1=${comparison.notes.f1} missing=${comparison.notes.missingInV3} extra=${comparison.notes.extraInV3}`,
    )
  }
  if (comparison.rhythm) {
    lines.push(
      `Rhythm: duration=${comparison.rhythm.durationAgreement} onset=${comparison.rhythm.onsetAgreement} wrongDur=${comparison.rhythm.wrongDurationCount} wrongOnset=${comparison.rhythm.wrongOnsetCount}`,
    )
  }
  if (comparison.chords) {
    lines.push(
      `Chords: agreement=${comparison.chords.agreement} mismatches=${comparison.chords.mismatchCount}`,
    )
  }
  if (comparison.pitch) {
    lines.push(
      `Pitch: agreement=${comparison.pitch.agreement} wrong=${comparison.pitch.wrongPitchCount}`,
    )
  }
  if (comparison.confidence) {
    lines.push(
      `Confidence: v2=${comparison.confidence.v2} v3=${comparison.confidence.v3} Δ=${comparison.confidence.delta}`,
    )
  }
  if (comparison.disagreement?.categories?.length) {
    lines.push(`Disagreement categories: ${comparison.disagreement.categories.join(', ')}`)
  }
  return lines.join('\n')
}

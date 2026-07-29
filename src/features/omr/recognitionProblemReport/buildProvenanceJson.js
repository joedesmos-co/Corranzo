/**
 * provenance.json for recognition problem exports.
 * Never re-runs OMR — only packages already-available diagnostics.
 */

export const RECOGNITION_PROVENANCE_SAMPLE_LIMIT = 120

function boundArray(value, limit = RECOGNITION_PROVENANCE_SAMPLE_LIMIT) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, limit)
}

function compactRhythmProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') {
    return null
  }
  return {
    version: provenance.version ?? 1,
    noteDurationCount: provenance.noteDurationCount ?? provenance.noteDurations?.length ?? 0,
    dotCandidateCount: provenance.dotCandidateCount ?? provenance.dotCandidates?.length ?? 0,
    beamCandidateCount: provenance.beamCandidateCount ?? provenance.beamCandidates?.length ?? 0,
    beamDurationOverwrittenLater: provenance.beamDurationOverwrittenLater ?? 0,
    chordCoalesceOverrides: provenance.chordCoalesceOverrides ?? 0,
    unassignedDots: provenance.unassignedDots ?? 0,
    rejectedBeams: provenance.rejectedBeams ?? 0,
    noteDurations: boundArray(provenance.noteDurations),
    dotCandidates: boundArray(provenance.dotCandidates),
    beamCandidates: boundArray(provenance.beamCandidates),
  }
}

export function buildRecognitionProvenanceJson({
  diagnostics = null,
  quality = null,
  activeScoreId = null,
  omrRunMeta = null,
  exportedAt = null,
} = {}) {
  const rhythm = diagnostics?.rhythmProvenance ?? null
  const hasRhythm =
    rhythm &&
    typeof rhythm === 'object' &&
    (Array.isArray(rhythm.noteDurations) ||
      Array.isArray(rhythm.dotCandidates) ||
      Array.isArray(rhythm.beamCandidates) ||
      Number(rhythm.noteDurationCount) > 0)

  if (!hasRhythm) {
    return {
      schema: 'corranzo-recognition-provenance',
      schemaVersion: 1,
      exportedAt: exportedAt ?? new Date().toISOString(),
      provenanceAvailable: false,
      reason:
        'Provenance was not collected during score generation. Enable DEV Provenance before OMR only when intentionally diagnosing rhythm decisions; this export does not re-run recognition.',
      ownerScoreId: activeScoreId ?? quality?.ownerScoreId ?? null,
      run: omrRunMeta
        ? {
            runId: omrRunMeta.runId ?? null,
            stage: omrRunMeta.stage ?? null,
          }
        : null,
      acceptance: quality
        ? {
            acceptance: quality.acceptance ?? null,
            confidenceBand: quality.confidenceBand ?? null,
            warningReasons: Array.isArray(quality.warningReasons)
              ? quality.warningReasons.slice(0, 24)
              : [],
            safetyChecks: quality.safetyChecks ?? null,
            extractionSummary: quality.extractionSummary ?? null,
          }
        : null,
      rhythmProvenance: null,
    }
  }

  return {
    schema: 'corranzo-recognition-provenance',
    schemaVersion: 1,
    exportedAt: exportedAt ?? new Date().toISOString(),
    provenanceAvailable: true,
    reason: null,
    ownerScoreId: activeScoreId ?? quality?.ownerScoreId ?? null,
    run: omrRunMeta
      ? {
          runId: omrRunMeta.runId ?? null,
          stage: omrRunMeta.stage ?? null,
        }
      : null,
    acceptance: quality
      ? {
          acceptance: quality.acceptance ?? null,
          confidenceBand: quality.confidenceBand ?? null,
          warningReasons: Array.isArray(quality.warningReasons)
            ? quality.warningReasons.slice(0, 24)
            : [],
          safetyChecks: quality.safetyChecks ?? null,
          extractionSummary: quality.extractionSummary ?? null,
        }
      : null,
    rhythmProvenance: compactRhythmProvenance(rhythm),
    sampleLimit: RECOGNITION_PROVENANCE_SAMPLE_LIMIT,
  }
}

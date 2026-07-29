/**
 * Active-score ownership gate for recognition problem exports.
 *
 * All non-null owner ids must equal activeScoreId. Missing optional owners are
 * allowed (e.g. failed OMR with no quality metadata yet).
 */

export function assertRecognitionReportOwnership({
  activeScoreId = null,
  omrOwnerScoreId = null,
  qualityOwnerScoreId = null,
  provenanceOwnerScoreId = null,
  mode = 'score', // 'score' | 'omr-failure'
} = {}) {
  if (mode === 'omr-failure') {
    // Failure reports may predate a stamped MusicXML owner. Require a score id
    // when one exists on the gate; otherwise allow run-scoped export.
    if (activeScoreId == null) {
      return { ok: true, mode, reason: null }
    }
    for (const [label, value] of [
      ['omrOwnerScoreId', omrOwnerScoreId],
      ['qualityOwnerScoreId', qualityOwnerScoreId],
      ['provenanceOwnerScoreId', provenanceOwnerScoreId],
    ]) {
      if (value != null && value !== activeScoreId) {
        return {
          ok: false,
          mode,
          reason: 'ownership-mismatch',
          field: label,
          expected: activeScoreId,
          actual: value,
          message:
            'This report no longer matches the active score. Close the dialog and try again after the score finishes loading.',
        }
      }
    }
    return { ok: true, mode, reason: null }
  }

  if (activeScoreId == null || activeScoreId === '') {
    return {
      ok: false,
      mode,
      reason: 'missing-active-score',
      message: 'No active score is available to report. Open a score and try again.',
    }
  }

  for (const [label, value] of [
    ['omrOwnerScoreId', omrOwnerScoreId],
    ['qualityOwnerScoreId', qualityOwnerScoreId],
    ['provenanceOwnerScoreId', provenanceOwnerScoreId],
  ]) {
    if (value != null && value !== activeScoreId) {
      return {
        ok: false,
        mode,
        reason: 'ownership-mismatch',
        field: label,
        expected: activeScoreId,
        actual: value,
        message:
          'Score ownership changed while preparing this report. Close the dialog and try again on the current score.',
      }
    }
  }

  return { ok: true, mode, reason: null, activeScoreId }
}

export function logRecognitionReportOwnershipMismatch(result) {
  if (result?.ok !== false) {
    return
  }
  if (typeof console === 'undefined') {
    return
  }
  try {
    console.warn('[recognition-report] ownership check failed', result)
  } catch {
    // ignore
  }
}

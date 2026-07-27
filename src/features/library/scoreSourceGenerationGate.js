/**
 * Score-source generation ownership gate.
 *
 * Hard rule: an async callback may mutate active score sources only when
 *   callbackPdfIdentity === activePdfIdentity
 *   AND callbackEpoch === activeEpoch
 *   AND callbackRunId === activeOmrRunId
 * Otherwise discard with zero side effects.
 */

import { pushScoreSourceContentTrace } from './scoreSourceContentIdentity.js'

const gate = {
  activePdfIdentity: null,
  activeEpoch: 0,
  activeOmrRunId: null,
  activeScoreId: null,
}

function publishGateSnapshot() {
  if (typeof window === 'undefined') {
    return
  }
  window.__SCOREFLOW_GENERATION_GATE__ = {
    activePdfIdentity: gate.activePdfIdentity,
    activeEpoch: gate.activeEpoch,
    activeOmrRunId: gate.activeOmrRunId,
    activeScoreId: gate.activeScoreId,
  }
}

export function getActiveScoreSourceGeneration() {
  return {
    activePdfIdentity: gate.activePdfIdentity,
    activeEpoch: gate.activeEpoch,
    activeOmrRunId: gate.activeOmrRunId,
    activeScoreId: gate.activeScoreId,
  }
}

/** Keep the gate's scoreId aligned with ActiveScore (published from App sync). */
export function setActiveScoreIdOnGate(scoreId = null) {
  gate.activeScoreId = scoreId ?? null
  publishGateSnapshot()
}

/**
 * Lifecycle + identity trace for browser regression (and DEV consoles).
 * Phases map to the required A→B race checkpoints.
 */
export function logScoreSourceLifecycle(phase, payload = {}) {
  const entry = {
    phase,
    activePdfIdentity: gate.activePdfIdentity,
    activeEpoch: gate.activeEpoch,
    activeOmrRunId: gate.activeOmrRunId,
    ...payload,
  }
  pushScoreSourceContentTrace(phase, entry)
  publishGateSnapshot()
  try {
    console.info(`[score-source-lifecycle] ${phase}`, entry)
  } catch {
    // ignore
  }
  return entry
}

/** Activate a PDF as the sole mutable score source (invalidates any OMR run). */
export function activatePdfScoreSource({
  pdfIdentity = null,
  epoch = 0,
  previousPdfIdentity = null,
  reason = 'pdf-selected',
  scoreId = null,
} = {}) {
  const cancelledOmrRunId = gate.activeOmrRunId
  gate.activePdfIdentity = pdfIdentity ?? null
  gate.activeEpoch = Number.isFinite(epoch) ? epoch : 0
  gate.activeOmrRunId = null
  if (scoreId !== undefined && scoreId !== null) {
    gate.activeScoreId = scoreId
  } else if (pdfIdentity == null) {
    gate.activeScoreId = null
  }
  return logScoreSourceLifecycle('pdf-selected', {
    reason,
    previousPdfIdentity,
    selectedPdfIdentity: gate.activePdfIdentity,
    cancelledOmrRunId,
    practiceSessionEpoch: gate.activeEpoch,
    activeScoreId: gate.activeScoreId,
  })
}

/** Request cancellation of the prior PDF's in-flight OMR (before / with activate). */
export function requestOmrCancellation({
  previousPdfIdentity = null,
  reason = 'pdf-replacement',
} = {}) {
  const cancelledOmrRunId = gate.activeOmrRunId
  gate.activeOmrRunId = null
  return logScoreSourceLifecycle('omr-cancellation-requested', {
    reason,
    previousPdfIdentity,
    cancelledOmrRunId,
    practiceSessionEpoch: gate.activeEpoch,
  })
}

/**
 * Register an OMR run that may later apply results. Rejects if the PDF/epoch
 * is already stale at register time.
 */
export function registerOmrRunStart({
  runId = null,
  pdfIdentity = null,
  epoch = null,
  scoreId = null,
} = {}) {
  if (
    pdfIdentity == null ||
    pdfIdentity !== gate.activePdfIdentity ||
    epoch == null ||
    epoch !== gate.activeEpoch
  ) {
    return {
      ok: false,
      reason: 'stale-register',
      ...logScoreSourceLifecycle('omr-run-register-rejected', {
        callbackPdfIdentity: pdfIdentity,
        callbackEpoch: epoch,
        callbackRunId: runId,
        callbackScoreId: scoreId,
        practiceSessionEpoch: gate.activeEpoch,
      }),
    }
  }
  if (scoreId != null && gate.activeScoreId != null && scoreId !== gate.activeScoreId) {
    return {
      ok: false,
      reason: 'score-id-mismatch',
      ...logScoreSourceLifecycle('omr-run-register-rejected', {
        callbackPdfIdentity: pdfIdentity,
        callbackEpoch: epoch,
        callbackRunId: runId,
        callbackScoreId: scoreId,
        practiceSessionEpoch: gate.activeEpoch,
      }),
    }
  }
  gate.activeOmrRunId = runId
  logScoreSourceLifecycle('omr-run-start', {
    callbackPdfIdentity: pdfIdentity,
    callbackEpoch: epoch,
    callbackRunId: runId,
    callbackScoreId: scoreId ?? gate.activeScoreId,
    practiceSessionEpoch: gate.activeEpoch,
  })
  return { ok: true, scoreId: scoreId ?? gate.activeScoreId }
}

export function noteOmrWorkerSettled({
  runId = null,
  pdfIdentity = null,
  epoch = null,
  outcome = 'resolved',
  errorName = null,
} = {}) {
  return logScoreSourceLifecycle('omr-worker-settled', {
    callbackPdfIdentity: pdfIdentity,
    callbackEpoch: epoch,
    callbackRunId: runId,
    outcome,
    errorName,
    practiceSessionEpoch: gate.activeEpoch,
  })
}

/**
 * Hard ownership check. Returns { ok:true } only when the callback still owns
 * the active PDF + epoch + OMR run.
 */
export function assertScoreSourceMutationAllowed({
  callbackPdfIdentity = null,
  callbackEpoch = null,
  callbackRunId = null,
  callbackScoreId = null,
  phase = 'omr-result-apply-attempt',
} = {}) {
  const active = getActiveScoreSourceGeneration()
  let reason = null
  if (callbackPdfIdentity == null || callbackPdfIdentity !== active.activePdfIdentity) {
    reason = 'pdf-identity-mismatch'
  } else if (callbackEpoch == null || callbackEpoch !== active.activeEpoch) {
    reason = 'session-epoch-mismatch'
  } else if (callbackRunId == null || callbackRunId !== active.activeOmrRunId) {
    reason = 'omr-run-mismatch'
  } else if (
    callbackScoreId != null &&
    active.activeScoreId != null &&
    callbackScoreId !== active.activeScoreId
  ) {
    reason = 'score-id-mismatch'
  }

  logScoreSourceLifecycle(phase, {
    callbackPdfIdentity,
    callbackEpoch,
    callbackRunId,
    callbackScoreId,
    practiceSessionEpoch: active.activeEpoch,
    activeScoreId: active.activeScoreId,
    allowed: !reason,
    discardReason: reason,
  })

  if (reason) {
    return {
      ok: false,
      reason,
      message: 'That PDF changed before timing finished. Upload it again or retry.',
      discarded: true,
    }
  }
  return { ok: true, discarded: false }
}

/** Test helper — reset singleton between unit tests. */
export function resetScoreSourceGenerationGateForTests() {
  gate.activePdfIdentity = null
  gate.activeEpoch = 0
  gate.activeOmrRunId = null
  gate.activeScoreId = null
  publishGateSnapshot()
}

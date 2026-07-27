/**
 * Auto score-preparation (OMR) orchestration helpers.
 *
 * Source precedence (roles are not interchangeable):
 * 1. User-provided MusicXML/MXL → authoritative **notation + timing**
 * 2. User-provided MIDI → authoritative **playback audio** only (never timing)
 * 3. OMR-generated MusicXML → notation/timing when no uploaded MusicXML exists
 * 4. PDF alone → display only; queues automatic preparation
 *
 * PDF + MIDI without MusicXML still runs OMR because MIDI cannot supply
 * measure timing, Wait For You checkpoints, or the score cursor.
 */

import { cancelActiveOmrWorker } from '../omr/runPdfOmrClient.js'
import {
  hasUploadedScoreTiming,
  isLibraryScoreTimingReady,
  isOmrGeneratedPlayback,
} from '../import/musicXmlSource.js'
import { normalizeInstrumentId } from '../instruments/instruments.js'
import {
  assertScoreSourceMutationAllowed,
  getActiveScoreSourceGeneration,
  requestOmrCancellation,
} from './scoreSourceGenerationGate.js'

export const AUTO_OMR_PRECEDENCE = Object.freeze({
  uploadedMusicXml: 1,
  uploadedMidiPlayback: 2,
  omrGeneratedTiming: 3,
  pdfAlone: 4,
})

export function buildAutoOmrRequestKey(file, instrumentId) {
  if (!file) return null
  const normalizedInstrument = normalizeInstrumentId(instrumentId)
  const fileName = file.name ?? 'score.pdf'
  const size = Number.isFinite(file.size) ? file.size : 0
  const lastModified = Number.isFinite(file.lastModified) ? file.lastModified : 0
  return {
    key: `${normalizedInstrument}:${fileName}:${size}:${lastModified}`,
    instrumentId: normalizedInstrument,
    pdfFileName: fileName,
  }
}

export function buildAutoOmrRequestFromPdfMeta(pdfMeta, instrumentId) {
  if (!pdfMeta?.fileName) return null
  return buildAutoOmrRequestKey(
    {
      name: pdfMeta.fileName,
      size: pdfMeta.size ?? 0,
      lastModified: pdfMeta.lastModified ?? 0,
    },
    instrumentId,
  )
}

/** True when PDF-only (or PDF+MIDI) should queue automatic preparation. */
export function shouldQueueAutoOmr({ musicXmlSource } = {}) {
  if (hasUploadedScoreTiming(musicXmlSource)) {
    return false
  }
  if (isOmrGeneratedPlayback(musicXmlSource) && isLibraryScoreTimingReady(musicXmlSource)) {
    return false
  }
  return true
}

/**
 * Cancel any in-flight worker and clear the queued auto-request so a late
 * OMR result cannot apply after a user-supplied MusicXML/MXL takes over.
 *
 * Invalidates the active OMR run id so late callbacks fail the hard gate.
 * Does not touch a newer PDF's preparation UI — callers must only clear the
 * queue when intentionally abandoning the active auto-OMR request.
 */
export function cancelInFlightOmrGeneration(setAutoOmrRequest, {
  previousPdfIdentity = null,
  reason = 'cancel-in-flight',
  clearAutoRequest = true,
} = {}) {
  requestOmrCancellation({ previousPdfIdentity, reason })
  cancelActiveOmrWorker()
  if (clearAutoRequest) {
    setAutoOmrRequest?.(null)
  }
}

/**
 * Reject stale OMR acceptance when uploaded timing already owns the session,
 * or when the PDF/instrument/run identity no longer matches the run.
 *
 * Hard rule (when a session identity is active):
 *   callbackPdfIdentity === activePdfIdentity
 *   AND callbackEpoch === activeEpoch
 *   AND callbackRunId === activeOmrRunId
 */
export function shouldAcceptOmrGeneratedResult({
  musicXmlSource,
  sourceInstrumentId,
  currentInstrumentId,
  sourcePdfFileName,
  sourcePdfFileUrl,
  currentPdfFileName,
  currentPdfFileUrl,
  sourcePdfIdentity = null,
  currentPdfIdentity = null,
  sourcePracticeSessionEpoch = null,
  currentPracticeSessionEpoch = null,
  sourceOmrRunId = null,
  currentOmrRunId = null,
  enforceGenerationGate = true,
} = {}) {
  const liveGate = getActiveScoreSourceGeneration()
  const resolvedCurrentPdfIdentity = currentPdfIdentity ?? liveGate.activePdfIdentity
  const resolvedCurrentEpoch =
    currentPracticeSessionEpoch ?? liveGate.activeEpoch
  const resolvedCurrentRunId =
    currentOmrRunId !== undefined && currentOmrRunId !== null
      ? currentOmrRunId
      : liveGate.activeOmrRunId

  // Fail closed once the session has an active identity/epoch/run: OMR must
  // declare which PDF + run it belongs to.
  if (resolvedCurrentPdfIdentity && !sourcePdfIdentity) {
    return {
      ok: false,
      reason: 'missing-source-pdf-identity',
      message: 'That PDF changed before timing finished. Upload it again or retry.',
      discarded: true,
    }
  }
  if (
    resolvedCurrentEpoch != null &&
    sourcePracticeSessionEpoch == null &&
    resolvedCurrentPdfIdentity
  ) {
    return {
      ok: false,
      reason: 'missing-source-session-epoch',
      message: 'That PDF changed before timing finished. Upload it again or retry.',
      discarded: true,
    }
  }
  if (resolvedCurrentPdfIdentity && sourceOmrRunId == null) {
    return {
      ok: false,
      reason: 'missing-source-omr-run-id',
      message: 'That PDF changed before timing finished. Upload it again or retry.',
      discarded: true,
    }
  }
  if (resolvedCurrentPdfIdentity && resolvedCurrentRunId == null) {
    return {
      ok: false,
      reason: 'no-active-omr-run',
      message: 'That PDF changed before timing finished. Upload it again or retry.',
      discarded: true,
    }
  }

  if (enforceGenerationGate && resolvedCurrentPdfIdentity) {
    const gate = assertScoreSourceMutationAllowed({
      callbackPdfIdentity: sourcePdfIdentity,
      callbackEpoch: sourcePracticeSessionEpoch,
      callbackRunId: sourceOmrRunId,
      phase: 'omr-result-apply-attempt',
    })
    if (!gate.ok) {
      return gate
    }
  } else {
    if (
      sourcePracticeSessionEpoch != null &&
      resolvedCurrentEpoch != null &&
      sourcePracticeSessionEpoch !== resolvedCurrentEpoch
    ) {
      return {
        ok: false,
        reason: 'session-epoch-mismatch',
        message: 'That PDF changed before timing finished. Upload it again or retry.',
        discarded: true,
      }
    }

    if (
      sourcePdfIdentity &&
      resolvedCurrentPdfIdentity &&
      sourcePdfIdentity !== resolvedCurrentPdfIdentity
    ) {
      return {
        ok: false,
        reason: 'pdf-identity-mismatch',
        message: 'That PDF changed before timing finished. Upload it again or retry.',
        discarded: true,
      }
    }

    if (
      sourceOmrRunId != null &&
      resolvedCurrentRunId != null &&
      sourceOmrRunId !== resolvedCurrentRunId
    ) {
      return {
        ok: false,
        reason: 'omr-run-mismatch',
        message: 'That PDF changed before timing finished. Upload it again or retry.',
        discarded: true,
      }
    }
  }

  if (hasUploadedScoreTiming(musicXmlSource)) {
    return {
      ok: false,
      reason: 'uploaded-timing-owns-session',
      message: 'A timing file is already loaded — prepared score was discarded.',
    }
  }

  // OMR-generated timing that belongs to a different PDF must not stick.
  if (
    musicXmlSource?.data &&
    musicXmlSource.ownerPdfIdentity &&
    currentPdfIdentity &&
    musicXmlSource.ownerPdfIdentity !== currentPdfIdentity
  ) {
    return {
      ok: false,
      reason: 'companion-owner-mismatch',
      message: 'That PDF changed before timing finished. Upload it again or retry.',
    }
  }

  const currentInstrument = normalizeInstrumentId(currentInstrumentId)
  const generatedInstrument = normalizeInstrumentId(sourceInstrumentId ?? currentInstrument)
  if (generatedInstrument !== currentInstrument) {
    return {
      ok: false,
      reason: 'instrument-mismatch',
      message: 'That PDF changed before timing finished. Upload it again or retry.',
    }
  }
  if (sourcePdfFileUrl && currentPdfFileUrl && sourcePdfFileUrl !== currentPdfFileUrl) {
    return {
      ok: false,
      reason: 'pdf-url-mismatch',
      message: 'That PDF changed before timing finished. Upload it again or retry.',
    }
  }
  if (sourcePdfFileName && currentPdfFileName && sourcePdfFileName !== currentPdfFileName) {
    return {
      ok: false,
      reason: 'pdf-name-mismatch',
      message: 'That PDF changed before timing finished. Upload it again or retry.',
    }
  }
  return { ok: true }
}

export function pdfPreparingScoreMessage(
  fileName,
  { clearedCompanionFiles = false, softWarning = null } = {},
) {
  const clearedHint = clearedCompanionFiles
    ? ' Previous timing and sound files were cleared.'
    : ''
  const warningHint = softWarning ? `${softWarning} ` : ''
  return `${warningHint}Loaded ${fileName}.${clearedHint} Preparing score… This may take a moment.`
}

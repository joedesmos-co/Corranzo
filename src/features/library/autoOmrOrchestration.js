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
 */
export function cancelInFlightOmrGeneration(setAutoOmrRequest) {
  cancelActiveOmrWorker()
  setAutoOmrRequest?.(null)
}

/**
 * Reject stale OMR acceptance when uploaded timing already owns the session,
 * or when the PDF/instrument identity no longer matches the run.
 */
export function shouldAcceptOmrGeneratedResult({
  musicXmlSource,
  sourceInstrumentId,
  currentInstrumentId,
  sourcePdfFileName,
  sourcePdfFileUrl,
  currentPdfFileName,
  currentPdfFileUrl,
} = {}) {
  if (hasUploadedScoreTiming(musicXmlSource)) {
    return {
      ok: false,
      reason: 'uploaded-timing-owns-session',
      message: 'A timing file is already loaded — prepared score was discarded.',
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

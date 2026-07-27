/**
 * Full score-source replacement when a different PDF is imported.
 *
 * Invariant: active PDF identity === owner identity of any MusicXML/MIDI/OMR
 * companion. Mismatched companions must be rejected and cleared.
 *
 * A new PDF must not keep the previous piece's MusicXML/MXL, MIDI, OMR output,
 * score-follow maps, or session companion blobs. Clear those synchronously
 * before auto-OMR starts.
 */

import { clearPdfAnalysisCache } from '../score-follow/pdfPageAnalysis.js'
import { buildPdfFingerprint, clearScoreFollowAnchors } from '../score-follow/scoreFollowStorage.js'
import {
  buildAutoSetupKey,
  clearAutoSetupAttempted,
} from '../score-follow/scoreFollowAutoSetupStorage.js'
import { clearCalibrationDebugStorage } from '../score-follow/calibrationDebugStorage.js'
import { musicXmlSourceKey } from '../import/musicXmlSource.js'

/** Stable PDF identity — fileName alone is not enough. */
export function buildPdfSourceIdentity(pdfMeta) {
  return buildPdfFingerprint(pdfMeta)
}

export function describeScoreSourceIdentities({
  pdfMeta = null,
  pdfFile = null,
  musicXmlSource = null,
  midiSource = null,
  practiceSessionEpoch = null,
  bundle = null,
} = {}) {
  const pdfIdentity = buildPdfSourceIdentity(pdfMeta)
  return {
    pdfIdentity,
    pdfFileName: pdfMeta?.fileName ?? null,
    pdfUrlPresent: Boolean(pdfFile),
    musicXmlIdentity: musicXmlSource
      ? {
          fileName: musicXmlSource.fileName ?? null,
          source: musicXmlSource.source ?? null,
          ownerPdfIdentity: musicXmlSource.ownerPdfIdentity ?? null,
          byteLength: musicXmlSource.data?.byteLength ?? 0,
          key: musicXmlSourceKey(musicXmlSource),
        }
      : null,
    midiIdentity: midiSource
      ? {
          fileName: midiSource.fileName ?? null,
          ownerPdfIdentity: midiSource.ownerPdfIdentity ?? null,
          byteLength: midiSource.data?.byteLength ?? 0,
        }
      : null,
    bundleIdentity: bundle
      ? {
          pdfFileName: bundle.pdfMeta?.fileName ?? bundle.fileName ?? null,
          pdfIdentity: buildPdfSourceIdentity(bundle.pdfMeta),
          musicXmlOwner: bundle.musicXmlSource?.ownerPdfIdentity ?? null,
          midiOwner: bundle.midiSource?.ownerPdfIdentity ?? null,
          hasMusicXml: Boolean(bundle.musicXmlSource?.data),
          hasMidi: Boolean(bundle.midiSource?.data),
        }
      : null,
    practiceSessionEpoch,
  }
}

/** Temporary DEV diagnostics for PDF replacement / OMR ownership races. */
export function logScoreSourceIdentities(phase, snapshot) {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV === false) {
    return
  }
  try {
    console.info(`[score-source] ${phase}`, snapshot)
  } catch {
    // ignore
  }
}

export function companionBelongsToPdf(companion, pdfIdentity) {
  if (!companion?.data) {
    return true
  }
  if (!pdfIdentity) {
    return false
  }
  // Legacy companions without an owner stamp are not trusted until stamped.
  if (!companion.ownerPdfIdentity) {
    return false
  }
  return companion.ownerPdfIdentity === pdfIdentity
}

/**
 * Enforce the ownership invariant. Returns companions that still match the PDF,
 * or nulls when identity is missing/mismatched. Legacy unowned companions are
 * cleared here — session restore stamps ownership when PDF+companions load together.
 */
export function reconcileCompanionsToPdfIdentity({
  pdfIdentity = null,
  musicXmlSource = null,
  midiSource = null,
} = {}) {
  const reconcileOne = (source) => {
    if (!source?.data) {
      return { source: source ?? null, rejected: false }
    }
    if (!pdfIdentity || !source.ownerPdfIdentity || source.ownerPdfIdentity !== pdfIdentity) {
      return { source: null, rejected: true }
    }
    return { source, rejected: false }
  }

  const musicXml = reconcileOne(musicXmlSource)
  const midi = reconcileOne(midiSource)
  return {
    musicXmlSource: musicXml.source,
    midiSource: midi.source,
    musicXmlRejected: musicXml.rejected,
    midiRejected: midi.rejected,
    musicXmlStamped: false,
    midiStamped: false,
  }
}

export function withOwnerPdfIdentity(source, pdfIdentity) {
  if (!source?.data || !pdfIdentity) {
    return source ?? null
  }
  return {
    ...source,
    ownerPdfIdentity: pdfIdentity,
  }
}

/**
 * Invalidate mappings and flags that belonged to the previous PDF/timing pair.
 */
export function invalidatePreviousScoreSideEffects({
  previousPdfMeta = null,
  previousFileName = null,
  previousMusicXmlSource = null,
} = {}) {
  const fingerprint = buildPdfFingerprint(previousPdfMeta)
  const fileName = previousPdfMeta?.fileName ?? previousFileName ?? null
  clearScoreFollowAnchors({ fingerprint, fileName })
  // Drop cached PDFDocumentProxy so the next OMR/job cannot inherit pageCount.
  clearPdfAnalysisCache()

  const timingSourceId =
    previousMusicXmlSource?.fileName ?? musicXmlSourceKey(previousMusicXmlSource) ?? null
  const autoSetupKey = buildAutoSetupKey(fingerprint, timingSourceId)
  if (autoSetupKey) {
    clearAutoSetupAttempted(autoSetupKey)
    clearCalibrationDebugStorage(autoSetupKey)
  }
  const pdfOnlyKey = buildAutoSetupKey(fingerprint, 'timing')
  if (pdfOnlyKey && pdfOnlyKey !== autoSetupKey) {
    clearAutoSetupAttempted(pdfOnlyKey)
    clearCalibrationDebugStorage(pdfOnlyKey)
  }

  return { fingerprint, fileName, autoSetupKey }
}

export function hadCompanionScoreSources({ midiSource = null, musicXmlSource = null } = {}) {
  return Boolean(midiSource?.data || musicXmlSource?.data)
}

/**
 * Synchronously wipe companion fields on a live bundle snapshot (refs update
 * before React re-renders, so late OMR/persistence cannot read Piece A).
 */
export function clearLiveBundleCompanions(liveBundle) {
  if (!liveBundle || typeof liveBundle !== 'object') {
    return {
      midiSource: null,
      musicXmlSource: null,
      demoPieceActive: false,
    }
  }
  liveBundle.midiSource = null
  liveBundle.musicXmlSource = null
  liveBundle.demoPieceActive = false
  return liveBundle
}

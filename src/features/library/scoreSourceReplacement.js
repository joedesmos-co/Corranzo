/**
 * Full score-source replacement when a different PDF is imported.
 *
 * A new PDF must not keep the previous piece's MusicXML/MXL, MIDI, OMR output,
 * score-follow mappings, or practice-session identity. Callers then set the new
 * PDF bytes/meta and optionally queue automatic preparation.
 */

import { buildPdfFingerprint, clearScoreFollowAnchors } from '../score-follow/scoreFollowStorage.js'
import {
  buildAutoSetupKey,
  clearAutoSetupAttempted,
} from '../score-follow/scoreFollowAutoSetupStorage.js'
import { clearCalibrationDebugStorage } from '../score-follow/calibrationDebugStorage.js'
import { musicXmlSourceKey } from '../import/musicXmlSource.js'

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

  const timingSourceId =
    previousMusicXmlSource?.fileName ?? musicXmlSourceKey(previousMusicXmlSource) ?? null
  const autoSetupKey = buildAutoSetupKey(fingerprint, timingSourceId)
  if (autoSetupKey) {
    clearAutoSetupAttempted(autoSetupKey)
    clearCalibrationDebugStorage(autoSetupKey)
  }
  // Also clear the timing-agnostic key used before timing is known.
  const pdfOnlyKey = buildAutoSetupKey(fingerprint, 'timing')
  if (pdfOnlyKey && pdfOnlyKey !== autoSetupKey) {
    clearAutoSetupAttempted(pdfOnlyKey)
    clearCalibrationDebugStorage(pdfOnlyKey)
  }

  return { fingerprint, fileName, autoSetupKey }
}

/**
 * Snapshot whether companions existed before a PDF replacement clears them.
 */
export function hadCompanionScoreSources({ midiSource = null, musicXmlSource = null } = {}) {
  return Boolean(midiSource?.data || musicXmlSource?.data)
}

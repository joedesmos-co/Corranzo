import { useMemo } from 'react'
import { analyzeMusicXmlImport } from './musicXmlImportWarnings.js'
import { analyzeMidiImport } from './midiImportWarnings.js'
import { buildFilePairWarnings } from './filePairWarnings.js'
import { buildPracticeGuidance } from './practiceGuidance.js'
import { buildLibraryAccuracyWarnings } from './accuracyGuide.js'

function omrWarningStrength(message) {
  return /TAB notes detected|Dense TAB notes|Repeat\/coda|Capo marking/i.test(message)
    ? 'strong'
    : 'mild'
}

export function buildOmrGeneratedWarnings(musicXmlSource) {
  if (musicXmlSource?.source !== 'omr') {
    return []
  }
  return (musicXmlSource.omrMeta?.warnings ?? [])
    .filter(Boolean)
    .map((message, index) => ({
      id: `omr-generated-${index}`,
      strength: omrWarningStrength(message),
      message,
    }))
}

/**
 * Combine per-file and cross-file import warnings plus next-step guidance.
 */
export default function useImportReadiness({
  hasPdf,
  hasMidi,
  hasMusicXml,
  timingMap,
  timingError,
  timingLoading,
  midiTracks,
  midiDuration,
  midiError,
  midiLoading,
  alignmentDiagnostics,
  pdfSoftWarning,
  musicXmlSource = null,
  isDemoPiece = false,
}) {
  return useMemo(() => {
    const timingReady = Boolean(timingMap) && !timingLoading && !timingError
    const midiPlayable =
      hasMidi &&
      !midiLoading &&
      !midiError &&
      (midiTracks?.reduce((sum, track) => sum + (track.noteCount ?? 0), 0) ?? 0) > 0

    const warnings = []

    if (pdfSoftWarning) {
      warnings.push({ id: 'pdf-large', strength: 'mild', message: pdfSoftWarning })
    }

    warnings.push(
      ...buildLibraryAccuracyWarnings({
        hasPdf,
        hasMusicXml,
        hasMidi,
      }),
    )

    if (timingReady) {
      warnings.push(...analyzeMusicXmlImport(timingMap))
      warnings.push(...buildOmrGeneratedWarnings(musicXmlSource))
    }

    if (midiError) {
      warnings.push({
        id: 'midi-load-error',
        strength: 'strong',
        message: midiError,
      })
    } else if (hasMidi && !midiLoading) {
      warnings.push(...analyzeMidiImport({ tracks: midiTracks, duration: midiDuration }))
    }

    if (timingReady && hasMidi && !midiLoading && !midiError) {
      warnings.push(...buildFilePairWarnings(alignmentDiagnostics))
    }

    const guidance = buildPracticeGuidance({
      hasPdf,
      hasMidi,
      hasMusicXml,
      timingReady,
      timingError,
      midiError,
      midiPlayable,
      isDemoPiece,
    })

    const visibleWarnings = warnings

    return {
      warnings: visibleWarnings,
      guidance,
      timingReady,
      midiPlayable,
    }
  }, [
    hasPdf,
    hasMidi,
    hasMusicXml,
    timingMap,
    timingError,
    timingLoading,
    midiTracks,
    midiDuration,
    midiError,
    midiLoading,
    alignmentDiagnostics,
    pdfSoftWarning,
    musicXmlSource,
    isDemoPiece,
  ])
}

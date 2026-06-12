import { useMemo } from 'react'
import { analyzeMusicXmlImport } from './musicXmlImportWarnings.js'
import { analyzeMidiImport } from './midiImportWarnings.js'
import { buildFilePairWarnings } from './filePairWarnings.js'
import { buildPracticeGuidance } from './practiceGuidance.js'
import { buildLibraryAccuracyWarnings } from './accuracyGuide.js'

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

    const demoHiddenWarningIds = new Set([
      'xml-multi-part',
      'pair-low-overlap',
      'pair-duration-mismatch',
      'pair-first-note-offset',
    ])
    const visibleWarnings = isDemoPiece
      ? warnings.filter((warning) => !demoHiddenWarningIds.has(warning.id))
      : warnings

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
    isDemoPiece,
  ])
}

import { MIC_CALIBRATION_STATUS } from './micCalibration.js'
import { MIC_SIGNAL_QUALITY } from './micSignalQuality.js'

/** User-facing mic diagnostic codes for Wait For You + mic test. */
export const MIC_DIAGNOSTIC = {
  NO_INPUT: 'no-input',
  TOO_QUIET: 'too-quiet',
  TOO_NOISY: 'too-noisy',
  UNCLEAR_PITCH: 'unclear-pitch',
  UNSTABLE: 'unstable',
  WRONG_PITCH: 'wrong-pitch',
  CHORD_UNSUPPORTED: 'chord-unsupported',
  QUIET_PRACTICE_HELP: 'quiet-practice-help',
  LISTENING: 'listening',
  GOOD: 'good',
  CALIBRATING: 'calibrating',
}

export const MIC_DIAGNOSTIC_LABELS = {
  [MIC_DIAGNOSTIC.NO_INPUT]: 'No input detected — check the mic is unmuted',
  [MIC_DIAGNOSTIC.TOO_QUIET]: 'Too quiet — move closer or play a bit louder',
  [MIC_DIAGNOSTIC.TOO_NOISY]: 'Too noisy — try a quieter room',
  [MIC_DIAGNOSTIC.UNCLEAR_PITCH]: 'Unclear pitch — play one clear note at a time',
  [MIC_DIAGNOSTIC.UNSTABLE]: 'Pitch detected but not stable yet — hold the note',
  [MIC_DIAGNOSTIC.WRONG_PITCH]: 'Wrong note — check the expected pitch',
  [MIC_DIAGNOSTIC.CHORD_UNSUPPORTED]: 'Mic hears one note at a time — use MIDI for chords together',
  [MIC_DIAGNOSTIC.QUIET_PRACTICE_HELP]: 'Soft note detected — move closer for quiet practice',
  [MIC_DIAGNOSTIC.LISTENING]: 'Listening…',
  [MIC_DIAGNOSTIC.GOOD]: 'Good signal — single notes should register well',
  [MIC_DIAGNOSTIC.CALIBRATING]: 'Stay quiet for a moment…',
}

/**
 * Resolve the primary mic diagnostic from calibration, live frame, and optional
 * Wait For You context. Does not change matching — guidance only.
 */
export function resolveMicDiagnostic({
  calibrating = false,
  calibrationStatus = null,
  signalQuality = null,
  stabilizerPending = false,
  wrongPitch = false,
  chordUnsupported = false,
  quietNoteRejected = false,
} = {}) {
  if (chordUnsupported) {
    return MIC_DIAGNOSTIC.CHORD_UNSUPPORTED
  }
  if (calibrating || calibrationStatus === MIC_CALIBRATION_STATUS.MEASURING) {
    return MIC_DIAGNOSTIC.CALIBRATING
  }
  if (calibrationStatus === MIC_CALIBRATION_STATUS.NO_INPUT) {
    return MIC_DIAGNOSTIC.NO_INPUT
  }
  if (wrongPitch) {
    return MIC_DIAGNOSTIC.WRONG_PITCH
  }
  if (quietNoteRejected) {
    return MIC_DIAGNOSTIC.QUIET_PRACTICE_HELP
  }
  if (signalQuality === MIC_SIGNAL_QUALITY.SILENT && calibrationStatus === MIC_CALIBRATION_STATUS.NO_INPUT) {
    return MIC_DIAGNOSTIC.NO_INPUT
  }
  if (signalQuality === MIC_SIGNAL_QUALITY.TOO_QUIET) {
    return MIC_DIAGNOSTIC.TOO_QUIET
  }
  if (signalQuality === MIC_SIGNAL_QUALITY.TOO_NOISY) {
    return MIC_DIAGNOSTIC.TOO_NOISY
  }
  if (signalQuality === MIC_SIGNAL_QUALITY.WEAK) {
    return MIC_DIAGNOSTIC.UNCLEAR_PITCH
  }
  if (stabilizerPending || signalQuality === MIC_SIGNAL_QUALITY.UNSTABLE) {
    return MIC_DIAGNOSTIC.UNSTABLE
  }
  if (signalQuality === MIC_SIGNAL_QUALITY.GOOD) {
    return MIC_DIAGNOSTIC.GOOD
  }
  return MIC_DIAGNOSTIC.LISTENING
}

export function micDiagnosticLabel(code) {
  return MIC_DIAGNOSTIC_LABELS[code] ?? MIC_DIAGNOSTIC_LABELS[MIC_DIAGNOSTIC.LISTENING]
}

import { MIC_SIGNAL_SHAPE } from '../microphone-input/micSignalShape.js'

function hasInstrumentLikeHarmonicDecay(v2Notes = []) {
  const note = v2Notes.find((entry) => entry?.detected)
  const magnitudes = note?.harmonicMagnitudes
  if (!Array.isArray(magnitudes) || magnitudes.length < 2) {
    return true
  }
  const fundamental = magnitudes[0] ?? 0
  const secondHarmonic = magnitudes[1] ?? 0
  if (!(fundamental > 0)) {
    return false
  }
  // Voiced speech boosts lower formants so the 2nd partial rivals the fundamental.
  // A played instrument tone keeps upper harmonics well below the fundamental.
  return secondHarmonic / fundamental <= 0.15
}

/**
 * Reject broadband / formant-heavy input that is not a sustained instrument tone.
 * Speech often picks up weak pitch while remaining aperiodic and high-ZCR.
 */
export function isMusicalMicFrame(frame) {
  if (!frame?.gateOpen) {
    return false
  }

  const shape = frame.signalShape
  if (shape === MIC_SIGNAL_SHAPE.NOISY || shape === MIC_SIGNAL_SHAPE.QUIET) {
    return false
  }

  if (frame.v2Active) {
    if (!(frame.v2DetectedMidis?.length > 0)) {
      return false
    }
    if (!hasInstrumentLikeHarmonicDecay(frame.v2Notes ?? [])) {
      return false
    }
  }

  const clarity = frame.clarity ?? 0
  const zeroCrossingRate = frame.zeroCrossingRate ?? 0
  const spectralEnergy = frame.spectralEnergy ?? 0
  const crestFactor = frame.crestFactor ?? 0

  // Formant-heavy speech: weak pitch clarity on broadband voiced energy.
  if (
    zeroCrossingRate >= 0.2 &&
    spectralEnergy >= 0.12 &&
    clarity < 0.55 &&
    crestFactor < 7
  ) {
    return false
  }

  return true
}

export function micMusicalRejectReason(frame) {
  if (!frame?.gateOpen) {
    return null
  }
  if (isMusicalMicFrame(frame)) {
    return null
  }
  const shape = frame.signalShape
  if (shape === MIC_SIGNAL_SHAPE.NOISY) {
    return 'non-musical-noise'
  }
  if (shape === MIC_SIGNAL_SHAPE.QUIET) {
    return 'non-musical-quiet'
  }
  if (frame.v2Active && !(frame.v2DetectedMidis?.length > 0)) {
    return 'non-musical-no-v2'
  }
  if (frame.v2Active && frame.v2DetectedMidis?.length) {
    return 'non-musical-formant-harmonics'
  }
  return 'non-musical-speech-like'
}

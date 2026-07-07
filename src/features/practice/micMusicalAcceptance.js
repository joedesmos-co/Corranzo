import { MIC_SIGNAL_SHAPE } from '../microphone-input/micSignalShape.js'

/**
 * Upper-partial energy cap: (h4+h5+h6) / (h1+h2). Measured on the benchmark
 * fixtures, real piano/guitar/distorted notes stay ≤ 0.39 while droney voiced
 * speech (formant resonance) measures ≥ 0.52.
 */
export const MIC_HARMONIC_HIGH_LOW_MAX = 0.45

/** Partials after the peak must decay — formant speech piles energy on h4+. */
function harmonicDecayAfterStrongest(magnitudes, strongestIndex) {
  const peak = magnitudes[strongestIndex] ?? 0
  if (!(peak > 0)) {
    return false
  }
  for (let index = strongestIndex + 1; index < magnitudes.length; index += 1) {
    if ((magnitudes[index] ?? 0) > peak * 0.85) {
      return false
    }
  }
  return true
}

/**
 * Amp / speaker coloration and distorted electric can anchor on h2 or h3 with
 * a smooth harmonic decay. Voice formants peak on h4+ or break the decay shape.
 */
function hasElectricHarmonicRichProfile(note, frame) {
  const magnitudes = note?.harmonicMagnitudes
  if (!Array.isArray(magnitudes) || magnitudes.length < 3 || !note?.detected) {
    return false
  }

  const shape = frame?.signalShape
  if (shape === MIC_SIGNAL_SHAPE.NOISY || shape === MIC_SIGNAL_SHAPE.QUIET) {
    return false
  }
  if ((frame?.zeroCrossingRate ?? 0) >= 0.18) {
    return false
  }

  let strongestIndex = 0
  for (let index = 1; index < magnitudes.length; index += 1) {
    if ((magnitudes[index] ?? 0) > (magnitudes[strongestIndex] ?? 0)) {
      strongestIndex = index
    }
  }
  if (strongestIndex > 2) {
    return false
  }
  if (!harmonicDecayAfterStrongest(magnitudes, strongestIndex)) {
    return false
  }

  const v2Confidence = frame?.v2MeanConfidence ?? 0
  const distortedLike =
    shape === MIC_SIGNAL_SHAPE.DISTORTED || (frame?.spectralEnergy ?? 0) >= 0.1
  return strongestIndex >= 1 && (distortedLike || v2Confidence >= 0.35)
}

function hasInstrumentLikeHarmonicProfile(v2Notes = [], frame = null) {
  const note = v2Notes.find((entry) => entry?.detected)
  const magnitudes = note?.harmonicMagnitudes
  if (!Array.isArray(magnitudes) || magnitudes.length < 2) {
    return true
  }
  if (hasElectricHarmonicRichProfile(note, frame)) {
    return true
  }
  const fundamental = magnitudes[0] ?? 0
  if (!(fundamental > 0)) {
    return false
  }

  // A played note anchors its spectrum on the fundamental: real piano/guitar
  // fixtures measure h2/h1 ≈ 0.5 with a smooth decay above it. Formant-filtered
  // voice instead puts a resonance peak on an upper partial…
  //
  // Bass strings radiate a weak fundamental with the 2nd partial strongest, so
  // bass notes may also anchor on h2. That stays voice-safe: a vocal formant
  // (~700 Hz) only lands on h2 when f0 is 300-400 Hz — never a bass pitch —
  // while bass-range voices peak on h3+ or fail the high/low cap below.
  let strongestIndex = 0
  for (let index = 1; index < magnitudes.length; index += 1) {
    if ((magnitudes[index] ?? 0) > (magnitudes[strongestIndex] ?? 0)) {
      strongestIndex = index
    }
  }
  const strongestAllowed = note?.isBass ? strongestIndex <= 1 : strongestIndex === 0
  if (!strongestAllowed) {
    return false
  }

  // …or piles disproportionate energy into partials 4-6 relative to 1-2.
  const lowEnergy = fundamental + (magnitudes[1] ?? 0)
  let highEnergy = 0
  for (let index = 3; index < magnitudes.length; index += 1) {
    highEnergy += magnitudes[index] ?? 0
  }
  return lowEnergy > 0 && highEnergy / lowEnergy <= MIC_HARMONIC_HIGH_LOW_MAX
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
  const scoreInformedQuietGate = Boolean(frame.scoreInformedQuietGateOpen)
  if (shape === MIC_SIGNAL_SHAPE.NOISY) {
    return false
  }
  if (shape === MIC_SIGNAL_SHAPE.QUIET && !scoreInformedQuietGate) {
    return false
  }

  if (frame.v2Active) {
    if (!(frame.v2DetectedMidis?.length > 0)) {
      return false
    }
    if (!hasInstrumentLikeHarmonicProfile(frame.v2Notes ?? [], frame)) {
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

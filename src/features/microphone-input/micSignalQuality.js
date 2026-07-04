export const MIC_SIGNAL_QUALITY = {
  SILENT: 'silent',
  TOO_QUIET: 'too-quiet',
  TOO_NOISY: 'too-noisy',
  WEAK: 'weak',
  UNSTABLE: 'unstable',
  LISTENING: 'listening',
  GOOD: 'good',
}

export const MIC_SIGNAL_QUALITY_LABELS = {
  [MIC_SIGNAL_QUALITY.SILENT]: 'Quiet — play a note to test',
  [MIC_SIGNAL_QUALITY.TOO_QUIET]: 'Too quiet — move closer or play a bit louder',
  [MIC_SIGNAL_QUALITY.TOO_NOISY]: 'Too noisy — try a quieter room or lower room volume',
  [MIC_SIGNAL_QUALITY.WEAK]: 'Unclear pitch — try one clear note at a time',
  [MIC_SIGNAL_QUALITY.UNSTABLE]: 'Pitch detected but not stable — hold the note',
  [MIC_SIGNAL_QUALITY.LISTENING]: 'Listening…',
  [MIC_SIGNAL_QUALITY.GOOD]: 'Good signal — single notes should register well',
}

// A clearly audible frame: never call this "too quiet" even if the filtered
// gate is closed (bright/percussive/distorted energy can slip under a gate
// tuned on filtered RMS).
const AUDIBLE_RMS = 0.02

/**
 * User-facing mic signal guidance (not raw DSP jargon).
 *
 * "Too quiet" is reserved for input that is genuinely below the gate — a
 * marginal signal. A strong signal that fails the filtered gate, or any frame
 * whose shape reads as audible (sustained / percussive / distorted / noisy),
 * is routed to shape-appropriate guidance instead, so a loud distorted guitar
 * is never reported as silence.
 */
export function classifyMicSignalQuality({
  rms = 0,
  clarity = 0,
  passesGate = false,
  hasPitch = false,
  stabilizerPending = false,
  signalShape = null,
}) {
  const audibleShape = signalShape != null && signalShape !== 'quiet'

  if (rms < 0.0035 && !audibleShape) {
    return MIC_SIGNAL_QUALITY.SILENT
  }

  // Only truly-marginal input (below gate AND not clearly audible) is "too quiet".
  if (!passesGate && !(audibleShape && rms >= AUDIBLE_RMS)) {
    return MIC_SIGNAL_QUALITY.TOO_QUIET
  }

  if (rms > 0.32 || signalShape === 'noisy') {
    return MIC_SIGNAL_QUALITY.TOO_NOISY
  }
  if (stabilizerPending) {
    return MIC_SIGNAL_QUALITY.UNSTABLE
  }
  if (hasPitch && clarity >= 0.4) {
    return MIC_SIGNAL_QUALITY.GOOD
  }
  if (hasPitch && clarity >= 0.28) {
    return MIC_SIGNAL_QUALITY.LISTENING
  }
  if (hasPitch) {
    return MIC_SIGNAL_QUALITY.WEAK
  }
  return MIC_SIGNAL_QUALITY.LISTENING
}

export function clarityPercent(clarity) {
  if (!Number.isFinite(clarity)) {
    return 0
  }
  return Math.round(Math.min(100, Math.max(0, clarity * 100)))
}

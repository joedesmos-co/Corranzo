export const MIC_SIGNAL_QUALITY = {
  SILENT: 'silent',
  TOO_QUIET: 'too-quiet',
  TOO_NOISY: 'too-noisy',
  WEAK: 'weak',
  LISTENING: 'listening',
  GOOD: 'good',
}

export const MIC_SIGNAL_QUALITY_LABELS = {
  [MIC_SIGNAL_QUALITY.SILENT]: 'Quiet — play a note to test',
  [MIC_SIGNAL_QUALITY.TOO_QUIET]: 'Too quiet — move closer or play a bit louder',
  [MIC_SIGNAL_QUALITY.TOO_NOISY]: 'Too noisy — try a quieter room or lower room volume',
  [MIC_SIGNAL_QUALITY.WEAK]: 'Unclear — try one clear note at a time',
  [MIC_SIGNAL_QUALITY.LISTENING]: 'Listening…',
  [MIC_SIGNAL_QUALITY.GOOD]: 'Good signal — single notes should register well',
}

/**
 * User-facing mic signal guidance (not raw DSP jargon).
 */
export function classifyMicSignalQuality({ rms = 0, clarity = 0, passesGate = false, hasPitch = false }) {
  if (rms < 0.0035) {
    return MIC_SIGNAL_QUALITY.SILENT
  }
  if (!passesGate) {
    return MIC_SIGNAL_QUALITY.TOO_QUIET
  }
  if (rms > 0.32) {
    return MIC_SIGNAL_QUALITY.TOO_NOISY
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

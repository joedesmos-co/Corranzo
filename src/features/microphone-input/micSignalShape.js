/**
 * Coarse instrument-signal shape from cheap time-domain features.
 *
 * The point is NOT to name the instrument — it is to keep calibration and the
 * "too quiet" guidance honest across very different real inputs:
 *
 *   - a sustained acoustic/digital piano tone,
 *   - a plucky guitar attack that decays,
 *   - a clean electric tone, and
 *   - a distorted / amp'd electric tone that is harmonic-rich and bright.
 *
 * A strong distorted or harmonic-rich signal must never be mistaken for silence
 * just because per-frame pitch tracking wobbled. Pure numbers in, shape out —
 * no audio APIs, fully testable.
 */
export const MIC_SIGNAL_SHAPE = {
  QUIET: 'quiet',
  SUSTAINED: 'sustained',
  PERCUSSIVE: 'percussive',
  DISTORTED: 'distorted',
  NOISY: 'noisy',
}

export const MIC_SIGNAL_SHAPE_LABELS = {
  [MIC_SIGNAL_SHAPE.QUIET]: 'Quiet',
  [MIC_SIGNAL_SHAPE.SUSTAINED]: 'Sustained tone',
  [MIC_SIGNAL_SHAPE.PERCUSSIVE]: 'Plucky / percussive',
  [MIC_SIGNAL_SHAPE.DISTORTED]: 'Harmonic-rich / distorted',
  [MIC_SIGNAL_SHAPE.NOISY]: 'Broadband noise',
}

// Below this RMS there is no musically useful energy in the frame.
const QUIET_RMS = 0.006
// At/above this RMS the signal is clearly audible — never call it silence.
const STRONG_RMS = 0.02
// High-frequency energy ratio (first-difference energy / total energy).
// ~0 for a low sine, rises with bright harmonics, ~2 for white noise.
const HARMONIC_RICH_HF = 0.12
const BROADBAND_HF = 0.9
const BROADBAND_ZCR = 0.32

/**
 * @param {object} f
 * @param {number} f.rms                 raw frame RMS
 * @param {number} [f.clarity]           autocorrelation clarity (0..1)
 * @param {boolean} [f.hasPitch]         a confident pitch was found this frame
 * @param {number} [f.crestFactor]       peak / rms
 * @param {number} [f.zeroCrossingRate]  zero crossings per sample (0..1)
 * @param {number} [f.spectralEnergy]    high-frequency energy ratio
 */
export function classifyMicSignalShape({
  rms = 0,
  clarity = 0,
  hasPitch = false,
  crestFactor = 0,
  zeroCrossingRate = 0,
  spectralEnergy = 0,
} = {}) {
  if (!Number.isFinite(rms) || rms <= QUIET_RMS) {
    return MIC_SIGNAL_SHAPE.QUIET
  }

  const strong = rms >= STRONG_RMS
  const broadband = spectralEnergy >= BROADBAND_HF || zeroCrossingRate >= BROADBAND_ZCR
  const harmonicRich = spectralEnergy >= HARMONIC_RICH_HF

  // Aperiodic broadband energy with no pitch → room/handling noise (only when
  // strong enough to matter; a whisper of hiss is still just "quiet").
  if (broadband && !hasPitch && clarity < 0.4) {
    return strong ? MIC_SIGNAL_SHAPE.NOISY : MIC_SIGNAL_SHAPE.QUIET
  }

  // Strong + bright, but still tonal-ish → distorted / amp'd electric or a
  // harmonic-heavy attack. Explicitly NOT silence.
  if (strong && harmonicRich) {
    return MIC_SIGNAL_SHAPE.DISTORTED
  }

  // Sharp transient with no settled pitch yet → pluck / hammer attack.
  if (crestFactor >= 8 && !hasPitch) {
    return MIC_SIGNAL_SHAPE.PERCUSSIVE
  }

  if (hasPitch || clarity >= 0.4) {
    return MIC_SIGNAL_SHAPE.SUSTAINED
  }

  // Audible but featureless: keep it out of the "silence" bucket when strong.
  return strong ? MIC_SIGNAL_SHAPE.DISTORTED : MIC_SIGNAL_SHAPE.QUIET
}

/** True when the frame carries clearly audible musical energy (not silence). */
export function signalShapeIsAudible(shape) {
  return shape != null && shape !== MIC_SIGNAL_SHAPE.QUIET
}

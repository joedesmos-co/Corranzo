const MIN_MIDI = 21
const MAX_MIDI = 108
const A4_FREQUENCY = 440
const MIN_CORRELATION = 0.012

/**
 * Lightweight autocorrelation pitch estimate (monophonic).
 * Returns null when signal is too quiet or ambiguous.
 */
export function detectPitchAutocorrelation(samples, sampleRate) {
  if (!samples?.length || !sampleRate) {
    return null
  }

  const size = samples.length
  let rms = 0
  for (let index = 0; index < size; index += 1) {
    rms += samples[index] * samples[index]
  }
  rms = Math.sqrt(rms / size)
  if (rms < 0.006) {
    return null
  }

  const minPeriod = Math.max(2, Math.floor(sampleRate / 1400))
  const maxPeriod = Math.min(size - 1, Math.floor(sampleRate / 55))
  if (maxPeriod <= minPeriod) {
    return null
  }

  let bestPeriod = -1
  let bestCorrelation = 0

  for (let period = minPeriod; period <= maxPeriod; period += 1) {
    let correlation = 0
    const window = size - period
    for (let index = 0; index < window; index += 1) {
      correlation += samples[index] * samples[index + period]
    }
    correlation /= window
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestPeriod = period
    }
  }

  if (bestPeriod < 0 || bestCorrelation < MIN_CORRELATION) {
    return null
  }

  function correlationAtPeriod(period) {
    if (period < minPeriod || period > maxPeriod) {
      return 0
    }
    let correlation = 0
    const window = size - period
    for (let index = 0; index < window; index += 1) {
      correlation += samples[index] * samples[index + period]
    }
    return correlation / window
  }

  let period = bestPeriod

  // Prefer fundamental over harmonics (period too short → pitch too high).
  for (const divisor of [2, 3, 4]) {
    const candidate = Math.floor(bestPeriod / divisor)
    if (candidate < minPeriod) {
      continue
    }
    const candidateCorrelation = correlationAtPeriod(candidate)
    if (candidateCorrelation > bestCorrelation * 0.52 && candidate < period) {
      period = candidate
    }
  }

  const frequency = sampleRate / period
  if (!Number.isFinite(frequency) || frequency < 55 || frequency > 2200) {
    return null
  }

  const periodCorrelation = correlationAtPeriod(period)
  const clarity = Math.min(1, periodCorrelation / (rms * rms + 1e-5))

  if (clarity < 0.12) {
    return null
  }

  return {
    frequency,
    clarity,
    rms,
    periodCorrelation,
  }
}

export function frequencyToMidi(frequency) {
  if (!frequency || frequency <= 0) {
    return null
  }
  const midi = 69 + 12 * Math.log2(frequency / A4_FREQUENCY)
  if (!Number.isFinite(midi)) {
    return null
  }
  return midi
}

export function quantizeMidi(midi, centsTolerance = 30) {
  if (midi == null || !Number.isFinite(midi)) {
    return null
  }
  const rounded = Math.round(midi)
  if (Math.abs(midi - rounded) * 100 > centsTolerance) {
    return null
  }
  return Math.min(MAX_MIDI, Math.max(MIN_MIDI, rounded))
}

export function pitchToMidiNote(pitch, { minClarity = 0.28 } = {}) {
  if (!pitch || pitch.clarity < minClarity) {
    return null
  }
  const midi = quantizeMidi(frequencyToMidi(pitch.frequency))
  if (midi == null) {
    return null
  }
  return {
    midi,
    frequency: pitch.frequency,
    clarity: pitch.clarity,
    rms: pitch.rms,
  }
}

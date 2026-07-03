/**
 * Deterministic synthetic clips for mic accuracy measurement.
 * Used when manifest entries have a `synthetic` spec instead of a WAV file.
 */

export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function synthSine(frequency, sampleRate, seconds = 0.5, amplitude = 0.35) {
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const buffer = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    buffer[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * amplitude
  }
  return buffer
}

export function synthHarmonicTone(fundamental, harmonics, sampleRate, seconds = 0.5) {
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const buffer = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    let sample = 0
    for (const { multiple, amplitude } of harmonics) {
      sample +=
        Math.sin((2 * Math.PI * fundamental * multiple * index) / sampleRate) *
        amplitude
    }
    buffer[index] = sample
  }
  return buffer
}

export function synthSilence(sampleRate, seconds = 0.5) {
  return new Float32Array(Math.max(1, Math.floor(sampleRate * seconds)))
}

export function synthWhiteNoise(sampleRate, seconds = 0.5, seed = 7) {
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const buffer = new Float32Array(length)
  let state = seed
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    buffer[index] = ((state / 0x7fffffff) * 2 - 1) * 0.08
  }
  return buffer
}

/**
 * @param {{ type: string, frequency?: number, midi?: number, seconds?: number, amplitude?: number, harmonics?: Array<{multiple:number,amplitude:number}>, seed?: number }} spec
 */
export function renderSyntheticClip(spec, sampleRate = 44100) {
  const seconds = spec.seconds ?? 0.5
  switch (spec.type) {
    case 'sine': {
      const frequency = spec.frequency ?? midiToFrequency(spec.midi ?? 69)
      return synthSine(frequency, sampleRate, seconds, spec.amplitude ?? 0.35)
    }
    case 'harmonic': {
      const fundamental = spec.frequency ?? midiToFrequency(spec.midi ?? 57)
      return synthHarmonicTone(
        fundamental,
        spec.harmonics ?? [
          { multiple: 1, amplitude: 0.12 },
          { multiple: 2, amplitude: 0.35 },
        ],
        sampleRate,
        seconds,
      )
    }
    case 'silence':
      return synthSilence(sampleRate, seconds)
    case 'noise':
      return synthWhiteNoise(sampleRate, seconds, spec.seed ?? 7)
    default:
      throw new Error(`Unknown synthetic clip type: ${spec.type}`)
  }
}

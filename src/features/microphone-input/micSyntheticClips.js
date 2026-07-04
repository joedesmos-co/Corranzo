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

const GUITAR_PLUCK_HARMONICS = [
  { multiple: 1, amplitude: 1 },
  { multiple: 2, amplitude: 0.55 },
  { multiple: 3, amplitude: 0.32 },
  { multiple: 4, amplitude: 0.18 },
  { multiple: 5, amplitude: 0.1 },
]

/**
 * Plucky, decaying harmonic tone — an acoustic / clean-electric guitar note.
 * The fast attack + exponential decay is the articulation a held piano lacks.
 */
export function synthPluck(fundamental, sampleRate, seconds = 0.6, options = {}) {
  const { amplitude = 0.42, decay = 2, harmonics = GUITAR_PLUCK_HARMONICS } = options
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const buffer = new Float32Array(length)
  const totalAmplitude = harmonics.reduce((sum, part) => sum + part.amplitude, 0) || 1
  for (let index = 0; index < length; index += 1) {
    const envelope = Math.exp((-decay * index) / sampleRate)
    let sample = 0
    for (const { multiple, amplitude: partAmplitude } of harmonics) {
      sample += Math.sin((2 * Math.PI * fundamental * multiple * index) / sampleRate) * partAmplitude
    }
    buffer[index] = (envelope * amplitude * sample) / totalAmplitude
  }
  return buffer
}

const DISTORTED_HARMONICS = [
  { multiple: 1, amplitude: 0.6 },
  { multiple: 2, amplitude: 0.45 },
  { multiple: 3, amplitude: 0.35 },
]

/**
 * Distorted / amp'd electric guitar: a harmonic tone driven through a soft
 * clipper (tanh), which piles on high harmonics and makes the frame bright and
 * broadband while staying periodic. A strong signal that must NOT read as
 * silence even when per-frame pitch tracking wobbles.
 */
export function synthDistorted(fundamental, sampleRate, seconds = 0.6, options = {}) {
  const { amplitude = 0.5, drive = 4.5, harmonics = DISTORTED_HARMONICS } = options
  const base = synthHarmonicTone(fundamental, harmonics, sampleRate, seconds)
  const out = new Float32Array(base.length)
  for (let index = 0; index < base.length; index += 1) {
    out[index] = Math.tanh(base[index] * drive) * amplitude
  }
  return out
}

const SPEAKER_HARMONICS = [
  { multiple: 1, amplitude: 0.5 },
  { multiple: 2, amplitude: 0.24 },
  { multiple: 3, amplitude: 0.12 },
]

/**
 * Digital piano played back through speakers: a sustained harmonic tone with a
 * small broadband noise bed (cabinet / room coloration).
 */
export function synthSpeaker(fundamental, sampleRate, seconds = 0.6, options = {}) {
  const { amplitude = 0.34, noise = 0.008, seed = 13, harmonics = SPEAKER_HARMONICS } = options
  const tone = synthHarmonicTone(fundamental, harmonics, sampleRate, seconds)
  const totalAmplitude = harmonics.reduce((sum, part) => sum + part.amplitude, 0) || 1
  const out = new Float32Array(tone.length)
  let state = seed >>> 0
  for (let index = 0; index < tone.length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    const hiss = ((state / 0xffffffff) * 2 - 1) * noise
    out[index] = (tone[index] * amplitude) / totalAmplitude + hiss
  }
  return out
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
    case 'pluck': {
      const fundamental = spec.frequency ?? midiToFrequency(spec.midi ?? 55)
      return synthPluck(fundamental, sampleRate, seconds, spec)
    }
    case 'distorted': {
      const fundamental = spec.frequency ?? midiToFrequency(spec.midi ?? 52)
      return synthDistorted(fundamental, sampleRate, seconds, spec)
    }
    case 'speaker': {
      const fundamental = spec.frequency ?? midiToFrequency(spec.midi ?? 60)
      return synthSpeaker(fundamental, sampleRate, seconds, spec)
    }
    case 'silence':
      return synthSilence(sampleRate, seconds)
    case 'noise':
      return synthWhiteNoise(sampleRate, seconds, spec.seed ?? 7)
    default:
      throw new Error(`Unknown synthetic clip type: ${spec.type}`)
  }
}

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
 * Voiced talking: glottal (sawtooth-like) source with prosody drift + per-cycle
 * jitter, filtered through vowel formant resonators, under a syllable-rate
 * amplitude envelope. The adversarial mic fixture — speech near a target note
 * must never advance Wait For You.
 */
export function synthSpeech(sampleRate, seconds = 1.6, options = {}) {
  const {
    f0 = 145,
    driftSemitones = 3,
    jitterCents = 18,
    syllableHz = 3.6,
    amplitude = 0.3,
    formants = [
      { frequency: 700, bandwidth: 110, gain: 1 },
      { frequency: 1220, bandwidth: 140, gain: 0.7 },
      { frequency: 2600, bandwidth: 220, gain: 0.25 },
    ],
    seed = 91,
  } = options

  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const source = new Float32Array(length)
  let state = seed >>> 0
  const rand = () => {
    state = (state * 1103515245 + 12345) >>> 0
    return state / 0xffffffff
  }

  let phase = 0
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate
    const drift = 2 ** ((driftSemitones * Math.sin(2 * Math.PI * 0.9 * t + 0.7)) / 12)
    const jitter = 2 ** (((rand() - 0.5) * 2 * (jitterCents / 100)) / 12)
    phase += (f0 * drift * jitter) / sampleRate
    if (phase >= 1) {
      phase -= 1
    }
    source[index] = (2 * phase - 1) * 0.5 + (rand() - 0.5) * 0.02
  }

  const out = new Float32Array(length)
  for (const { frequency, bandwidth, gain } of formants) {
    const r = Math.exp((-Math.PI * bandwidth) / sampleRate)
    const theta = (2 * Math.PI * frequency) / sampleRate
    const a1 = -2 * r * Math.cos(theta)
    const a2 = r * r
    let y1 = 0
    let y2 = 0
    for (let index = 0; index < length; index += 1) {
      const y = source[index] - a1 * y1 - a2 * y2
      out[index] += y * gain * (1 - r)
      y2 = y1
      y1 = y
    }
  }

  let peak = 0
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate
    out[index] *= 0.55 + 0.45 * Math.sin(2 * Math.PI * syllableHz * t)
    peak = Math.max(peak, Math.abs(out[index]))
  }
  if (peak > 0) {
    for (let index = 0; index < length; index += 1) {
      out[index] = (out[index] / peak) * amplitude
    }
  }
  return out
}

const ELECTRIC_AMP_H2_HARMONICS = [
  { multiple: 1, amplitude: 0.08 },
  { multiple: 2, amplitude: 0.32 },
  { multiple: 3, amplitude: 0.18 },
  { multiple: 4, amplitude: 0.08 },
]

const ELECTRIC_AMP_H3_HARMONICS = [
  { multiple: 1, amplitude: 0.06 },
  { multiple: 2, amplitude: 0.14 },
  { multiple: 3, amplitude: 0.35 },
  { multiple: 4, amplitude: 0.12 },
]

const ELECTRIC_CLEAN_SUSTAIN_HARMONICS = [
  { multiple: 1, amplitude: 0.35 },
  { multiple: 2, amplitude: 0.22 },
  { multiple: 3, amplitude: 0.12 },
  { multiple: 4, amplitude: 0.06 },
]

/**
 * Clean electric through an amp/speaker: weak fundamental with h2 or h3
 * dominating — the mic path that fails when treated like acoustic guitar.
 */
export function synthElectricAmp(fundamental, sampleRate, seconds = 0.8, options = {}) {
  const {
    amplitude = 0.34,
    noise = 0.008,
    seed = 77,
    profile = 'h2-strong',
    harmonics = profile === 'h3-strong' ? ELECTRIC_AMP_H3_HARMONICS : ELECTRIC_AMP_H2_HARMONICS,
  } = options
  return synthSpeaker(fundamental, sampleRate, seconds, { amplitude, noise, seed, harmonics })
}

/** Sustained clean electric tone (neck pickup / clean channel). */
export function synthElectricClean(fundamental, sampleRate, seconds = 0.8, options = {}) {
  const { amplitude = 0.3, harmonics = ELECTRIC_CLEAN_SUSTAIN_HARMONICS } = options
  const tone = synthHarmonicTone(fundamental, harmonics, sampleRate, seconds)
  const totalAmplitude = harmonics.reduce((sum, part) => sum + part.amplitude, 0) || 1
  const out = new Float32Array(tone.length)
  for (let index = 0; index < tone.length; index += 1) {
    out[index] = (tone[index] * amplitude) / totalAmplitude
  }
  return out
}

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
    case 'electric-amp': {
      const fundamental = spec.frequency ?? midiToFrequency(spec.midi ?? 57)
      return synthElectricAmp(fundamental, sampleRate, seconds, spec)
    }
    case 'electric-clean': {
      const fundamental = spec.frequency ?? midiToFrequency(spec.midi ?? 57)
      return synthElectricClean(fundamental, sampleRate, seconds, spec)
    }
    case 'silence':
      return synthSilence(sampleRate, seconds)
    case 'noise':
      return synthWhiteNoise(sampleRate, seconds, spec.seed ?? 7)
    case 'speech':
      return synthSpeech(sampleRate, seconds, spec)
    default:
      throw new Error(`Unknown synthetic clip type: ${spec.type}`)
  }
}

/**
 * Deterministic synthetic chord clips for polyphonic mic measurement.
 * Offline only — not used in the live browser mic path.
 */

import { midiToFrequency, synthSilence, synthWhiteNoise, synthDistorted, synthHarmonicTone } from './micSyntheticClips.js'

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function synthPianoPartial(midi, sampleIndex, sampleRate, time, amplitude = 0.22) {
  const f0 = midiToFrequency(midi)
  const attack = 1 - Math.exp(-time * 22)
  const decay = Math.exp(-time * 0.9)
  let tone = 0
  for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
    const frequency = f0 * harmonic * (1 + 0.0007 * harmonic * harmonic)
    tone += Math.sin((2 * Math.PI * frequency * sampleIndex) / sampleRate) * (0.5 / harmonic)
  }
  return tone * attack * decay * amplitude
}

/**
 * @param {number[]} midis
 * @param {number} sampleRate
 * @param {{ seconds?: number, amplitude?: number, seed?: number }} options
 */
export function synthSimultaneousChord(midis, sampleRate, options = {}) {
  const seconds = options.seconds ?? 1.6
  const amplitude = options.amplitude ?? 0.28
  const seed = options.seed ?? 1
  const rng = mulberry32(seed)
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const buffer = new Float32Array(length)

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate
    let sample = 0
    for (const midi of midis) {
      sample += synthPianoPartial(midi, index, sampleRate, time, amplitude / midis.length)
    }
    buffer[index] = sample + (rng() * 2 - 1) * 0.003
  }

  return buffer
}

/**
 * Rolled chord: each MIDI enters with `staggerMs` delay.
 */
export function synthRolledChord(midis, sampleRate, options = {}) {
  const seconds = options.seconds ?? 2
  const staggerMs = options.staggerMs ?? 80
  const amplitude = options.amplitude ?? 0.28
  const seed = options.seed ?? 2
  const rng = mulberry32(seed)
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const buffer = new Float32Array(length)
  const staggerSamples = Math.floor((staggerMs / 1000) * sampleRate)

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate
    let sample = 0
    for (let voice = 0; voice < midis.length; voice += 1) {
      const start = voice * staggerSamples
      if (index < start) {
        continue
      }
      const voiceTime = (index - start) / sampleRate
      sample += synthPianoPartial(midis[voice], index, sampleRate, voiceTime, amplitude / midis.length)
    }
    buffer[index] = sample + (rng() * 2 - 1) * 0.003
  }

  return buffer
}

/**
 * Clean or distorted electric guitar chord mix (deterministic adversarial fixture).
 */
export function synthElectricChord(midis, sampleRate, options = {}) {
  const seconds = options.seconds ?? 1.7
  const amplitude = options.amplitude ?? 0.28
  const mode = options.mode === 'distorted' ? 'distorted' : 'clean'
  const seed = options.seed ?? 11
  const rng = mulberry32(seed)
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const buffer = new Float32Array(length)
  const perVoice = amplitude / Math.max(1, midis.length)

  for (const midi of midis) {
    const f0 = midiToFrequency(midi)
    let voice
    if (mode === 'distorted') {
      voice = synthDistorted(f0, sampleRate, seconds, { amplitude: perVoice, drive: 3.8 })
    } else {
      voice = synthHarmonicTone(
        f0,
        [
          { multiple: 1, amplitude: 0.55 },
          { multiple: 2, amplitude: 0.28 },
          { multiple: 3, amplitude: 0.14 },
          { multiple: 4, amplitude: 0.08 },
        ],
        sampleRate,
        seconds,
      )
      for (let index = 0; index < voice.length; index += 1) {
        voice[index] *= perVoice
      }
    }
    for (let index = 0; index < length; index += 1) {
      buffer[index] += voice[index] ?? 0
    }
  }

  for (let index = 0; index < length; index += 1) {
    buffer[index] += (rng() * 2 - 1) * (mode === 'distorted' ? 0.006 : 0.003)
  }
  return buffer
}

export const MIC_POLYPHONY_CHORD_TYPES = {
  SIMULTANEOUS: 'simultaneous',
  ROLLED: 'rolled',
  SPLIT_REGISTER: 'split-register',
}

/**
 * @param {{ type: string, midis?: number[], seconds?: number, staggerMs?: number, amplitude?: number, seed?: number, mode?: string }} spec
 */
export function renderSyntheticChordClip(spec, sampleRate = 44100) {
  const midis = [...(spec.midis ?? [])].sort((a, b) => a - b)
  switch (spec.type) {
    case 'chord-simultaneous':
      return synthSimultaneousChord(midis, sampleRate, spec)
    case 'chord-rolled':
      return synthRolledChord(midis, sampleRate, spec)
    case 'chord-electric':
      return synthElectricChord(midis, sampleRate, spec)
    case 'silence':
      return synthSilence(sampleRate, spec.seconds ?? 0.8)
    case 'noise':
      return synthWhiteNoise(sampleRate, spec.seconds ?? 0.8, spec.seed ?? 7)
    default:
      throw new Error(`Unknown synthetic chord clip type: ${spec.type}`)
  }
}

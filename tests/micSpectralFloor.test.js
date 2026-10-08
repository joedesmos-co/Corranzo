/**
 * Spectral noise-floor absolute minimum (real-data fix 2026-10-07).
 *
 * Real DAT silence (rms 0.00013) collapsed the old 1e-7 floor to 9.8e-6 and
 * the blind-range scorer hallucinated 16 phantom notes. Magnitudes below
 * ~0.8 LSB of 16-bit full scale are converter residue, not room tone.
 */
import { describe, expect, it } from 'vitest'
import {
  estimateNoiseFloor,
  SPECTRAL_NOISE_FLOOR_ABSOLUTE_MIN,
} from '../src/features/microphone-input/v2/micSpectralAnalysis.js'
import { scoreBlindPianoRange } from '../src/features/microphone-input/v2/scoreInformedChordScorer.js'

function lowLevelNoise(length = 2048, amplitude = 0.0002, seed = 11) {
  let state = seed
  const out = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    out[index] = ((state / 0xffffffff) * 2 - 1) * amplitude
  }
  return out
}

describe('spectral noise floor', () => {
  it('never believes sub-LSB residue on near-silent input', () => {
    const samples = lowLevelNoise()
    const floor = estimateNoiseFloor(samples, 44100, { expectedMidis: [] })
    expect(floor).toBeGreaterThanOrEqual(SPECTRAL_NOISE_FLOOR_ABSOLUTE_MIN)
  })

  it('finds no phantom notes in real-silence-level residue', () => {
    const samples = lowLevelNoise(2048, 0.00013, 5)
    const notes = scoreBlindPianoRange(samples, 44100, {})
    expect(notes.filter((note) => note.detected)).toEqual([])
  })

  it('still hears a genuine quiet note far above the minimum', () => {
    const samples = lowLevelNoise(2048, 0.00013, 5)
    // Add a quiet 220 Hz tone (~0.01 RMS, like the verified quiet fixture).
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] += 0.014 * Math.sin((2 * Math.PI * 220 * index) / 44100)
    }
    const notes = scoreBlindPianoRange(samples, 44100, {})
    const detected = notes.filter((note) => note.detected).map((note) => note.midi)
    expect(detected).toContain(57)
  })
})

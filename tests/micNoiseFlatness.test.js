/**
 * Spectral-flatness noise gate (Step 5): pure unit tests.
 */
import { describe, expect, it } from 'vitest'
import {
  FLATNESS_MIN_HZ,
  FLATNESS_SKIP_FRAMES,
  FLATNESS_SKIP_THRESHOLD,
  spectralFlatnessFromDb,
  shouldSkipFlatNoise,
} from '../src/features/microphone-input/micNoiseFlatness.js'

function flatDb(binCount, binWidthHz) {
  // Pure broadband noise: equal power per bin -> flatness ~1.
  const bins = new Float32Array(binCount)
  bins.fill(-40)
  return bins
}

function peakyDb(binCount, binWidthHz, peaksHz = [261.6, 523.2, 784.9]) {
  const bins = new Float32Array(binCount)
  bins.fill(-80)
  for (const hz of peaksHz) {
    const bin = Math.round(hz / binWidthHz)
    if (bin < binCount) {
      bins[bin] = -10
    }
  }
  return bins
}

describe('micNoiseFlatness', () => {
  const binCount = 1024
  const binWidthHz = 44100 / 2048

  it('scores broadband noise as flat and harmonic spectra as peaky', () => {
    const noise = spectralFlatnessFromDb(flatDb(binCount, binWidthHz), binWidthHz)
    const music = spectralFlatnessFromDb(peakyDb(binCount, binWidthHz), binWidthHz)
    expect(noise).toBeGreaterThan(FLATNESS_SKIP_THRESHOLD)
    expect(music).toBeLessThan(0.05)
  })

  it('excludes sub-minHz bins (rumble is not evidence)', () => {
    const bins = new Float32Array(binCount)
    bins.fill(-80)
    for (let bin = 0; bin < Math.ceil(FLATNESS_MIN_HZ / binWidthHz); bin += 1) {
      bins[bin] = 0
    }
    expect(spectralFlatnessFromDb(bins, binWidthHz)).toBe(0)
  })

  it('returns 0 (not flat) on silence and degenerate spectra', () => {
    const silent = new Float32Array(binCount).fill(-Infinity)
    expect(spectralFlatnessFromDb(silent, binWidthHz)).toBe(0)
    // Analyser floor reporting (-100 dB on every bin) is silence too.
    expect(spectralFlatnessFromDb(new Float32Array(binCount).fill(-100), binWidthHz)).toBe(0)
    expect(spectralFlatnessFromDb(new Float32Array(4), binWidthHz)).toBe(0)
    expect(spectralFlatnessFromDb(null, binWidthHz)).toBe(0)
    expect(spectralFlatnessFromDb(new Float32Array(binCount).fill(-40), 0)).toBe(0)
  })

  it('skips inference only when the whole tail is flat (fail-open)', () => {
    const flatTail = [0.55, 0.55, 0.55, 0.55, 0.55]
    expect(shouldSkipFlatNoise(flatTail, FLATNESS_SKIP_THRESHOLD, FLATNESS_SKIP_FRAMES)).toBe(true)
    // One peaky frame (an attack) re-arms immediately: never gated.
    const attack = [0.55, 0.55, 0.55, 0.55, 0.002]
    expect(shouldSkipFlatNoise(attack, FLATNESS_SKIP_THRESHOLD, FLATNESS_SKIP_FRAMES)).toBe(false)
    // Too little history: run the old behavior.
    expect(shouldSkipFlatNoise([0.55], FLATNESS_SKIP_THRESHOLD, FLATNESS_SKIP_FRAMES)).toBe(false)
    // Music mixed with noise below the threshold: old behavior (fail-open).
    expect(shouldSkipFlatNoise([0.44, 0.44, 0.44, 0.44, 0.44], FLATNESS_SKIP_THRESHOLD, FLATNESS_SKIP_FRAMES)).toBe(false)
  })

  it('ignores non-finite readings instead of trusting them', () => {
    expect(shouldSkipFlatNoise([0.55, 0.55, NaN, 0.55, 0.55], FLATNESS_SKIP_THRESHOLD, FLATNESS_SKIP_FRAMES)).toBe(false)
  })
})

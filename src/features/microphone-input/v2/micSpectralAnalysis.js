/**
 * Mic Engine V2 — browser-safe spectral helpers (offline prototype).
 * Goertzel + Hann windowing; no WASM or live mic dependencies.
 */

import { midiToFrequency } from '../micSyntheticClips.js'

export const DEFAULT_FFT_SIZE = 2048

export function hannWindow(length) {
  const window = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / Math.max(1, length - 1)))
  }
  return window
}

export function applyWindow(samples, window) {
  const length = Math.min(samples.length, window.length)
  const out = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    out[index] = samples[index] * window[index]
  }
  return out
}

export function windowRms(samples) {
  if (!samples?.length) {
    return 0
  }
  let sumSq = 0
  for (let index = 0; index < samples.length; index += 1) {
    sumSq += samples[index] * samples[index]
  }
  return Math.sqrt(sumSq / samples.length)
}

/**
 * Goertzel magnitude at a single frequency (normalized by window length).
 */
export function goertzelMagnitude(samples, sampleRate, targetHz) {
  if (!samples?.length || !sampleRate || !targetHz) {
    return 0
  }
  const omega = (2 * Math.PI * targetHz) / sampleRate
  const coeff = 2 * Math.cos(omega)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  for (let index = 0; index < samples.length; index += 1) {
    s0 = samples[index] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  return Math.sqrt(Math.max(0, power)) / samples.length
}

/**
 * Median probe energy at off-chord MIDI anchors — noise-floor estimate.
 * Probes avoid expected fundamentals and their low harmonics.
 */
export function estimateNoiseFloor(samples, sampleRate, { expectedMidis = [], probeMidis = null } = {}) {
  const expectedSet = new Set(expectedMidis ?? [])
  const blockedHz = new Set()
  for (const midi of expectedSet) {
    const f0 = midiToFrequency(midi)
    for (let harmonic = 1; harmonic <= 8; harmonic += 1) {
      blockedHz.add(Math.round(f0 * harmonic))
    }
  }

  const defaultProbes = []
  for (let midi = 36; midi <= 96; midi += 1) {
    if (!expectedSet.has(midi)) {
      defaultProbes.push(midi)
    }
  }
  const probes = probeMidis ?? defaultProbes
  const energies = []
  for (const midi of probes) {
    const hz = Math.round(midiToFrequency(midi))
    if (blockedHz.has(hz)) {
      continue
    }
    energies.push(goertzelMagnitude(samples, sampleRate, midiToFrequency(midi)))
  }
  energies.sort((left, right) => left - right)
  const p25 = energies.length ? energies[Math.floor(energies.length * 0.25)] : 0
  const rms = windowRms(samples)
  return Math.max(p25, rms * 0.12, 1e-7)
}

/**
 * Radix-2 Cooley–Tukey FFT magnitude spectrum (offline diagnostic).
 * Returns linear magnitude bins 0..N/2 for real input.
 */
export function computeMagnitudeSpectrum(samples) {
  const length = samples.length
  if (length < 2 || (length & (length - 1)) !== 0) {
    throw new Error('FFT length must be a power of 2')
  }

  const real = new Float32Array(length)
  const imag = new Float32Array(length)
  real.set(samples)

  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1
    for (; j & bit; bit >>= 1) {
      j ^= bit
    }
    j ^= bit
    if (i < j) {
      const temp = real[i]
      real[i] = real[j]
      real[j] = temp
    }
  }

  for (let size = 2; size <= length; size <<= 1) {
    const half = size >> 1
    const angle = (-2 * Math.PI) / size
    const wStepReal = Math.cos(angle)
    const wStepImag = Math.sin(angle)
    for (let start = 0; start < length; start += size) {
      let wReal = 1
      let wImag = 0
      for (let offset = 0; offset < half; offset += 1) {
        const left = start + offset
        const right = left + half
        const tReal = wReal * real[right] - wImag * imag[right]
        const tImag = wReal * imag[right] + wImag * real[right]
        real[right] = real[left] - tReal
        imag[right] = imag[left] - tImag
        real[left] += tReal
        imag[left] += tImag
        const nextWReal = wReal * wStepReal - wImag * wStepImag
        wImag = wReal * wStepImag + wImag * wStepReal
        wReal = nextWReal
      }
    }
  }

  const halfBins = (length >> 1) + 1
  const magnitudes = new Float32Array(halfBins)
  for (let bin = 0; bin < halfBins; bin += 1) {
    magnitudes[bin] = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]) / length
  }
  return magnitudes
}

export function binFrequency(bin, sampleRate, fftSize) {
  return (bin * sampleRate) / fftSize
}

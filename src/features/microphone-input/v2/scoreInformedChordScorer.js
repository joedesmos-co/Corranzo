/**
 * Mic Engine V2 Phase 2 — score-informed chord scorer (offline prototype).
 *
 * At each analysis window, scores energy at expected fundamentals + harmonics.
 * Does not modify live Wait For You or V1 pitch detection.
 */

import { midiToFrequency } from '../micSyntheticClips.js'
import {
  applyWindow,
  DEFAULT_FFT_SIZE,
  estimateNoiseFloor,
  goertzelMagnitude,
  hannWindow,
} from './micSpectralAnalysis.js'

export const SCORE_INFORMED_DEFAULTS = {
  fftSize: DEFAULT_FFT_SIZE,
  frameHopMs: 1000 / 60,
  harmonicCount: 6,
  detectionRatio: 1.35,
  minConfidence: 0.28,
  relativeEnergyFloor: 0.38,
  dyadRelativeEnergyFloor: 0.26,
  triadRelativeEnergyFloor: 0.32,
  bassMidiThreshold: 60,
  bassBoost: 1.4,
  bassFundamentalWeight: 1.65,
  stableFrameThreshold: 2,
  blindProbeMidiMin: 48,
  blindProbeMidiMax: 84,
  scorerVersion: 'phase-2b',
}

function adaptiveHarmonicWeight(harmonic, midi) {
  const isBass = midi < SCORE_INFORMED_DEFAULTS.bassMidiThreshold
  if (harmonic === 1) {
    return isBass ? SCORE_INFORMED_DEFAULTS.bassFundamentalWeight : 1.15
  }
  return (1 / harmonic) * (isBass ? 0.85 : 1)
}

function relativeEnergyFloorForChord(expectedCount, options = {}) {
  if (expectedCount <= 2) {
    return options.dyadRelativeEnergyFloor ?? SCORE_INFORMED_DEFAULTS.dyadRelativeEnergyFloor
  }
  if (expectedCount === 3) {
    return options.triadRelativeEnergyFloor ?? SCORE_INFORMED_DEFAULTS.triadRelativeEnergyFloor
  }
  return options.relativeEnergyFloor ?? SCORE_INFORMED_DEFAULTS.relativeEnergyFloor
}

function ratioToConfidence(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0
  }
  const logRatio = Math.log10(ratio)
  return Math.min(1, Math.max(0, (logRatio + 0.05) / 0.85))
}

/**
 * Score one expected MIDI in a window using harmonic Goertzel energy.
 */
export function scoreExpectedNote(samples, sampleRate, midi, options = {}) {
  const harmonicCount = options.harmonicCount ?? SCORE_INFORMED_DEFAULTS.harmonicCount
  const noiseFloor =
    options.noiseFloor ??
    estimateNoiseFloor(samples, sampleRate, { expectedMidis: options.expectedMidis ?? [midi] })
  const f0 = midiToFrequency(midi)
  const isBass = midi < (options.bassMidiThreshold ?? SCORE_INFORMED_DEFAULTS.bassMidiThreshold)

  let harmonicEnergy = 0
  let weightSum = 0
  const harmonicMagnitudes = []

  for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
    const weight = adaptiveHarmonicWeight(harmonic, midi)
    const magnitude = goertzelMagnitude(samples, sampleRate, f0 * harmonic)
    harmonicMagnitudes.push(magnitude)
    harmonicEnergy += magnitude * weight
    weightSum += weight
  }

  const fundamentalEnergy = harmonicMagnitudes[0] ?? 0
  const weightedMean = weightSum > 0 ? harmonicEnergy / weightSum : 0
  const harmonicSupport =
    fundamentalEnergy > 0
      ? (weightedMean - fundamentalEnergy * 0.12) / (fundamentalEnergy + 1e-8)
      : 0

  const bassBoost = isBass ? (options.bassBoost ?? SCORE_INFORMED_DEFAULTS.bassBoost) : 1
  const signal = (weightedMean + fundamentalEnergy * 0.28) * bassBoost
  const ratio = signal / (noiseFloor + 1e-8)
  const confidence = ratioToConfidence(ratio)
  const detectionRatio = options.detectionRatio ?? SCORE_INFORMED_DEFAULTS.detectionRatio
  const minConfidence = options.minConfidence ?? SCORE_INFORMED_DEFAULTS.minConfidence
  const detected = ratio >= detectionRatio && confidence >= minConfidence

  return {
    midi,
    detected,
    confidence,
    ratio,
    noiseFloor,
    fundamentalEnergy,
    harmonicEnergy: weightedMean,
    harmonicSupport,
    harmonicMagnitudes,
    isBass,
    bassBoosted: isBass,
  }
}

/**
 * Score all expected notes in one window.
 */
export function scoreInformedChordWindow(samples, sampleRate, expectedMidis = [], options = {}) {
  const fftSize = options.fftSize ?? SCORE_INFORMED_DEFAULTS.fftSize
  const window = options.window ?? hannWindow(fftSize)
  const trimmed =
    samples.length >= fftSize ? samples.subarray(samples.length - fftSize) : samples
  const windowed = applyWindow(trimmed, window)
  const noiseFloor = estimateNoiseFloor(windowed, sampleRate, { expectedMidis })

  const notes = (expectedMidis ?? []).map((midi) =>
    scoreExpectedNote(windowed, sampleRate, midi, {
      ...options,
      expectedMidis,
      noiseFloor,
    }),
  )

  const peakEnergy = notes.reduce((max, note) => Math.max(max, note.harmonicEnergy), 0)
  const relativeFloor = relativeEnergyFloorForChord(expectedMidis.length, options)
  const peerMedian =
    notes.length > 0
      ? [...notes].sort((left, right) => left.harmonicEnergy - right.harmonicEnergy)[
          Math.floor(notes.length / 2)
        ].harmonicEnergy
      : 0

  for (const note of notes) {
    const relativeEnergy = peakEnergy > 0 ? note.harmonicEnergy / peakEnergy : 0
    const peerRelative = peerMedian > 0 ? note.harmonicEnergy / peerMedian : 0
    note.relativeEnergy = relativeEnergy
    note.peerRelative = peerRelative
    const bassRelief = note.isBass ? 0.06 : 0
    note.detected =
      note.ratio >= (options.detectionRatio ?? SCORE_INFORMED_DEFAULTS.detectionRatio) &&
      note.confidence >= (options.minConfidence ?? SCORE_INFORMED_DEFAULTS.minConfidence) &&
      (relativeEnergy >= relativeFloor - bassRelief || peerRelative >= 0.72)
  }

  const detectedMidis = notes.filter((note) => note.detected).map((note) => note.midi)
  const meanConfidence = notes.length
    ? notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length
    : 0

  return {
    notes,
    detectedMidis,
    noiseFloor,
    meanConfidence,
    chordDetected:
      expectedMidis.length > 0 &&
      detectedMidis.length === expectedMidis.length &&
      expectedMidis.every((midi) => detectedMidis.includes(midi)),
  }
}

/**
 * Blind piano-range scan for silence/noise false-positive measurement.
 */
export function scoreBlindPianoRange(samples, sampleRate, options = {}) {
  const fftSize = options.fftSize ?? SCORE_INFORMED_DEFAULTS.fftSize
  const window = options.window ?? hannWindow(fftSize)
  const trimmed =
    samples.length >= fftSize ? samples.subarray(samples.length - fftSize) : samples
  const windowed = applyWindow(trimmed, window)
  const minMidi = options.blindProbeMidiMin ?? SCORE_INFORMED_DEFAULTS.blindProbeMidiMin
  const maxMidi = options.blindProbeMidiMax ?? SCORE_INFORMED_DEFAULTS.blindProbeMidiMax

  const notes = []
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const scored = scoreExpectedNote(windowed, sampleRate, midi, options)
    if (scored.detected) {
      notes.push(scored)
    }
  }
  return notes
}

/**
 * Blind polyphonic pitch detector (Stage 2, S3) — EXPERIMENTAL, flagged OFF.
 *
 * Estimates simultaneous pitches WITHOUT knowing the expected score notes:
 *
 *   FFT magnitude spectrum → spectral peak picking → MIDI candidates →
 *   Goertzel harmonic-family scoring per candidate → overtone suppression
 *
 * Architecture notes (browser/mobile appropriate, no neural model):
 * - One 2048-point FFT per window (N log N) prunes the search; expensive
 *   Goertzel harmonic families run only on spectrum-peak candidates (≤12),
 *   not on all 88 keys. Live cost ≈ FFT + ~12×5 Goertzel passes per window.
 * - A candidate is accepted ONLY on its own acoustic evidence: its
 *   fundamental must clear the blind noise floor AND its harmonic family
 *   must support it. The score-informed scorer is never consulted here, so
 *   this detector cannot manufacture an expected note.
 * - Harmonic overtones are suppressed explicitly: a candidate whose
 *   fundamental is an integer multiple of an accepted stronger fundamental
 *   (and whose energy is explained by that partial) is marked
 *   overtone-suppressed, never reported as played.
 *
 * Band: 50–1400 Hz, mirroring the live autocorrelation tracker's resolvable
 * band. Extreme registers stay on the V2 deep-bass / high-octave guards.
 *
 * Pure + offline-capable: Float32Array in, candidates out. No audio APIs.
 */

import { midiToFrequency } from '../micSyntheticClips.js'
import {
  createChordGroupingState,
  flushChordGrouping,
  pushChordGroupingFrame,
} from '../micChordGrouping.js'
import {
  applyWindow,
  computeMagnitudeSpectrum,
  DEFAULT_FFT_SIZE,
  estimateNoiseFloor,
  goertzelMagnitude,
  hannWindow,
  windowRms,
} from './micSpectralAnalysis.js'

export const BLIND_POLY_ENGINE_ID = 'blind-poly-v1'

export const BLIND_POLY_DEFAULTS = {
  fftSize: DEFAULT_FFT_SIZE,
  minHz: 50,
  maxHz: 1400,
  maxSpectrumPeaks: 12,
  /** A spectrum peak must reach this fraction of the spectral max. */
  peakRelativeFloor: 0.12,
  harmonicCount: 5,
  /** Family signal / noise floor required for independent acceptance. */
  minRatio: 1.6,
  minConfidence: 0.3,
  /** Fundamental must clear the noise floor by this factor (anti-manufacture). */
  fundamentalFloorFactor: 1.2,
  overtoneCents: 40,
  /** Candidate fundamental explained by a stronger partial → overtone. */
  overtoneMargin: 0.9,
  minMidi: 21,
  maxMidi: 108,
}

function frequencyToFloatMidi(frequency) {
  return 69 + 12 * Math.log2(frequency / 440)
}

function ratioToConfidence(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0
  }
  const logRatio = Math.log10(ratio)
  return Math.min(1, Math.max(0, (logRatio + 0.05) / 0.85))
}

function pickSpectrumPeaks(magnitudes, sampleRate, fftSize, options) {
  const { minHz, maxHz, maxSpectrumPeaks, peakRelativeFloor } = options
  const binHz = sampleRate / fftSize
  const minBin = Math.max(1, Math.floor(minHz / binHz))
  const maxBin = Math.min(magnitudes.length - 2, Math.ceil(maxHz / binHz))
  let maxMag = 0
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (magnitudes[bin] > maxMag) {
      maxMag = magnitudes[bin]
    }
  }
  if (!(maxMag > 0)) {
    return []
  }
  const peaks = []
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const mag = magnitudes[bin]
    if (mag < maxMag * peakRelativeFloor) {
      continue
    }
    if (mag >= magnitudes[bin - 1] && mag >= magnitudes[bin + 1]) {
      peaks.push({ bin, frequency: bin * binHz, magnitude: mag })
    }
  }
  peaks.sort((left, right) => right.magnitude - left.magnitude)
  return peaks.slice(0, maxSpectrumPeaks)
}

/**
 * Score one blind candidate's harmonic family with Goertzel magnitudes.
 */
export function scoreBlindCandidate(windowed, sampleRate, midiFloat, noiseFloor, options = {}) {
  const harmonicCount = options.harmonicCount ?? BLIND_POLY_DEFAULTS.harmonicCount
  const midi = Math.round(midiFloat)
  const f0 = midiToFrequency(midi)
  let harmonicEnergy = 0
  let weightSum = 0
  const harmonicMagnitudes = []
  for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
    const targetHz = f0 * harmonic
    const weight = 1 / harmonic
    if (targetHz >= sampleRate / 2) {
      harmonicMagnitudes.push(0)
      continue
    }
    const magnitude = goertzelMagnitude(windowed, sampleRate, targetHz)
    harmonicMagnitudes.push(magnitude)
    harmonicEnergy += magnitude * weight
    weightSum += weight
  }
  const fundamentalEnergy = harmonicMagnitudes[0] ?? 0
  const weightedMean = weightSum > 0 ? harmonicEnergy / weightSum : 0
  const harmonicSupport = fundamentalEnergy > 0 ? weightedMean / (fundamentalEnergy + 1e-8) : 0
  const signal = weightedMean + fundamentalEnergy * 0.28
  const ratio = signal / (noiseFloor + 1e-8)
  return {
    midi,
    midiFloat,
    frequency: f0,
    confidence: ratioToConfidence(ratio),
    ratio,
    fundamentalEnergy,
    harmonicEnergy: weightedMean,
    harmonicSupport,
    harmonicMagnitudes,
  }
}

function centsBetween(observedHz, expectedHz) {
  if (!(observedHz > 0) || !(expectedHz > 0)) {
    return Infinity
  }
  return Math.abs(1200 * Math.log2(observedHz / expectedHz))
}

/**
 * Detect simultaneous pitches in one window without score knowledge.
 *
 * @returns {{ engine, noiseFloor, peakCount, candidates, detectedMidis }}
 * candidates are sorted by confidence desc; each carries
 * { midi, midiFloat, detected, confidence, ratio, fundamentalEnergy,
 *   harmonicEnergy, harmonicSupport, overtoneOf }
 */
export function detectBlindPolyphony(samples, sampleRate, options = {}) {
  const config = { ...BLIND_POLY_DEFAULTS, ...options }
  const fftSize = config.fftSize ?? DEFAULT_FFT_SIZE
  if (!samples?.length || !sampleRate) {
    return { engine: BLIND_POLY_ENGINE_ID, noiseFloor: 0, peakCount: 0, candidates: [], detectedMidis: [] }
  }
  const slice = samples.length >= fftSize ? samples.subarray(samples.length - fftSize) : samples
  if (slice.length < 256) {
    return { engine: BLIND_POLY_ENGINE_ID, noiseFloor: 0, peakCount: 0, candidates: [], detectedMidis: [] }
  }
  const window = config.window ?? hannWindow(slice.length)
  const windowed = applyWindow(slice, window)
  const rms = windowRms(windowed)
  if (rms < 0.004) {
    return { engine: BLIND_POLY_ENGINE_ID, noiseFloor: rms, peakCount: 0, candidates: [], detectedMidis: [] }
  }

  const noiseFloor = estimateNoiseFloor(windowed, sampleRate, { expectedMidis: [] })
  let spectrum
  try {
    // FFT requires power-of-2; fall back to a truncated power-of-2 window.
    let fftLength = 1
    while (fftLength * 2 <= windowed.length) {
      fftLength *= 2
    }
    spectrum = computeMagnitudeSpectrum(windowed.subarray(0, fftLength))
  } catch {
    return { engine: BLIND_POLY_ENGINE_ID, noiseFloor, peakCount: 0, candidates: [], detectedMidis: [] }
  }
  const peaks = pickSpectrumPeaks(spectrum, sampleRate, spectrum.length > 1 ? (spectrum.length - 1) * 2 : fftSize, config)

  // Peak frequency → integer MIDI candidates (deduped). The FFT bin grid
  // (~21.5 Hz at 2048/44.1k) is coarser than a semitone in the low-mid
  // register, so a peak between bins can round to the WRONG neighbor
  // (measured: B3 straddling bins rounded to Bb3 and was lost). Score the
  // rounded peak AND its semitone neighbors — the harmonic-family scorer,
  // not the peak grid, decides which pitch has real support. Candidates
  // whose own fundamental lies outside the resolvable band are skipped
  // (measured: sub-50 Hz room rumble rounded up into F#1/G1 ghosts).
  //
  // Exhaustive mode (Stage 4 P2): skip peak pruning and score every MIDI
  // in range. Measured 2026-10-07 on real piano dense harmony: masked
  // fundamentals are not spectrum local maxima at all, so no peak floor
  // can reveal them — only family scoring finds them. Brute force costs
  // ~88×5 Goertzel passes (≈1 ms/window, affordable); the acceptance
  // guards (ratio, fundamental floor, overtone, adjacent) are unchanged,
  // so widening the net cannot manufacture evidence-free notes.
  const seenMidis = new Set()
  const midiFloats = []
  if (config.exhaustive) {
    for (let midi = config.minMidi; midi <= config.maxMidi; midi += 1) {
      const candidateHz = midiToFrequency(midi)
      if (candidateHz < config.minHz || candidateHz > config.maxHz) {
        continue
      }
      seenMidis.add(midi)
      midiFloats.push(midi)
    }
  } else {
    for (const peak of peaks) {
      const midiFloat = frequencyToFloatMidi(peak.frequency)
      const center = Math.round(midiFloat)
      // Nudge the float so the family scorer targets the neighbor integer.
      for (const midi of [center - 1, center, center + 1]) {
        if (midi < config.minMidi || midi > config.maxMidi || seenMidis.has(midi)) {
          continue
        }
        const candidateHz = midiToFrequency(midi)
        if (candidateHz < config.minHz || candidateHz > config.maxHz) {
          continue
        }
        seenMidis.add(midi)
        midiFloats.push(midiFloat + (midi - center))
      }
    }
  }

  const scored = midiFloats.map((midiFloat) =>
    scoreBlindCandidate(windowed, sampleRate, midiFloat, noiseFloor, config),
  )
  for (const note of scored) {
    note.detected =
      note.ratio >= config.minRatio &&
      note.confidence >= config.minConfidence &&
      note.fundamentalEnergy >= noiseFloor * config.fundamentalFloorFactor
    note.overtoneOf = null
  }

  // Overtone suppression: strongest families first; explain away integer
  // multiples whose fundamental energy is covered by the stronger partial.
  const byStrength = [...scored]
    .filter((note) => note.detected)
    .sort((left, right) => right.harmonicEnergy - left.harmonicEnergy)
  const accepted = []
  for (const note of byStrength) {
    let overtoneOf = null
    for (const strong of accepted) {
      const strongF0 = midiToFrequency(strong.midi)
      for (let harmonic = 2; harmonic <= 6; harmonic += 1) {
        if (centsBetween(note.frequency, strongF0 * harmonic) > config.overtoneCents) {
          continue
        }
        const partialEnergy = strong.harmonicMagnitudes[harmonic - 1] ?? 0
        if (note.fundamentalEnergy <= partialEnergy * config.overtoneMargin + noiseFloor) {
          overtoneOf = strong.midi
          break
        }
      }
      if (overtoneOf != null) {
        break
      }
    }
    if (overtoneOf != null) {
      note.detected = false
      note.overtoneOf = overtoneOf
    } else {
      accepted.push(note)
    }
  }

  // Adjacent-semitone leakage guard: the neighbor candidates scored for one
  // spectrum peak share most of its harmonic energy (Goertzel main lobe is
  // wider than a semitone at 2048 samples), so a strong note drags its
  // ±1–2 semitone neighbors over the bar. Strongest family first: a weaker
  // neighbor survives ONLY when its own fundamental clearly dominates the
  // stronger candidate's fundamental (a true minor-2nd dyad); otherwise it
  // is leakage from the same acoustic source.
  const surviving = []
  for (const note of byStrength) {
    if (!note.detected) {
      continue
    }
    let leakedFrom = null
    for (const strong of surviving) {
      const semitones = Math.abs(note.midi - strong.midi)
      if (semitones === 0 || semitones > 2) {
        continue
      }
      if (note.fundamentalEnergy < strong.fundamentalEnergy * 1.05) {
        leakedFrom = strong.midi
        break
      }
    }
    if (leakedFrom != null) {
      note.detected = false
      note.adjacentSuppressedBy = leakedFrom
    } else {
      surviving.push(note)
    }
  }

  // Known limit (measured 2026-10-07 on a real low electric string):
  // weak-fundamental bass (F2 radiating 0.3× the note-inflated floor) locks
  // onto the 2nd harmonic and reports the octave above. Suboctave
  // reassignment was prototyped and REVERTED: every variant either
  // under-fired on real amp timbre or risked manufacturing octaves in
  // common triads. Low strings stay on the score-informed bass-boost path
  // (V2), which handles them correctly; see the Stage-2 realbench report.
  const detectedMidis = scored
    .filter((note) => note.detected)
    .map((note) => note.midi)
    .sort((left, right) => left - right)
  scored.sort((left, right) => right.confidence - left.confidence)
  return {
    engine: BLIND_POLY_ENGINE_ID,
    noiseFloor,
    peakCount: peaks.length,
    candidates: scored,
    detectedMidis,
  }
}

/**
 * Offline replay helper: run the blind detector across a clip in fixed hops.
 * Returns per-frame detections plus midis stable across enough frames.
 */
export function replayBlindPolyphonySamples(samples, sampleRate, options = {}) {
  const {
    fftSize = BLIND_POLY_DEFAULTS.fftSize,
    frameHopMs = 1000 / 60,
    minStableFrames = 2,
    ...detectorOptions
  } = options
  if (!samples?.length || !sampleRate) {
    return { engine: BLIND_POLY_ENGINE_ID, frames: [], stableMidis: [] }
  }
  const hop = Math.max(1, Math.round((frameHopMs / 1000) * sampleRate))
  const frames = []
  const votes = new Map()
  let frameCount = 0
  for (let end = fftSize; end <= samples.length; end += hop) {
    const slice = samples.subarray(end - fftSize, end)
    const result = detectBlindPolyphony(slice, sampleRate, { fftSize, ...detectorOptions })
    const timeMs = ((end - fftSize) / sampleRate) * 1000
    frameCount += 1
    frames.push({ timeMs, detectedMidis: result.detectedMidis, noiseFloor: result.noiseFloor })
    for (const midi of result.detectedMidis) {
      votes.set(midi, (votes.get(midi) ?? 0) + 1)
    }
  }
  const threshold = Math.max(minStableFrames, Math.ceil(frameCount * 0.2))
  const stableMidis = [...votes.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([midi]) => midi)
    .sort((left, right) => left - right)
  return { engine: BLIND_POLY_ENGINE_ID, frames, stableMidis }
}

/**
 * Strum-aware replay (Stage 4 P1): blind frames → onset-anchored chord
 * grouping instead of vote counting.
 *
 * Vote counting keeps only tones present ≥20% of the clip, which drops
 * short melody notes, staggered strum strings, and masked voices the
 * detector DID hear. Grouping retains any onset-anchored tone (attack +
 * persistence + release tracking) with per-note onset and max confidence —
 * persistence through musical structure, not stretched windows.
 */
export function replayBlindPolyphonyEvents(samples, sampleRate, options = {}) {
  const {
    fftSize = BLIND_POLY_DEFAULTS.fftSize,
    frameHopMs = 1000 / 60,
    groupingOptions = {},
    ...detectorOptions
  } = options
  if (!samples?.length || !sampleRate) {
    return { engine: `${BLIND_POLY_ENGINE_ID}+groups`, frames: [], groups: [] }
  }
  const hop = Math.max(1, Math.round((frameHopMs / 1000) * sampleRate))
  const grouping = createChordGroupingState(groupingOptions)
  const frames = []
  const groups = []
  for (let end = fftSize; end <= samples.length; end += hop) {
    const slice = samples.subarray(end - fftSize, end)
    const result = detectBlindPolyphony(slice, sampleRate, { fftSize, ...detectorOptions })
    const timeMs = ((end - fftSize) / sampleRate) * 1000
    const byMidi = new Map(result.candidates.map((candidate) => [candidate.midi, candidate]))
    frames.push({ timeMs, detectedMidis: result.detectedMidis, noiseFloor: result.noiseFloor })
    const { events } = pushChordGroupingFrame(grouping, {
      timeMs,
      candidates: result.detectedMidis.map((midi) => ({
        midi,
        confidence: byMidi.get(midi)?.confidence ?? 0,
      })),
    })
    groups.push(...events)
  }
  groups.push(...flushChordGrouping(grouping).events)
  return { engine: `${BLIND_POLY_ENGINE_ID}+groups`, frames, groups }
}

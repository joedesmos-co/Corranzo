/**
 * Mic Engine V2 Phase 2 — score-informed chord scorer (offline prototype).
 *
 * At each analysis window, scores energy at expected fundamentals + harmonics.
 * Does not modify live Wait For You or V1 pitch detection.
 */

import { midiToFrequency } from '../micSyntheticClips.js'
import {
  buildExpectedStringByMidi,
  isHighGuitarString,
  isUpperGuitarStringForMasking,
  isLowGuitarString,
} from '../../practice/guitarChordShapeCheckpoint.js'
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
  octaveLeakRelativeEnergyFloor: 0.56,
  adjacentLeakRatio: 1.08,
  adjacentLeakMinRatio: 2.0,
  bassMidiThreshold: 60,
  bassBoost: 1.4,
  bassFundamentalWeight: 1.65,
  stableFrameThreshold: 2,
  blindProbeMidiMin: 48,
  blindProbeMidiMax: 84,
  scorerVersion: 'phase-2b',
  guitarHighStringDyadRelativeFloor: 0.11,
  guitarHighStringMinConfidence: 0.14,
  guitarHighStringDetectionRatio: 1.12,
  guitarHighStringOctaveLeakFloor: 0.38,
  guitarHighStringProbeMinRatio: 1.08,
  guitarHighStringProbeMinConfidence: 0.18,
  guitarHighStringProbeMinRelativeEnergy: 0.1,
  guitarHighStringFundamentalWeight: 1.28,
  guitarHighStringNoiseFloorFactor: 0.42,
  guitarHighStringMinFundamentalEnergy: 0.001,
}

function adaptiveHarmonicWeight(harmonic, midi, stringNum = null) {
  const isBass = midi < SCORE_INFORMED_DEFAULTS.bassMidiThreshold
  if (harmonic === 1) {
    if (isHighGuitarString(stringNum)) {
      return SCORE_INFORMED_DEFAULTS.guitarHighStringFundamentalWeight
    }
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

function pitchClass(midi) {
  return ((midi % 12) + 12) % 12
}

function hasStrongerOctavePeer(note, notes = []) {
  return notes.some(
    (peer) =>
      peer !== note &&
      pitchClass(peer.midi) === pitchClass(note.midi) &&
      peer.harmonicEnergy > note.harmonicEnergy,
  )
}

function hasStrongerAdjacentProbe(note, {
  sampleRate,
  windowed,
  noiseFloor,
  expectedMidis = [],
  options = {},
} = {}) {
  const expected = new Set(expectedMidis)
  const leakRatio =
    options.adjacentLeakRatio ?? SCORE_INFORMED_DEFAULTS.adjacentLeakRatio
  const minRatio =
    options.adjacentLeakMinRatio ?? SCORE_INFORMED_DEFAULTS.adjacentLeakMinRatio
  for (const adjacentMidi of [note.midi - 1, note.midi + 1]) {
    if (expected.has(adjacentMidi)) {
      continue
    }
    const adjacent = scoreExpectedNote(windowed, sampleRate, adjacentMidi, {
      ...options,
      expectedMidis,
      noiseFloor,
    })
    if (
      adjacent.ratio >= minRatio &&
      adjacent.confidence >= (note.confidence ?? 0) - 0.04 &&
      adjacent.harmonicEnergy >= note.harmonicEnergy * leakRatio
    ) {
      return true
    }
  }
  return false
}

function ratioToConfidence(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0
  }
  const logRatio = Math.log10(ratio)
  return Math.min(1, Math.max(0, (logRatio + 0.05) / 0.85))
}

function isLikelyLowStringHarmonicArtifact(highMidi, lowMidi) {
  if (!Number.isFinite(highMidi) || !Number.isFinite(lowMidi) || highMidi <= lowMidi) {
    return false
  }
  const semitoneDelta = highMidi - lowMidi
  for (let harmonic = 2; harmonic <= 6; harmonic += 1) {
    const expectedDelta = Math.round(12 * Math.log2(harmonic))
    if (Math.abs(semitoneDelta - expectedDelta) <= 1) {
      return true
    }
  }
  return false
}

function hasStrongerAdjacentFundamental(note, {
  sampleRate,
  windowed,
  noiseFloor,
  expectedMidis = [],
  options = {},
  noiseFloorFactor = 1,
  dominanceRatio = 1.02,
} = {}) {
  const expected = new Set(expectedMidis)
  for (const adjacentMidi of [note.midi - 1, note.midi + 1]) {
    if (expected.has(adjacentMidi)) {
      continue
    }
    const adjacent = scoreExpectedNote(windowed, sampleRate, adjacentMidi, {
      ...options,
      expectedMidis,
      noiseFloor: noiseFloor * noiseFloorFactor,
    })
    if (adjacent.fundamentalEnergy >= (note.fundamentalEnergy ?? 0) * dominanceRatio) {
      return true
    }
  }
  return false
}

function probeGuitarHighStringNote(note, {
  sampleRate,
  windowed,
  noiseFloor,
  expectedMidis = [],
  options = {},
  notes = [],
  lowPeerNotes = [],
} = {}) {
  const probeMinRatio =
    options.guitarHighStringProbeMinRatio ??
    SCORE_INFORMED_DEFAULTS.guitarHighStringProbeMinRatio
  const probeMinConfidence =
    options.guitarHighStringProbeMinConfidence ??
    SCORE_INFORMED_DEFAULTS.guitarHighStringProbeMinConfidence
  const probeMinRelativeEnergy =
    options.guitarHighStringProbeMinRelativeEnergy ??
    SCORE_INFORMED_DEFAULTS.guitarHighStringProbeMinRelativeEnergy

  if ((note.ratio ?? 0) < probeMinRatio || (note.confidence ?? 0) < probeMinConfidence) {
    return null
  }

  const peakEnergy = notes.reduce((max, peer) => Math.max(max, peer.harmonicEnergy), 0)
  const relativeEnergy = peakEnergy > 0 ? note.harmonicEnergy / peakEnergy : 0
  if (relativeEnergy < probeMinRelativeEnergy && (note.ratio ?? 0) < probeMinRatio + 0.2) {
    return null
  }

  if (
    lowPeerNotes.some(
      (peer) =>
        isLikelyLowStringHarmonicArtifact(note.midi, peer.midi) &&
        pitchClass(note.midi) === pitchClass(peer.midi),
    )
  ) {
    return null
  }

  if (
    hasStrongerAdjacentProbe(note, {
      sampleRate,
      windowed,
      noiseFloor,
      expectedMidis,
      options,
    })
  ) {
    return null
  }

  const fundamentalFloor =
    options.guitarHighStringMinFundamentalEnergy ??
    SCORE_INFORMED_DEFAULTS.guitarHighStringMinFundamentalEnergy
  if ((note.fundamentalEnergy ?? 0) < fundamentalFloor) {
    return null
  }

  const probeNoiseFloorFactor =
    options.guitarHighStringNoiseFloorFactor ??
    SCORE_INFORMED_DEFAULTS.guitarHighStringNoiseFloorFactor
  if (
    hasStrongerAdjacentFundamental(note, {
      sampleRate,
      windowed,
      noiseFloor,
      expectedMidis,
      options,
      noiseFloorFactor: probeNoiseFloorFactor,
      dominanceRatio: 1.08,
    })
  ) {
    return null
  }

  const noiseFloorMinimum = noiseFloor * 1.15
  if ((note.fundamentalEnergy ?? 0) < noiseFloorMinimum) {
    return null
  }

  return {
    accepted: true,
    relativeEnergy,
  }
}

/**
 * Score one expected MIDI in a window using harmonic Goertzel energy.
 */
export function scoreExpectedNote(samples, sampleRate, midi, options = {}) {
  const harmonicCount = options.harmonicCount ?? SCORE_INFORMED_DEFAULTS.harmonicCount
  const stringByMidi = options.stringByMidi ?? buildExpectedStringByMidi(options.expectedStringFrets)
  const stringNum = stringByMidi.get(midi) ?? null
  const noiseFloor =
    options.noiseFloor ??
    estimateNoiseFloor(samples, sampleRate, { expectedMidis: options.expectedMidis ?? [midi] })
  const f0 = midiToFrequency(midi)
  const isBass = midi < (options.bassMidiThreshold ?? SCORE_INFORMED_DEFAULTS.bassMidiThreshold)

  let harmonicEnergy = 0
  let weightSum = 0
  const harmonicMagnitudes = []

  for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
    const weight = adaptiveHarmonicWeight(harmonic, midi, stringNum)
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
  const stringByMidi = options.stringByMidi ?? buildExpectedStringByMidi(options.expectedStringFrets)
  const guitarShapeContext = stringByMidi.size > 0

  const notes = (expectedMidis ?? []).map((midi) =>
    scoreExpectedNote(windowed, sampleRate, midi, {
      ...options,
      expectedMidis,
      noiseFloor,
      stringByMidi,
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

  const applyDetectionPass = ({
    onlyUndetected = false,
    highStringMaskingRelief = false,
    lowPeerNotes = [],
  } = {}) => {
    for (const note of notes) {
      if (onlyUndetected && note.detected) {
        continue
      }

      const stringNum = stringByMidi.get(note.midi) ?? null
      const isUpperString = guitarShapeContext && isUpperGuitarStringForMasking(stringNum)
      const relativeEnergy = peakEnergy > 0 ? note.harmonicEnergy / peakEnergy : 0
      const peerRelative = peerMedian > 0 ? note.harmonicEnergy / peerMedian : 0
      note.relativeEnergy = relativeEnergy
      note.peerRelative = peerRelative

      const bassRelief = note.isBass ? 0.06 : 0
      let effectiveRelativeFloor = relativeFloor - bassRelief
      let effectiveDetectionRatio = options.detectionRatio ?? SCORE_INFORMED_DEFAULTS.detectionRatio
      let effectiveMinConfidence = options.minConfidence ?? SCORE_INFORMED_DEFAULTS.minConfidence
      let octaveLeakFloor =
        options.octaveLeakRelativeEnergyFloor ??
        SCORE_INFORMED_DEFAULTS.octaveLeakRelativeEnergyFloor

      if (highStringMaskingRelief && isUpperString && lowPeerNotes.length > 0) {
        effectiveRelativeFloor =
          options.guitarHighStringDyadRelativeFloor ??
          SCORE_INFORMED_DEFAULTS.guitarHighStringDyadRelativeFloor
        effectiveDetectionRatio =
          options.guitarHighStringDetectionRatio ??
          SCORE_INFORMED_DEFAULTS.guitarHighStringDetectionRatio
        effectiveMinConfidence =
          options.guitarHighStringMinConfidence ??
          SCORE_INFORMED_DEFAULTS.guitarHighStringMinConfidence
        octaveLeakFloor =
          options.guitarHighStringOctaveLeakFloor ??
          SCORE_INFORMED_DEFAULTS.guitarHighStringOctaveLeakFloor
      }

      const octaveHarmonicFromLowPeer =
        highStringMaskingRelief &&
        isUpperString &&
        lowPeerNotes.some(
          (peer) =>
            pitchClass(note.midi) === pitchClass(peer.midi) &&
            isLikelyLowStringHarmonicArtifact(note.midi, peer.midi) &&
            (note.fundamentalEnergy ?? 0) <
              (options.guitarOctaveDyadMinFundamental ?? 0.025),
        )
      const octaveLeakageGuard =
        hasStrongerOctavePeer(note, notes) && relativeEnergy < octaveLeakFloor
      const adjacentLeakageGuard = hasStrongerAdjacentProbe(note, {
        sampleRate,
        windowed,
        noiseFloor,
        expectedMidis,
        options,
      })
      const minFundamentalEnergy =
        highStringMaskingRelief && isUpperString
          ? (options.guitarHighStringMinFundamentalEnergy ??
            SCORE_INFORMED_DEFAULTS.guitarHighStringMinFundamentalEnergy)
          : 0

      note.detected =
        note.ratio >= effectiveDetectionRatio &&
        note.confidence >= effectiveMinConfidence &&
        (relativeEnergy >= effectiveRelativeFloor || peerRelative >= 0.72) &&
        (note.fundamentalEnergy ?? 0) >= minFundamentalEnergy &&
        !octaveLeakageGuard &&
        !adjacentLeakageGuard &&
        !octaveHarmonicFromLowPeer

      if (highStringMaskingRelief && isUpperString && !note.detected) {
        const probeNoiseFloor =
          noiseFloor *
          (options.guitarHighStringNoiseFloorFactor ??
            SCORE_INFORMED_DEFAULTS.guitarHighStringNoiseFloorFactor)
        const probed = probeGuitarHighStringNote(note, {
          sampleRate,
          windowed,
          noiseFloor: probeNoiseFloor,
          expectedMidis,
          options,
          notes,
          lowPeerNotes,
        })
        if (probed?.accepted) {
          note.detected = true
          note.harmonicProbe = true
        }
      }
    }
  }

  applyDetectionPass()

  // Piano / non-guitar: when a chord is clearly present, recover quieter interior
  // expected tones that sit just above the noise floor (common with real MIS mixes).
  if (!guitarShapeContext && expectedMidis.length >= 2) {
    const strongPeers = notes.filter((note) => note.detected && note.ratio >= 1.8)
    if (strongPeers.length > 0) {
      const reliefMinRatio = 0.92
      // Confidence is a monotonic transform of ratio — keep the floor consistent
      // with reliefMinRatio so ratio>=0.92 is not dead-gated by conf>=0.02.
      const reliefMinConfidence = ratioToConfidence(reliefMinRatio)
      for (const note of notes) {
        if (note.detected) {
          continue
        }
        const relativeEnergy = note.relativeEnergy ?? 0
        const peerRelative = note.peerRelative ?? 0
        const fundOverNoise =
          noiseFloor > 0 ? (note.fundamentalEnergy ?? 0) / noiseFloor : 0
        const pianoInteriorRelief =
          (relativeEnergy >= relativeFloor * 0.9 || peerRelative >= 0.55) &&
          fundOverNoise >= 1.0 &&
          (note.ratio ?? 0) >= reliefMinRatio &&
          (note.confidence ?? 0) >= reliefMinConfidence &&
          !hasStrongerOctavePeer(note, notes) &&
          !hasStrongerAdjacentProbe(note, {
            sampleRate,
            windowed,
            noiseFloor,
            expectedMidis,
            options,
          })
        if (pianoInteriorRelief) {
          note.detected = true
          note.pianoCompanionRelief = true
        }
      }
    }
  }

  if (guitarShapeContext) {
    const confirmedLowPeers = notes.filter(
      (note) => note.detected && isLowGuitarString(stringByMidi.get(note.midi)),
    )
    if (confirmedLowPeers.length > 0) {
      const noiseFloorFactor =
        options.guitarHighStringNoiseFloorFactor ??
        SCORE_INFORMED_DEFAULTS.guitarHighStringNoiseFloorFactor
      for (const note of notes) {
        if (note.detected) {
          continue
        }
        const stringNum = stringByMidi.get(note.midi)
        if (!isUpperGuitarStringForMasking(stringNum)) {
          continue
        }
        const rescore = scoreExpectedNote(windowed, sampleRate, note.midi, {
          ...options,
          expectedMidis,
          noiseFloor: noiseFloor * noiseFloorFactor,
          stringByMidi,
        })
        note.ratio = rescore.ratio
        note.confidence = rescore.confidence
        note.harmonicEnergy = rescore.harmonicEnergy
        note.fundamentalEnergy = rescore.fundamentalEnergy
        note.harmonicSupport = rescore.harmonicSupport
        note.maskingRescored = true
      }

      const maskedPeakEnergy = notes.reduce((max, note) => Math.max(max, note.harmonicEnergy), 0)
      for (const note of notes) {
        note.relativeEnergy =
          maskedPeakEnergy > 0 ? note.harmonicEnergy / maskedPeakEnergy : 0
      }

      applyDetectionPass({
        onlyUndetected: true,
        highStringMaskingRelief: true,
        lowPeerNotes: confirmedLowPeers,
      })
    }
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

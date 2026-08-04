import { describe, expect, it } from 'vitest'

import { createNoiseFloorTracker } from '../src/features/microphone-input/micNoiseGate.js'
import { midiToFrequency } from '../src/features/microphone-input/micSyntheticClips.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
  scoreFrameSizeForExpectedMidis,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import {
  causalHannWindow,
  hannWindow,
} from '../src/features/microphone-input/v2/micSpectralAnalysis.js'
import {
  scoreInformedChordWindow,
} from '../src/features/microphone-input/v2/scoreInformedChordScorer.js'
import {
  createMicAttackLatchState,
  getMicAttackRearmReason,
  markMicAttackConsumed,
  updateMicAttackRelease,
} from '../src/features/practice/micAttackLatch.js'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  micConfirmFramesForExpectedMidis,
} from '../src/features/practice/micMatchConfirm.js'
import { isMusicalMicFrame } from '../src/features/practice/micMusicalAcceptance.js'

const SAMPLE_RATE = 44100

function synthNote(midi, length, harmonics = [1, 0.62, 0.36, 0.21, 0.13, 0.08]) {
  const samples = new Float32Array(length)
  const f0 = midiToFrequency(midi)
  const normalizer = harmonics.reduce((sum, amplitude, index) =>
    f0 * (index + 1) < SAMPLE_RATE / 2 ? sum + Math.abs(amplitude) : sum, 0) || 1
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE
    const attack = 1 - Math.exp(-time * 210)
    const envelope = attack * Math.exp(-time * 0.55)
    for (let harmonic = 0; harmonic < harmonics.length; harmonic += 1) {
      const multiple = harmonic + 1
      const frequency = f0 * multiple
      if (frequency >= SAMPLE_RATE / 2) continue
      samples[index] += Math.sin(2 * Math.PI * frequency * time) * harmonics[harmonic] / normalizer * envelope * 0.35
    }
  }
  return samples
}

function scoreSynthetic(midi, expectedMidi = midi, {
  harmonics,
  humHz = null,
  noiseAmplitude = 0,
} = {}) {
  const frameSize = expectedMidi <= 32 ? 8192 : 2048
  const buffer = synthNote(midi, frameSize, harmonics)
  let noiseState = 0x51f15e
  for (let index = 0; index < buffer.length; index += 1) {
    if (humHz) {
      buffer[index] += Math.sin(2 * Math.PI * humHz * index / SAMPLE_RATE) * 0.02
    }
    if (noiseAmplitude) {
      noiseState = (noiseState * 1664525 + 1013904223) >>> 0
      buffer[index] += ((noiseState / 0xffffffff) * 2 - 1) * noiseAmplitude
    }
  }
  return scoreInformedChordWindow(buffer, SAMPLE_RATE, [expectedMidi], {
    fftSize: frameSize,
    window: frameSize === 8192 ? causalHannWindow(frameSize) : hannWindow(frameSize),
  })
}

describe('extreme-register microphone recognition', () => {
  it('uses register-aware confirmation without changing middle or high notes', () => {
    expect(micConfirmFramesForExpectedMidis([21])).toBe(2)
    expect(micConfirmFramesForExpectedMidis([32])).toBe(2)
    expect(micConfirmFramesForExpectedMidis([33])).toBe(3)
    expect(micConfirmFramesForExpectedMidis([108])).toBe(3)
  })

  it('weights the newest sample most in the causal bass window', () => {
    const window = causalHannWindow(8192)
    expect(window[0]).toBe(0)
    expect(window[window.length - 1]).toBeCloseTo(1, 6)
    expect(window[6144]).toBeGreaterThan(window[2048])
  })

  it('uses long history throughout the deep-bass band', () => {
    expect(scoreFrameSizeForExpectedMidis([21], 8192)).toBe(8192)
    expect(scoreFrameSizeForExpectedMidis([22], 8192)).toBe(8192)
    expect(scoreFrameSizeForExpectedMidis([32], 8192)).toBe(8192)
    expect(scoreFrameSizeForExpectedMidis([33], 8192)).toBe(2048)
  })

  it.each([21, 22, 23, 24, 31, 32])('recognizes deep-bass boundary note MIDI %i', (midi) => {
    expect(scoreSynthetic(midi).detectedMidis).toContain(midi)
  })

  it.each([104, 105, 106, 107, 108])('recognizes extreme-treble boundary note MIDI %i', (midi) => {
    expect(scoreSynthetic(midi).detectedMidis).toContain(midi)
  })

  it('rejects an A1 harmonic family when absolute A0 is expected', () => {
    const frameSize = 8192
    const result = scoreInformedChordWindow(synthNote(33, frameSize), SAMPLE_RATE, [21], {
      fftSize: frameSize,
      window: hannWindow(frameSize),
    })
    expect(result.detectedMidis).toEqual([])
  })

  it('rejects C7 when absolute C8 is expected', () => {
    const frameSize = 2048
    const result = scoreInformedChordWindow(synthNote(96, frameSize), SAMPLE_RATE, [108], {
      fftSize: frameSize,
      window: hannWindow(frameSize),
    })
    expect(result.detectedMidis).toEqual([])
  })

  it('rejects harmonically related wrong pitches at both boundaries', () => {
    expect(scoreSynthetic(28, 21).detectedMidis).toEqual([])
    expect(scoreSynthetic(103, 108).detectedMidis).toEqual([])
  })

  it.each([
    ['second', [0.1, 1, 0.42, 0.22, 0.12, 0.07]],
    ['third', [0.09, 0.4, 1, 0.24, 0.13, 0.07]],
  ])('recovers A0 when its %s harmonic dominates', (_label, harmonics) => {
    expect(scoreSynthetic(21, 21, { harmonics }).detectedMidis).toContain(21)
  })

  it('keeps A0 identifiable in 60 Hz hum', () => {
    expect(scoreSynthetic(21, 21, { humHz: 60 }).detectedMidis).toContain(21)
  })

  it('keeps weak-fundamental C8 identifiable in broadband noise', () => {
    const result = scoreSynthetic(108, 108, {
      harmonics: [0.16, 1, 0.52, 0.24, 0.1, 0.04],
      noiseAmplitude: 0.015,
    })
    expect(result.detectedMidis).toContain(108)
  })

  it('accepts a coherent weak-fundamental C8 family without treating it as voice', () => {
    const buffer = synthNote(108, 2048, [0.16, 1, 0.52, 0.24, 0.1, 0.04])
    const tick = processMicEngineV2Tick({
      buffer,
      sampleRate: SAMPLE_RATE,
      expectedMidis: [108],
      noiseFloor: createNoiseFloorTracker(0.004),
      state: createMicEngineV2RuntimeState(),
      timeMs: 100,
    })
    expect(tick.frame.v2DetectedMidis).toContain(108)
    expect(isMusicalMicFrame(tick.frame)).toBe(true)
  })

  it('rearms a repeated high note from a coherent transient below the broad RMS-rise threshold', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [108] })
    for (let index = 0; index < 6; index += 1) {
      updateMicAttackRelease(latch, true, {
        rms: 0.14 - index * 0.004,
        spectralEnergy: 0.34,
        transientRms: 0.075 - index * 0.002,
      })
    }
    const reason = getMicAttackRearmReason(latch, {
      gateOpen: true,
      filteredRms: 0.143,
      spectralEnergy: 0.35,
      transientRms: 0.082,
      signalShape: 'distorted',
      v2Notes: [{
        midi: 108,
        detected: true,
        confidence: 0.68,
        ratio: 3.3,
        harmonicSupport: 0.7,
      }],
    }, { expectedMidis: [108] })
    expect(reason).toBe('high-note-transient')
  })

  it('rearms a neighboring deep-bass attack from absolute derivative energy', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [21] })
    for (const [rms, transientRms] of [[0.172, 0.0051], [0.167, 0.00435], [0.167, 0.00421]]) {
      updateMicAttackRelease(latch, true, {
        rms,
        spectralEnergy: 0.00024,
        transientRms,
      })
    }
    const reason = getMicAttackRearmReason(latch, {
      gateOpen: true,
      filteredRms: 0.238,
      spectralEnergy: 0.00048,
      transientRms: 0.00647,
      signalShape: 'sustained',
      v2Notes: [{
        midi: 22,
        detected: true,
        confidence: 0.79,
        ratio: 4.2,
        harmonicSupport: 0.58,
      }],
    }, { expectedMidis: [22] })
    expect(reason).toBe('low-note-transient')
  })

  it.each([
    [21, 0.006, 0.0058],
    [108, 0.08, 0.078],
  ])('does not rearm a sustained extreme note MIDI %i', (midi, transientStart, transientEnd) => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [midi] })
    for (let index = 0; index < 8; index += 1) {
      updateMicAttackRelease(latch, true, {
        rms: 0.18 - index * 0.004,
        spectralEnergy: 0.3 - index * 0.01,
        transientRms: transientStart - (transientStart - transientEnd) * index / 7,
      })
    }
    expect(getMicAttackRearmReason(latch, {
      gateOpen: true,
      filteredRms: 0.151,
      spectralEnergy: 0.22,
      transientRms: transientEnd,
      signalShape: 'sustained',
      v2Notes: [{
        midi,
        detected: true,
        confidence: 0.8,
        ratio: 4,
        harmonicSupport: 0.8,
      }],
    }, { expectedMidis: [midi] })).toBeNull()
  })

  it('keeps low-to-high and high-to-low pitch identities absolute', () => {
    expect(scoreSynthetic(21).detectedMidis).toEqual([21])
    expect(scoreSynthetic(108).detectedMidis).toEqual([108])
    expect(scoreSynthetic(108, 21).detectedMidis).toEqual([])
    expect(scoreSynthetic(21, 108).detectedMidis).toEqual([])
  })

  it('does not restart confirmation when the independent tracker flips by an octave', () => {
    const state = createMatchConfirmState()
    expect(confirmConfidentMatch(state, 'midi-78', true, { pitchCents: 7800 })).toBe(false)
    expect(confirmConfidentMatch(state, 'midi-78', true, { pitchCents: 6600 })).toBe(false)
    expect(confirmConfidentMatch(state, 'midi-78', true, { pitchCents: 7805 })).toBe(true)
  })
})

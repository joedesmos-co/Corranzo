import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeMicFrame, createMicFrameAnalyzer } from '../src/features/microphone-input/micFrameAnalysis.js'
import { MIC_SIGNAL_SHAPE } from '../src/features/microphone-input/micSignalShape.js'
import {
  renderSyntheticClip,
  synthSine,
  synthSpeech,
} from '../src/features/microphone-input/micSyntheticClips.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import { isMusicalMicFrame, micMusicalRejectReason } from '../src/features/practice/micMusicalAcceptance.js'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const SAMPLE_RATE = 44100
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function frameFromSamples(samples) {
  const analyzer = createMicFrameAnalyzer()
  return analyzeMicFrame(samples.subarray(0, 2048), SAMPLE_RATE, analyzer.noiseFloor, {
    gateOptions: { absoluteMin: 0.005, floorMultiplier: 1 },
  })
}

/** Live-path V2 frame (analyzeMicFrame + score-informed tick merged). */
function v2FrameFromSamples(samples, expectedMidi, offset = 2048) {
  const analyzer = createMicFrameAnalyzer()
  const window = samples.subarray(offset, offset + 2048)
  const frame = analyzeMicFrame(window, SAMPLE_RATE, analyzer.noiseFloor, {
    gateOptions: { absoluteMin: 0.005, floorMultiplier: 1 },
  })
  const tick = processMicEngineV2Tick({
    buffer: window,
    sampleRate: SAMPLE_RATE,
    expectedMidis: [expectedMidi],
    noiseFloor: analyzer.noiseFloor,
    state: createMicEngineV2RuntimeState(),
    stableFrameThreshold: 2,
  })
  return { ...frame, ...tick.frame, v2Active: true }
}

describe('micMusicalAcceptance', () => {
  it('accepts a clear sustained instrument tone', () => {
    const frame = frameFromSamples(synthSine(261.63, SAMPLE_RATE, 0.5, 0.35))
    expect(frame.gateOpen).toBe(true)
    expect(isMusicalMicFrame(frame)).toBe(true)
    expect(micMusicalRejectReason(frame)).toBeNull()
  })

  it('rejects broadband noise frames', () => {
    const frame = {
      gateOpen: true,
      signalShape: MIC_SIGNAL_SHAPE.NOISY,
      clarity: 0.1,
      zeroCrossingRate: 0.45,
      spectralEnergy: 1.2,
      crestFactor: 2,
    }
    expect(isMusicalMicFrame(frame)).toBe(false)
    expect(micMusicalRejectReason(frame)).toBe('non-musical-noise')
  })

  it('accepts a digital-piano-through-speakers tone on the V2 path (h2/h1 ≈ 0.5 is a real instrument, not speech)', () => {
    // Regression: the earlier h2/h1 <= 0.15 "instrument decay" rule rejected
    // every real piano/guitar fixture (their 2nd partial is ~half the
    // fundamental) which silently broke live mic advancement.
    const samples = renderSyntheticClip(
      { type: 'speaker', midi: 60, seconds: 0.7, amplitude: 0.34, noise: 0.008, seed: 31 },
      SAMPLE_RATE,
    )
    const merged = v2FrameFromSamples(samples, 60)
    expect(merged.gateOpen).toBe(true)
    expect(merged.v2DetectedMidis).toContain(60)
    expect(isMusicalMicFrame(merged)).toBe(true)
    expect(micMusicalRejectReason(merged)).toBeNull()
  })

  it('accepts real recorded piano and guitar note frames on the V2 path', () => {
    const cases = [
      { file: 'benchmarks/mic-accuracy/clips/real-piano-c4.wav', midi: 60 },
      { file: 'benchmarks/mic-accuracy/clips/real-piano-e4.wav', midi: 64 },
      { file: 'benchmarks/mic-accuracy/clips/real-guitar-g3.wav', midi: 55 },
    ]
    for (const testCase of cases) {
      const wav = readWavPcm(join(root, testCase.file))
      // Skip the attack; sample a sustain window like the live confirm does.
      const merged = v2FrameFromSamples(wav.samples, testCase.midi, 8192)
      expect(merged.gateOpen, testCase.file).toBe(true)
      expect(merged.v2DetectedMidis, testCase.file).toContain(testCase.midi)
      expect(isMusicalMicFrame(merged), testCase.file).toBe(true)
    }
  })

  it('rejects formant-resonant voiced frames whose upper partials rival the fundamental', () => {
    // Droney voice puts a formant resonance on partials 4-6; played notes decay.
    const frame = {
      gateOpen: true,
      v2Active: true,
      v2DetectedMidis: [50],
      v2Notes: [
        {
          midi: 50,
          detected: true,
          harmonicMagnitudes: [1, 0.55, 0.45, 0.57, 0.49, 0.08],
        },
      ],
      signalShape: MIC_SIGNAL_SHAPE.SUSTAINED,
      clarity: 0.82,
      zeroCrossingRate: 0.02,
      spectralEnergy: 0.005,
      crestFactor: 3,
    }
    expect(isMusicalMicFrame(frame)).toBe(false)
    expect(micMusicalRejectReason(frame)).toBe('non-musical-formant-harmonics')
  })

  it('rejects frames whose strongest partial is not the fundamental', () => {
    const frame = {
      gateOpen: true,
      v2Active: true,
      v2DetectedMidis: [45],
      v2Notes: [
        {
          midi: 45,
          detected: true,
          harmonicMagnitudes: [0.4, 0.2, 0.1, 0.1, 0.9, 0.2],
        },
      ],
      signalShape: MIC_SIGNAL_SHAPE.SUSTAINED,
      clarity: 0.8,
      zeroCrossingRate: 0.02,
      spectralEnergy: 0.005,
      crestFactor: 3,
    }
    expect(isMusicalMicFrame(frame)).toBe(false)
    expect(micMusicalRejectReason(frame)).toBe('non-musical-formant-harmonics')
  })

  it('accepts bass notes whose 2nd partial is strongest (weak-fundamental strings)', () => {
    // Real piano/guitar bass radiates little fundamental; h2 dominates. The
    // scorer marks these notes isBass and the profile allows h2-anchored bass.
    // Magnitudes mirror the measured Goertzel profile of the low-C2 fixture
    // (h456/h12 ≈ 0.30).
    const frame = {
      gateOpen: true,
      v2Active: true,
      v2DetectedMidis: [36],
      v2Notes: [
        {
          midi: 36,
          detected: true,
          isBass: true,
          harmonicMagnitudes: [0.09, 0.28, 0.2, 0.08, 0.03, 0.0],
        },
      ],
      signalShape: MIC_SIGNAL_SHAPE.SUSTAINED,
      clarity: 0.85,
      zeroCrossingRate: 0.02,
      spectralEnergy: 0.005,
      crestFactor: 3,
    }
    expect(isMusicalMicFrame(frame)).toBe(true)
    expect(micMusicalRejectReason(frame)).toBeNull()
  })

  it('still rejects bass-register frames anchored on partials 3+ (voice formants)', () => {
    const frame = {
      gateOpen: true,
      v2Active: true,
      v2DetectedMidis: [40],
      v2Notes: [
        {
          midi: 40,
          detected: true,
          isBass: true,
          harmonicMagnitudes: [0.1, 0.15, 0.2, 0.5, 0.45, 0.2],
        },
      ],
      signalShape: MIC_SIGNAL_SHAPE.SUSTAINED,
      clarity: 0.8,
      zeroCrossingRate: 0.02,
      spectralEnergy: 0.005,
      crestFactor: 3,
    }
    expect(isMusicalMicFrame(frame)).toBe(false)
    expect(micMusicalRejectReason(frame)).toBe('non-musical-formant-harmonics')
  })

  it('rejects sweeping voiced speech frames during the formant-heavy sweep', () => {
    // Honest speech synthesis (glottal pulses + formants + prosody drift).
    // Voiced talking hits formant-resonant windows that the harmonic profile
    // rejects; frames outside those windows are handled by the pitch-drift
    // confirm guard (see waitForYouMicRealWorldGate tests).
    const samples = synthSpeech(SAMPLE_RATE, 1.6, { f0: 146.8, seed: 23, driftSemitones: 0.8, jitterCents: 12, syllableHz: 2.8 })
    let rejected = 0
    let inspected = 0
    for (let offset = 2048; offset + 2048 <= samples.length; offset += 4096) {
      const merged = v2FrameFromSamples(samples, 50, offset)
      if (!merged.gateOpen || !merged.v2DetectedMidis?.length) {
        continue
      }
      inspected += 1
      if (!isMusicalMicFrame(merged)) {
        rejected += 1
      }
    }
    expect(inspected).toBeGreaterThan(4)
    expect(rejected).toBeGreaterThan(0)
  })
})

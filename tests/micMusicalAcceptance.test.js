import { describe, expect, it } from 'vitest'
import { analyzeMicFrame, createMicFrameAnalyzer } from '../src/features/microphone-input/micFrameAnalysis.js'
import { MIC_SIGNAL_SHAPE } from '../src/features/microphone-input/micSignalShape.js'
import { synthSpeaker, synthSine } from '../src/features/microphone-input/micSyntheticClips.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import { isMusicalMicFrame, micMusicalRejectReason } from '../src/features/practice/micMusicalAcceptance.js'

const SAMPLE_RATE = 44100

function frameFromSamples(samples) {
  const analyzer = createMicFrameAnalyzer()
  return analyzeMicFrame(samples.subarray(0, 2048), SAMPLE_RATE, analyzer.noiseFloor, {
    gateOptions: { absoluteMin: 0.005, floorMultiplier: 1 },
  })
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

  it('rejects speech-like formant energy without treating it as a confident note', () => {
    const samples = synthSpeaker(261, SAMPLE_RATE, 0.8, { amplitude: 0.45, noise: 0.015 })
    const analyzer = createMicFrameAnalyzer()
    const frame = analyzeMicFrame(samples.subarray(2048, 4096), SAMPLE_RATE, analyzer.noiseFloor, {
      gateOptions: { absoluteMin: 0.005, floorMultiplier: 1 },
    })
    const tick = processMicEngineV2Tick({
      buffer: samples.subarray(2048, 4096),
      sampleRate: SAMPLE_RATE,
      expectedMidis: [60],
      noiseFloor: analyzer.noiseFloor,
      state: createMicEngineV2RuntimeState(),
      stableFrameThreshold: 2,
    })
    const merged = { ...frame, ...tick.frame, v2Active: true }
    expect(merged.gateOpen).toBe(true)
    expect(merged.v2DetectedMidis).toContain(60)
    expect(isMusicalMicFrame(merged)).toBe(false)
    expect(micMusicalRejectReason(merged)).toMatch(/^non-musical-/)
  })
})

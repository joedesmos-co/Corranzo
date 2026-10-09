/**
 * Mic Engine rescue (M2) — three-way failure classification must separate
 * NO SIGNAL from DETECTION FAILED from ENGINE REJECTED.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyMicInputFailure,
  MIC_INPUT_FAILURE,
} from '../src/features/microphone-input/micInputFailure.js'

const EXPECTED = [60, 64, 67]

function frame(overrides = {}) {
  return {
    rms: 0.0008,
    filteredRms: 0.0008,
    gateOpen: false,
    signalShape: 'quiet',
    midi: null,
    v2DetectedMidis: [],
    clarity: 0,
    ...overrides,
  }
}

describe('classifyMicInputFailure', () => {
  it('reports no usable signal when the gate never opened', () => {
    const result = classifyMicInputFailure({
      frame: frame(),
      rejectReason: 'noise-gate-closed',
      matchingEnabled: true,
      expectedMidis: EXPECTED,
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL)
    expect(result.pitchEvidence).toBe(false)
  })

  it('reports no usable signal when no frame was produced', () => {
    const result = classifyMicInputFailure({
      frame: null,
      rejectReason: null,
      matchingEnabled: true,
      expectedMidis: EXPECTED,
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL)
    expect(result.reason).toBe('missing-frame')
  })

  it('reports no usable signal while calibrating', () => {
    const result = classifyMicInputFailure({
      frame: frame(),
      rejectReason: 'calibrating',
      matchingEnabled: true,
      expectedMidis: EXPECTED,
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL)
  })

  it('reports detection failure for audible input with no pitch', () => {
    const result = classifyMicInputFailure({
      frame: frame({
        rms: 0.08,
        filteredRms: 0.08,
        gateOpen: true,
        signalShape: 'sustained',
        clarity: 0.05,
      }),
      rejectReason: 'no-midi-detected',
      matchingEnabled: true,
      expectedMidis: EXPECTED,
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.PITCH_DETECTION_FAILED)
    expect(result.audible).toBe(true)
  })

  it('reports detection failure when V2 stays below threshold on an open gate', () => {
    const result = classifyMicInputFailure({
      frame: frame({
        rms: 0.06,
        filteredRms: 0.06,
        gateOpen: true,
        signalShape: 'distorted',
      }),
      rejectReason: 'v2-below-threshold',
      matchingEnabled: true,
      expectedMidis: [40, 47],
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.PITCH_DETECTION_FAILED)
  })

  it('reports engine rejection when V2 hears the note but the soft gate holds it', () => {
    const result = classifyMicInputFailure({
      frame: frame({
        rms: 0.009,
        filteredRms: 0.009,
        gateOpen: false,
        signalShape: 'sustained',
        v2DetectedMidis: [60],
      }),
      rejectReason: 'soft-note-below-gate',
      matchingEnabled: true,
      expectedMidis: EXPECTED,
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED)
    expect(result.pitchEvidence).toBe(true)
  })

  it('reports engine rejection for formant/harmonic vetoes on real pitch evidence', () => {
    const result = classifyMicInputFailure({
      frame: frame({
        rms: 0.12,
        filteredRms: 0.1,
        gateOpen: true,
        signalShape: 'distorted',
        midi: 52,
        v2DetectedMidis: [52],
        clarity: 0.6,
      }),
      rejectReason: 'non-musical-formant-harmonics',
      matchingEnabled: true,
      expectedMidis: [52],
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED)
  })

  it('reports engine rejection for wrong-note mismatches (pitch heard, score rejected)', () => {
    const result = classifyMicInputFailure({
      frame: frame({
        rms: 0.07,
        filteredRms: 0.07,
        gateOpen: true,
        signalShape: 'sustained',
        midi: 62,
        v2DetectedMidis: [62],
        clarity: 0.8,
      }),
      rejectReason: 'wrong-note',
      matchingEnabled: true,
      expectedMidis: EXPECTED,
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED)
  })

  it('reports engine rejection while the attack latch holds a ringing note', () => {
    const result = classifyMicInputFailure({
      frame: frame({
        rms: 0.07,
        filteredRms: 0.07,
        gateOpen: true,
        signalShape: 'sustained',
        midi: 64,
        v2DetectedMidis: [64],
        clarity: 0.8,
      }),
      rejectReason: null,
      matchingEnabled: true,
      expectedMidis: EXPECTED,
      attackLatched: true,
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED)
    expect(result.reason).toBe('attack-latch-holding')
  })

  it('reports none when the frame is accepted for matching', () => {
    const result = classifyMicInputFailure({
      frame: frame({
        rms: 0.07,
        filteredRms: 0.07,
        gateOpen: true,
        signalShape: 'sustained',
        midi: 60,
        v2DetectedMidis: [60, 64, 67],
        clarity: 0.8,
      }),
      rejectReason: null,
      matchingEnabled: true,
      expectedMidis: EXPECTED,
    })
    expect(result.category).toBe(MIC_INPUT_FAILURE.NONE)
  })

  it('never misreports an unknown gate as silence', () => {
    const result = classifyMicInputFailure({
      frame: frame({ gateOpen: true, signalShape: 'sustained' }),
      rejectReason: 'some-future-gate',
      matchingEnabled: true,
      expectedMidis: EXPECTED,
    })
    expect(result.category).not.toBe(MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL)
  })
})

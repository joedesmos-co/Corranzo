/**
 * Five-stage signal probe + calibrated gate prototype (Stage 2, S5).
 */
import { describe, expect, it } from 'vitest'
import {
  MIC_SIGNAL_STAGE,
  proposeCalibratedGate,
  probeSignalStages,
} from '../src/features/microphone-input/micSignalStages.js'

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

describe('probeSignalStages', () => {
  it('separates no-input-signal from signal-below-gate', () => {
    const noInput = probeSignalStages({
      frame: frame(),
      rejectReason: 'noise-gate-closed',
      gateThreshold: 0.012,
      matchingEnabled: true,
      expectedMidis: [57],
    })
    expect(noInput.stage).toBe(MIC_SIGNAL_STAGE.NO_INPUT_SIGNAL)

    const belowGate = probeSignalStages({
      frame: frame({ rms: 0.008, filteredRms: 0.008, signalShape: 'sustained' }),
      rejectReason: 'noise-gate-closed',
      gateThreshold: 0.012,
      matchingEnabled: true,
      expectedMidis: [57],
    })
    expect(belowGate.stage).toBe(MIC_SIGNAL_STAGE.SIGNAL_BELOW_GATE)
    expect(belowGate.measurements.gateMargin).toBeLessThan(0)
  })

  it('reports pitch-rejected for audible input with no extraction', () => {
    const result = probeSignalStages({
      frame: frame({ rms: 0.08, filteredRms: 0.08, gateOpen: true, signalShape: 'distorted' }),
      rejectReason: 'v2-below-threshold',
      gateThreshold: 0.012,
      matchingEnabled: true,
      expectedMidis: [40, 47],
    })
    expect(result.stage).toBe(MIC_SIGNAL_STAGE.PITCH_REJECTED)
  })

  it('reports event-suppressed for formant vetoes on real pitch evidence', () => {
    const result = probeSignalStages({
      frame: frame({
        rms: 0.12, filteredRms: 0.1, gateOpen: true, signalShape: 'distorted',
        midi: 52, v2DetectedMidis: [52], clarity: 0.6,
      }),
      rejectReason: 'non-musical-formant-harmonics',
      gateThreshold: 0.012,
      matchingEnabled: true,
      expectedMidis: [52],
    })
    expect(result.stage).toBe(MIC_SIGNAL_STAGE.EVENT_SUPPRESSED)
  })

  it('reports evaluator-rejected when the engine turned down a built event', () => {
    const result = probeSignalStages({
      frame: frame({
        rms: 0.07, filteredRms: 0.07, gateOpen: true, signalShape: 'sustained',
        midi: 62, v2DetectedMidis: [62], clarity: 0.8,
      }),
      rejectReason: 'wrong-note',
      gateThreshold: 0.012,
      matchingEnabled: true,
      expectedMidis: [60, 64, 67],
      evaluatorOutcome: 'wrong',
    })
    expect(result.stage).toBe(MIC_SIGNAL_STAGE.EVALUATOR_REJECTED)
  })

  it('reports accepted for frames flowing to the evaluator', () => {
    const result = probeSignalStages({
      frame: frame({
        rms: 0.07, filteredRms: 0.07, gateOpen: true, signalShape: 'sustained',
        midi: 60, v2DetectedMidis: [60], clarity: 0.8,
      }),
      rejectReason: null,
      gateThreshold: 0.012,
      matchingEnabled: true,
      expectedMidis: [60],
      evaluatorOutcome: 'complete',
    })
    expect(result.stage).toBe(MIC_SIGNAL_STAGE.ACCEPTED)
  })
})

describe('proposeCalibratedGate', () => {
  it('keeps an unplugged-electric-level whisper below the gate (honest gating)', () => {
    const { threshold } = proposeCalibratedGate({ noiseFloor: 0.003, instrumentId: 'guitar' })
    expect(0.004).toBeLessThan(threshold)
  })

  it('passes loud amp-level signals while following the measured floor', () => {
    const quietRoom = proposeCalibratedGate({ noiseFloor: 0.004 })
    const noisyRoom = proposeCalibratedGate({ noiseFloor: 0.02 })
    expect(noisyRoom.threshold).toBeGreaterThan(quietRoom.threshold)
    expect(0.12).toBeGreaterThan(noisyRoom.threshold)
  })

  it('nudges guitar slightly lower than piano without disabling protection', () => {
    const piano = proposeCalibratedGate({ noiseFloor: 0.005, instrumentId: 'piano' })
    const guitar = proposeCalibratedGate({ noiseFloor: 0.005, instrumentId: 'guitar' })
    expect(guitar.threshold).toBeLessThanOrEqual(piano.threshold)
    expect(guitar.threshold).toBeGreaterThan(0)
  })
})

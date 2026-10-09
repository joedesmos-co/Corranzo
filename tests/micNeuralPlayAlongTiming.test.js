/**
 * Play Along capture-clock timing (Stage M5): score-time mapping and the
 * unchanged 150 ms early / 280 ms late rules.
 * Plus readiness-gated routing (M1): flag alone never parks practice.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyPlayAlongTiming,
  mapCaptureToScoreTime,
  selectMicInputSource,
} from '../src/features/practice/useNeuralMicInput.js'
import { RECOGNITION_TIMING } from '../src/features/microphone-input/v3/micRecognitionIr.js'

describe('mapCaptureToScoreTime', () => {
  const clock = [
    { captureMs: 10_000, practiceTimeMs: 5_000 },
    { captureMs: 10_100, practiceTimeMs: 5_100 },
    { captureMs: 10_200, practiceTimeMs: 5_200 },
  ]

  it('maps an onset between samples by nearest neighbor + rate-1 extrapolation', () => {
    // Onset 50 ms after the 10_100 sample: score 5.15 s.
    expect(mapCaptureToScoreTime(clock, 10_150, null)).toBeCloseTo(5.15, 6)
  })

  it('uses the fallback practice time when the map is empty', () => {
    expect(mapCaptureToScoreTime([], 10_150, 5_000)).toBeCloseTo(5.0, 6)
  })

  it('returns null (never zero) when nothing is known', () => {
    expect(mapCaptureToScoreTime([], 10_150, null)).toBeNull()
    expect(mapCaptureToScoreTime([{ captureMs: 10_000, practiceTimeMs: null }], 10_000, null)).toBeNull()
    expect(mapCaptureToScoreTime(clock, NaN, 5_000)).toBeCloseTo(5.0, 6)
  })
})

describe('classifyPlayAlongTiming', () => {
  it('keeps the 150 ms early / 280 ms late rules', () => {
    expect(classifyPlayAlongTiming(1.0, 1.0)).toBe(RECOGNITION_TIMING.TARGET)
    expect(classifyPlayAlongTiming(0.8, 1.0)).toBe(RECOGNITION_TIMING.EARLY)
    expect(classifyPlayAlongTiming(0.86, 1.0)).toBe(RECOGNITION_TIMING.TARGET)
    expect(classifyPlayAlongTiming(1.3, 1.0)).toBe(RECOGNITION_TIMING.LATE)
    expect(classifyPlayAlongTiming(1.27, 1.0)).toBe(RECOGNITION_TIMING.TARGET)
  })

  it('marks unknown timing untimed, never on-time', () => {
    expect(classifyPlayAlongTiming(null, 1.0)).toBe(RECOGNITION_TIMING.UNTIMED)
    expect(classifyPlayAlongTiming(1.0, null)).toBe(RECOGNITION_TIMING.UNTIMED)
  })
})

describe('selectMicInputSource', () => {
  it('routes to neural only when flagged AND listening', () => {
    expect(selectMicInputSource({ flagEnabled: true, neuralPhase: 'listening' })).toBe('neural')
  })

  it('keeps spectral for every non-ready combination', () => {
    // Flag off: production behavior, always.
    expect(selectMicInputSource({ flagEnabled: false, neuralPhase: 'listening' })).toBe('spectral')
    // Flag on but model loading/warming/failed: fall back, never stall.
    for (const neuralPhase of ['idle', 'loading', 'warming', 'unavailable', null, undefined]) {
      expect(selectMicInputSource({ flagEnabled: true, neuralPhase })).toBe('spectral')
    }
  })
})

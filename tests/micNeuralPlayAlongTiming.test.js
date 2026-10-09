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
  shouldAdoptRing,
  trimAdoptedRing,
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

describe('shouldAdoptRing', () => {
  const freshRing = (ageMs) => ({
    samples: new Array(1000).fill(0),
    startCaptureMs: 10_000,
    lastAppendMs: 20_000 - ageMs,
  })

  it('adopts rings appended within the adoption window', () => {
    expect(shouldAdoptRing(freshRing(200), 20_000)).toBe(true)
    expect(shouldAdoptRing(freshRing(1500), 20_000)).toBe(true)
    expect(shouldAdoptRing(freshRing(4000), 20_000)).toBe(true)
  })

  it('rejects stale, empty, or malformed rings (never smears old takes)', () => {
    expect(shouldAdoptRing(freshRing(4001), 20_000)).toBe(false)
    expect(shouldAdoptRing(freshRing(10_000), 20_000)).toBe(false)
    expect(shouldAdoptRing(null, 20_000)).toBe(false)
    expect(shouldAdoptRing({ samples: [] }, 20_000)).toBe(false)
    expect(shouldAdoptRing({ samples: [1] }, 20_000)).toBe(false)
  })
})

describe('trimAdoptedRing', () => {
  it('keeps one trailing window and preserves sample-time mapping', () => {
    const ring = {
      samples: new Array(44100).fill(0.5),
      startCaptureMs: 10_000,
      lastAppendMs: 11_000,
      totalAppended: 44100,
    }
    trimAdoptedRing(ring, 44100)
    expect(ring.samples.length).toBe(Math.floor(0.75 * 44100))
    // 0.25 s dropped -> start advances 250 ms; accounting untouched.
    expect(ring.startCaptureMs).toBeCloseTo(10_250, 6)
    expect(ring.totalAppended).toBe(44100)
  })

  it('leaves short rings alone', () => {
    const ring = { samples: [1, 2, 3], startCaptureMs: 5 }
    trimAdoptedRing(ring, 44100)
    expect(ring.samples).toEqual([1, 2, 3])
    expect(ring.startCaptureMs).toBe(5)
  })
})

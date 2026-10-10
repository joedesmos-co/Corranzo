/**
 * Silence-skip gate (Stage M3): inference runs only with musical signal.
 */
import { describe, expect, it } from 'vitest'
import {
  calibrateNeuralFloor,
  NEURAL_AMBIENT_MAX,
  NEURAL_SILENCE_SKIP_FRAMES,
  NEURAL_SILENCE_SKIP_RMS,
  shouldSkipSilence,
} from '../src/features/microphone-input/micNeuralTfAdapter.js'

describe('shouldSkipSilence', () => {
  it('runs inference until enough history exists', () => {
    expect(shouldSkipSilence([], 0.001, 5)).toBe(false)
    expect(shouldSkipSilence([0.0001, 0.0001], 0.001, 5)).toBe(false)
  })

  it('skips sustained room silence (measured DAT floor 0.00014)', () => {
    expect(shouldSkipSilence(
      [0.0002, 0.0001, 0.0003, 0.0001, 0.0002, 0.0001],
      NEURAL_SILENCE_SKIP_RMS,
      NEURAL_SILENCE_SKIP_FRAMES,
    )).toBe(true)
  })

  it('skips the measured room-quiet ceiling (all polls <= 0.00233)', () => {
    // Overnight mission: WebGL hallucinates C4 on real room tone at
    // 0.0023 RMS and completed a [60] checkpoint; the CPU backend stays
    // silent. The floor must sit above this clip's hottest poll.
    expect(shouldSkipSilence(
      [0.00231, 0.00233, 0.00229, 0.00233, 0.00230],
      NEURAL_SILENCE_SKIP_RMS,
      NEURAL_SILENCE_SKIP_FRAMES,
    )).toBe(true)
  })

  it('never skips the softest verified real note (pp piano 0.00445)', () => {
    expect(shouldSkipSilence(
      [0.0001, 0.0002, 0.00445, 0.0001, 0.0002],
      NEURAL_SILENCE_SKIP_RMS,
      NEURAL_SILENCE_SKIP_FRAMES,
    )).toBe(false)
  })

  it('re-arms on a single louder poll (attacks are never skipped)', () => {
    expect(shouldSkipSilence(
      [0.0001, 0.0001, 0.0001, 0.0001, 0.03],
      NEURAL_SILENCE_SKIP_RMS,
      NEURAL_SILENCE_SKIP_FRAMES,
    )).toBe(false)
  })

  it('ignores non-finite meter readings instead of trusting them', () => {
    expect(shouldSkipSilence(
      [0.0001, 0.0001, NaN, 0.0001, 0.0001],
      NEURAL_SILENCE_SKIP_RMS,
      NEURAL_SILENCE_SKIP_FRAMES,
    )).toBe(false)
  })
})

describe('calibrateNeuralFloor', () => {
  it('keeps the validated fixed floor for quiet rooms', () => {
    expect(calibrateNeuralFloor(0.0023)).toBeGreaterThanOrEqual(NEURAL_SILENCE_SKIP_RMS)
    expect(calibrateNeuralFloor(0.0023)).toBeLessThan(0.004)
  })

  it('raises the floor for louder rooms without muting pp attacks', () => {
    // Hot room at 0.008 RMS: floor rises but stays far below pp attack
    // polls (0.024), so attacks always infer.
    const floor = calibrateNeuralFloor(0.008)
    expect(floor).toBeGreaterThan(NEURAL_SILENCE_SKIP_RMS)
    expect(floor).toBeLessThanOrEqual(NEURAL_AMBIENT_MAX)
    expect(floor).toBeLessThan(0.024)
  })

  it('caps the floor so loud rooms cannot mute everything', () => {
    expect(calibrateNeuralFloor(0.05)).toBe(NEURAL_AMBIENT_MAX)
  })

  it('falls back to the fixed floor on garbage input', () => {
    expect(calibrateNeuralFloor(NaN)).toBe(NEURAL_SILENCE_SKIP_RMS)
    expect(calibrateNeuralFloor(-1)).toBe(NEURAL_SILENCE_SKIP_RMS)
    expect(calibrateNeuralFloor(null)).toBe(NEURAL_SILENCE_SKIP_RMS)
  })

  it('freezes: sustained music never becomes the ambient (min-of-first-polls)', () => {
    // Caller discipline: ambient = min(first 10 polls), frozen after.
    // Even starting mid-music, the minimum is closest to the room and
    // the cap bounds the damage; afterwards nothing updates it.
    const firstPolls = [0.05, 0.04, 0.03, 0.045, 0.035, 0.05, 0.028, 0.04, 0.033, 0.038]
    const ambient = Math.min(...firstPolls)
    expect(calibrateNeuralFloor(ambient)).toBeLessThanOrEqual(NEURAL_AMBIENT_MAX)
  })
})

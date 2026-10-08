/**
 * Silence-skip gate (Stage M3): inference runs only with musical signal.
 */
import { describe, expect, it } from 'vitest'
import {
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

/**
 * Neural confirmation tracker (Stage 8, M8) — per-checkpoint emission
 * identity: each confirmed tone emits once; checkpoint changes reset.
 */
import { describe, expect, it } from 'vitest'
import {
  createNeuralConfirmTracker,
  resetNeuralConfirmTracker,
  takeNewlyConfirmed,
} from '../src/features/practice/micNeuralConfirmTracker.js'

describe('micNeuralConfirmTracker', () => {
  it('emits each confirmed tone once per checkpoint', () => {
    const tracker = createNeuralConfirmTracker()
    expect(takeNewlyConfirmed(tracker, 'cp-1', [60, 64])).toEqual([60, 64])
    expect(takeNewlyConfirmed(tracker, 'cp-1', [60, 64, 67])).toEqual([67])
    expect(takeNewlyConfirmed(tracker, 'cp-1', [60])).toEqual([])
  })

  it('resets on checkpoint change without leaking confirmations', () => {
    const tracker = createNeuralConfirmTracker()
    takeNewlyConfirmed(tracker, 'cp-1', [60, 64])
    expect(takeNewlyConfirmed(tracker, 'cp-2', [60])).toEqual([60])
  })

  it('resets explicitly', () => {
    const tracker = createNeuralConfirmTracker()
    takeNewlyConfirmed(tracker, 'cp-1', [60])
    resetNeuralConfirmTracker(tracker, 'cp-1')
    expect(takeNewlyConfirmed(tracker, 'cp-1', [60])).toEqual([60])
  })

  it('requires state', () => {
    expect(() => takeNewlyConfirmed(null, 'cp', [60])).toThrow()
  })
})

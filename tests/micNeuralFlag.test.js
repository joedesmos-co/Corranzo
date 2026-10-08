/**
 * Neural-microphone flag (Stage 6, N9): default OFF everywhere, explicit
 * opt-in only. No live listening path consults it yet.
 */
import { describe, expect, it } from 'vitest'
import {
  decideMicNeuralEnabled,
  isMicNeuralEnabled,
  MIC_NEURAL_FLAG,
  MIC_NEURAL_STORAGE_KEY,
} from '../src/features/microphone-input/micEngineFlag.js'

describe('micNeural flag', () => {
  it('is off by default in every environment', () => {
    expect(decideMicNeuralEnabled({})).toBe(false)
    expect(decideMicNeuralEnabled({ defaultEnabled: false })).toBe(false)
    expect(isMicNeuralEnabled()).toBe(false)
  })

  it('opts in explicitly via override, global, or storage', () => {
    expect(decideMicNeuralEnabled({ override: true })).toBe(true)
    expect(decideMicNeuralEnabled({ globalValue: '1' })).toBe(true)
    expect(decideMicNeuralEnabled({ storageValue: 'yes' })).toBe(true)
  })

  it('honors explicit false (never turns itself on)', () => {
    expect(decideMicNeuralEnabled({ override: false, defaultEnabled: true })).toBe(false)
    expect(decideMicNeuralEnabled({ storageValue: '0', defaultEnabled: true })).toBe(false)
  })

  it('exposes stable flag identifiers', () => {
    expect(MIC_NEURAL_FLAG).toBe('micNeural')
    expect(MIC_NEURAL_STORAGE_KEY).toBe('scoreflow.flags.micNeural')
  })
})

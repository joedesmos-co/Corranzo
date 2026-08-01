import { describe, expect, it } from 'vitest'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  getMicAttackRearmReason,
  markMicAttackConsumed,
  resetMicAttackLatch,
  updateMicAttackRelease,
} from '../src/features/practice/micAttackLatch.js'

describe('micAttackLatch', () => {
  it('blocks further matches until the gate closes after a consumed attack', () => {
    const latch = createMicAttackLatchState()
    expect(canAcceptMicAttackMatch(latch)).toBe(true)

    markMicAttackConsumed(latch)
    expect(canAcceptMicAttackMatch(latch)).toBe(false)

    updateMicAttackRelease(latch, true)
    expect(canAcceptMicAttackMatch(latch)).toBe(false)

    for (let index = 0; index < 3; index += 1) {
      updateMicAttackRelease(latch, false)
    }
    expect(canAcceptMicAttackMatch(latch)).toBe(false)

    updateMicAttackRelease(latch, false)
    expect(canAcceptMicAttackMatch(latch)).toBe(true)
  })

  it('resets only when explicitly cleared', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch)
    resetMicAttackLatch(latch)
    expect(canAcceptMicAttackMatch(latch)).toBe(true)
  })

  it('rearms a repeated low note from a coherent attack transient without full silence', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [36] })
    for (let index = 0; index < 8; index += 1) {
      updateMicAttackRelease(latch, true, {
        rms: 0.08 - index * 0.001,
        spectralEnergy: 0.0009 - index * 0.00001,
      })
    }
    const reason = getMicAttackRearmReason(
      latch,
      {
        gateOpen: true,
        filteredRms: 0.079,
        spectralEnergy: 0.00145,
        signalShape: 'sustained',
        v2Notes: [{
          midi: 36,
          detected: true,
          confidence: 0.9,
          ratio: 5,
          harmonicSupport: 0.6,
        }],
      },
      { expectedMidis: [36] },
    )
    expect(reason).toBe('low-note-transient')
  })

  it('does not turn spectral drift in one sustained low note into another attack', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [36] })
    for (let index = 0; index < 10; index += 1) {
      updateMicAttackRelease(latch, true, {
        rms: 0.09 - index * 0.001,
        spectralEnergy: 0.0009 - index * 0.00001,
      })
    }
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.083,
          spectralEnergy: 0.00118,
          signalShape: 'sustained',
          v2Notes: [{
            midi: 36,
            detected: true,
            confidence: 0.9,
            ratio: 5,
            harmonicSupport: 0.6,
          }],
        },
        { expectedMidis: [36] },
      ),
    ).toBeNull()
  })

  it('accepts a compressed low re-attack whose harmonic evidence is strong', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [36] })
    for (let index = 0; index < 8; index += 1) {
      updateMicAttackRelease(latch, true, {
        rms: 0.1 - index * 0.002,
        spectralEnergy: 0.0049,
      })
    }
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.125,
          spectralEnergy: 0.005,
          signalShape: 'sustained',
          v2Notes: [{
            midi: 36,
            detected: true,
            confidence: 0.86,
            ratio: 4.8,
            harmonicSupport: 0.65,
          }],
        },
        { expectedMidis: [36] },
      ),
    ).toBe('low-note-transient')
  })

  it('does not rearm a held low note from a broadband percussive interruption', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [36] })
    for (let index = 0; index < 8; index += 1) {
      updateMicAttackRelease(latch, true, {
        rms: 0.08,
        spectralEnergy: 0.0008,
      })
    }
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.081,
          spectralEnergy: 0.004,
          signalShape: 'percussive',
          v2Notes: [{
            midi: 36,
            detected: true,
            confidence: 0.9,
            ratio: 5,
            harmonicSupport: 0.6,
          }],
        },
        { expectedMidis: [36] },
      ),
    ).toBeNull()
  })
})

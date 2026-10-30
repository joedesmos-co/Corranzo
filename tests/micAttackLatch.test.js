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
        // A real re-attack follows a decay of the previous low string; 1%
        // drift is the same attack, not a new one.
        rms: 0.08 - index * 0.005,
        transientRms: 0.03 - index * 0.002,
        spectralEnergy: 0.0009 - index * 0.00001,
      })
    }
    const reason = getMicAttackRearmReason(
      latch,
      {
        gateOpen: true,
        filteredRms: 0.06,
        transientRms: 0.04,
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

  it('does not rearm from the rising envelope of the attack just consumed', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [60] })
    // The same piano/guitar attack reaches its peak after the detector has
    // already accepted it. Those rising frames are not a new attack.
    for (const rms of [0.04, 0.06, 0.082, 0.104]) {
      updateMicAttackRelease(latch, true, { rms })
    }
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.12,
          signalShape: 'sustained',
          v2Notes: [{
            midi: 60,
            detected: true,
            confidence: 0.9,
            ratio: 5,
            harmonicSupport: 0.6,
          }],
        },
        { expectedMidis: [60] },
      ),
    ).toBeNull()
  })

  it('rearms a same-note repeat after the previous attack has decayed', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [60] })
    const decay = [
      [0.12, 0.02], [0.11, 0.017], [0.095, 0.014], [0.08, 0.011],
      [0.07, 0.009], [0.065, 0.008],
    ]
    for (const [rms, transientRms] of decay) {
      updateMicAttackRelease(latch, true, { rms, transientRms })
    }
    expect(latch.decayedSinceConsumed).toBe(true)
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.13,
          transientRms: 0.03,
          signalShape: 'sustained',
          v2Notes: [{
            midi: 60,
            detected: true,
            confidence: 0.9,
            ratio: 5,
            harmonicSupport: 0.6,
          }],
        },
        { expectedMidis: [60] },
      ),
    ).toBe('energy-rise')
  })

  it('admits a quieter same-pitch low retrigger by its derivative transient', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [55], staleBoundary: true })
    // Loud first attack, then decay; the second pluck is quieter than the
    // still-ringing first note, so RMS is falling while the derivative spikes.
    const frames = [
      [0.16, 0.012], [0.15, 0.011], [0.13, 0.010], [0.11, 0.009],
      [0.09, 0.009], [0.08, 0.009], [0.075, 0.009],
    ]
    for (const [rms, transientRms] of frames) {
      updateMicAttackRelease(latch, true, { rms, transientRms, spectralEnergy: 0.005 })
    }
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.085,
          transientRms: 0.0155,
          spectralEnergy: 0.037,
          signalShape: 'sustained',
          v2DetectedMidis: [55],
          v2Notes: [{
            midi: 55,
            detected: true,
            confidence: 0.42,
            ratio: 1.9,
            harmonicSupport: 0.5,
          }],
        },
        { expectedMidis: [55] },
      ),
    ).toBe('low-note-transient')
  })

  it('does not let a stale dyad ring re-arm on a spectral wobble', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [55, 59], staleBoundary: true })
    const frames = [
      [0.085, 0.0048], [0.083, 0.0046], [0.073, 0.0043], [0.066, 0.0042],
      [0.059, 0.0040], [0.050, 0.0037], [0.045, 0.0036],
    ]
    for (const [rms, transientRms] of frames) {
      updateMicAttackRelease(latch, true, { rms, transientRms, spectralEnergy: 0.0026 })
    }
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.045,
          transientRms: 0.0035,
          spectralEnergy: 0.0061,
          signalShape: 'sustained',
          v2DetectedMidis: [55, 59],
          v2Notes: [{
            midi: 55,
            detected: true,
            confidence: 0.5,
            ratio: 2.4,
            harmonicSupport: 0.6,
          }],
        },
        { expectedMidis: [55, 59] },
      ),
    ).toBeNull()
  })

  it('does not let a brief gate flicker release a stale wrong-note boundary', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [], staleBoundary: true })
    for (let index = 0; index < 4; index += 1) {
      updateMicAttackRelease(latch, false)
    }
    expect(canAcceptMicAttackMatch(latch)).toBe(false)
    expect(latch.staleBoundary).toBe(true)
    for (let index = 0; index < 6; index += 1) {
      updateMicAttackRelease(latch, false)
    }
    expect(canAcceptMicAttackMatch(latch)).toBe(true)
    expect(latch.staleBoundary).toBe(false)
  })

  it('blocks pitch-only re-arm while a stale wrong-note boundary is active', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [], staleBoundary: true })
    for (let index = 0; index < 6; index += 1) {
      updateMicAttackRelease(latch, true, { rms: 0.04, transientRms: 0.005 })
    }
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.05,
          transientRms: 0.006,
          signalShape: 'sustained',
          v2DetectedMidis: [60],
          v2Notes: [{
            midi: 60,
            detected: true,
            confidence: 0.9,
            ratio: 5,
            harmonicSupport: 0.6,
          }],
        },
        { expectedMidis: [60] },
      ),
    ).toBeNull()
  })

  it('accepts a compressed low re-attack whose harmonic evidence is strong', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [36] })
    for (let index = 0; index < 8; index += 1) {
      updateMicAttackRelease(latch, true, {
        rms: 0.1 - index * 0.006,
        transientRms: 0.03 - index * 0.0015,
        spectralEnergy: 0.0049,
      })
    }
    expect(
      getMicAttackRearmReason(
        latch,
        {
          gateOpen: true,
          filteredRms: 0.125,
          transientRms: 0.04,
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
    ).toEqual(expect.stringMatching(/low-note-transient|energy-rise/))
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

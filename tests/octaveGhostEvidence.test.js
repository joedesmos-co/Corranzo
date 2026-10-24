/**
 * Odd-partial octave-ghost evidence (detection evidence → expectation
 * decision). Pure, no audio APIs.
 */
import { describe, expect, it } from 'vitest'
import { octaveGhostFromHalfPartial } from '../src/features/microphone-input/v3/octaveGhostEvidence.js'

function frame({ dominant, midi = 67, ratio = 0.18, fundamental = 0.03, notes = null }) {
  return {
    midiFloat: dominant,
    v2Notes: notes ?? [
      { midi, detected: true, confidence: 0.6, fundamentalEnergy: fundamental, halfPartialRatio: ratio },
    ],
  }
}

describe('octaveGhostFromHalfPartial', () => {
  it('reports the played pitch when the lower octave\u2019s 3rd partial is strong', () => {
    expect(octaveGhostFromHalfPartial(frame({ dominant: 55.2 }), [67])).toBe(55)
  })

  it('stays silent when the expected note is the sounding pitch (dominant agrees)', () => {
    expect(octaveGhostFromHalfPartial(frame({ dominant: 67.1 }), [67])).toBe(null)
  })

  it('stays silent when the half-partial band is clean (true upper note)', () => {
    expect(octaveGhostFromHalfPartial(frame({ dominant: 55.2, ratio: 0.03 }), [67])).toBe(null)
  })

  it('never vetoes on a vanishing fundamental (ratio is noise there)', () => {
    expect(octaveGhostFromHalfPartial(frame({ dominant: 55.2, ratio: 0.9, fundamental: 1e-7 }), [67])).toBe(null)
  })

  it('leaves chord expectations to the chord paths (documented limit)', () => {
    // Chord octave expectations are NOT handled here: a real fifth above a
    // chord tone lights its 1.5f band, and the dominant may be an octave
    // flip. Measured on real triads; documented as a limitation.
    expect(octaveGhostFromHalfPartial(frame({ dominant: 55.2 }), [55, 67])).toBe(null)
    expect(octaveGhostFromHalfPartial(frame({ dominant: 60.2 }), [60, 72])).toBe(null)
  })


  it('requires the measured evidence to be present', () => {
    const missing = { midiFloat: 55.2, v2Notes: [{ midi: 67, detected: true }] }
    expect(octaveGhostFromHalfPartial(missing, [67])).toBe(null)
    expect(octaveGhostFromHalfPartial({}, [67])).toBe(null)
    expect(octaveGhostFromHalfPartial(null, [67])).toBe(null)
  })

  it('honours a calibrated threshold override', () => {
    expect(octaveGhostFromHalfPartial(frame({ dominant: 55.2, ratio: 0.12 }), [67], { octaveGhostHalfPartialRatio: 0.15 })).toBe(null)
    expect(octaveGhostFromHalfPartial(frame({ dominant: 55.2, ratio: 0.16 }), [67], { octaveGhostHalfPartialRatio: 0.15 })).toBe(55)
  })
})

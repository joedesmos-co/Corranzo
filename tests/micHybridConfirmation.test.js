/**
 * Hybrid confirmation (Stage 2, S4) — the score may confirm, never manufacture.
 */
import { describe, expect, it } from 'vitest'
import { confirmBlindCandidates } from '../src/features/microphone-input/micHybridConfirmation.js'

function blind(midis, confidence = 0.8) {
  return midis.map((midi) => ({ midi, midiFloat: midi, confidence, detected: true }))
}

describe('micHybridConfirmation', () => {
  it('confirms the full expected chord from independent blind evidence', () => {
    const result = confirmBlindCandidates(blind([60, 64, 67]), [60, 64, 67])
    expect(result.complete).toBe(true)
    expect(result.confirmedMidis).toEqual([60, 64, 67])
    expect(result.missingMidis).toEqual([])
    expect(result.unexpectedMidis).toEqual([])
    expect(Object.keys(result.evidence)).toEqual(['60', '64', '67'])
  })

  it('REFUSES to award C major when D F A was actually played', () => {
    const result = confirmBlindCandidates(blind([62, 65, 69]), [60, 64, 67])
    expect(result.complete).toBe(false)
    expect(result.confirmedMidis).toEqual([])
    expect(result.missingMidis).toEqual([60, 64, 67])
    expect(result.unexpectedMidis).toEqual([62, 65, 69])
  })

  it('reports partial chords with the exact missing tones', () => {
    const result = confirmBlindCandidates(blind([60, 64]), [60, 64, 67])
    expect(result.complete).toBe(false)
    expect(result.partial).toBe(true)
    expect(result.confirmedMidis).toEqual([60, 64])
    expect(result.missingMidis).toEqual([67])
  })

  it('keeps unexpected extra tones instead of silently dropping them', () => {
    const result = confirmBlindCandidates(blind([60, 64, 67, 69]), [60, 64, 67])
    expect(result.complete).toBe(true)
    expect(result.unexpectedMidis).toEqual([69])
  })

  it('confirms nothing on silence', () => {
    const result = confirmBlindCandidates([], [60, 64, 67])
    expect(result.complete).toBe(false)
    expect(result.confirmedMidis).toEqual([])
    expect(result.missingMidis).toEqual([60, 64, 67])
  })

  it('ignores weak blind evidence below the confirmation floor', () => {
    const result = confirmBlindCandidates(blind([60, 64, 67], 0.1), [60, 64, 67])
    expect(result.complete).toBe(false)
    expect(result.missingMidis).toEqual([60, 64, 67])
  })
})

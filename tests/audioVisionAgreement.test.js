import { describe, it, expect } from 'vitest'
import {
  spectralSecondOpinion,
  scoreAgreement,
  AGREEMENT_UNCERTAIN_THRESHOLD,
} from '../src/features/audio-vision/agreementScore.js'

describe('§5 agreement-based transcription confidence', () => {
  it('marks windows where an independent second opinion disagrees', () => {
    // Primary always plays C major; second opinion hears Eb (d dissonant) in 4-6s.
    const primary = [
      { midi: 60, startSeconds: 0, endSeconds: 1 },
      { midi: 64, startSeconds: 1, endSeconds: 2 },
      { midi: 67, startSeconds: 2, endSeconds: 3 },
      { midi: 72, startSeconds: 3, endSeconds: 4 },
      { midi: 74, startSeconds: 4, endSeconds: 5 },
      { midi: 76, startSeconds: 5, endSeconds: 6 },
    ]
    const second = primary.slice(0, 3).concat([
      { midi: 63, startSeconds: 3, endSeconds: 4 },
      { midi: 65, startSeconds: 4, endSeconds: 5 },
      { midi: 66, startSeconds: 5, endSeconds: 6 },
    ])
    const scored = scoreAgreement(primary, second, { totalSeconds: 6, windowSeconds: 1 })
    expect(scored.agreement).toBeLessThan(0.8)
    expect(scored.uncertainRegions.length).toBe(3)
    for (const region of scored.uncertainRegions) {
      expect(region.agreement).toBeLessThan(AGREEMENT_UNCERTAIN_THRESHOLD)
      expect(region.endSeconds).toBeGreaterThan(region.startSeconds)
    }
  })

  it('agrees perfectly when both transcribers hear the same music', () => {
    const notes = Array.from({ length: 6 }, (_, i) => ({ midi: 60 + i, startSeconds: i, endSeconds: i + 1 }))
    const scored = scoreAgreement(notes, notes, { totalSeconds: 6 })
    expect(scored.agreement).toBe(1)
    expect(scored.uncertainRegions).toEqual([])
  })

  it('degrades honestly without a second opinion', () => {
    const notes = [{ midi: 60, startSeconds: 0, endSeconds: 1 }]
    const scored = scoreAgreement(notes, [], { totalSeconds: 2 })
    expect(scored.agreement).toBe(null)
    expect(scored.source).toBe('degraded')
  })

  it('second opinion is model-free and carries only detected provenance', () => {
    const fftSize = 2048
    const sampleRate = 22050
    // One frame with a strong 440 Hz bin.
    const spectrum = new Float64Array(fftSize / 2)
    spectrum[Math.round(440 / (sampleRate / fftSize))] = 10
    const frames = [spectrum, spectrum]
    const onsets = [{ seconds: 0 }, { seconds: 0.5 }]
    const notes = spectralSecondOpinion({ harmonicFrames: frames, onsets, totalSeconds: 1, fftSize, sampleRate })
    expect(notes.length).toBeGreaterThan(0)
    for (const note of notes) {
      expect(note.provenance).toBe('detected')
      expect(note.midi).toBeGreaterThan(0)
      expect(Number.isFinite(note.startSeconds)).toBe(true)
    }
  })
})

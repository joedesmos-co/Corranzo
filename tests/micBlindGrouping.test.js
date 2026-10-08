/**
 * Strum-aware blind persistence (Stage 4 P1) — onset-anchored grouping
 * retains what vote counting drops.
 */
import { describe, expect, it } from 'vitest'
import { replayBlindPolyphonyEvents } from '../src/features/microphone-input/v2/blindPolyphonicDetector.js'
import {
  synthRolledChord,
  synthSimultaneousChord,
} from '../src/features/microphone-input/micSyntheticChordClips.js'
import { synthSilence } from '../src/features/microphone-input/micSyntheticClips.js'

const SAMPLE_RATE = 44100

/**
 * Live capture always runs before the first attack, so take-start taint
 * sees room — never the chord. Synthetic clips start mid-note, so tests
 * prepend a short silence preroll to honor the same contract.
 */
function withPreroll(samples, prerollSeconds = 0.3) {
  const preroll = synthSilence(SAMPLE_RATE, prerollSeconds)
  const out = new Float32Array(preroll.length + samples.length)
  out.set(preroll, 0)
  out.set(samples, preroll.length)
  return out
}

describe('replayBlindPolyphonyEvents', () => {
  it('groups a simultaneous triad into one event with all tones + onsets', () => {
    const samples = withPreroll(synthSimultaneousChord([60, 64, 67], SAMPLE_RATE, {}))
    const { groups } = replayBlindPolyphonyEvents(samples, SAMPLE_RATE, {})
    expect(groups.length).toBeGreaterThanOrEqual(1)
    const first = groups[0]
    expect([...first.midis].sort((a, b) => a - b)).toEqual([60, 64, 67])
    expect(first.type).toBe('simultaneous')
    expect(first.notes).toHaveLength(3)
    for (const note of first.notes) {
      expect(note.maxConfidence).toBeGreaterThanOrEqual(note.confidence)
    }
  })

  it('groups a staggered strum into one strummed event, not vote-loss', () => {
    const samples = withPreroll(synthRolledChord([60, 64, 67], SAMPLE_RATE, { staggerMs: 80 }))
    const { groups } = replayBlindPolyphonyEvents(samples, SAMPLE_RATE, {})
    const chordGroups = groups.filter((group) => group.midis.length > 1)
    expect(chordGroups.length).toBeGreaterThanOrEqual(1)
    expect(chordGroups[0].midis).toEqual([60, 64, 67])
    expect(chordGroups[0].type).toBe('strummed')
  })

  it('emits no groups on silence', () => {
    const samples = synthSilence(SAMPLE_RATE, 0.8)
    const { groups } = replayBlindPolyphonyEvents(samples, SAMPLE_RATE, {})
    expect(groups).toEqual([])
  })
})

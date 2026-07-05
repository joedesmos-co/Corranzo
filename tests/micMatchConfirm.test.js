/**
 * Unit tests for the mic match confirmation window: consecutive-frame
 * confirmation, the pitch-drift guard that blocks sweeping speech prosody,
 * and the autocorrelation cross-check that blocks near-target wrong notes
 * (Goertzel probe leakage from a semitone/quarter-tone away).
 */
import { describe, expect, it } from 'vitest'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  frameCorroboratesSingleNote,
  MIC_MATCH_CONFIRM_FRAMES,
  MIC_MATCH_PITCH_DRIFT_CENTS,
} from '../src/features/practice/micMatchConfirm.js'

function runFrames(state, key, entries) {
  let confirmed = false
  for (const entry of entries) {
    confirmed = confirmConfidentMatch(state, key, entry.confident ?? true, {
      pitchCents: entry.pitchCents ?? null,
    })
  }
  return confirmed
}

describe('confirmConfidentMatch pitch-drift guard', () => {
  it('confirms a steady pitch after the required frame count', () => {
    const state = createMatchConfirmState()
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES }, () => ({
      pitchCents: 6000,
    }))
    expect(runFrames(state, 'k', frames)).toBe(true)
  })

  it('tolerates drift inside the limit (instrument vibrato)', () => {
    const state = createMatchConfirmState()
    const wobble = MIC_MATCH_PITCH_DRIFT_CENTS - 5
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES }, (_, index) => ({
      pitchCents: 6000 + (index % 2 === 0 ? 0 : wobble),
    }))
    expect(runFrames(state, 'k', frames)).toBe(true)
  })

  it('restarts the run when pitch sweeps past the drift limit (speech prosody)', () => {
    const state = createMatchConfirmState()
    // Each frame moves +30 cents: every frame drifts past the 25-cent anchor.
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES * 3 }, (_, index) => ({
      pitchCents: 6000 + index * (MIC_MATCH_PITCH_DRIFT_CENTS + 5),
    }))
    expect(runFrames(state, 'k', frames)).toBe(false)
  })

  it('still confirms without pitch info (chord paths pass pitchCents=null)', () => {
    const state = createMatchConfirmState()
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES }, () => ({}))
    expect(runFrames(state, 'k', frames)).toBe(true)
  })
})

describe('frameCorroboratesSingleNote', () => {
  const options = { centsTolerance: 35 }

  it('accepts when autocorrelation agrees with the expected note', () => {
    expect(frameCorroboratesSingleNote({ midiFloat: 60.05 }, 60, options)).toBe(true)
  })

  it('accepts small detune inside tolerance plus slack', () => {
    expect(frameCorroboratesSingleNote({ midiFloat: 60.4 }, 60, options)).toBe(true)
  })

  it('rejects a semitone-off played pitch (probe leakage)', () => {
    expect(frameCorroboratesSingleNote({ midiFloat: 61.02 }, 60, options)).toBe(false)
  })

  it('rejects a detune beyond tolerance plus slack', () => {
    expect(frameCorroboratesSingleNote({ midiFloat: 60.55 }, 60, options)).toBe(false)
  })

  it('is octave-invariant (autocorrelation octave flips are not contradictions)', () => {
    expect(frameCorroboratesSingleNote({ midiFloat: 72.1 }, 60, options)).toBe(true)
    expect(frameCorroboratesSingleNote({ midiFloat: 48.02 }, 60, options)).toBe(true)
  })

  it('passes through when no autocorrelation pitch is available', () => {
    expect(frameCorroboratesSingleNote({ midiFloat: null }, 60, options)).toBe(true)
    expect(frameCorroboratesSingleNote({}, 60, options)).toBe(true)
  })

  it('never contradicts notes below the autocorrelation band (deep bass)', () => {
    // A0 (27.5 Hz) cannot be tracked; the estimator returns boundary garbage
    // (measured: pinned near MIDI 89). That garbage must not block the match.
    expect(frameCorroboratesSingleNote({ midiFloat: 89.3 }, 21, options)).toBe(true)
    expect(frameCorroboratesSingleNote({ midiFloat: 89.3 }, 31, options)).toBe(true)
  })

  it('ignores estimates pinned outside the tracked band for in-band targets', () => {
    expect(frameCorroboratesSingleNote({ midiFloat: 100.2 }, 60, options)).toBe(true)
  })
})

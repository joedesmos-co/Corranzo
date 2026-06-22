/**
 * Microphone single-note reliability: pitch detection, calibration, the note
 * stabilizer (attack skip / octave reject / repeat guard) and cents-tolerant
 * matching. These are the Wait For You mic-mode guarantees.
 */
import { describe, expect, it } from 'vitest'
import {
  detectPitchAutocorrelation,
  pitchToMidiNote,
  quantizeMidi,
  frequencyToMidi,
  frequencyMatchesMidi,
} from '../src/features/microphone-input/pitchDetection.js'
import {
  createNoteStabilizer,
  pushStableNote,
  resetNoteStabilizer,
} from '../src/features/microphone-input/noteStabilizer.js'
import {
  createMicCalibration,
  pushCalibrationSample,
  finalizeMicCalibration,
  MIC_CALIBRATION_STATUS,
} from '../src/features/microphone-input/micCalibration.js'
import { passesNoiseGate } from '../src/features/microphone-input/micNoiseGate.js'
import { evaluateMicNoteInput, MATCH_OUTCOME } from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const SAMPLE_RATE = 44100

function synthSine(frequency, amplitude = 0.35, seconds = 0.25) {
  const length = Math.floor(SAMPLE_RATE * seconds)
  const buffer = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    buffer[i] = Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) * amplitude
  }
  return buffer
}

function feed(stabilizer, frames, sample) {
  let emitted = null
  for (let i = 0; i < frames; i += 1) {
    const v = pushStableNote(stabilizer, sample())
    if (v != null) emitted = v
  }
  return emitted
}

// ─── pitch detection ────────────────────────────────────────────────────────

describe('pitch detection', () => {
  it('detects a clean A4 sine as MIDI 69', () => {
    const note = pitchToMidiNote(detectPitchAutocorrelation(synthSine(440), SAMPLE_RATE))
    expect(note?.midi).toBe(69)
  })

  it('ignores a near-silent signal (too quiet)', () => {
    const quiet = synthSine(440, 0.002)
    expect(detectPitchAutocorrelation(quiet, SAMPLE_RATE)).toBeNull()
  })

  it('ignores white noise (no stable pitch)', () => {
    const noise = new Float32Array(SAMPLE_RATE * 0.25)
    let seed = 7
    for (let i = 0; i < noise.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      noise[i] = (seed / 0x7fffffff) * 2 - 1
    }
    const note = pitchToMidiNote(detectPitchAutocorrelation(noise, SAMPLE_RATE))
    // Either no pitch, or low-clarity → not a confident note.
    expect(note).toBeNull()
  })
})

// ─── cents tolerance ──────────────────────────────────────────────────────────

describe('cents tolerance', () => {
  it('quantizeMidi rejects a pitch outside tolerance, accepts within', () => {
    // 60.4 = 40 cents sharp of C4 (60).
    expect(quantizeMidi(60.4, 30)).toBeNull()
    expect(quantizeMidi(60.4, 50)).toBe(60)
    expect(quantizeMidi(60.1, 30)).toBe(60)
  })

  it('pitchToMidiNote honours a configurable cents tolerance', () => {
    // ~40 cents above C4 (261.63 Hz → 268.7 Hz).
    const freq = 440 * 2 ** ((60.4 - 69) / 12)
    const pitch = { frequency: freq, clarity: 0.9, rms: 0.1 }
    expect(pitchToMidiNote(pitch, { centsTolerance: 25 })).toBeNull()
    expect(pitchToMidiNote(pitch, { centsTolerance: 50 })?.midi).toBe(60)
  })

  it('frequencyMatchesMidi compares within cents', () => {
    const c4 = 440 * 2 ** ((60 - 69) / 12)
    expect(frequencyMatchesMidi(c4, 60, 30)).toBe(true)
    const c4Sharp40 = 440 * 2 ** ((60.4 - 69) / 12)
    expect(frequencyMatchesMidi(c4Sharp40, 60, 30)).toBe(false)
    expect(frequencyMatchesMidi(c4Sharp40, 60, 50)).toBe(true)
  })

  it('default match settings expose ~30 cents tolerance, clamped to a sane range', () => {
    expect(normalizeMatchSettings({}).micCentsTolerance).toBe(30)
    expect(normalizeMatchSettings({ micCentsTolerance: 1000 }).micCentsTolerance).toBeLessThanOrEqual(50)
    expect(normalizeMatchSettings({ micCentsTolerance: 0 }).micCentsTolerance).toBeGreaterThanOrEqual(15)
  })
})

// ─── note stabilizer ──────────────────────────────────────────────────────────

describe('note stabilizer', () => {
  const opts = { holdFrames: 4, minClarity: 0.35, minSilenceFrames: 4, minSameNoteGapMs: 0, minRms: 0.01, attackFrames: 2 }

  it('accepts a stable, confident pitch', () => {
    const s = createNoteStabilizer(opts)
    const emitted = feed(s, 10, () => ({ midi: 60, clarity: 0.9, rms: 0.1 }))
    expect(emitted).toBe(60)
  })

  it('rejects unstable/jumping pitch', () => {
    const s = createNoteStabilizer(opts)
    let i = 0
    const emitted = feed(s, 12, () => ({ midi: i++ % 2 === 0 ? 60 : 67, clarity: 0.9, rms: 0.1 }))
    expect(emitted).toBeNull() // never holds a single pitch
  })

  it('ignores quiet input (below minRms)', () => {
    const s = createNoteStabilizer(opts)
    const emitted = feed(s, 10, () => ({ midi: 60, clarity: 0.9, rms: 0.002 }))
    expect(emitted).toBeNull()
  })

  it('ignores low-confidence frames (below minClarity)', () => {
    const s = createNoteStabilizer(opts)
    const emitted = feed(s, 10, () => ({ midi: 60, clarity: 0.1, rms: 0.1 }))
    expect(emitted).toBeNull()
  })

  it('skips the attack transient before counting the hold window', () => {
    const s = createNoteStabilizer({ ...opts, attackFrames: 3, holdFrames: 3 })
    // Exactly attackFrames + holdFrames - 1 frames should NOT emit yet.
    expect(feed(s, 3 + 3 - 1, () => ({ midi: 60, clarity: 0.9, rms: 0.1 }))).toBeNull()
    // One more frame crosses the threshold.
    expect(pushStableNote(s, { midi: 60, clarity: 0.9, rms: 0.1 })).toBe(60)
  })

  it('suppresses a transient octave glitch on a building candidate', () => {
    const s = createNoteStabilizer({ ...opts, holdFrames: 5, attackFrames: 1 })
    const seq = [60, 60, 72, 60, 60, 60, 60] // one octave glitch (72) mid-hold
    let emitted = null
    for (const midi of seq) {
      const v = pushStableNote(s, { midi, clarity: 0.9, rms: 0.1 })
      if (v != null) emitted = v
    }
    // The glitch is ignored; the candidate stays 60 and eventually emits 60.
    expect(emitted).toBe(60)
  })

  it('does not double-trigger a sustained note (re-trigger needs silence + gap)', () => {
    const s = createNoteStabilizer({ ...opts, minSameNoteGapMs: 200 })
    // Sustained note: emits once, then keeps holding without silence.
    let emits = 0
    for (let i = 0; i < 30; i += 1) {
      if (pushStableNote(s, { midi: 60, clarity: 0.9, rms: 0.1, now: 1000 + i * 16 }) != null) {
        emits += 1
      }
    }
    expect(emits).toBe(1)
  })

  it('re-triggers the same note after a silence gap', () => {
    const s = createNoteStabilizer({ ...opts, minSameNoteGapMs: 0 })
    const first = feed(s, 8, () => ({ midi: 60, clarity: 0.9, rms: 0.1 }))
    feed(s, 6, () => ({ midi: null, clarity: 0, rms: 0 })) // silence
    const second = feed(s, 8, () => ({ midi: 60, clarity: 0.9, rms: 0.1 }))
    expect(first).toBe(60)
    expect(second).toBe(60)
  })

  it('reset clears all internal state', () => {
    const s = createNoteStabilizer(opts)
    feed(s, 3, () => ({ midi: 60, clarity: 0.9, rms: 0.1 }))
    resetNoteStabilizer(s)
    expect(s.candidateMidi).toBeNull()
    expect(s.onsetFrames).toBe(0)
    expect(s.armed).toBe(true)
  })
})

// ─── matching: octave rejection ───────────────────────────────────────────────

describe('matching', () => {
  const settings = normalizeMatchSettings({})

  it('accepts the expected pitch', () => {
    const result = evaluateMicNoteInput({ expectedMidi: 60 }, 60, settings)
    expect(result.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('rejects an octave error when octave mistakes are off', () => {
    const result = evaluateMicNoteInput({ expectedMidi: 60 }, 72, settings)
    expect(result.outcome).toBe(MATCH_OUTCOME.WRONG)
  })

  it('accepts an octave when octave mistakes are allowed', () => {
    const lenient = normalizeMatchSettings({ allowOctaveMistakes: true, exactPitch: false })
    const result = evaluateMicNoteInput({ expectedMidi: 60 }, 72, lenient)
    expect(result.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })
})

// ─── calibration ──────────────────────────────────────────────────────────────

describe('mic calibration', () => {
  function calibrate(rmsValues) {
    const state = createMicCalibration({ frames: rmsValues.length })
    for (const rms of rmsValues) pushCalibrationSample(state, rms)
    return finalizeMicCalibration(state)
  }

  it('a quiet room is ready with a low gate above the floor', () => {
    const result = calibrate(new Array(45).fill(0.004))
    expect(result.status).toBe(MIC_CALIBRATION_STATUS.READY)
    expect(result.roomQuality).toBe('quiet')
    expect(result.gateThreshold).toBeGreaterThan(result.noiseFloor)
    // A real note above the gate passes; the room floor does not.
    expect(passesNoiseGate(0.05, result.noiseFloor)).toBe(true)
    expect(passesNoiseGate(result.noiseFloor, result.noiseFloor)).toBe(false)
  })

  it('a noisy room reports room-noisy with a higher gate', () => {
    const quiet = calibrate(new Array(45).fill(0.004))
    const noisy = calibrate(new Array(45).fill(0.05))
    expect(noisy.status).toBe(MIC_CALIBRATION_STATUS.ROOM_NOISY)
    expect(noisy.gateThreshold).toBeGreaterThan(quiet.gateThreshold)
  })

  it('a dead/muted mic reports no input', () => {
    const result = calibrate(new Array(45).fill(0))
    expect(result.status).toBe(MIC_CALIBRATION_STATUS.NO_INPUT)
    expect(result.ready).toBe(false)
  })

  it('reports progress until enough frames are collected', () => {
    const state = createMicCalibration({ frames: 10 })
    const mid = pushCalibrationSample(state, 0.005)
    expect(mid.done).toBe(false)
    expect(mid.progress).toBeCloseTo(0.1, 5)
    for (let i = 0; i < 9; i += 1) pushCalibrationSample(state, 0.005)
    expect(state.done).toBe(true)
  })
})

// sanity: frequencyToMidi is exposed and correct
describe('frequencyToMidi', () => {
  it('maps 440 Hz to 69', () => {
    expect(Math.round(frequencyToMidi(440))).toBe(69)
  })
})

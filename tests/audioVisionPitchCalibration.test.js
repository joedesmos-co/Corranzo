/**
 * Guards for the pitch-transcription calibration.
 *
 * The values in NOTE_EXTRACTION were measured, not chosen for taste
 * (docs/audio-vision-pitch-calibration.md, scripts/audio-vision-threshold-sweep.mjs):
 * onset 0.65 / frame 0.50 / 3 frames took the arrangement's event F1 on five
 * unseen GuitarSet takes from 0.751 to 0.807, precision from 0.761 to 0.906
 * and the invented-note rate from 0.102 to 0.038.
 *
 * If someone changes these numbers they must re-run that sweep; this test
 * exists so the change is deliberate rather than accidental.
 */
import { describe, it, expect } from 'vitest'
import { NOTE_EXTRACTION } from '../src/features/audio-vision/noteExtraction.js'
import { harmonicSalience, dropHarmonicSiblings } from '../src/features/audio-vision/harmonicEvidence.js'
import { suppressHarmonicDoubles } from '../src/features/audio-vision/arrangementModel.js'

const SR = 22050

/** A steady harmonic tone at a MIDI pitch, so the salience has something real to read. */
function tone(midi, seconds = 0.4, harmonics = 5) {
  const f0 = 440 * 2 ** ((midi - 69) / 12)
  const out = new Float32Array(Math.floor(seconds * SR))
  for (let i = 0; i < out.length; i += 1) {
    let v = 0
    for (let h = 1; h <= harmonics; h += 1) v += Math.sin((2 * Math.PI * f0 * h * i) / SR) / h
    out[i] = v * 0.2
  }
  return out
}

describe('note extraction calibration', () => {
  it('keeps the measured thresholds', () => {
    expect(NOTE_EXTRACTION.onsetThreshold).toBe(0.65)
    expect(NOTE_EXTRACTION.frameThreshold).toBe(0.5)
    expect(NOTE_EXTRACTION.minNoteFrames).toBe(3)
  })

  it('is stricter than the library defaults it replaced', () => {
    // The point of the calibration: read the model's evidence more
    // conservatively than the general-purpose defaults (0.5 / 0.3 / 5).
    expect(NOTE_EXTRACTION.onsetThreshold).toBeGreaterThan(0.5)
    expect(NOTE_EXTRACTION.frameThreshold).toBeGreaterThan(0.3)
  })
})

describe('harmonic evidence', () => {
  it('finds a played note at its own pitch, above an octave away', () => {
    const samples = tone(60) // C4
    const own = harmonicSalience(samples, SR, 0, 60)
    const octaveAbove = harmonicSalience(samples, SR, 0, 72)
    const octaveBelow = harmonicSalience(samples, SR, 0, 48)
    expect(own).toBeGreaterThan(octaveAbove)
    expect(own).toBeGreaterThan(octaveBelow)
  })

  it('removes a weakly-supported harmonic sibling', () => {
    const samples = tone(60, 0.4, 4)
    const notes = [
      { midi: 60, startSeconds: 0, endSeconds: 0.4, amplitude: 0.9 },
      // The octave is reported but the audio has little energy there.
      { midi: 72, startSeconds: 0.005, endSeconds: 0.4, amplitude: 0.2 },
    ]
    const result = dropHarmonicSiblings(notes, { samples, sampleRate: SR, amplitudeRatio: 0.85, salienceRatio: 0.85 })
    expect(result.notes.map((n) => n.midi)).toEqual([60])
    expect(result.removed).toBe(1)
  })

  it('keeps a genuine octave doubling (both notes are strong)', () => {
    const samples = tone(60, 0.4, 4)
    const notes = [
      { midi: 60, startSeconds: 0, endSeconds: 0.4, amplitude: 0.8 },
      { midi: 72, startSeconds: 0, endSeconds: 0.4, amplitude: 0.78 },
    ]
    const result = dropHarmonicSiblings(notes, { samples, sampleRate: SR, amplitudeRatio: 0.85, salienceRatio: 0.85 })
    expect(result.removed).toBe(0)
    expect(result.notes).toHaveLength(2)
  })

  it('never removes the top or the bottom note of an onset (melody and bass)', () => {
    const samples = tone(60, 0.4, 4)
    const notes = [
      { midi: 84, startSeconds: 0, endSeconds: 0.4, amplitude: 0.3 }, // melody (top)
      { midi: 72, startSeconds: 0, endSeconds: 0.4, amplitude: 0.2 }, // a weak inner octave
      { midi: 48, startSeconds: 0, endSeconds: 0.4, amplitude: 0.25 }, // bass (bottom)
    ]
    const result = dropHarmonicSiblings(notes, { samples, sampleRate: SR, amplitudeRatio: 0.85, salienceRatio: 0.85 })
    expect(result.notes.some((n) => n.midi === 84)).toBe(true)
    expect(result.notes.some((n) => n.midi === 48)).toBe(true)
  })

  it('is a no-op when disabled and never mutates the input', () => {
    const samples = tone(60, 0.4, 4)
    const notes = [
      { midi: 60, startSeconds: 0, endSeconds: 0.4, amplitude: 0.9 },
      { midi: 72, startSeconds: 0, endSeconds: 0.4, amplitude: 0.2 },
    ]
    const snapshot = JSON.stringify(notes)
    const off = dropHarmonicSiblings(notes, { samples, sampleRate: SR, enabled: false })
    expect(off.removed).toBe(0)
    dropHarmonicSiblings(notes, { samples, sampleRate: SR })
    expect(JSON.stringify(notes)).toBe(snapshot)
  })
})

describe('harmonic-double suppression stays amplitude-only in production', () => {
  const pair = () => [
    { midi: 60, startSeconds: 0, endSeconds: 0.5, amplitude: 0.9 },
    { midi: 72, startSeconds: 0.005, endSeconds: 0.5, amplitude: 0.2 },
  ]

  it('without samples it removes the weak octave (the shipped rule)', () => {
    const result = suppressHarmonicDoubles(pair())
    expect(result.suppressed).toBe(1)
    expect(result.notes.map((n) => n.midi)).toEqual([60])
  })

  it('with samples it keeps a quiet octave when the audio really plays both', () => {
    // Two played notes: each pitch has its own full harmonic series, so the
    // octave is a doubling, not a leak - even though it is quieter in the
    // model's amplitudes.
    const a = tone(60, 0.5, 5)
    const b = tone(72, 0.5, 5)
    const samples = new Float32Array(a.length)
    for (let i = 0; i < a.length; i += 1) samples[i] = a[i] * 0.9 + b[i] * 0.5
    const result = suppressHarmonicDoubles(pair(), { samples, sampleRate: SR, salienceRatio: 0.75 })
    expect(result.notes.length).toBe(2)
  })

  it('with samples it still removes a leak that has no energy of its own', () => {
    // A tone at 60 only: the octave bin is leakage, so it must go.
    const samples = tone(60, 0.5, 5)
    const result = suppressHarmonicDoubles(pair(), { samples, sampleRate: SR, salienceRatio: 0.75 })
    expect(result.notes.length).toBe(1)
    expect(result.notes[0].midi).toBe(60)
  })

  it('is a no-op difference when samples are not supplied (production path)', () => {
    const a = suppressHarmonicDoubles(pair())
    const b = suppressHarmonicDoubles(pair(), { samples: null, sampleRate: SR })
    expect(b.suppressed).toBe(a.suppressed)
    expect(b.notes.map((n) => n.midi)).toEqual(a.notes.map((n) => n.midi))
  })
})

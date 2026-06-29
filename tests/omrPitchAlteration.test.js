import { describe, expect, it } from 'vitest'
import {
  accidentalMatchScore,
  applyKeySignature,
  assignLocalAccidentals,
  resolveMeasureNotePitch,
  resolveNotePitchWithMeasureState,
} from '../src/features/omr/omrPitchAlteration.js'

const ACCIDENTAL_GLYPHS = new Map([
  ['\uE262', { alter: 1, type: 'sharp' }],
  ['\uE261', { alter: 0, type: 'natural' }],
  ['\uE260', { alter: -1, type: 'flat' }],
])

const measureBox = {
  x0: 0.1,
  playableX0: 0.2,
  x1: 0.8,
  staffLines: {
    treble: [0.1, 0.12, 0.14, 0.16, 0.18],
    bass: [0.3, 0.32, 0.34, 0.36, 0.38],
  },
}

const imageData = { width: 1000, height: 1000 }

describe('applyKeySignature', () => {
  it('flattens B, E, and A in Eb major', () => {
    expect(applyKeySignature(71, -3).midi).toBe(70)
    expect(applyKeySignature(64, -3).midi).toBe(63)
    expect(applyKeySignature(69, -3).midi).toBe(68)
    expect(applyKeySignature(62, -3).midi).toBe(62)
  })
})

describe('resolveMeasureNotePitch', () => {
  it('cancels key signature with a natural accidental', () => {
    const resolved = resolveMeasureNotePitch({
      naturalMidi: 65,
      keySignature: { fifths: 2, mode: 'major' },
      localAccidental: { alter: 0, type: 'natural' },
    })
    expect(resolved.midi).toBe(65)
    expect(resolved.pitchAlteration.localAccidental).toBe('natural')
    expect(resolved.pitchAlteration.keySignatureFifths).toBe(2)
  })

  it('raises the key-default pitch with a sharp accidental', () => {
    const resolved = resolveMeasureNotePitch({
      naturalMidi: 64,
      keySignature: { fifths: -3, mode: 'major' },
      localAccidental: { alter: 1, type: 'sharp' },
    })
    expect(applyKeySignature(64, -3).midi).toBe(63)
    expect(resolved.midi).toBe(64)
    expect(resolved.pitchAlteration.keyDefaultMidi).toBe(63)
  })

  it('carries explicit accidentals to later notes in the measure', () => {
    const first = resolveMeasureNotePitch({
      naturalMidi: 62,
      keySignature: { fifths: -3, mode: 'major' },
      localAccidental: { alter: 1, type: 'sharp', glyph: { x: 280, y: 350 } },
    })
    const second = resolveMeasureNotePitch({
      naturalMidi: 62,
      keySignature: { fifths: -3, mode: 'major' },
      carriedState: first.accidentalState,
    })
    expect(first.midi).toBe(63)
    expect(second.midi).toBe(63)
    expect(second.pitchAlteration.measureAccidentalState).toEqual({ mode: 'explicit', alter: 1 })
  })
})

describe('resolveNotePitchWithMeasureState', () => {
  it('carries a sharp on repeated diatonic steps in Eb major', () => {
    const first = resolveNotePitchWithMeasureState({
      naturalMidi: 62,
      keySignature: { fifths: -3, mode: 'major' },
      localAccidental: { alter: 1, type: 'sharp', glyph: { x: 280, y: 350 } },
    })
    const second = resolveNotePitchWithMeasureState({
      naturalMidi: 62,
      keySignature: { fifths: -3, mode: 'major' },
      carriedAlter: first.measureAccidentalState,
    })
    expect(first.midi).toBe(63)
    expect(second.midi).toBe(63)
    expect(first.pitchAlteration.accidentalSource).toBe('vector-glyph')
    expect(second.pitchAlteration.measureAccidentalState).toBe(1)
  })

  it('carries a sharp from the key-default pitch for key-signature flats', () => {
    const resolved = resolveNotePitchWithMeasureState({
      naturalMidi: 71,
      keySignature: { fifths: -3, mode: 'major' },
      carriedAlter: 1,
    })
    expect(applyKeySignature(71, -3).midi).toBe(70)
    expect(resolved.midi).toBe(71)
    expect(resolved.pitchAlteration.keyDefaultMidi).toBe(70)
  })

  it('keeps local sharps on the written natural pitch', () => {
    const resolved = resolveNotePitchWithMeasureState({
      naturalMidi: 62,
      keySignature: { fifths: -3, mode: 'major' },
      localAccidental: { alter: 1, type: 'sharp' },
    })
    expect(resolved.midi).toBe(63)
    expect(resolved.pitchAlteration.keyDefaultMidi).toBe(62)
  })
})

describe('assignLocalAccidentals', () => {
  it('binds each accidental to the nearest vertically aligned notehead', () => {
    const notes = [
      { cx: 300, cy: 350, yNorm: 0.35, clef: 'bass', naturalMidi: 48 },
      { cx: 330, cy: 318, yNorm: 0.318, clef: 'bass', naturalMidi: 53 },
    ]
    const assignments = assignLocalAccidentals(
      [
        { text: '\uE261', x: 280, y: 350 },
        { text: '\uE262', x: 290, y: 318 },
      ],
      imageData,
      measureBox,
      notes,
      ACCIDENTAL_GLYPHS,
    )
    expect(assignments.get(0)?.type).toBe('natural')
    expect(assignments.get(1)?.type).toBe('sharp')
  })

  it('prefers vertically aligned accidentals over a closer horizontal neighbor', () => {
    const notes = [
      { cx: 300, cy: 350, yNorm: 0.35, clef: 'bass', naturalMidi: 50 },
      { cx: 330, cy: 318, yNorm: 0.318, clef: 'bass', naturalMidi: 55 },
    ]
    const sharpGlyph = { text: '\uE262', x: 290, y: 318 }
    const window = { maxDx: 40, maxDy: 40, minX: 0 }
    const alignedScore = accidentalMatchScore(
      notes[1],
      sharpGlyph,
      window,
      measureBox.staffLines.bass,
      imageData,
    )
    const misalignedScore = accidentalMatchScore(
      notes[0],
      sharpGlyph,
      window,
      measureBox.staffLines.bass,
      imageData,
    )
    expect(alignedScore).toBeLessThan(misalignedScore)
  })
})

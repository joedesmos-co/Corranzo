import { describe, expect, it } from 'vitest'
import {
  assignVectorStaccato,
  isAugmentationDotRelativeToNote,
  isStaccatoRelativeToNote,
  RHYTHM_DOT_GLYPH,
  VECTOR_STACCATO_GLYPHS,
} from '../src/features/omr/detectVectorStaccato.js'
import { buildVectorMeasureRecord } from '../src/features/omr/processVectorOmrPage.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'

const measureBox = {
  measureNumber: 1,
  page: 1,
  systemIndex: 0,
  x0: 0.1,
  playableX0: 0.2,
  x1: 0.8,
  y0: 0.08,
  y1: 0.42,
  staffLines: {
    treble: [0.1, 0.12, 0.14, 0.16, 0.18],
    bass: [0.3, 0.32, 0.34, 0.36, 0.38],
    splitY: 0.24,
  },
}

const imageData = { width: 1000, height: 1000 }

function trebleNote(cx, cy, midi = 60) {
  const left = measureBox.playableX0 * imageData.width
  const right = measureBox.x1 * imageData.width
  return {
    cx,
    cy,
    clef: 'treble',
    midi,
    naturalMidi: midi,
    positionInMeasure: (cx - left) / (right - left),
  }
}

describe('vector staccato glyph audit', () => {
  it('tracks Bravura staccato and Bravura Text staccatissimo glyphs', () => {
    expect(VECTOR_STACCATO_GLYPHS.has('\ue4a0')).toBe(true)
    expect(VECTOR_STACCATO_GLYPHS.has('\ue4a1')).toBe(true)
    expect(VECTOR_STACCATO_GLYPHS.has('\ue4e5')).toBe(true)
    expect(RHYTHM_DOT_GLYPH).toBe('\ue1e7')
  })
})

describe('assignVectorStaccato', () => {
  it('binds a staccato glyph above a notehead', () => {
    const notes = [trebleNote(300, 170)]
    const { assignments, detectedStaccatoCount, appliedStaccatoCount } = assignVectorStaccato(
      [{ text: '\ue4a0', x: 300, y: 140 }],
      notes,
      measureBox,
      imageData,
    )
    expect(detectedStaccatoCount).toBe(1)
    expect(appliedStaccatoCount).toBe(1)
    expect(assignments.get(0)?.type).toBe('staccato')
  })

  it('does not treat an augmentation dot beside a notehead as staccato', () => {
    const note = trebleNote(300, 170)
    expect(isAugmentationDotRelativeToNote({ x: 318, y: 170 }, note)).toBe(true)
    expect(isStaccatoRelativeToNote({ x: 318, y: 170 }, note, 10)).toBe(false)

    const { assignments, appliedStaccatoCount } = assignVectorStaccato(
      [{ text: RHYTHM_DOT_GLYPH, x: 318, y: 170 }],
      [note],
      measureBox,
      imageData,
    )
    expect(assignments.size).toBe(0)
    expect(appliedStaccatoCount).toBe(0)
  })

  it('ignores random text dots that are not staccato candidates', () => {
    const { assignments, detectedStaccatoCount } = assignVectorStaccato(
      [{ text: '.', x: 300, y: 140 }],
      [trebleNote(300, 170)],
      measureBox,
      imageData,
    )
    expect(detectedStaccatoCount).toBe(0)
    expect(assignments.size).toBe(0)
  })
})

describe('buildVectorMeasureRecord staccato playback path', () => {
  it('emits MusicXML staccato and shortens playback without changing written duration', () => {
    const record = buildVectorMeasureRecord({
      glyphs: [
        { text: '\ue4a0', x: 300, y: 140 },
        { text: '\ue0a4', x: 300, y: 170 },
      ],
      imageData,
      measureBox,
      keySignature: { fifths: 0, mode: 'major', confidence: 0.9 },
      timeSignature: { beats: 4, beatType: 4, confidence: 0.9 },
    })

    expect(record.vectorStaccatoDiagnostics?.appliedStaccatoCount).toBe(1)
    expect(record.events[0].notes[0].articulation?.type).toBe('staccato')

    const xml = buildOmrMusicXml({
      measures: [record],
      includeDisclaimer: false,
    })
    expect(xml).toContain('<staccato/>')

    const timing = parseMusicXml(xml, 'vector-staccato.omr.musicxml')
    const expectedMidi = record.events[0].notes[0].midi
    const note = timing.notes.find((entry) => entry.midi === expectedMidi)
    expect(note?.staccato).toBe(true)
    expect(note?.durationSeconds).toBeGreaterThan(0)

    const [event] = buildScoreNoteSchedule(timing)
    expect(event.writtenDurationSeconds).toBeCloseTo(note.durationSeconds, 6)
    expect(event.baseDurationSeconds).toBeCloseTo(note.durationSeconds * 0.5, 6)
    expect(event.scoreTimeSeconds).toBe(0)
  })
})

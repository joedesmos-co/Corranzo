import { describe, expect, it } from 'vitest'
import {
  assignVectorStaccato,
  assignVectorAugmentationDots,
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
  it('tracks authoritative SMuFL staccato glyphs and excludes rest glyphs', () => {
    expect(VECTOR_STACCATO_GLYPHS.has('\ue4a2')).toBe(true)
    expect(VECTOR_STACCATO_GLYPHS.has('\ue4a3')).toBe(true)
    expect(VECTOR_STACCATO_GLYPHS.has('\ue4e5')).toBe(false)
    expect(RHYTHM_DOT_GLYPH).toBe('\ue1e7')
  })
})

describe('assignVectorStaccato', () => {
  it('binds a staccato glyph above a notehead', () => {
    const notes = [trebleNote(300, 170)]
    const { assignments, detectedStaccatoCount, appliedStaccatoCount } = assignVectorStaccato(
      [{ text: '\ue4a2', x: 300, y: 140 }],
      notes,
      measureBox,
      imageData,
    )
    expect(detectedStaccatoCount).toBe(1)
    expect(appliedStaccatoCount).toBe(1)
    expect(assignments.get(0)?.type).toBe('staccato')
  })

  it('broadcasts one staccato glyph across a chord column', () => {
    const notes = [
      trebleNote(300, 170, 67),
      trebleNote(300, 183, 64),
      trebleNote(300, 196, 60),
    ]
    const { appliedStaccatoCount } = assignVectorStaccato(
      [{ text: '\ue4a2', x: 300, y: 140 }],
      notes,
      measureBox,
      imageData,
    )
    expect(appliedStaccatoCount).toBe(3)
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

  it('falls back to compact ink dots above/below when no SMuFL staccato glyphs exist', () => {
    const width = 80
    const height = 80
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
    const paint = (x, y) => {
      const index = (y * width + x) * 4
      data[index] = 0
      data[index + 1] = 0
      data[index + 2] = 0
    }
    // Isolated compact ink blob above the notehead (4–7 dark in 3×3).
    paint(40, 26)
    paint(41, 26)
    paint(40, 27)
    paint(41, 27)
    paint(39, 27)
    const localImage = { width, height, data }
    const localBox = {
      ...measureBox,
      x0: 0,
      playableX0: 0,
      x1: 1,
      y0: 0,
      y1: 1,
      staffLines: {
        treble: [0.4, 0.5, 0.6, 0.7, 0.8],
        bass: [],
        splitY: 0.9,
      },
    }
    const note = {
      cx: 40,
      cy: 45,
      clef: 'treble',
      midi: 60,
      naturalMidi: 60,
      positionInMeasure: 0.4,
      noteheadFont: { glyph: '\ue0a4' },
    }
    const { assignments, detectedStaccatoCount, appliedStaccatoCount } = assignVectorStaccato(
      [],
      [note],
      localBox,
      localImage,
    )
    expect(detectedStaccatoCount).toBeGreaterThanOrEqual(1)
    expect(appliedStaccatoCount).toBeGreaterThanOrEqual(1)
    expect(assignments.get(0)?.type).toBe('staccato')
    expect(assignments.get(0)?.source).toBe('ink-path')
  })

  it('rejects ink hits that coincide with period / rhythm-dot glyphs', () => {
    const width = 80
    const height = 80
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
    const paint = (x, y) => {
      const index = (y * width + x) * 4
      data[index] = 0
      data[index + 1] = 0
      data[index + 2] = 0
    }
    paint(40, 26)
    paint(41, 26)
    paint(40, 27)
    paint(41, 27)
    paint(39, 27)
    const localImage = { width, height, data }
    const localBox = {
      ...measureBox,
      x0: 0,
      playableX0: 0,
      x1: 1,
      y0: 0,
      y1: 1,
      staffLines: {
        treble: [0.4, 0.5, 0.6, 0.7, 0.8],
        bass: [],
        splitY: 0.9,
      },
    }
    const note = {
      cx: 40,
      cy: 45,
      clef: 'treble',
      midi: 60,
      naturalMidi: 60,
      positionInMeasure: 0.4,
      noteheadFont: { glyph: '\ue0a4' },
    }
    const { assignments, detectedStaccatoCount } = assignVectorStaccato(
      [{ text: '.', x: 40, y: 26 }],
      [note],
      localBox,
      localImage,
    )
    expect(detectedStaccatoCount).toBe(0)
    expect(assignments.size).toBe(0)
  })

  it('skips ink fallback on legacy-normalized noteheads', () => {
    const width = 80
    const height = 80
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
    const paint = (x, y) => {
      const index = (y * width + x) * 4
      data[index] = 0
      data[index + 1] = 0
      data[index + 2] = 0
    }
    paint(40, 28)
    paint(41, 28)
    paint(40, 29)
    paint(41, 29)
    const localImage = { width, height, data }
    const localBox = {
      ...measureBox,
      x0: 0,
      playableX0: 0,
      x1: 1,
      y0: 0,
      y1: 1,
    }
    const note = {
      cx: 40,
      cy: 45,
      clef: 'treble',
      midi: 60,
      naturalMidi: 60,
      positionInMeasure: 0.4,
      noteheadFont: { glyph: '\ue0a4', legacyNormalized: true },
    }
    const { assignments, detectedStaccatoCount } = assignVectorStaccato(
      [],
      [note],
      localBox,
      localImage,
    )
    expect(detectedStaccatoCount).toBe(0)
    expect(assignments.size).toBe(0)
  })

  it('does not run ink fallback when SMuFL staccato glyphs are present', () => {
    const width = 80
    const height = 80
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
    const paint = (x, y) => {
      const index = (y * width + x) * 4
      data[index] = 0
      data[index + 1] = 0
      data[index + 2] = 0
    }
    paint(40, 28)
    paint(41, 28)
    paint(40, 29)
    paint(41, 29)
    const localImage = { width, height, data }
    const localBox = {
      ...measureBox,
      x0: 0,
      playableX0: 0,
      x1: 1,
      y0: 0,
      y1: 1,
    }
    const note = {
      cx: 40,
      cy: 45,
      clef: 'treble',
      midi: 60,
      naturalMidi: 60,
      positionInMeasure: 0.4,
    }
    // Unrelated SMuFL glyph far away — still disables ink fallback for the measure.
    const { assignments, detectedStaccatoCount } = assignVectorStaccato(
      [{ text: '\ue4a2', x: 10, y: 10 }],
      [note],
      localBox,
      localImage,
    )
    expect(assignments.get(0)?.source).not.toBe('ink-path')
    // Glyph may be rejected for geometry; ink must not fill in.
    const inkApplied = [...assignments.values()].some((a) => a.source === 'ink-path')
    expect(inkApplied).toBe(false)
    expect(detectedStaccatoCount).toBeLessThanOrEqual(1)
  })

  it('never treats a quarter-rest glyph as staccato', () => {
    const { assignments, detectedStaccatoCount } = assignVectorStaccato(
      [{ text: '\ue4e5', x: 300, y: 140 }],
      [trebleNote(300, 170)],
      measureBox,
      imageData,
    )
    expect(detectedStaccatoCount).toBe(0)
    expect(assignments.size).toBe(0)
  })
})

describe('assignVectorAugmentationDots', () => {
  it('binds a rhythm-dot glyph beside a notehead', () => {
    const notes = [trebleNote(300, 170)]
    const assignments = assignVectorAugmentationDots(
      [{ text: RHYTHM_DOT_GLYPH, x: 318, y: 170 }],
      notes,
      measureBox,
      imageData,
    )
    expect(assignments.get(0)).toBe(true)
  })

  it('normalizes a filled PDF path dot from visual center to notehead font baseline', () => {
    const notes = [trebleNote(300, 170)]
    const assignments = assignVectorAugmentationDots(
      [
        {
          text: RHYTHM_DOT_GLYPH,
          x: 318,
          y: 160,
          source: 'vector-path',
          reason: 'filled-circular-path',
        },
      ],
      notes,
      measureBox,
      imageData,
    )
    expect(assignments.get(0)).toBe(true)
  })

  it('rejects a filled PDF path circle tagged as part of a repeat-dot pair', () => {
    const notes = [trebleNote(300, 170)]
    const assignments = assignVectorAugmentationDots(
      [
        {
          text: RHYTHM_DOT_GLYPH,
          x: 318,
          y: 160,
          source: 'vector-path',
          reason: 'filled-circular-path',
          repeatPairCandidate: true,
        },
      ],
      notes,
      measureBox,
      imageData,
    )
    expect(assignments.size).toBe(0)
  })

  it('applies one printed augmentation dot to a same-onset chord', () => {
    const notes = [
      trebleNote(300, 170, 67),
      trebleNote(300, 183, 64),
      trebleNote(300, 196, 60),
    ]
    const assignments = assignVectorAugmentationDots(
      [{ text: RHYTHM_DOT_GLYPH, x: 318, y: 183 }],
      notes,
      measureBox,
      imageData,
    )
    expect(assignments.size).toBe(3)
    expect(assignments.get(0)).toBe(true)
    expect(assignments.get(1)).toBe(true)
    expect(assignments.get(2)).toBe(true)
  })

  it('does not attach an augmentation dot to a later onset at a different X', () => {
    const notes = [trebleNote(300, 170, 60), trebleNote(420, 170, 62)]
    const assignments = assignVectorAugmentationDots(
      [{ text: RHYTHM_DOT_GLYPH, x: 318, y: 170 }],
      notes,
      measureBox,
      imageData,
    )
    expect(assignments.get(0)).toBe(true)
    expect(assignments.has(1)).toBe(false)
  })
})

describe('buildVectorMeasureRecord staccato playback path', () => {
  it('emits MusicXML staccato and shortens playback without changing written duration', () => {
    const record = buildVectorMeasureRecord({
      glyphs: [
        { text: '\ue4a2', x: 300, y: 140 },
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
    expect(xml).toContain('<staccato placement="above"/>')

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

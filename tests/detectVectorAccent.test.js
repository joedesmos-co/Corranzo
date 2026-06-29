import { describe, expect, it } from 'vitest'
import {
  assignVectorAccent,
  looksLikeHairpinGlyph,
  VECTOR_ACCENT_GLYPHS,
  VECTOR_HAIRPIN_GLYPHS,
} from '../src/features/omr/detectVectorAccent.js'
import { buildVectorMeasureRecord } from '../src/features/omr/processVectorOmrPage.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'
import { ACCENT_VELOCITY_BOOST } from '../src/features/playback/staccatoPlayback.js'
import { DEFAULT_MUSICXML_VELOCITY } from '../src/features/musicxml/dynamicsMap.js'

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

describe('vector accent glyph audit', () => {
  it('tracks Bravura accent glyphs and hairpin exclusions', () => {
    expect(VECTOR_ACCENT_GLYPHS.has('\ue4a3')).toBe(true)
    expect(VECTOR_ACCENT_GLYPHS.has('\ue4a4')).toBe(true)
    expect(VECTOR_HAIRPIN_GLYPHS.has('\ue53e')).toBe(true)
  })
})

describe('assignVectorAccent', () => {
  it('binds an accent glyph above a notehead', () => {
    const notes = [trebleNote(300, 170)]
    const { assignments, detectedAccentCount, appliedAccentCount } = assignVectorAccent(
      [{ text: '\ue4a3', x: 300, y: 140 }],
      notes,
      measureBox,
      imageData,
    )
    expect(detectedAccentCount).toBe(1)
    expect(appliedAccentCount).toBe(1)
    expect(assignments.get(0)?.type).toBe('accent')
  })

  it('ignores hairpin glyphs even when vertically near a notehead', () => {
    const note = trebleNote(300, 170)
    const hairpin = { text: '\ue53e', x: 300, y: 140, width: 40 }
    expect(looksLikeHairpinGlyph(hairpin, 10)).toBe(true)

    const { assignments, appliedAccentCount } = assignVectorAccent([hairpin], [note], measureBox, imageData)
    expect(assignments.size).toBe(0)
    expect(appliedAccentCount).toBe(0)
  })

  it('ignores wide hairpin-like glyphs spanning horizontally', () => {
    const note = trebleNote(300, 170)
    const wide = { text: '\ue4a3', x: 300, y: 140, width: 60 }
    expect(looksLikeHairpinGlyph(wide, 20)).toBe(true)

    const { appliedAccentCount } = assignVectorAccent([wide], [note], measureBox, imageData)
    expect(appliedAccentCount).toBe(0)
  })
})

describe('buildVectorMeasureRecord accent playback path', () => {
  it('emits MusicXML accent and boosts playback velocity without changing timing', () => {
    const record = buildVectorMeasureRecord({
      glyphs: [
        { text: '\ue4a3', x: 300, y: 140 },
        { text: '\ue0a4', x: 300, y: 170 },
      ],
      imageData,
      measureBox,
      keySignature: { fifths: 0, mode: 'major', confidence: 0.9 },
      timeSignature: { beats: 4, beatType: 4, confidence: 0.9 },
    })

    expect(record.vectorAccentDiagnostics?.appliedAccentCount).toBe(1)
    expect(record.events[0].notes[0].accentArticulation?.type).toBe('accent')

    const xml = buildOmrMusicXml({
      measures: [record],
      includeDisclaimer: false,
    })
    expect(xml).toContain('<accent/>')

    const timing = parseMusicXml(xml, 'vector-accent.omr.musicxml')
    const expectedMidi = record.events[0].notes[0].midi
    const note = timing.notes.find((entry) => entry.midi === expectedMidi)
    expect(note?.accent).toBe(true)
    expect(note?.durationSeconds).toBeGreaterThan(0)

    const [event] = buildScoreNoteSchedule(timing)
    expect(event.scoreTimeSeconds).toBe(0)
    expect(event.writtenDurationSeconds).toBeCloseTo(note.durationSeconds, 6)
    expect(event.velocity).toBeCloseTo(DEFAULT_MUSICXML_VELOCITY + ACCENT_VELOCITY_BOOST, 6)
  })
})

import { describe, expect, it } from 'vitest'
import {
  VECTOR_REST_SKIP_REASONS,
  restsForMeasure,
  insertMixedMeasureRests,
} from '../src/features/omr/detectVectorRests.js'
import {
  buildVectorEvents,
  buildVectorMeasureRecord,
} from '../src/features/omr/processVectorOmrPage.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

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

function trebleNote(positionInMeasure, midi = 60) {
  return {
    cx: 200 + positionInMeasure * 500,
    cy: 170,
    positionInMeasure,
    clef: 'treble',
    midi,
    naturalMidi: midi,
  }
}

function bassRestGlyph(positionInMeasure) {
  return {
    cx: 200 + positionInMeasure * 500,
    cy: 350,
    positionInMeasure,
    durationType: 'whole',
    glyph: '\ue4e3',
    clef: 'bass',
    source: 'vector-glyph',
    confidence: 0.88,
  }
}

describe('restsForMeasure', () => {
  it('detects SMuFL rest glyphs inside the measure playable area with staff assignment', () => {
    const rests = restsForMeasure(
      [
        { text: '\ue4e4', x: 250, y: 160 },
        { text: '\ue4e4', x: 255, y: 162 },
      ],
      imageData,
      measureBox,
      [],
    )
    expect(rests).toHaveLength(1)
    expect(rests[0].durationType).toBe('half')
    expect(rests[0].clef).toBe('treble')
    expect(rests[0].positionInMeasure).toBeGreaterThan(0)
    expect(rests[0].positionInMeasure).toBeLessThan(1)
  })

  it('does not treat staccatissimo glyphs as rests', () => {
    const rests = restsForMeasure([{ text: '\ue4e5', x: 520, y: 170 }], imageData, measureBox, [])
    expect(rests).toHaveLength(0)
  })

  it('skips uncertain rests parked on noteheads', () => {
    const noteheads = [{ cx: 300, cy: 170 }]
    const rests = restsForMeasure(
      [{ text: '\ue4e4', x: 300, y: 170 }],
      imageData,
      measureBox,
      noteheads,
    )
    expect(rests).toHaveLength(0)
  })
})

describe('insertMixedMeasureRests', () => {
  it('keeps treble note timing when a bass whole rest is added', () => {
    const noteEvents = buildVectorEvents(
      [trebleNote(0.45, 67)],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const beforeTreble = noteEvents.find((event) => event.type === 'note')
    const { events, appliedCount } = insertMixedMeasureRests(
      noteEvents,
      [bassRestGlyph(0.14)],
      { measureBox, totalDivisions: 16 },
    )

    const afterTreble = events.find((event) => event.type === 'note')
    expect(appliedCount).toBe(1)
    expect(afterTreble?.startDivision).toBe(beforeTreble?.startDivision)
    expect(afterTreble?.durationDivisions).toBe(beforeTreble?.durationDivisions)
    expect(events.some((event) => event.type === 'rest' && event.clef === 'bass')).toBe(true)
  })

  it('fills bass silence without shifting treble onsets in MusicXML', () => {
    const noteEvents = buildVectorEvents(
      [trebleNote(0.45, 67)],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const beforeTreble = noteEvents.find((event) => event.type === 'note')
    const { events } = insertMixedMeasureRests(noteEvents, [bassRestGlyph(0.14)], {
      measureBox,
      totalDivisions: 16,
    })
    const xml = buildOmrMusicXml({
      measures: [{ measureNumber: 1, uncertain: false, events }],
    })
    const timing = parseMusicXml(xml, 'mixed-rest.omr.musicxml')
    const treble = timing.notes.find((note) => note.label === 'G4')
    expect(treble?.quarterTime).toBe(beforeTreble?.startDivision / 4)
    expect(timing.notes.some((note) => note.isRest && note.voice === 2)).toBe(true)
  })

  it('skips whole rests when the same staff already has notes', () => {
    const noteEvents = buildVectorEvents(
      [trebleNote(0.2, 64), trebleNote(0.6, 67)],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const { appliedCount, skipped } = insertMixedMeasureRests(
      noteEvents,
      [{ ...bassRestGlyph(0.14), clef: 'treble', durationType: 'whole' }],
      { measureBox, totalDivisions: 16 },
    )
    expect(appliedCount).toBe(0)
    expect(skipped[0]?.reason).toBe(VECTOR_REST_SKIP_REASONS.WHOLE_REST_WITH_STAFF_NOTES)
  })

  it('inserts a partial rest only into a clear staff gap', () => {
    const noteEvents = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [trebleNote(0.05, 60)],
      },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 8,
        durationType: 'half',
        notes: [trebleNote(0.75, 62)],
      },
    ]
    const { events, appliedCount } = insertMixedMeasureRests(
      noteEvents,
      [
        {
          cx: 420,
          cy: 170,
          positionInMeasure: 0.25,
          durationType: 'half',
          clef: 'treble',
          source: 'vector-glyph',
          confidence: 0.88,
        },
      ],
      { measureBox, totalDivisions: 16 },
    )
    expect(appliedCount).toBe(1)
    const trebleNotes = events.filter((event) => event.type === 'note')
    expect(trebleNotes.map((event) => event.startDivision)).toEqual([0, 8])
    const rest = events.find((event) => event.type === 'rest')
    expect(rest?.startDivision).toBe(4)
    expect(rest?.durationDivisions).toBe(4)
  })
})

describe('buildVectorMeasureRecord mixed rests', () => {
  it('emits vector rest events for rest-only measures', () => {
    const record = buildVectorMeasureRecord({
      glyphs: [{ text: '\ue4e3', x: 400, y: 160 }],
      imageData,
      measureBox,
      keySignature: { fifths: 0, mode: 'major', confidence: 0.9 },
      timeSignature: { beats: 3, beatType: 4, confidence: 0.9 },
    })
    expect(record.vectorRestGlyphCount).toBe(1)
    expect(record.events).toHaveLength(1)
    expect(record.events[0].type).toBe('rest')
    expect(record.events[0].source).toBe('vector-glyph')
    expect(record.events[0].durationDivisions).toBe(12)
    expect(record.vectorRestDiagnostics?.appliedCount).toBe(1)
  })

  it('applies bass rests in mixed measures without removing treble notes', () => {
    const record = buildVectorMeasureRecord({
      glyphs: [
        { text: '\ue4e3', x: 250, y: 350 },
        { text: '\ue0a4', x: 520, y: 170 },
      ],
      imageData,
      measureBox,
      keySignature: { fifths: 0, mode: 'major', confidence: 0.9 },
      timeSignature: { beats: 4, beatType: 4, confidence: 0.9 },
    })
    expect(record.vectorRestGlyphCount).toBe(1)
    expect(record.events.some((event) => event.type === 'note')).toBe(true)
    expect(record.events.some((event) => event.type === 'rest' && event.clef === 'bass')).toBe(true)
    expect(record.vectorRestDiagnostics?.appliedCount).toBe(1)
  })
})

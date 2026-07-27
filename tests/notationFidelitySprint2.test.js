/**
 * OMR Notation Fidelity Sprint 2
 *
 * Focused slice: written note values, dots, and detector-owned beams must
 * survive MusicXML emission and Visual Practice rendering without changing
 * performed timing.
 */
import { describe, expect, it } from 'vitest'
import {
  buildMeasureBeamValues,
  buildOmrMusicXml,
} from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotes,
  buildStaffLaneRhythmMarks,
  buildStaffLaneStems,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'

function scoreWithNotes(notes, { divisions = 4, beats = 4 } = {}) {
  return (
    '<?xml version="1.0"?>' +
    '<score-partwise version="3.1">' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1"><measure number="1"><attributes><divisions>${divisions}</divisions>` +
    `<time><beats>${beats}</beats><beat-type>4</beat-type></time>` +
    '<clef><sign>G</sign><line>2</line></clef></attributes>' +
    notes +
    '</measure></part></score-partwise>'
  )
}

function pitchedNote({
  step,
  octave = 4,
  duration,
  type,
  dots = 0,
  beam = '',
}) {
  return (
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration><voice>1</voice><type>${type}</type>` +
    '<dot/>'.repeat(dots) +
    `${beam}</note>`
  )
}

describe('beam evidence -> MusicXML', () => {
  it('reads vector beam counts from noteheads and emits begin/continue/end once per chord', () => {
    const events = [0, 2, 4].map((startDivision, index) => ({
      type: 'note',
      startDivision,
      durationDivisions: 2,
      durationType: 'eighth',
      notes: [
        { midi: 72 + index, clef: 'treble', beams: 1 },
        { midi: 60 + index, clef: 'treble', beams: 0 },
      ],
    }))
    const values = buildMeasureBeamValues(events)
    expect(values.get(events[0])).toEqual([{ number: 1, value: 'begin' }])
    expect(values.get(events[1])).toEqual([{ number: 1, value: 'continue' }])
    expect(values.get(events[2])).toEqual([{ number: 1, value: 'end' }])

    const xml = buildOmrMusicXml({
      includeDisclaimer: false,
      measures: [{ measureNumber: 1, events }],
    })
    expect(xml.match(/<beam number="1">begin<\/beam>/g)).toHaveLength(1)
    expect(xml.match(/<beam number="1">continue<\/beam>/g)).toHaveLength(1)
    expect(xml.match(/<beam number="1">end<\/beam>/g)).toHaveLength(1)
    expect(xml.match(/<beam /g)).toHaveLength(3)
  })

  it('keeps isolated or quarter-note beam-like noise diagnostic-only', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        durationType: 'quarter',
        beams: 1,
        notes: [{ midi: 60, clef: 'treble', beams: 1 }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 62, clef: 'treble', beams: 1 }],
      },
    ]
    const xml = buildOmrMusicXml({
      includeDisclaimer: false,
      measures: [{ measureNumber: 1, events }],
    })
    expect(xml).not.toContain('<beam ')
  })

  it('caps beam levels to the written value and emits a sixteenth hook', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 60, clef: 'treble', beams: 2 }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 1,
        durationType: 'sixteenth',
        notes: [{ midi: 62, clef: 'treble', beams: 2 }],
      },
    ]
    const values = buildMeasureBeamValues(events)
    expect(values.get(events[0])).toEqual([{ number: 1, value: 'begin' }])
    expect(values.get(events[1])).toEqual([
      { number: 1, value: 'end' },
      { number: 2, value: 'backward hook' },
    ])
  })
})

describe('written duration MusicXML emission', () => {
  it('emits the correct fallback type and dot for dotted notes and rests', () => {
    const xml = buildOmrMusicXml({
      includeDisclaimer: false,
      measures: [
        {
          measureNumber: 1,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 12,
              dotted: true,
              notes: [{ midi: 60 }],
            },
            {
              type: 'rest',
              startDivision: 12,
              durationDivisions: 3,
              durationType: 'eighth',
              dotted: true,
            },
          ],
        },
      ],
    })
    expect(xml).toMatch(
      /<pitch>.*?<\/pitch><duration>12<\/duration><voice>1<\/voice><type>half<\/type><dot\/>/,
    )
    expect(xml).toMatch(
      /<rest\/><duration>3<\/duration><voice>1<\/voice><type>eighth<\/type><dot\/>/,
    )
  })

  it('keeps written rhythm fields before staff and beam in MusicXML note order', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 72, clef: 'treble', beams: 1 }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 74, clef: 'treble', beams: 1 }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [{ midi: 48, clef: 'bass' }],
      },
    ]
    for (let index = 0; index < 7; index += 1) {
      const clef = index < 2 ? 'bass' : 'treble'
      events.push({
        type: 'note',
        startDivision: 8 + index * 4,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [{ midi: clef === 'bass' ? 48 + index : 60 + index, clef }],
      })
    }
    const xml = buildOmrMusicXml({
      includeDisclaimer: false,
      measures: [{ measureNumber: 1, events }],
    })
    expect(xml).toMatch(
      /<voice>1<\/voice><type>eighth<\/type><staff>1<\/staff><beam number="1">begin<\/beam>/,
    )
  })
})

describe('MusicXML -> Visual Practice written rhythm', () => {
  it('preserves note type, dots, and beams without changing performed timing', () => {
    const xml = scoreWithNotes(
      pitchedNote({
        step: 'C',
        duration: 2,
        type: 'eighth',
        dots: 1,
        beam: '<beam number="1">begin</beam>',
      }) +
        pitchedNote({
          step: 'D',
          duration: 2,
          type: 'eighth',
          beam: '<beam number="1">end</beam>',
        }) +
        pitchedNote({ step: 'E', duration: 4, type: 'quarter' }),
    )
    const timing = parseMusicXml(xml, 'rhythm.musicxml')
    expect(timing.notes.map((note) => note.noteType)).toEqual([
      'eighth',
      'eighth',
      'quarter',
    ])
    expect(timing.notes[0].dots).toBe(1)
    expect(timing.notes[0].beams).toEqual([{ number: 1, value: 'begin' }])
    expect(timing.notes[1].beams).toEqual([{ number: 1, value: 'end' }])
    expect(timing.notes.map((note) => note.quarterTime)).toEqual([0, 0.5, 1])
    expect(timing.notes.map((note) => note.durationQuarters)).toEqual([0.5, 0.5, 1])
  })

  it('draws a beam for a valid pair, a flag for an unbeamed eighth, and an augmentation dot', () => {
    const xml = scoreWithNotes(
      pitchedNote({
        step: 'C',
        duration: 2,
        type: 'eighth',
        dots: 1,
        beam: '<beam number="1">begin</beam>',
      }) +
        pitchedNote({
          step: 'D',
          duration: 2,
          type: 'eighth',
          beam: '<beam number="1">end</beam>',
        }) +
        pitchedNote({ step: 'E', duration: 2, type: 'eighth' }) +
        pitchedNote({ step: 'F', duration: 4, type: 'quarter' }),
    )
    const groups = buildVisualLaneGroups(parseMusicXml(xml, 'visual-rhythm.musicxml'))
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry, { pixelsPerSecond: 120 })
    const stems = buildStaffLaneStems(groups, geometry, {
      pixelsPerSecond: 120,
      notes,
    })
    const marks = buildStaffLaneRhythmMarks(notes, stems)

    expect(marks.beams).toHaveLength(1)
    expect(marks.beams[0].x2).toBeGreaterThan(marks.beams[0].x1)
    expect(marks.flags).toHaveLength(1)
    expect(marks.flags[0].path).toMatch(/^M .* Q /)
    expect(marks.dots).toHaveLength(1)
  })

  it('uses written type to distinguish half and whole notes at the same tempo', () => {
    const xml = scoreWithNotes(
      pitchedNote({ step: 'C', duration: 8, type: 'half' }) +
        pitchedNote({ step: 'D', duration: 16, type: 'whole' }),
      { divisions: 4, beats: 6 },
    )
    const groups = buildVisualLaneGroups(parseMusicXml(xml, 'long-values.musicxml'))
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const stems = buildStaffLaneStems(groups, geometry, { notes })

    expect(notes.map((note) => note.hollow)).toEqual([true, true])
    expect(notes.map((note) => note.stemless)).toEqual([false, true])
    expect(stems).toHaveLength(1)
    expect(stems[0].groupId).toBe(groups[0].id)
  })
})

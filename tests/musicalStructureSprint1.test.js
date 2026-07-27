import { describe, expect, it } from 'vitest'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { buildMeasureStructureUnits } from '../src/features/omr/measureStructureSemantics.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotes,
  buildStaffLaneStems,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'

function ownership(direction, index, overrides = {}) {
  return {
    noteheadId: `n-${index}`,
    attachedStemId: `s-${index}`,
    attachedStemIds: [`s-${index}`],
    attachedBeamIds: [],
    stemDirection: direction,
    stemConfidence: 0.91,
    confidence: 0.9,
    beamCount: 0,
    ...overrides,
  }
}

function polyphonicMeasure({ confidence = 0.91 } = {}) {
  const notes = [
    { midi: 72, clef: 'treble' },
    { midi: 67, clef: 'treble' },
    { midi: 60, clef: 'treble' },
  ]
  return {
    measureNumber: 1,
    page: 1,
    systemIndex: 0,
    events: [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 74, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 62, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 6,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 76, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 64, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 2,
        durationType: 'eighth',
        notes,
      },
    ],
    beamStemGraph: {
      eventOwnership: [
        { eventIndex: 0, ownerships: [ownership('up', 10)] },
        { eventIndex: 1, ownerships: [ownership('down', 11)] },
        { eventIndex: 2, ownerships: [ownership('up', 12)] },
        { eventIndex: 3, ownerships: [ownership('down', 13)] },
        {
          eventIndex: 4,
          splitCandidate: true,
          reasons: ['mixed-stem-directions'],
          ownerships: [
            ownership('up', 0, { stemConfidence: confidence }),
            ownership('up', 1, { stemConfidence: confidence }),
            ownership('down', 2, { stemConfidence: confidence }),
          ],
        },
      ],
    },
  }
}

function coreAttackSignature(xml) {
  return parseMusicXml(xml, 'structure.musicxml').notes
    .filter((note) => !note.isRest && note.midi != null)
    .map((note) => ({
      midi: note.midi,
      quarterTime: note.quarterTime,
      durationQuarters: note.durationQuarters,
    }))
    .sort((left, right) => left.midi - right.midi)
}

describe('Musical Structure Sprint 1', () => {
  it('splits only strong opposing-stem chord columns into parallel voices', () => {
    const measure = polyphonicMeasure()
    const structure = buildMeasureStructureUnits(measure)
    expect(structure.diagnostics).toMatchObject({
      splitEventCount: 1,
      splitNoteCount: 3,
      polyphonicStaffs: ['treble'],
      changedPitchCount: 0,
      changedOnsetCount: 0,
      changedDurationCount: 0,
      changedNoteCount: 0,
    })
    expect(structure.units.filter((unit) => unit.eventIndex === 4).map((unit) => ({
      voice: unit.voice,
      stemDirection: unit.stemDirection,
      midis: unit.notes.map((note) => note.midi),
    }))).toEqual([
      { voice: 1, stemDirection: 'up', midis: [72, 67] },
      { voice: 3, stemDirection: 'down', midis: [60] },
    ])
  })

  it('emits chord, voice, stem, and backup structure without changing attacks', () => {
    const measure = polyphonicMeasure()
    const baseline = buildOmrMusicXml({
      measures: [{ ...measure, beamStemGraph: null }],
      includeDisclaimer: false,
    })
    const xml = buildOmrMusicXml({ measures: [measure], includeDisclaimer: false })

    expect(xml.match(/<chord\/>/g)).toHaveLength(1)
    expect(xml).toContain('<voice>1</voice>')
    expect(xml).toContain('<voice>3</voice>')
    expect(xml).toContain('<stem>up</stem>')
    expect(xml).toContain('<stem>down</stem>')
    expect(xml).toMatch(/<backup><duration>\d+<\/duration><\/backup>/)
    expect(coreAttackSignature(xml)).toEqual(coreAttackSignature(baseline))
  })

  it('leaves low-confidence opposing stems as one chord and diagnostic-only', () => {
    const measure = polyphonicMeasure({ confidence: 0.55 })
    const structure = buildMeasureStructureUnits(measure)
    expect(structure.diagnostics.splitEventCount).toBe(0)
    expect(structure.diagnostics.rejectedReasons).toMatchObject({
      'no-strong-stem-ownership': 1,
    })
    const xml = buildOmrMusicXml({ measures: [measure], includeDisclaimer: false })
    expect(xml.match(/<chord\/>/g)).toHaveLength(2)
    expect(
      parseMusicXml(xml).notes
        .filter((note) => [72, 67, 60].includes(note.midi))
        .map((note) => note.stemDirection),
    ).toEqual([null, null, null])
  })

  it('parses written stem direction and Visual Practice keeps voices separate', () => {
    const xml = buildOmrMusicXml({
      measures: [polyphonicMeasure()],
      includeDisclaimer: false,
    })
    const timing = parseMusicXml(xml, 'polyphonic.musicxml')
    expect(
      timing.notes
        .filter((note) => [72, 67, 60].includes(note.midi))
        .map((note) => note.stemDirection)
        .sort(),
    ).toEqual([
      'down',
      'up',
      'up',
    ])
    const groups = buildVisualLaneGroups(timing).map((group) => ({
      ...group,
      status: 'upcoming',
    }))
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const stems = buildStaffLaneStems(groups, geometry, { notes })
    const splitStems = stems.filter((stem) =>
      notes.some(
        (note) =>
          note.groupId === stem.groupId &&
          note.measureNumber === 1 &&
          [72, 67, 60].includes(note.midi),
      ),
    )
    expect(splitStems).toHaveLength(2)
    expect(splitStems.map((stem) => ({
      voice: stem.voice,
      stemDown: stem.stemDown,
    })).sort((left, right) => left.voice - right.voice)).toEqual([
      { voice: 1, stemDown: false },
      { voice: 3, stemDown: true },
    ])
  })

  it('uses independent voices for overlapping same-staff events without splitting a chord', () => {
    const measure = {
      measureNumber: 1,
      events: [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 12,
          durationType: 'half',
          dotted: true,
          notes: [{ midi: 43, clef: 'bass' }],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 8,
          durationType: 'half',
          notes: [
            { midi: 66, clef: 'bass' },
            { midi: 62, clef: 'bass' },
            { midi: 59, clef: 'bass' },
          ],
        },
      ],
    }
    const structure = buildMeasureStructureUnits(measure)
    expect(structure.diagnostics.polyphonicStaffs).toEqual(['bass'])
    expect(structure.diagnostics.splitEventCount).toBe(0)
    expect(new Set(structure.units.map((unit) => unit.voice)).size).toBe(2)
    const xml = buildOmrMusicXml({ measures: [measure], includeDisclaimer: false })
    expect(xml.match(/<chord\/>/g)).toHaveLength(2)
    expect(coreAttackSignature(xml)).toEqual(
      coreAttackSignature(
        buildOmrMusicXml({
          measures: [{ ...measure, events: measure.events.map((event) => ({ ...event })) }],
          includeDisclaimer: false,
        }),
      ),
    )
  })

  it('keeps short same-staff duration overlaps in the default voice', () => {
    const measure = {
      measureNumber: 1,
      events: [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ midi: 72, clef: 'treble' }],
        },
        {
          type: 'note',
          startDivision: 3,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ midi: 74, clef: 'treble' }],
        },
      ],
    }
    const structure = buildMeasureStructureUnits(measure)
    expect(structure.diagnostics.polyphonicStaffs).toEqual([])
    expect(structure.units.map((unit) => unit.voice)).toEqual([1, 1])
  })

  it('preserves legacy per-staff voices inside an unsplit mixed-staff event', () => {
    const xml = buildOmrMusicXml({
      includeDisclaimer: false,
      measures: [{
        measureNumber: 1,
        events: [{
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [
            { midi: 67, clef: 'treble' },
            { midi: 43, clef: 'bass' },
          ],
        }],
      }],
    })
    expect(xml).toMatch(
      /<voice>1<\/voice><type>quarter<\/type><\/note><note><chord\/>[\s\S]*?<voice>2<\/voice><type>quarter<\/type>/,
    )
  })
})

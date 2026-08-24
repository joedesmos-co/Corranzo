import { describe, expect, it } from 'vitest'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { buildMeasureStructureUnits } from '../src/features/omr/measureStructureSemantics.js'
import {
  reconstructCompoundMeterDottedBeamOverprints,
  reconstructDenseAlternatingVoiceLattice,
} from '../src/features/omr/processVectorOmrPage.js'

function latticeNote({ cx, midi, clef = 'treble', stem = 'up', open = false }) {
  return {
    cx,
    cy: 100 - midi,
    midi,
    naturalMidi: midi,
    clef,
    positionInMeasure: (cx - 100) / 300,
    noteheadGlyph: open ? 'whole' : 'black',
    hollow: open,
    durationType: open ? 'whole' : 'sixteenth',
    durationDivisions: open ? 16 : 1,
    stem: { direction: stem, x: cx, tipY: stem === 'up' ? 60 : 140 },
    beams: open ? 2 : 0,
  }
}

function latticeEvent(notes, startDivision, durationDivisions = 1) {
  return {
    type: 'note',
    cx: notes.reduce((sum, note) => sum + note.cx, 0) / notes.length,
    clef: notes[0].clef,
    notes,
    startDivision,
    durationDivisions,
    durationType: durationDivisions === 16 ? 'whole' : 'sixteenth',
  }
}

function denseAlternatingFixture({
  columns = 16,
  lowerStem = 'down',
  bass = true,
  beamedBass = true,
  displacedChordHead = false,
  melodyIntrusions = true,
  thinLowerColumn = false,
} = {}) {
  const events = []
  if (bass) {
    const note = latticeNote({ cx: 100, midi: 38, clef: 'bass', open: true })
    if (!beamedBass) {
      note.beams = 0
      note.stem = null
    }
    events.push(latticeEvent([note], 0, 16))
  }
  const melodyByColumn = new Map(
    melodyIntrusions
      ? [[0, 79], [6, 77], [8, 76], [12, 74]]
      : [[0, 79]],
  )
  for (let index = 0; index < columns; index += 1) {
    const baseX = 100 + index * 20
    if (index === 0) {
      events.push(latticeEvent([
        latticeNote({ cx: baseX, midi: melodyByColumn.get(index), stem: 'up' }),
      ], 0, 6))
      continue
    }
    if (index % 2 === 1) {
      events.push(latticeEvent([
        latticeNote({ cx: baseX - 0.4, midi: 72, stem: 'up' }),
        latticeNote({ cx: baseX + 0.4, midi: 68, stem: 'up' }),
      ], index, 1))
      continue
    }
    const lowerNotes = [67, 64, 60].map((midi, noteIndex) =>
      latticeNote({ cx: baseX + noteIndex * 0.3, midi, stem: lowerStem }),
    )
    if (thinLowerColumn && index === 4) lowerNotes.pop()
    if (displacedChordHead && index === 10) lowerNotes[2].cx -= 9
    const melodyMidi = melodyByColumn.get(index)
    if (melodyMidi != null) {
      // A nearby independent melody note can be offset in X without becoming
      // a new rhythmic column.
      lowerNotes.push(latticeNote({ cx: baseX + 4, midi: melodyMidi, stem: 'up' }))
    }
    events.push(latticeEvent(lowerNotes, Math.max(0, index - 1), 1))
  }
  events.push({
    type: 'rest',
    clef: 'treble',
    startDivision: 1,
    durationDivisions: 1,
    durationType: 'sixteenth',
  })
  return events
}

describe('reconstructDenseAlternatingVoiceLattice', () => {
  it('recovers four independent source lanes from a complete 16-column lattice', () => {
    const source = denseAlternatingFixture({ displacedChordHead: true })
    const rebuilt = reconstructDenseAlternatingVoiceLattice(source, 16)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(
      source.flatMap((event) => event.notes ?? []).length + 1,
    )
    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      [0, 6],
      [6, 2],
      [8, 4],
      [12, 4],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 2 && event.type === 'note'))
      .toHaveLength(8)
    const lowerEvents = rebuilt.filter((event) => event.sourceVoice === 5)
    expect(lowerEvents).toHaveLength(8)
    expect(lowerEvents.find((event) => event.sourceVoiceLane === 'lower-ostinato-bass-attack'))
      .toMatchObject({
        startDivision: 0,
        durationDivisions: 1,
        notes: [{ noteheadGlyph: 'black', denseAlternatingBassAttackOverprint: true }],
      })
    expect(rebuilt.filter((event) => event.sourceVoice === 6)).toHaveLength(1)
    expect(rebuilt.find((event) => event.type === 'rest')).toMatchObject({
      startDivision: 0,
      sourceVoice: 2,
    })

    const structure = buildMeasureStructureUnits({ measureNumber: 1, events: rebuilt })
    expect(structure.diagnostics.polyphonicStaffs).toEqual(['bass', 'treble'])
    expect(new Set(structure.units.map((unit) => unit.voice))).toEqual(new Set([1, 2, 5, 6]))

    const xml = buildOmrMusicXml({
      measures: [{ measureNumber: 1, events: rebuilt }],
      includeDisclaimer: false,
    })
    for (const voice of [1, 2, 5, 6]) {
      expect(xml).toContain(`<voice>${voice}</voice>`)
    }
    expect(xml).toContain('<backup>')
  })

  it('accepts a complete variant with no later melody intrusion and one two-note lower chord', () => {
    const source = denseAlternatingFixture({
      melodyIntrusions: false,
      thinLowerColumn: true,
    })
    const rebuilt = reconstructDenseAlternatingVoiceLattice(source, 16)

    expect(rebuilt).not.toBe(source)
    expect(rebuilt.filter((event) => event.sourceVoice === 1)).toHaveLength(1)
    expect(rebuilt.filter((event) => event.sourceVoice === 2 && event.type === 'note'))
      .toHaveLength(8)
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(8)
    expect(rebuilt.filter((event) => event.sourceVoice === 6)).toHaveLength(1)
  })

  it.each([
    ['an incomplete lattice', { columns: 15 }],
    ['unsupported lower-stem ownership', { lowerStem: 'up' }],
    ['a missing bass anchor', { bass: false }],
    ['a hollow bass note without crossing beam evidence', { beamedBass: false }],
  ])('abstains for %s', (_label, options) => {
    const source = denseAlternatingFixture(options)
    expect(reconstructDenseAlternatingVoiceLattice(source, 16)).toBe(source)
  })
})

function compoundMeterFixture({
  columns = 12,
  missingAnchorDot = false,
  sparseNonAnchorBeams = false,
} = {}) {
  return ['treble', 'bass'].flatMap((clef, staffIndex) =>
    Array.from({ length: columns }, (_, index) => {
      const anchor = index === 0 || index === 6
      const cx = 100 + index * 20 + staffIndex * 0.5
      const note = latticeNote({
        cx,
        midi: (clef === 'treble' ? 78 : 69) + (index % 3),
        clef,
        stem: 'down',
      })
      note.beams = anchor || !sparseNonAnchorBeams ? 2 : 0
      note.dotted = anchor && !(missingAnchorDot && clef === 'bass' && index === 6)
      return latticeEvent([note], index, 1)
    }),
  )
}

describe('reconstructCompoundMeterDottedBeamOverprints', () => {
  it('splits complete 6/8 dotted-beam overprints into attack and sustain voices', () => {
    const source = compoundMeterFixture({ sparseNonAnchorBeams: true })
    const rebuilt = reconstructCompoundMeterDottedBeamOverprints(source, 12)

    expect(rebuilt.flatMap((event) => event.notes)).toHaveLength(28)
    expect(rebuilt.filter((event) => event.sourceVoice === 1)).toHaveLength(12)
    expect(rebuilt.filter((event) => event.sourceVoice === 2)).toHaveLength(2)
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(12)
    expect(rebuilt.filter((event) => event.sourceVoice === 6)).toHaveLength(2)
    expect(
      rebuilt
        .filter((event) => event.sourceVoice === 2 || event.sourceVoice === 6)
        .map((event) => [event.startDivision, event.durationDivisions, event.dotted]),
    ).toEqual([
      [0, 6, true],
      [0, 6, true],
      [6, 6, true],
      [6, 6, true],
    ])
    expect(
      rebuilt
        .filter((event) => event.sourceVoice === 1 || event.sourceVoice === 5)
        .every((event) => event.durationDivisions === 1 && event.dotted === false),
    ).toBe(true)
  })

  it.each([
    ['a non-6/8 meter', compoundMeterFixture(), 16],
    ['an incomplete lattice', compoundMeterFixture({ columns: 11 }), 12],
    ['incomplete dotted-anchor evidence', compoundMeterFixture({ missingAnchorDot: true }), 12],
  ])('abstains for %s', (_label, source, totalDivisions) => {
    expect(reconstructCompoundMeterDottedBeamOverprints(source, totalDivisions)).toBe(source)
  })
})

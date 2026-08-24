import { describe, expect, it } from 'vitest'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { buildMeasureStructureUnits } from '../src/features/omr/measureStructureSemantics.js'
import {
  reconstructCompoundMeterDottedBeamOverprints,
  reconstructDenseAlternatingVoiceLattice,
  reconstructQuarterMelodyOffbeatChordLattice,
  reconstructTripletMelodyOverprintLattice,
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
  indirectBassBeam = false,
  singleNoteUpper = false,
  raisedAlternatingLower = false,
  fourNoteLower = false,
  splitBassAnchors = false,
  misalignedSecondBass = false,
} = {}) {
  const events = []
  if (bass) {
    const bassStarts = splitBassAnchors ? [0, 8] : [0]
    for (const [index, startDivision] of bassStarts.entries()) {
      const cx = 100 + index * 160 + (index === 1 && misalignedSecondBass ? 8 : 0)
      const note = latticeNote({ cx, midi: 38 + index * 2, clef: 'bass', open: true })
      if (!beamedBass && index === 0) note.beams = 0
      if (splitBassAnchors) {
        note.noteheadGlyph = 'half'
        note.durationType = 'half'
        note.durationDivisions = 8
      }
      events.push(latticeEvent([note], startDivision, splitBassAnchors ? 8 : 16))
    }
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
    if (index === 8 && splitBassAnchors) {
      events.push(latticeEvent([
        latticeNote({ cx: baseX, midi: melodyByColumn.get(index), stem: 'up' }),
      ], index, 4))
      continue
    }
    if (index % 2 === 1) {
      const upperNotes = [
        latticeNote({ cx: baseX - 0.4, midi: 72, stem: 'up' }),
        latticeNote({ cx: baseX + 0.4, midi: 68, stem: 'up' }),
      ]
      events.push(latticeEvent(singleNoteUpper ? upperNotes.slice(0, 1) : upperNotes, index, 1))
      continue
    }
    const lowerTop = raisedAlternatingLower && index % 4 === 0 ? 70 : 67
    const lowerMidis = fourNoteLower ? [lowerTop, 65, 62, 59] : [lowerTop, 64, 60]
    const lowerNotes = lowerMidis.map((midi, noteIndex) =>
      latticeNote({ cx: baseX + noteIndex * 0.3, midi, stem: lowerStem }),
    )
    if (indirectBassBeam) lowerNotes[0].beams = 2
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
    const lowerEvents = rebuilt.filter(
      (event) => event.sourceVoice === 5 && event.type === 'note',
    )
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
    expect(rebuilt.filter((event) => event.type === 'rest')).toHaveLength(16)

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
    expect(rebuilt.filter((event) => event.sourceVoice === 5 && event.type === 'note'))
      .toHaveLength(8)
    expect(rebuilt.filter((event) => event.sourceVoice === 6)).toHaveLength(1)
  })

  it('uses aligned lattice beams and stable chord columns for dense variants', () => {
    const source = denseAlternatingFixture({
      beamedBass: false,
      indirectBassBeam: true,
      singleNoteUpper: true,
      raisedAlternatingLower: true,
      fourNoteLower: true,
    })
    const rebuilt = reconstructDenseAlternatingVoiceLattice(source, 16)

    expect(rebuilt).not.toBe(source)
    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 6], [6, 2], [8, 4], [12, 4]])
    expect(rebuilt.filter((event) => event.sourceVoice === 2 && event.type === 'note'))
      .toHaveLength(8)
    expect(rebuilt.filter(
      (event) => event.sourceVoiceLane === 'lower-ostinato' &&
        event.notes?.some((note) => note.midi === 70),
    )).toHaveLength(3)
  })

  it('recovers two aligned half-note bass anchors and their attack overprints', () => {
    const source = denseAlternatingFixture({
      splitBassAnchors: true,
      beamedBass: false,
      indirectBassBeam: true,
    })
    const rebuilt = reconstructDenseAlternatingVoiceLattice(source, 16)

    expect(rebuilt.filter((event) => event.sourceVoice === 6).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 8], [8, 8]])
    expect(rebuilt.filter(
      (event) => event.sourceVoiceLane === 'lower-ostinato-bass-attack',
    ).map((event) => event.startDivision)).toEqual([0, 8])
    expect(rebuilt.filter((event) => event.type === 'rest')).toHaveLength(16)
  })

  it.each([
    ['an incomplete lattice', { columns: 15 }],
    ['unsupported lower-stem ownership', { lowerStem: 'up' }],
    ['a missing bass anchor', { bass: false }],
    ['a hollow bass note without crossing beam evidence', { beamedBass: false }],
    ['a misaligned second bass anchor', {
      splitBassAnchors: true,
      misalignedSecondBass: true,
    }],
  ])('abstains for %s', (_label, options) => {
    const source = denseAlternatingFixture(options)
    expect(reconstructDenseAlternatingVoiceLattice(source, 16)).toBe(source)
  })
})

function quarterMelodyOffbeatFixture({ missingBass = false, wrongOddStem = false } = {}) {
  const events = []
  if (!missingBass) {
    for (const index of [0, 4]) {
      events.push(latticeEvent([
        latticeNote({ cx: 100 + index * 20, midi: 42, clef: 'bass', stem: 'up' }),
      ], index * 2, 8))
    }
  }
  for (let index = 0; index < 8; index += 1) {
    const cx = 100 + index * 20
    if (index % 2 === 1) {
      events.push(latticeEvent([
        latticeNote({ cx, midi: 71, stem: wrongOddStem && index === 3 ? 'down' : 'up' }),
        latticeNote({ cx, midi: 66, stem: 'up' }),
      ], index * 2, 2))
      continue
    }
    const notes = [latticeNote({ cx, midi: 79 - index, stem: 'up' })]
    if (index === 2 || index === 6) {
      notes.push(latticeNote({ cx, midi: 70, stem: 'down' }))
      notes.push(latticeNote({ cx, midi: 63, stem: 'down' }))
      if (index === 2) {
        notes.push(latticeNote({ cx: cx - 9, midi: 58, stem: 'down' }))
      }
    }
    events.push(latticeEvent(notes, index * 2, 2))
  }
  return events
}

describe('reconstructQuarterMelodyOffbeatChordLattice', () => {
  it('recovers melody, offbeat, lower-chord, and bass cursors from eight columns', () => {
    const source = quarterMelodyOffbeatFixture()
    const rebuilt = reconstructQuarterMelodyOffbeatChordLattice(source, 16)

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 4], [4, 4], [8, 4], [12, 4]])
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 3 && event.type === 'note',
    ).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[2, 2], [6, 2], [10, 2], [14, 2]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.type,
    ])).toEqual([
      [0, 4, 'note'],
      [4, 2, 'note'],
      [6, 2, 'rest'],
      [8, 4, 'note'],
      [12, 2, 'note'],
      [14, 2, 'rest'],
    ])
    expect(rebuilt.filter((event) => event.type === 'rest')).toHaveLength(8)
  })

  it.each([
    ['a missing bass anchor', quarterMelodyOffbeatFixture({ missingBass: true }), 16],
    ['unsupported odd-column stem ownership', quarterMelodyOffbeatFixture({ wrongOddStem: true }), 16],
    ['a non-4/4 measure', quarterMelodyOffbeatFixture(), 12],
  ])('abstains for %s', (_label, source, totalDivisions) => {
    expect(reconstructQuarterMelodyOffbeatChordLattice(source, totalDivisions)).toBe(source)
  })
})

function tripletMelodyFixture({
  trebleNoteCount = 16,
  halfAnchor = true,
  wholeAnchor = false,
  columns = 12,
  bassOctave = true,
  beamedGroups = true,
} = {}) {
  const events = []
  const bass = [38, bassOctave ? 26 : 27].map((midi) => {
    const note = latticeNote({ cx: 100, midi, clef: 'bass', open: true })
    note.stem = null
    note.beams = 0
    return note
  })
  events.push(latticeEvent(bass, 0, 16))
  const chordIndexes = new Set(
    trebleNoteCount === 16
      ? [2, 5, 8, 10]
      : trebleNoteCount === 15
        ? [2, 5, 7]
        : trebleNoteCount === 14
          ? [2, 8]
          : [5],
  )
  for (let index = 0; index < columns; index += 1) {
    const cx = 100 + index * 18
    const note = latticeNote({ cx, midi: 78 - (index % 5), stem: 'down' })
    note.beams = beamedGroups && index % 3 === 1 && index < 7 ? 2 : 0
    if (halfAnchor && index === 6) {
      note.noteheadGlyph = 'half'
      note.hollow = true
      note.durationType = 'half'
      note.durationDivisions = 8
    } else if (wholeAnchor && index === 0) {
      note.noteheadGlyph = 'whole'
      note.hollow = true
      note.durationType = 'whole'
      note.durationDivisions = 16
    }
    const notes = [note]
    if (chordIndexes.has(index)) {
      notes.push(latticeNote({ cx, midi: note.midi - 7, stem: 'down' }))
    }
    events.push(latticeEvent(notes, index, 1))
  }
  return events
}

function tripletSourceOptions(ottavaIndex = null) {
  return {
    glyphs: ottavaIndex == null
      ? []
      : [{ text: '\ue510', x: 100 + ottavaIndex * 18, y: 80 }],
    measureBox: { x0: 90, y0: 100, x1: 320, y1: 220 },
  }
}

describe('reconstructTripletMelodyOverprintLattice', () => {
  it('recovers the explicit-half melody and the complete 3:2 attack lane', () => {
    const source = tripletMelodyFixture()
    const rebuilt = reconstructTripletMelodyOverprintLattice(
      source,
      16,
      tripletSourceOptions(7),
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 4], [4, 4], [8, 8]])
    const triplets = rebuilt.filter((event) => event.sourceVoice === 2)
    expect(triplets).toHaveLength(12)
    expect(triplets.every(
      (event) =>
        event.durationType === 'eighth' &&
        event.timeModification?.actualNotes === 3 &&
        event.timeModification?.normalNotes === 2,
    )).toBe(true)
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(1)
  })

  it.each([
    ['the syncopated 15-head variant', { trebleNoteCount: 15, halfAnchor: false }, 4, 7],
    ['the four-quarter 14-head variant', { trebleNoteCount: 14, halfAnchor: false }, 4, null],
    ['the whole-melody 16-head variant', { trebleNoteCount: 16, halfAnchor: false, wholeAnchor: true }, 1, 5],
  ])('recovers %s', (_label, options, expectedMelodyEvents, ottavaIndex) => {
    const rebuilt = reconstructTripletMelodyOverprintLattice(
      tripletMelodyFixture(options),
      16,
      tripletSourceOptions(ottavaIndex),
    )
    expect(rebuilt.filter((event) => event.sourceVoice === 1)).toHaveLength(
      expectedMelodyEvents,
    )
    expect(rebuilt.filter((event) => event.sourceVoice === 2)).toHaveLength(12)
  })

  it.each([4, 5])(
    'starts the whole-melody ottava shift at source-aligned column %i',
    (ottavaIndex) => {
      const source = tripletMelodyFixture({
        trebleNoteCount: 16,
        halfAnchor: false,
        wholeAnchor: true,
      })
      const sourceTripletMidis = source.slice(1).map((event) => event.notes[0].midi)
      const rebuilt = reconstructTripletMelodyOverprintLattice(
        source,
        16,
        tripletSourceOptions(ottavaIndex),
      )
      const triplets = rebuilt.filter((event) => event.sourceVoice === 2)

      expect(triplets[ottavaIndex - 1].notes[0].midi).toBe(
        sourceTripletMidis[ottavaIndex - 1],
      )
      expect(triplets[ottavaIndex].notes[0].midi).toBe(
        sourceTripletMidis[ottavaIndex] + 12,
      )
    },
  )

  it.each([
    ['an incomplete lattice', { columns: 11 }],
    ['a non-octave bass anchor', { bassOctave: false }],
    ['insufficient beam grouping', { beamedGroups: false }],
  ])('abstains for %s', (_label, options) => {
    const source = tripletMelodyFixture(options)
    expect(reconstructTripletMelodyOverprintLattice(
      source,
      16,
      tripletSourceOptions(7),
    )).toBe(source)
  })

  it('abstains when the printed ottava start does not align with the source variant', () => {
    const source = tripletMelodyFixture()
    expect(reconstructTripletMelodyOverprintLattice(
      source,
      16,
      tripletSourceOptions(5),
    )).toBe(source)
  })
})

function compoundMeterFixture({
  columns = 12,
  missingAnchorDot = false,
  sparseNonAnchorBeams = false,
  fragmentedBeamTopology = false,
  missingBeamTopology = false,
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
      note.beams = missingBeamTopology
        ? 0
        : fragmentedBeamTopology
          ? clef === 'bass' && [1, 2, 3, 4, 7, 8, 9, 10].includes(index) ? 2 : 0
          : anchor || !sparseNonAnchorBeams ? 2 : 0
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

  it('uses half-measure beam topology when beams do not attach to dotted anchors', () => {
    const source = compoundMeterFixture({ fragmentedBeamTopology: true })
    const rebuilt = reconstructCompoundMeterDottedBeamOverprints(source, 12)

    expect(rebuilt.flatMap((event) => event.notes)).toHaveLength(28)
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 2 || event.sourceVoice === 6,
    )).toHaveLength(4)
  })

  it.each([
    ['a non-6/8 meter', compoundMeterFixture(), 16],
    ['an incomplete lattice', compoundMeterFixture({ columns: 11 }), 12],
    ['incomplete dotted-anchor evidence', compoundMeterFixture({ missingAnchorDot: true }), 12],
    ['no double-beam topology', compoundMeterFixture({ missingBeamTopology: true }), 12],
  ])('abstains for %s', (_label, source, totalDivisions) => {
    expect(reconstructCompoundMeterDottedBeamOverprints(source, totalDivisions)).toBe(source)
  })
})

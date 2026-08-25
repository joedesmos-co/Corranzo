import { describe, expect, it } from 'vitest'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { buildMeasureStructureUnits } from '../src/features/omr/measureStructureSemantics.js'
import {
  applyVectorOttavaSpans,
  completeQuarterRestChordBassTies,
  completeSyncopatedQuarterChordBassTies,
  reconstructAlternatingEighthChordBassLattice,
  reconstructCantabileAlternatingChordGrid,
  reconstructCompoundMeterDottedBeamOverprints,
  reconstructDenseAlternatingVoiceLattice,
  reconstructDottedCadenceArpeggioGrid,
  reconstructDottedChordSixteenthBassLattice,
  reconstructDottedChordOffbeatPairLattice,
  reconstructDottedMelodySixteenthBassLattice,
  reconstructDottedMelodyHalfChordBassGrid,
  reconstructEighthMelodyQuarterChordBassLattice,
  reconstructEighthMelodyHalfSustainArpeggioLattice,
  reconstructHalfMelodyChordCadenceGrid,
  reconstructHalfSustainSixteenthCadenceGrid,
  reconstructMixedQuintupletSeptupletLattice,
  reconstructOffsetChordBassQuintupletGrid,
  reconstructQuarterChordGapBassLattice,
  reconstructQuarterCadenceSixteenthBassLattice,
  removeQuarterCadenceBassTieSpillover,
  reconstructTiedCadenceContinuationLattice,
  removeTiedCadenceContinuationBassTieSpillover,
  reconstructQuarterMelodyOffbeatChordLattice,
  reconstructQuarterRestChordBassLattice,
  reconstructSyncopatedChordBassOstinatoGrid,
  reconstructSyncopatedQuarterChordBassLattice,
  reconstructSustainedCantabileChordGrid,
  reconstructTiedChordMelodyBassLattice,
  reconstructTripletMelodyOverprintLattice,
  reconstructWholeMelodyQuarterChordBassGrid,
} from '../src/features/omr/processVectorOmrPage.js'

function rasterImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const mark = (x, y) => {
    const index = (y * width + x) * 4
    data[index] = 0
    data[index + 1] = 0
    data[index + 2] = 0
    data[index + 3] = 255
  }
  return { width, height, data, mark }
}

describe('applyVectorOttavaSpans', () => {
  it('shifts only treble notes inside a source-proven dotted 8va span', () => {
    const image = rasterImage(400, 250)
    for (let x = 110; x <= 220; x += 10) {
      for (let dashX = x; dashX < x + 5; dashX += 1) image.mark(dashX, 72)
    }
    for (let y = 73; y <= 80; y += 1) image.mark(224, y)
    const measureRecordsBySystem = [[{
      measureNumber: 1,
      events: [latticeEvent([
        latticeNote({ cx: 102, midi: 72 }),
        latticeNote({ cx: 180, midi: 76 }),
        latticeNote({ cx: 180, midi: 48, clef: 'bass' }),
        latticeNote({ cx: 240, midi: 79 }),
      ], 0, 4)],
    }]]

    const diagnostics = applyVectorOttavaSpans({
      glyphs: [{ text: '\ue510', x: 100, y: 80, width: 10, height: 20 }],
      imageData: image,
      systemMeasureBoxes: [[{ x0: 0.05, x1: 0.9, y0: 0.4, y1: 0.8 }]],
      measureRecordsBySystem,
    })

    expect(diagnostics).toMatchObject({ appliedNoteCount: 2 })
    expect(measureRecordsBySystem[0][0].events[0].notes.map((note) => note.midi))
      .toEqual([84, 88, 48, 79])
    expect(measureRecordsBySystem[0][0].events[0].notes[0]).toMatchObject({
      ottavaShiftSemitones: 12,
      vectorOttavaSpan: true,
    })
  })

  it('abstains without a dotted line and terminal hook', () => {
    const image = rasterImage(400, 250)
    const sourceNote = latticeNote({ cx: 140, midi: 72 })
    const measureRecordsBySystem = [[{
      measureNumber: 1,
      events: [latticeEvent([sourceNote], 0, 4)],
    }]]

    const diagnostics = applyVectorOttavaSpans({
      glyphs: [{ text: '\ue510', x: 100, y: 80, width: 10, height: 20 }],
      imageData: image,
      systemMeasureBoxes: [[{ x0: 0.05, x1: 0.9, y0: 0.4, y1: 0.8 }]],
      measureRecordsBySystem,
    })

    expect(diagnostics).toEqual({ detected: [], appliedNoteCount: 0 })
    expect(measureRecordsBySystem[0][0].events[0].notes[0]).toBe(sourceNote)
  })
})

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

function cantabileChordGridFixture({
  variant = 'odd',
  irregularAttack = false,
  openBassAnchor = true,
  sourceRestCount = null,
} = {}) {
  const odd = variant === 'odd'
  const xs = odd
    ? [100, 124, 160, 172, 194, 214, 236, 256]
    : [100, irregularAttack ? 128 : 118, 136, 154, 172, 190, 214, 234]
  const columns = odd
    ? [
        [[78, 'up']],
        [[70, 'down'], [66, 'down']],
        [[70, 'down'], [66, 'down']],
        [[77, 'up']],
        [[75, 'down'], [71, 'down'], [63, 'down']],
        [[70, 'up'], [66, 'up']],
        [[75, 'up'], [69, 'down'], [63, 'down']],
        [[70, 'up'], [66, 'up']],
      ]
    : [
        [[78, 'up']],
        [[70, 'down'], [66, 'down']],
        [[78, 'up']],
        [[70, 'down'], [66, 'down']],
        [[82, 'up', true], [71, 'down'], [66, 'down'], [63, 'down']],
        [[78, 'up'], [75, 'up'], [70, 'up']],
        [[69, 'down'], [66, 'down'], [63, 'down']],
        [[78, 'up'], [75, 'up'], [70, 'up']],
      ]
  const events = columns.map((specs, index) => {
    const notes = specs.map(([midi, stem, open = false]) => {
      const note = latticeNote({ cx: xs[index], midi, stem, open })
      note.stem.x = xs[index] + (stem === 'up' ? 5 : -5)
      note.beams = index === 1 || (!odd && index === 4) ? 2 : 0
      note.dotted = odd && index === 0
      return note
    })
    return latticeEvent(notes, index * 2, 1)
  })
  const bassFirst = latticeNote({ cx: 100, midi: 39, clef: 'bass', stem: 'up' })
  bassFirst.stem.x = 105
  bassFirst.durationDivisions = 4
  bassFirst.durationType = 'quarter'
  const bassSecond = latticeNote({
    cx: odd ? 142 : 136,
    midi: 58,
    clef: 'bass',
    stem: 'down',
    open: openBassAnchor,
  })
  bassSecond.stem.x = bassSecond.cx - 5
  bassSecond.durationDivisions = 12
  bassSecond.durationType = 'half'
  bassSecond.dotted = true
  const restCount = sourceRestCount ?? (odd ? 1 : 0)
  return [
    ...events,
    latticeEvent([bassFirst], 0, 4),
    latticeEvent([bassSecond], 4, 12),
    ...Array.from({ length: restCount }, (_, index) => ({
      type: 'rest',
      clef: 'treble',
      cx: 130 + index * 20,
      startDivision: 2 + index * 2,
      durationDivisions: 2,
      durationType: 'eighth',
    })),
  ]
}

describe('reconstructCantabileAlternatingChordGrid', () => {
  it.each([
    ['double-dotted melody', 'odd', [[0, 7], [7, 1], [8, 4], [12, 4]]],
    ['half-note melody', 'even', [[0, 4], [4, 4], [8, 8]]],
  ])('recovers the %s and two alternating chord cursors', (
    _label,
    variant,
    expectedMelody,
  ) => {
    const rebuilt = reconstructCantabileAlternatingChordGrid(
      cantabileChordGridFixture({ variant }),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual(expectedMelody)
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
    ])).toEqual([
      ['rest', 0], ['note', 2], ['rest', 4], ['note', 6],
      ['note', 8], ['rest', 10], ['note', 12], ['rest', 14],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 3).map((event) => [
      event.type,
      event.startDivision,
    ])).toEqual([
      ['rest', 8], ['note', 10], ['rest', 12], ['note', 14],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 4], [4, 12]])
  })

  it.each([
    ['a filled second bass anchor', { openBassAnchor: false }, 16],
    ['multiple detected source rests', { sourceRestCount: 2 }, 16],
    ['irregular opening attack geometry', { variant: 'even', irregularAttack: true }, 16],
    ['a non-4/4 measure', {}, 12],
  ])('abstains for %s', (_label, options, totalDivisions) => {
    const source = cantabileChordGridFixture(options)
    expect(reconstructCantabileAlternatingChordGrid(source, totalDivisions)).toBe(source)
  })
})

function sustainedCantabileFixture({
  variant = 'whole',
  tiedBass = true,
  wrongTiedPitch = false,
  missingOpeningBeam = false,
} = {}) {
  const whole = variant === 'whole'
  const xs = whole
    ? [100, 120, 160, 180, 200, 220, 240]
    : [100, 124, 160, 172, 194, 214, 236, 256]
  const columns = whole
    ? [
        [[75, null, true]],
        [[70, 'down'], [66, 'down']],
        [[70, 'down'], [66, 'down']],
        [[71, 'down'], [66, 'down'], [63, 'down']],
        [[70, 'up'], [66, 'up']],
        [[69, 'down'], [66, 'down'], [63, 'down']],
        [[70, 'up'], [66, 'up']],
      ]
    : [
        [[78, 'up']],
        [[70, 'down'], [66, 'down']],
        [[70, 'down'], [66, 'down']],
        [[77, 'up']],
        [[75, 'down', true], [71, 'down'], [63, 'down']],
        [[70, 'up'], [66, 'up']],
        [[69, 'down'], [63, 'down']],
        [[70, 'up'], [66, 'up']],
      ]
  const events = columns.map((specs, index) => {
    const notes = specs.map(([midi, stem, open = false]) => {
      const note = latticeNote({
        cx: xs[index],
        midi,
        stem: stem ?? 'up',
        open,
      })
      if (stem == null) {
        note.stem = null
      } else {
        note.stem.x = xs[index] + (stem === 'up' ? 5 : -5)
      }
      note.beams = index === 1 && !missingOpeningBeam ? 2 : 0
      note.dotted = !whole && index === 0
      return note
    })
    return latticeEvent(notes, index * 2, 1)
  })
  const bassAttack = latticeNote({ cx: 100, midi: 39, clef: 'bass', stem: 'up' })
  bassAttack.stem.x = 105
  const upperCx = whole ? 140 : 142
  const upperSustain = latticeNote({
    cx: upperCx,
    midi: 58,
    clef: 'bass',
    stem: 'down',
    open: true,
  })
  upperSustain.stem.x = upperCx - 5
  const bassEvents = [
    latticeEvent([bassAttack], 0, 4),
    latticeEvent([upperSustain], 4, 12),
  ]
  if (tiedBass) {
    const tied = latticeNote({
      cx: 114,
      midi: wrongTiedPitch ? 40 : 39,
      clef: 'bass',
      open: true,
    })
    tied.stem = null
    bassEvents.splice(1, 0, latticeEvent([tied], 0, 16))
  }
  return [
    ...events,
    ...bassEvents,
    ...(!whole ? [{
      type: 'rest',
      clef: 'treble',
      cx: 150,
      startDivision: 6,
      durationDivisions: 2,
      durationType: 'eighth',
    }] : []),
  ]
}

describe('reconstructSustainedCantabileChordGrid', () => {
  it.each([
    ['whole melody', 'whole', [[0, 16]]],
    ['double-dotted and half melody', 'half', [[0, 7], [7, 1], [8, 8]]],
  ])('recovers the %s above the tied bass sustain', (_label, variant, melody) => {
    const rebuilt = reconstructSustainedCantabileChordGrid(
      sustainedCantabileFixture({ variant }),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual(melody)
    expect(rebuilt.filter((event) => event.sourceVoice === 2 && event.type === 'note')
      .map((event) => event.startDivision)).toEqual([2, 6, 8, 12])
    expect(rebuilt.filter((event) => event.sourceVoice === 3 && event.type === 'note')
      .map((event) => event.startDivision)).toEqual([10, 14])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 4], [4, 12]])
    expect(rebuilt.find((event) => event.sourceVoice === 6)).toMatchObject({
      startDivision: 0,
      durationDivisions: 16,
    })
  })

  it('also recovers the complete two-head bass foundation', () => {
    const rebuilt = reconstructSustainedCantabileChordGrid(
      sustainedCantabileFixture({ tiedBass: false }),
      16,
    )
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(2)
    expect(rebuilt.some((event) => event.sourceVoice === 6)).toBe(false)
    expect(rebuilt.find(
      (event) =>
        event.sourceVoice === 3 &&
        event.type === 'rest' &&
        event.startDivision === 0,
    )).toMatchObject({ durationDivisions: 8 })
  })

  it.each([
    ['a mismatched tied bass pitch', { wrongTiedPitch: true }, 16],
    ['missing opening double-beam evidence', { missingOpeningBeam: true }, 16],
    ['a non-4/4 measure', {}, 12],
  ])('abstains for %s', (_label, options, totalDivisions) => {
    const source = sustainedCantabileFixture(options)
    expect(reconstructSustainedCantabileChordGrid(source, totalDivisions)).toBe(source)
  })
})

function quarterRestChordBassFixture({ missingBassHead = false } = {}) {
  const events = []
  const xs = Array.from({ length: 8 }, (_, index) => 100 + index * 24)
  const trebleCounts = [1, 0, 3, 1, 1, 1, 2, 1]
  const bassCounts = [2, 1, 2, 2, 2, 2, 2, 0]
  for (const [index, cx] of xs.entries()) {
    if (trebleCounts[index]) {
      const notes = Array.from({ length: trebleCounts[index] }, (_, noteIndex) => {
        const stem = index === 6
          ? noteIndex === 0 ? 'up' : 'down'
          : index === 2 && noteIndex > 0 ? 'up' : 'down'
        const note = latticeNote({
          cx,
          midi: 81 - index * 2 - noteIndex * 4,
          stem,
        })
        note.beams = index === 5 ? 2 : 0
        return note
      })
      events.push(latticeEvent(notes, index * 2, 1))
    }
    const count = bassCounts[index] - (missingBassHead && index === 3 ? 1 : 0)
    if (count > 0) {
      const notes = Array.from({ length: count }, (_, noteIndex) => {
        const stem = index >= 4 && noteIndex === 0 ? 'down' : 'up'
        const bassTopMidi = index >= 3 ? 48 : 52 - index
        const note = latticeNote({
          cx,
          midi: bassTopMidi - noteIndex * 12,
          clef: 'bass',
          stem,
        })
        note.durationDivisions = 4
        note.durationType = 'quarter'
        if (index === 3 && noteIndex === 0) note.tieStart = true
        if (index === 4 && noteIndex === 0) note.tieStop = true
        note.beams = [4, 5].includes(index) && noteIndex === 1 ? 1 : 0
        return note
      })
      events.push(latticeEvent(notes, index * 2, 1))
    }
  }
  return events
}

describe('reconstructQuarterRestChordBassLattice', () => {
  it('recovers the independent melody, half-chord, and bass cursors', () => {
    const rebuilt = reconstructQuarterRestChordBassLattice(
      quarterRestChordBassFixture(),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['note', 0, 4],
      ['rest', 4, 2],
      ['note', 6, 2],
      ['note', 8, 2],
      ['note', 10, 2],
      ['note', 12, 2],
      ['note', 14, 2],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
      event.notes?.length ?? 0,
    ])).toEqual([
      ['rest', 0, 4, 0],
      ['note', 4, 4, 3],
      ['rest', 8, 4, 0],
      ['note', 12, 4, 1],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      [0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4],
    ])
    const tieCompleted = completeQuarterRestChordBassTies(rebuilt)
    expect(tieCompleted.filter((event) => event.sourceVoice === 5)[3].notes.every(
      (note) => note.tieStart === true,
    )).toBe(true)
    expect(tieCompleted.filter((event) => event.sourceVoice === 5)[4].notes.every(
      (note) => note.tieStop === true,
    )).toBe(true)
  })

  it('abstains when the source pattern is incomplete or the meter differs', () => {
    const complete = quarterRestChordBassFixture()
    const incomplete = quarterRestChordBassFixture({ missingBassHead: true })
    expect(reconstructQuarterRestChordBassLattice(incomplete, 16)).toBe(incomplete)
    expect(reconstructQuarterRestChordBassLattice(complete, 12)).toBe(complete)
  })

  it('does not complete a paired tie without one detected start/stop pair', () => {
    const rebuilt = reconstructQuarterRestChordBassLattice(
      quarterRestChordBassFixture(),
      16,
    ).map((event) => ({
      ...event,
      notes: event.notes?.map((note) => ({
        ...note,
        tieStart: undefined,
        tieStop: undefined,
      })),
    }))
    expect(completeQuarterRestChordBassTies(rebuilt)).toBe(rebuilt)
  })
})

function eighthMelodyQuarterChordBassFixture({ missingBassHead = false } = {}) {
  const events = [{
    type: 'rest',
    clef: 'treble',
    startDivision: 1,
    durationDivisions: 2,
    durationType: 'eighth',
  }]
  const xs = Array.from({ length: 8 }, (_, index) => 100 + index * 24)
  const bassCounts = [2, 0, 3, 1, 1, 1, 3, 0]
  for (const [index, cx] of xs.entries()) {
    const melody = latticeNote({
      cx,
      midi: 76 - (index % 2) * 2,
      stem: 'up',
    })
    melody.beams = [0, 1, 2, 5, 6].includes(index) ? 2 : index === 4 ? 1 : 0
    events.push(latticeEvent([melody], index * 2, 1))
    if ([2, 6].includes(index)) {
      events.push(latticeEvent([
        latticeNote({ cx, midi: 68, stem: 'down' }),
      ], index * 2, 1))
    }

    const count = bassCounts[index] - (missingBassHead && index === 2 ? 1 : 0)
    if (count > 0) {
      const notes = Array.from({ length: count }, (_, noteIndex) => {
        const stem = index === 0
          ? noteIndex === 0 ? 'down' : 'up'
          : [2, 3, 6].includes(index) ? 'down' : 'up'
        const midi = [3, 4, 5].includes(index)
          ? 49
          : 64 - noteIndex * 6
        const note = latticeNote({ cx, midi, clef: 'bass', stem })
        note.durationDivisions = [0, 3, 5, 6].includes(index) ? 4 : 2
        note.durationType = note.durationDivisions === 4 ? 'quarter' : 'eighth'
        note.beams = index === 2 && noteIndex === 0 ? 1 : 0
        if (index === 3) note.tieStart = true
        if (index === 4) note.tieStop = true
        return note
      })
      events.push(latticeEvent(notes, index * 2, 1))
    }
  }
  return events
}

describe('reconstructEighthMelodyQuarterChordBassLattice', () => {
  it('recovers the eighth melody, quarter chords, and syncopated bass', () => {
    const rebuilt = reconstructEighthMelodyQuarterChordBassLattice(
      eighthMelodyQuarterChordBassFixture(),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual(Array.from({ length: 8 }, (_, index) => [index * 2, 2]))
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['rest', 0, 4], ['note', 4, 4], ['rest', 8, 4], ['note', 12, 4],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 4, 2], [4, 2, 3], [6, 2, 1],
      [8, 2, 1], [10, 2, 1], [12, 4, 3],
    ])
  })

  it('abstains for incomplete bass evidence or a different meter', () => {
    const complete = eighthMelodyQuarterChordBassFixture()
    const incomplete = eighthMelodyQuarterChordBassFixture({ missingBassHead: true })
    expect(reconstructEighthMelodyQuarterChordBassLattice(incomplete, 16))
      .toBe(incomplete)
    expect(reconstructEighthMelodyQuarterChordBassLattice(complete, 12))
      .toBe(complete)
  })
})

function tiedChordMelodyBassFixture({ openSustain = true } = {}) {
  const events = []
  const xs = [100, 132, 164, 200, 232, 264, 296, 328, 348]
  const melodyIndexes = new Set([0, 1, 2, 3, 4, 6, 8])
  const melodyMidis = [69, 66, 69, 68, 68, null, 68, null, 68]
  const chordMidis = [[63, 60], [63, 60], [63, 60], [65, 60], [65, 60]]
  const bassMidis = [36, 48, 36, 48, 37, 49, 32, 44]

  for (const [index, cx] of xs.entries()) {
    if (melodyIndexes.has(index)) {
      const melody = latticeNote({
        cx,
        midi: melodyMidis[index],
        stem: [1, 4].includes(index) ? 'down' : 'up',
      })
      melody.beams = [0, 1, 2, 6].includes(index) ? 1 : 0
      events.push(latticeEvent([melody], index, 1))
    }
    if (index < 5) {
      const chord = chordMidis[index].map((midi, noteIndex) => latticeNote({
        cx,
        midi,
        stem: noteIndex === 0 || index >= 2 ? 'down' : 'up',
        open: index === 4 && openSustain,
      }))
      events.push(latticeEvent(chord, index, 1))
    }
    if (index < 8) {
      const bass = latticeNote({ cx, midi: bassMidis[index], clef: 'bass' })
      bass.beams = [1, 3, 5].includes(index) ? 1 : 0
      events.push(latticeEvent([bass], index, 1))
    }
  }
  return events
}

describe('reconstructTiedChordMelodyBassLattice', () => {
  it('separates the sustained chord, upper melody, and bass eighths', () => {
    const rebuilt = reconstructTiedChordMelodyBassLattice(
      tiedChordMelodyBassFixture(),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([[0, 2, 2], [2, 2, 2], [4, 2, 2], [6, 2, 2], [8, 8, 2]])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 3], [15, 1]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual(Array.from({ length: 8 }, (_, index) => [index * 2, 2]))
  })

  it('abstains without the printed hollow sustain or in a different meter', () => {
    const complete = tiedChordMelodyBassFixture()
    const noSustain = tiedChordMelodyBassFixture({ openSustain: false })
    expect(reconstructTiedChordMelodyBassLattice(noSustain, 16)).toBe(noSustain)
    expect(reconstructTiedChordMelodyBassLattice(complete, 12)).toBe(complete)
  })
})

function dottedChordSixteenthBassFixture({
  dotted = true,
  upperStem = 'up',
  includeRest = true,
} = {}) {
  const events = []
  const xs = [100, 136, 160, 184, 208, 224, 240, 264]
  const trebleMidis = [[69], [81, 76, 72, 69], [], [74, 71], [], [76, 72], [], [69]]
  const bassMidis = [[53, 41], [64, 60, 57], [53], [52, 40], [40], [52], [47], [47, 33]]
  for (const [index, cx] of xs.entries()) {
    if (trebleMidis[index].length) {
      const notes = trebleMidis[index].map((midi, noteIndex) => {
        const stem = index === 1 && noteIndex < 2 ? upperStem : 'down'
        const note = latticeNote({ cx, midi, stem })
        if (index === 3) {
          note.dotted = dotted
          note.beams = 2
        }
        return note
      })
      events.push(latticeEvent(notes, index, 1))
    }
    if (bassMidis[index].length) {
      const notes = bassMidis[index].map((midi, noteIndex) => latticeNote({
        cx,
        midi,
        clef: 'bass',
        stem: index === 1 || index === 2 || noteIndex === 0 ? 'down' : 'up',
      }))
      if ([4, 5, 6].includes(index)) notes[0].stem.direction = 'up'
      events.push(latticeEvent(notes, index, 1))
    }
  }
  if (includeRest) {
    events.push({
      type: 'rest',
      clef: 'treble',
      cx: xs[6],
      startDivision: 14,
      durationDivisions: 2,
      durationType: 'eighth',
    })
  }
  return events
}

describe('reconstructDottedChordSixteenthBassLattice', () => {
  it('recovers the dotted upper chord and mixed sixteenth bass cursors', () => {
    const rebuilt = reconstructDottedChordSixteenthBassLattice(
      dottedChordSixteenthBassFixture(),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
      event.notes?.length ?? 0,
    ])).toEqual([
      ['note', 0, 4, 1], ['note', 4, 4, 2], ['note', 8, 3, 2],
      ['note', 11, 1, 2], ['rest', 12, 2, 0], ['note', 14, 2, 1],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['rest', 0, 4], ['note', 4, 4], ['rest', 8, 8],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 4, 2], [4, 2, 3], [6, 2, 1], [8, 2, 2],
      [10, 1, 1], [11, 1, 1], [12, 2, 1], [14, 2, 2],
    ])
  })

  it('abstains without the dotted beam, printed rest, upper stem, or meter', () => {
    const complete = dottedChordSixteenthBassFixture()
    const noDot = dottedChordSixteenthBassFixture({ dotted: false })
    const noRest = dottedChordSixteenthBassFixture({ includeRest: false })
    const wrongStem = dottedChordSixteenthBassFixture({ upperStem: 'down' })
    expect(reconstructDottedChordSixteenthBassLattice(noDot, 16)).toBe(noDot)
    expect(reconstructDottedChordSixteenthBassLattice(noRest, 16)).toBe(noRest)
    expect(reconstructDottedChordSixteenthBassLattice(wrongStem, 16)).toBe(wrongStem)
    expect(reconstructDottedChordSixteenthBassLattice(complete, 12)).toBe(complete)
  })
})

function alternatingEighthChordBassFixture({
  includeRest = true,
  upperStem = 'up',
} = {}) {
  const events = []
  const xs = Array.from({ length: 8 }, (_, index) => 100 + index * 24)
  const trebleMidis = [[69], [69], [81, 76, 72], [69], [74, 71], [76, 72],
    [74, 71], [76, 72]]
  const bassMidis = [[45, 33], [45], [57, 52], [48, 36], [48, 36], [36], [48], [36]]
  for (const [index, cx] of xs.entries()) {
    const trebleNotes = trebleMidis[index].map((midi, noteIndex) => {
      const note = latticeNote({
        cx,
        midi,
        stem: index === 2 && noteIndex < 2 ? upperStem : 'down',
      })
      note.beams = [0, 1, 4, 5, 6].includes(index) ? 2 : 0
      return note
    })
    events.push(latticeEvent(trebleNotes, index * 2, 1))

    const bassNotes = bassMidis[index].map((midi, noteIndex) => {
      const note = latticeNote({
        cx,
        midi,
        clef: 'bass',
        stem: index === 4 && noteIndex === 0 ? 'down' : 'up',
      })
      note.beams = index === 2 ? 2 : 0
      return note
    })
    events.push(latticeEvent(bassNotes, index * 2, 1))
  }
  if (includeRest) {
    events.push({
      type: 'rest',
      clef: 'treble',
      cx: xs[0],
      sourceGlyph: '\ue4e5',
      startDivision: 1,
      durationDivisions: 2,
      durationType: 'eighth',
    })
  }
  return events
}

describe('reconstructAlternatingEighthChordBassLattice', () => {
  it('recovers the melody, quarter chord, and bass eighth cursors', () => {
    const rebuilt = reconstructAlternatingEighthChordBassLattice(
      alternatingEighthChordBassFixture(),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 2, 1], [2, 2, 1], [4, 2, 1], [6, 2, 1],
      [8, 2, 2], [10, 2, 2], [12, 2, 2], [14, 2, 2],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['rest', 0, 4], ['note', 4, 4], ['rest', 8, 8],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 2, 2], [2, 2, 1], [4, 2, 2], [6, 2, 2],
      [8, 2, 2], [10, 2, 1], [12, 2, 1], [14, 2, 1],
    ])
  })

  it('abstains without the printed rest, upper stem, or 4/4 capacity', () => {
    const complete = alternatingEighthChordBassFixture()
    const noRest = alternatingEighthChordBassFixture({ includeRest: false })
    const wrongStem = alternatingEighthChordBassFixture({ upperStem: 'down' })
    expect(reconstructAlternatingEighthChordBassLattice(noRest, 16)).toBe(noRest)
    expect(reconstructAlternatingEighthChordBassLattice(wrongStem, 16)).toBe(wrongStem)
    expect(reconstructAlternatingEighthChordBassLattice(complete, 12)).toBe(complete)
  })
})

function quarterCadenceSixteenthBassFixture({
  variant = 'chordal',
  includeRest = variant === 'octave',
  firstGap = 36,
} = {}) {
  const xs = [100, 100 + firstGap, 160, 184, 208, 224, 240, 264]
  const trebleMidis = variant === 'chordal'
    ? [[69], [69, 72, 76, 81], [], [67, 71], [], [], [67], [64, 67, 76]]
    : [[69], [74, 81], [], [71], [], [], [67], [69, 81]]
  const bassMidis = [
    [38, 50], [53, 57, 60], [50], [40, 52], [40], [52], [47],
    variant === 'chordal' ? [33] : [33, 45],
  ]
  const events = []
  for (const [index, cx] of xs.entries()) {
    if (trebleMidis[index].length) {
      const trebleNotes = trebleMidis[index].map((midi) => {
        let stem = 'down'
        if (variant === 'chordal' && index === 1 && midi !== 81) stem = 'up'
        if (variant === 'chordal' && index === 7 && midi !== 64) stem = 'up'
        if (variant === 'octave' && index === 1 && midi === 81) stem = 'up'
        if (variant === 'octave' && index === 7 && midi === 69) stem = 'up'
        const note = latticeNote({ cx, midi, stem })
        note.beams = variant === 'chordal' && index === 6 ? 2 : 0
        return note
      })
      events.push(latticeEvent(trebleNotes, index * 2, 1))
    }

    const bassNotes = bassMidis[index].map((midi) => {
      let stem = 'up'
      if ((index === 0 && midi === 50) || index === 1 || index === 2 ||
        (index === 3 && midi === 52) ||
        (variant === 'octave' && index === 7 && midi === 45)) {
        stem = 'down'
      }
      const note = latticeNote({ cx, midi, clef: 'bass', stem })
      note.beams = index === 1 && midi === 53 ? 2 : index === 3 && midi === 52 ? 1 : 0
      return note
    })
    events.push(latticeEvent(bassNotes, index * 2, 1))
  }
  if (includeRest) {
    events.push({
      type: 'rest',
      clef: 'treble',
      cx: xs[6],
      sourceGlyph: '\ue4e6',
      startDivision: 12,
      durationDivisions: 2,
      durationType: 'eighth',
    })
  }
  return events
}

describe('reconstructQuarterCadenceSixteenthBassLattice', () => {
  it.each([
    ['chordal', [2, 2]],
    ['octave', [1, 1]],
  ])('recovers the %s upper cadence and asymmetric bass cursor', (
    variant,
    openingNoteCounts,
  ) => {
    const rebuilt = reconstructQuarterCadenceSixteenthBassLattice(
      quarterCadenceSixteenthBassFixture({ variant }),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 4, 1], [4, 4, openingNoteCounts[0]], [8, 4, variant === 'chordal' ? 2 : 1],
      [12, 2, 1], [14, 2, 1],
    ])
    expect(rebuilt.filter(
      (event) => event.type === 'note' && event.sourceVoice === 2,
    ).map((event) => [event.startDivision, event.notes.length])).toEqual([
      [4, openingNoteCounts[1]], [14, 2],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 4, 2], [4, 2, 3], [6, 2, 1], [8, 2, 2],
      [10, 1, 1], [11, 1, 1], [12, 2, 1],
      [14, 2, variant === 'chordal' ? 1 : 2],
    ])
  })

  it('abstains on incomplete rest, geometry, or meter evidence', () => {
    const missingRest = quarterCadenceSixteenthBassFixture({
      variant: 'octave',
      includeRest: false,
    })
    const regularOpening = quarterCadenceSixteenthBassFixture({ firstGap: 24 })
    const complete = quarterCadenceSixteenthBassFixture()
    expect(reconstructQuarterCadenceSixteenthBassLattice(missingRest, 16)).toBe(missingRest)
    expect(reconstructQuarterCadenceSixteenthBassLattice(regularOpening, 16)).toBe(regularOpening)
    expect(reconstructQuarterCadenceSixteenthBassLattice(complete, 12)).toBe(complete)
  })

  it('removes only a fourth closing tie spilled onto the lone bass head', () => {
    const rebuilt = reconstructQuarterCadenceSixteenthBassLattice(
      quarterCadenceSixteenthBassFixture(),
      16,
    ).map((event) => {
      if (event.type !== 'note' || event.startDivision !== 14) return event
      return {
        ...event,
        tieStart: true,
        notes: event.notes.map((note) => ({ ...note, tieStart: true })),
      }
    })
    const repaired = removeQuarterCadenceBassTieSpillover(rebuilt)
    const closingBass = repaired.find(
      (event) => event.sourceVoice === 5 && event.startDivision === 14,
    )
    const closingUpper = repaired.filter(
      (event) => event.sourceVoice !== 5 && event.startDivision === 14,
    )
    expect(closingBass.tieStart).toBeUndefined()
    expect(closingBass.notes[0].tieStart).toBeUndefined()
    expect(closingUpper.flatMap((event) => event.notes).every(
      (note) => note.tieStart === true,
    )).toBe(true)
  })
})

function tiedCadenceContinuationFixture({ openingUpperStem = 'up', gapScale = 1 } = {}) {
  const xs = [100, 124, 153, 178, 202, 226, 250, 274]
    .map((x) => 100 + (x - 100) * gapScale)
  const trebleMidis = [
    [64, 67, 76], [67], [62], [62], [60], [62], [64], [67],
  ]
  const bassMidis = [[45], [33], [32], [44], [31], [43], [36, 48], [43]]
  const events = []
  for (const [index, cx] of xs.entries()) {
    const trebleNotes = trebleMidis[index].map((midi) => {
      const stem = index === 0 && midi === 67 ? openingUpperStem : 'down'
      const note = latticeNote({ cx, midi, stem })
      note.beams = (index === 0 && midi === 64) || index === 1 || index === 2 ? 2 : 0
      return note
    })
    events.push(latticeEvent(trebleNotes, index * 2, 1))
    const bassNotes = bassMidis[index].map((midi) => {
      const stem = index === 6 && midi === 48 ? 'down' : 'up'
      const note = latticeNote({ cx, midi, clef: 'bass', stem })
      note.beams = index === 5 ? 2 : 0
      return note
    })
    events.push(latticeEvent(bassNotes, index * 2, 1))
  }
  return events
}

describe('reconstructTiedCadenceContinuationLattice', () => {
  it('recovers the melody, incoming chord, and bass eighth cursors', () => {
    const rebuilt = reconstructTiedCadenceContinuationLattice(
      tiedCadenceContinuationFixture(),
      16,
    )
    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual(Array.from({ length: 8 }, (_, index) => [index * 2, 2, 1]))
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
      event.notes?.length ?? 0,
    ])).toEqual([
      ['note', 0, 4, 2], ['rest', 4, 4, 0], ['rest', 8, 8, 0],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 2, 1], [2, 2, 1], [4, 2, 1], [6, 2, 1],
      [8, 2, 1], [10, 2, 1], [12, 2, 2], [14, 2, 1],
    ])
  })

  it('abstains on missing stem ownership, irregular geometry, or meter', () => {
    const wrongStem = tiedCadenceContinuationFixture({ openingUpperStem: 'down' })
    const stretched = tiedCadenceContinuationFixture({ gapScale: 1.5 })
    stretched[2].notes.forEach((note) => { note.cx += 20 })
    const complete = tiedCadenceContinuationFixture()
    expect(reconstructTiedCadenceContinuationLattice(wrongStem, 16)).toBe(wrongStem)
    expect(reconstructTiedCadenceContinuationLattice(stretched, 16)).toBe(stretched)
    expect(reconstructTiedCadenceContinuationLattice(complete, 12)).toBe(complete)
  })

  it('removes only the bass stop spilled from three incoming upper ties', () => {
    const rebuilt = reconstructTiedCadenceContinuationLattice(
      tiedCadenceContinuationFixture(),
      16,
    ).map((event) => {
      const isUpperOpening = event.type === 'note' && event.startDivision === 0 &&
        event.sourceVoice !== 5
      const isBassSpill = event.type === 'note' && event.startDivision === 2 &&
        event.sourceVoice === 5
      if (!isUpperOpening && !isBassSpill) return event
      return {
        ...event,
        tieStop: true,
        notes: event.notes.map((note) => ({ ...note, tieStop: true })),
      }
    })
    const repaired = removeTiedCadenceContinuationBassTieSpillover(rebuilt)
    const bassStop = repaired.find(
      (event) => event.sourceVoice === 5 && event.startDivision === 2,
    )
    expect(bassStop.tieStop).toBeUndefined()
    expect(bassStop.notes[0].tieStop).toBeUndefined()
    expect(repaired.filter(
      (event) => event.sourceVoice !== 5 && event.startDivision === 0,
    ).flatMap((event) => event.notes).every((note) => note.tieStop === true)).toBe(true)
  })
})

function quarterChordGapBassFixture({ closingUpperStem = 'up', includeRests = true } = {}) {
  const events = []
  const xs = [100, 137, 162, 187, 212, 229, 245, 270]
  const trebleMidis = [[69], [81, 76, 72], [67], [69], [72], [], [81, 74], [76]]
  const bassMidis = [[53, 41], [64, 60, 57], [53], [52, 40], [], [52, 40], [], [45, 33]]
  for (const [index, cx] of xs.entries()) {
    if (trebleMidis[index].length) {
      const notes = trebleMidis[index].map((midi, noteIndex) => {
        const stem = index === 1
          ? noteIndex === 0 ? 'down' : 'up'
          : index === 6 && noteIndex === 0 ? closingUpperStem : 'down'
        const note = latticeNote({ cx, midi, stem })
        note.beams = index === 4 ? 2 : 0
        return note
      })
      events.push(latticeEvent(notes, index, 1))
    }
    if (bassMidis[index].length) {
      const notes = bassMidis[index].map((midi, noteIndex) => latticeNote({
        cx,
        midi,
        clef: 'bass',
        stem: index === 1 || noteIndex === 0 ? 'down' : 'up',
      }))
      events.push(latticeEvent(notes, index, 1))
    }
  }
  if (includeRests) {
    for (const cx of [xs[4], xs[6]]) {
      events.push({
        type: 'rest',
        clef: 'bass',
        cx,
        durationDivisions: 1,
        durationType: 'sixteenth',
      })
    }
  }
  return events
}

describe('reconstructQuarterChordGapBassLattice', () => {
  it('recovers the melody, upper attacks, and written bass gaps', () => {
    const rebuilt = reconstructQuarterChordGapBassLattice(
      quarterChordGapBassFixture(),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['note', 0, 4], ['rest', 4, 2], ['note', 6, 2], ['note', 8, 2],
      ['note', 10, 2], ['note', 12, 2], ['note', 14, 2],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['rest', 0, 4], ['note', 4, 4], ['rest', 8, 4], ['note', 12, 4],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['note', 0, 4], ['note', 4, 2], ['note', 6, 2], ['note', 8, 2],
      ['rest', 10, 1], ['note', 11, 1], ['rest', 12, 2], ['note', 14, 2],
    ])
  })

  it('abstains when the opposing closing stems or meter are absent', () => {
    const complete = quarterChordGapBassFixture()
    const wrongStem = quarterChordGapBassFixture({ closingUpperStem: 'down' })
    const noRests = quarterChordGapBassFixture({ includeRests: false })
    expect(reconstructQuarterChordGapBassLattice(wrongStem, 16)).toBe(wrongStem)
    expect(reconstructQuarterChordGapBassLattice(noRests, 16)).toBe(noRests)
    expect(reconstructQuarterChordGapBassLattice(complete, 12)).toBe(complete)
  })
})

function syncopatedQuarterChordBassFixture({ missingBassHead = false } = {}) {
  const events = [{
    type: 'rest',
    clef: 'treble',
    startDivision: 2,
    durationDivisions: 2,
    durationType: 'eighth',
  }]
  const xs = [100, 136, 160, 184, 208, 220, 236, 260]
  const trebleCounts = [1, 2, 0, 1, 0, 1, 2, 1]
  const bassCounts = [2, 3, 1, 1, 1, 0, 3, 0]
  for (const [index, cx] of xs.entries()) {
    if (trebleCounts[index] > 0) {
      const melody = latticeNote({ cx, midi: 73, stem: 'up' })
      melody.beams = [3, 6].includes(index) ? 2 : 0
      melody.durationDivisions = [0, 1, 5, 7].includes(index) ? 4 : 2
      melody.durationType = melody.durationDivisions === 4 ? 'quarter' : 'eighth'
      events.push(latticeEvent([melody], index * 2, 1))
      if ([1, 6].includes(index)) {
        events.push(latticeEvent([
          latticeNote({ cx, midi: 68, stem: 'down' }),
        ], index * 2, 1))
      }
    }

    const count = bassCounts[index] - (missingBassHead && index === 1 ? 1 : 0)
    if (count > 0) {
      const notes = Array.from({ length: count }, (_, noteIndex) => {
        const stem = index === 0
          ? noteIndex === 0 ? 'down' : 'up'
          : [1, 2, 6].includes(index) ? 'down' : 'up'
        const midi = [2, 3, 4].includes(index)
          ? 49
          : 64 - noteIndex * 6
        const note = latticeNote({ cx, midi, clef: 'bass', stem })
        note.durationDivisions = [0, 2, 4, 6].includes(index) ? 4 : 2
        note.durationType = note.durationDivisions === 4 ? 'quarter' : 'eighth'
        note.beams = index === 1 && noteIndex === 0 ? 1 : index === 3 ? 2 : 0
        return note
      })
      events.push(latticeEvent(notes, index * 2, 1))
    }
  }
  return events
}

describe('reconstructSyncopatedQuarterChordBassLattice', () => {
  it('recovers the repeated melody, quarter chords, and syncopated bass', () => {
    const rebuilt = reconstructSyncopatedQuarterChordBassLattice(
      syncopatedQuarterChordBassFixture(),
      16,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 4], [4, 4], [8, 3], [11, 1], [12, 2], [14, 2]])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['rest', 0, 4], ['note', 4, 4], ['rest', 8, 4], ['note', 12, 4],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 4, 2], [4, 2, 3], [6, 2, 1],
      [8, 2, 1], [10, 2, 1], [12, 4, 3],
    ])
  })

  it('abstains for incomplete source topology or a different meter', () => {
    const complete = syncopatedQuarterChordBassFixture()
    const incomplete = syncopatedQuarterChordBassFixture({ missingBassHead: true })
    expect(reconstructSyncopatedQuarterChordBassLattice(incomplete, 16))
      .toBe(incomplete)
    expect(reconstructSyncopatedQuarterChordBassLattice(complete, 12))
      .toBe(complete)
  })

  it('completes the inner tie only with independent page-tie evidence', () => {
    const rebuilt = reconstructSyncopatedQuarterChordBassLattice(
      syncopatedQuarterChordBassFixture(),
      16,
    )
    const sourceConfirmed = rebuilt.map((event) => {
      if (event.sourceVoice === 1 && event.startDivision === 14) {
        return { ...event, notes: event.notes.map((note) => ({ ...note, tieStart: true })) }
      }
      if (event.sourceVoice === 5 && [6, 8].includes(event.startDivision)) {
        return {
          ...event,
          notes: event.notes.map((note) => ({
            ...note,
            ...(event.startDivision === 6 ? { tieStart: true } : { tieStop: true }),
          })),
        }
      }
      return event
    })
    const completed = completeSyncopatedQuarterChordBassTies(sourceConfirmed)

    expect(completed.find(
      (event) => event.sourceVoice === 1 && event.startDivision === 11,
    ).notes[0].tieStart).toBe(true)
    expect(completed.find(
      (event) => event.sourceVoice === 1 && event.startDivision === 12,
    ).notes[0].tieStop).toBe(true)
    expect(completeSyncopatedQuarterChordBassTies(rebuilt)).toBe(rebuilt)
  })
})

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

function mixedTupletFixture({ misalignedClosing = false } = {}) {
  const events = []
  const openingTreble = [73, 80, 75, 68].map((midi, index) =>
    latticeNote({ cx: index === 0 ? 100 : 108, midi, stem: index < 2 ? 'down' : 'up' }),
  )
  events.push(latticeEvent(openingTreble.slice(0, 1), 0, 1))
  events.push(latticeEvent(openingTreble.slice(1), 1, 1))
  events.push(latticeEvent([
    latticeNote({ cx: 108, midi: 44, clef: 'bass', stem: 'up' }),
    latticeNote({ cx: 108, midi: 32, clef: 'bass', stem: 'up' }),
  ], 1, 2))

  const trebleMidis = [63, 56, 61, 63, 68, 73, 75, 80, 85, 87]
  trebleMidis.forEach((midi, index) => {
    const note = latticeNote({
      cx: 160 + index * 20,
      midi,
      stem: index < 5 ? 'up' : 'down',
    })
    if (index < 3) note.beams = 2
    events.push(latticeEvent([note], index + 2, 1))
  })
  const bassMidis = [51, 44, 49, 51, 56, 61, 63]
  bassMidis.forEach((midi, index) => {
    const note = latticeNote({
      cx: 160 + index * (170 / 6),
      midi,
      clef: 'bass',
      stem: 'down',
    })
    if (index < 3) note.beams = 2
    events.push(latticeEvent([note], index + 2, 1))
  })
  const trebleClosingMidis = [92, 87, 85, 80]
  const bassClosingMidis = [68, 63, 61, 56]
  for (let index = 0; index < 4; index += 1) {
    const cx = 360 + index * 24
    events.push(latticeEvent([
      latticeNote({ cx, midi: trebleClosingMidis[index], stem: 'down' }),
    ], 12 + index, 1))
    events.push(latticeEvent([
      latticeNote({
        cx: cx + (misalignedClosing && index === 2 ? 8 : 0),
        midi: bassClosingMidis[index],
        clef: 'bass',
        stem: 'down',
      }),
    ], 12 + index, 1))
  }
  return events
}

describe('reconstructMixedQuintupletSeptupletLattice', () => {
  const geometry = {
    glyphs: [{ text: '5', x: 240, y: 90 }, { text: '7', x: 260, y: 140 }],
    measureBox: { x0: 0.05, x1: 0.5, y0: 0.05, y1: 0.2 },
    imageData: { width: 1000, height: 1000 },
  }

  it('recovers independent quintuplet, septuplet, and closing grids', () => {
    const source = mixedTupletFixture()
    const rebuilt = reconstructMixedQuintupletSeptupletLattice(source, 16, geometry)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(31)
    expect(rebuilt.filter(
      (event) => event.timeModification?.actualNotes === 5,
    )).toHaveLength(10)
    expect(rebuilt.filter(
      (event) => event.timeModification?.actualNotes === 7,
    )).toHaveLength(7)
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 1 && event.startDivision >= 12,
    ).map((event) => event.startDivision)).toEqual([12, 13, 14, 15])
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 5 && event.startDivision >= 12,
    ).map((event) => event.startDivision)).toEqual([12, 13, 14, 15])

    const xml = buildOmrMusicXml({
      measures: [{ measureNumber: 1, events: rebuilt }],
      includeDisclaimer: false,
    })
    expect(xml).toContain('<divisions>140</divisions>')
    expect(xml).toContain('<actual-notes>5</actual-notes>')
    expect(xml).toContain('<actual-notes>7</actual-notes>')
  })

  it('abstains without both printed tuplet digits', () => {
    const source = mixedTupletFixture()
    expect(reconstructMixedQuintupletSeptupletLattice(source, 16, {
      ...geometry,
      glyphs: geometry.glyphs.slice(0, 1),
    })).toBe(source)
  })

  it('abstains when the closing staff grids do not align', () => {
    const source = mixedTupletFixture({ misalignedClosing: true })
    expect(reconstructMixedQuintupletSeptupletLattice(source, 16, geometry)).toBe(source)
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

function dottedMelodySixteenthBassFixture({
  removeBassHead = false,
  bassVariant = 'alternating-sixteenths',
  midbarPadding = 0,
} = {}) {
  const events = []
  const columnX = (index) => 100 + index * 14 + (index >= 6 ? midbarPadding : 0)
  for (let index = 0; index < 12; index += 1) {
    const bassCount = bassVariant === 'single-sixteenths'
      ? 1
      : bassVariant === 'octave-eighths'
        ? index % 2 === 0 ? 2 : 0
        : index % 2 === 0 ? 2 : 1
    const bassNotes = Array.from({ length: bassCount }, (_, noteIndex) => {
      const note = latticeNote({
        cx: columnX(index),
        midi: 52 - noteIndex * 12 + (index % 3) * 2,
        clef: 'bass',
        stem: 'up',
      })
      note.beams = noteIndex === 0 && index % 2 === 0
        ? bassVariant === 'octave-eighths' ? (index === 8 ? 1 : 0) : 2
        : 0
      return note
    })
    if (removeBassHead && index === 4) bassNotes.pop()
    if (bassNotes.length > 0) events.push(latticeEvent(bassNotes, index, 1))
  }
  const accompanimentIndexes = bassVariant === 'octave-eighths'
    ? [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]
    : [0, 2, 4, 5, 6, 8, 10]
  for (const index of accompanimentIndexes) {
    const note = latticeNote({
      cx: columnX(index),
      midi: 68 - Math.floor(index / 5) * 2,
      stem: 'down',
    })
    note.beams = index < 6 ? 2 : 1
    events.push(latticeEvent([note], index, 1))
  }
  for (const [melodyIndex, index] of [0, 6].entries()) {
    const note = latticeNote({
      cx: columnX(index),
      midi: 76 + melodyIndex * 2,
      stem: 'up',
    })
    note.dotted = true
    note.durationType = 'quarter'
    note.durationDivisions = 6
    events.push(latticeEvent([note], index, 2))
  }
  return events
}

describe('reconstructDottedMelodySixteenthBassLattice', () => {
  it('separates dotted melody, upper accompaniment, and bass sixteenths', () => {
    const rebuilt = reconstructDottedMelodySixteenthBassLattice(
      dottedMelodySixteenthBassFixture(),
      12,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 6], [6, 6]])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 2], [2, 2], [4, 1], [5, 1], [6, 2], [8, 2], [10, 2]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(12)
  })

  it('supports a complete single-head bass sixteenth cursor', () => {
    const rebuilt = reconstructDottedMelodySixteenthBassLattice(
      dottedMelodySixteenthBassFixture({
        bassVariant: 'single-sixteenths',
        midbarPadding: 10,
      }),
      12,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1)).toHaveLength(2)
    expect(rebuilt.filter((event) => event.sourceVoice === 2)).toHaveLength(7)
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual(Array.from({ length: 12 }, (_, index) => [index, 1]))
  })

  it('supports rested treble sixteenths above octave bass eighths', () => {
    const rebuilt = reconstructDottedMelodySixteenthBassLattice(
      dottedMelodySixteenthBassFixture({ bassVariant: 'octave-eighths' }),
      12,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 6], [6, 6]])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.type,
    ])).toEqual([
      [0, 1, 'rest'],
      [1, 1, 'note'],
      [2, 1, 'note'],
      [3, 1, 'note'],
      [4, 1, 'note'],
      [5, 1, 'note'],
      [6, 1, 'rest'],
      [7, 1, 'note'],
      [8, 1, 'note'],
      [9, 1, 'note'],
      [10, 1, 'note'],
      [11, 1, 'note'],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2]])
  })

  it('abstains outside 3/4 and when the alternating bass topology is incomplete', () => {
    const complete = dottedMelodySixteenthBassFixture()
    expect(reconstructDottedMelodySixteenthBassLattice(complete, 16)).toBe(complete)
    const incomplete = dottedMelodySixteenthBassFixture({ removeBassHead: true })
    expect(reconstructDottedMelodySixteenthBassLattice(incomplete, 12)).toBe(incomplete)
  })
})

function eighthMelodyHalfSustainFixture({
  missingSecondHollow = false,
  misalignedBass = false,
  singleSustain = false,
  syncopatedDyads = false,
} = {}) {
  const events = []
  const melodyMidis = [76, 74, 72, 71, 69, 71, 72, 76]
  const sustainMidis = new Map(singleSustain ? [[0, 72]] : [[0, 72], [4, 65]])
  const bassMidis = singleSustain || syncopatedDyads
    ? Array.from({ length: 8 }, (_, index) => [29 + (index >= 4 ? 2 : 0), 41 + (index >= 4 ? 2 : 0)])
    : [
        [33, 45],
        [48],
        [52, 57],
        [48],
        [29, 41],
        [48],
        [53, 57],
        [48],
      ]
  for (let index = 0; index < 8; index += 1) {
    const bassCx = 100 + index * 20
    const cx = syncopatedDyads && index === 6 ? 210 : bassCx
    const treble = [latticeNote({ cx, midi: melodyMidis[index], stem: 'up' })]
    if (sustainMidis.has(index)) {
      const sustain = latticeNote({
        cx,
        midi: sustainMidis.get(index),
        stem: 'down',
        open: !(missingSecondHollow && index === 4),
      })
      sustain.noteheadGlyph = sustain.hollow ? 'half' : 'black'
      sustain.durationType = sustain.hollow ? 'half' : 'eighth'
      sustain.durationDivisions = sustain.hollow ? 8 : 2
      treble.push(sustain)
    }
    events.push(latticeEvent(treble, index * 2, 2))
    events.push(latticeEvent(bassMidis[index].map((midi) => latticeNote({
      cx: bassCx + (misalignedBass && index === 5 ? 8 : 0),
      midi,
      clef: 'bass',
      stem: 'up',
    })), index * 2, 2))
  }
  return events
}

describe('reconstructEighthMelodyHalfSustainArpeggioLattice', () => {
  it('separates hollow half-note anchors from aligned eighth-note grids', () => {
    const source = eighthMelodyHalfSustainFixture()
    const rebuilt = reconstructEighthMelodyHalfSustainArpeggioLattice(source, 16)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(22)
    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual(Array.from({ length: 8 }, (_, index) => [index * 2, 2]))
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 8], [8, 8]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(8)

    const xml = buildOmrMusicXml({
      measures: [{ measureNumber: 1, events: rebuilt }],
      includeDisclaimer: false,
    })
    expect(xml).toContain('<voice>1</voice>')
    expect(xml).toContain('<voice>2</voice>')
    expect(xml).toContain('<voice>5</voice>')
    expect(xml).toContain('<backup>')
  })

  it('preserves the explicit second-half rest over an all-dyad bass grid', () => {
    const source = eighthMelodyHalfSustainFixture({ singleSustain: true })
    const rebuilt = reconstructEighthMelodyHalfSustainArpeggioLattice(source, 16)

    expect(rebuilt.filter((event) => event.sourceVoice === 2)).toEqual([
      expect.objectContaining({
        type: 'note',
        startDivision: 0,
        durationDivisions: 8,
      }),
      expect.objectContaining({
        type: 'rest',
        startDivision: 8,
        durationDivisions: 8,
        structuralVoiceRest: true,
      }),
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(8)
    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(25)
  })

  it('uses the printed short and dotted X gaps over a regular dyad grid', () => {
    const source = eighthMelodyHalfSustainFixture({ syncopatedDyads: true })
    const rebuilt = reconstructEighthMelodyHalfSustainArpeggioLattice(source, 16)

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
      [6, 2],
      [8, 2],
      [10, 1],
      [11, 3],
      [14, 2],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 8], [8, 8]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(8)
  })

  it.each([
    ['one missing hollow anchor', { missingSecondHollow: true }],
    ['a broken staff-column alignment', { misalignedBass: true }],
  ])('abstains for %s', (_label, options) => {
    const source = eighthMelodyHalfSustainFixture(options)
    expect(reconstructEighthMelodyHalfSustainArpeggioLattice(source, 16)).toBe(source)
  })
})

function wholeMelodyQuarterChordFixture({
  missingWhole = false,
  misalignedChord = false,
} = {}) {
  const events = []
  const bassCounts = [3, 2, 3, 2, 3, 2, 3, 2]
  for (let index = 0; index < 8; index += 1) {
    const cx = 100 + index * 28
    events.push(latticeEvent(
      Array.from({ length: bassCounts[index] }, (_, noteIndex) => latticeNote({
        cx,
        midi: 40 - noteIndex * 6,
        clef: 'bass',
        stem: 'up',
      })),
      index * 2,
      2,
    ))
  }
  const chordCounts = [3, 2, 3, 2]
  for (let index = 0; index < 4; index += 1) {
    const cx = 100 + index * 56 + (misalignedChord && index === 3 ? 6 : 0)
    events.push(latticeEvent(
      Array.from({ length: chordCounts[index] }, (_, noteIndex) => latticeNote({
        cx,
        midi: 81 - noteIndex * 5 - index,
        stem: 'down',
      })),
      index * 4,
      4,
    ))
  }
  events.push(latticeEvent([
    latticeNote({ cx: 117, midi: 76, open: !missingWhole }),
  ], 0, 16))
  return events
}

describe('reconstructWholeMelodyQuarterChordBassGrid', () => {
  it('separates the whole melody from aligned chord and bass grids', () => {
    const source = wholeMelodyQuarterChordFixture()
    const rebuilt = reconstructWholeMelodyQuarterChordBassGrid(source, 16)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(31)
    expect(rebuilt.filter((event) => event.sourceVoice === 1)).toMatchObject([
      { startDivision: 0, durationDivisions: 16, notes: [{ hollow: true }] },
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([[0, 4, 3], [4, 4, 2], [8, 4, 3], [12, 4, 2]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([
      [0, 2, 3],
      [2, 2, 2],
      [4, 2, 3],
      [6, 2, 2],
      [8, 2, 3],
      [10, 2, 2],
      [12, 2, 3],
      [14, 2, 2],
    ])
  })

  it.each([
    ['a missing hollow whole-note head', { missingWhole: true }],
    ['a quarter chord outside its bass column', { misalignedChord: true }],
  ])('abstains for %s', (_label, options) => {
    const source = wholeMelodyQuarterChordFixture(options)
    expect(reconstructWholeMelodyQuarterChordBassGrid(source, 16)).toBe(source)
  })
})

function dottedMelodyHalfChordFixture({
  missingHollow = false,
  misplacedTerminal = false,
} = {}) {
  const events = []
  const bassCounts = [3, 2, 3, 2, 3, 2, 3, 2]
  for (let index = 0; index < 8; index += 1) {
    const cx = 100 + index * 20
    events.push(latticeEvent(
      Array.from({ length: bassCounts[index] }, (_, noteIndex) => latticeNote({
        cx,
        midi: 48 - noteIndex * 6 + (index >= 4 ? 1 : 0),
        clef: 'bass',
        stem: 'up',
      })),
      index * 2,
      2,
    ))
  }
  const anchor = (cx, melodyMidi, lowerMidis, secondAnchor = false) => {
    const notes = [latticeNote({ cx, midi: melodyMidi, stem: 'up' })]
    for (const [index, midi] of lowerMidis.entries()) {
      const note = latticeNote({
        cx,
        midi,
        stem: 'down',
        open: !(missingHollow && secondAnchor && index === 1),
      })
      note.noteheadGlyph = note.hollow ? 'half' : 'black'
      notes.push(note)
    }
    return notes
  }
  events.push(latticeEvent(anchor(100, 80, [76, 72]), 0, 4))
  events.push(latticeEvent([latticeNote({ cx: 160, midi: 78 })], 4, 4))
  events.push(latticeEvent(anchor(180, 80, [75, 71], true), 7, 6))
  events.push(latticeEvent([latticeNote({ cx: 240, midi: 78 })], 13, 1))
  events.push(latticeEvent([
    latticeNote({ cx: misplacedTerminal ? 258 : 252, midi: 80 }),
  ], 15, 1))
  return events
}

describe('reconstructDottedMelodyHalfChordBassGrid', () => {
  it('recovers staggered melody, chord sustains, and the regular bass grid', () => {
    const source = dottedMelodyHalfChordFixture()
    const rebuilt = reconstructDottedMelodyHalfChordBassGrid(source, 16)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(29)
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 1 && event.type === 'note',
    ).map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 6],
      [6, 2],
      [8, 4],
      [14, 1],
      [15, 1],
    ])
    expect(rebuilt.find(
      (event) => event.sourceVoice === 1 && event.type === 'rest',
    )).toMatchObject({ startDivision: 12, durationDivisions: 2 })
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([[0, 8, 2], [8, 8, 2]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(8)
  })

  it.each([
    ['incomplete hollow chord evidence', { missingHollow: true }],
    ['a terminal note outside the printed sixteenth gap', { misplacedTerminal: true }],
  ])('abstains for %s', (_label, options) => {
    const source = dottedMelodyHalfChordFixture(options)
    expect(reconstructDottedMelodyHalfChordBassGrid(source, 16)).toBe(source)
  })
})

function halfMelodyChordCadenceFixture({
  missingHollow = false,
  misalignedTerminal = false,
} = {}) {
  const events = []
  for (let index = 0; index < 8; index += 1) {
    const cx = 100 + index * 20
    const count = index < 6 ? 2 : 1
    events.push(latticeEvent(
      Array.from({ length: count }, (_, noteIndex) => latticeNote({
        cx,
        midi: 52 - noteIndex * 7,
        clef: 'bass',
        stem: 'up',
      })),
      index * 2,
      2,
    ))
  }
  for (const [index, melodyMidi] of [81, 80].entries()) {
    const cx = 100 + index * 80
    const lower = [76, 71].map((midi, noteIndex) => {
      const note = latticeNote({
        cx,
        midi,
        stem: 'down',
        open: !(missingHollow && index === 1 && noteIndex === 1),
      })
      note.noteheadGlyph = note.hollow ? 'half' : 'black'
      return note
    })
    events.push(latticeEvent([
      latticeNote({ cx, midi: melodyMidi, stem: 'up', open: index === 0 }),
      ...lower,
    ], index * 8, 8))
  }
  events.push(latticeEvent([
    latticeNote({ cx: misalignedTerminal ? 248 : 240, midi: 72, stem: 'up' }),
  ], 14, 2))
  return events
}

describe('reconstructHalfMelodyChordCadenceGrid', () => {
  it('separates two chord anchors and preserves the terminal cadence', () => {
    const source = halfMelodyChordCadenceFixture()
    const rebuilt = reconstructHalfMelodyChordCadenceGrid(source, 16)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(21)
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 1 && event.type === 'note',
    ).map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 8],
      [8, 4],
      [14, 2],
    ])
    expect(rebuilt.find(
      (event) => event.sourceVoice === 1 && event.type === 'rest',
    )).toMatchObject({ startDivision: 12, durationDivisions: 2 })
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([[0, 8, 2], [8, 8, 2]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(8)
  })

  it.each([
    ['incomplete hollow chord evidence', { missingHollow: true }],
    ['a terminal attack outside the bass cadence column', { misalignedTerminal: true }],
  ])('abstains for %s', (_label, options) => {
    const source = halfMelodyChordCadenceFixture(options)
    expect(reconstructHalfMelodyChordCadenceGrid(source, 16)).toBe(source)
  })
})

function halfSustainSixteenthCadenceFixture({
  missingHollow = false,
  misalignedCadence = false,
} = {}) {
  const events = []
  const trebleColumns = [
    { cx: 100, midis: [76, 71, 67], stems: ['up', 'down', 'down'] },
    { cx: 124, midis: [77], stems: ['up'] },
    { cx: 148, midis: [76], stems: ['up'] },
    { cx: 172, midis: [71], stems: ['up'] },
    { cx: 186, midis: [73, 68, 64], stems: ['down', 'down', 'down'], open: [false, true, true] },
    { cx: misalignedCadence ? 249 : 244, midis: [69], stems: ['up'] },
    { cx: 257, midis: [71], stems: ['up'] },
    { cx: 281, midis: [72], stems: ['up'] },
    { cx: 295, midis: [74], stems: ['up'] },
  ]
  for (const [columnIndex, column] of trebleColumns.entries()) {
    events.push(latticeEvent(column.midis.map((midi, noteIndex) => latticeNote({
      cx: column.cx,
      midi,
      stem: column.stems[noteIndex],
      open: column.open?.[noteIndex] && !(missingHollow && noteIndex === 2),
    })), columnIndex * 2, 2))
  }
  const bassColumns = [
    { cx: 100, midis: [40] },
    { cx: 124, midis: [47] },
    { cx: 148, midis: [56, 52] },
    { cx: 172, midis: [47] },
    { cx: 200, midis: [49, 37] },
    { cx: 244, midis: [53, 41] },
  ]
  for (const [columnIndex, column] of bassColumns.entries()) {
    events.push(latticeEvent(column.midis.map((midi) => latticeNote({
      cx: column.cx,
      midi,
      clef: 'bass',
      stem: 'up',
    })), columnIndex * 2, 2))
  }
  return events
}

describe('reconstructHalfSustainSixteenthCadenceGrid', () => {
  it('recovers the offset half sustain and terminal sixteenth cadence', () => {
    const source = halfSustainSixteenthCadenceFixture()
    const rebuilt = reconstructHalfSustainSixteenthCadenceGrid(source, 16)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(22)
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 1 && event.type === 'note',
    ).map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
      [6, 1],
      [7, 4],
      [12, 1],
      [13, 1],
      [14, 1],
      [15, 1],
    ])
    expect(rebuilt.find(
      (event) => event.sourceVoice === 1 && event.type === 'rest',
    )).toMatchObject({ startDivision: 11, durationDivisions: 1 })
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
      event.notes?.length ?? 0,
    ])).toEqual([
      ['note', 0, 6, 2],
      ['rest', 6, 1, 0],
      ['note', 7, 8, 2],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]])
  })

  it.each([
    ['incomplete hollow sustain evidence', { missingHollow: true }],
    ['a cadence outside the final bass anchor', { misalignedCadence: true }],
  ])('abstains for %s', (_label, options) => {
    const source = halfSustainSixteenthCadenceFixture(options)
    expect(reconstructHalfSustainSixteenthCadenceGrid(source, 16)).toBe(source)
  })
})

function dottedCadenceArpeggioFixture({
  wrongCentralStem = false,
  misalignedTerminal = false,
} = {}) {
  const events = []
  const trebleColumns = [
    { cx: 100, midis: [79, 74], stems: ['up', 'down'] },
    { cx: 124, midis: [77], stems: ['up'] },
    { cx: 148, midis: [79], stems: ['up'] },
    { cx: 172, midis: [84], stems: ['up'] },
    { cx: 188, midis: [84, 77, 72], stems: [
      wrongCentralStem ? 'down' : 'up',
      'down',
      'down',
    ] },
    { cx: misalignedTerminal ? 253 : 248, midis: [79, 74], stems: ['down', 'down'] },
  ]
  for (const [columnIndex, column] of trebleColumns.entries()) {
    events.push(latticeEvent(column.midis.map((midi, noteIndex) => latticeNote({
      cx: column.cx,
      midi,
      stem: column.stems[noteIndex],
    })), columnIndex * 2, 2))
  }
  const bassColumns = [
    { cx: 100, midis: [43, 31] },
    { cx: 124, midis: [50] },
    { cx: 148, midis: [59, 55] },
    { cx: 172, midis: [50] },
    { cx: 200, midis: [48, 36] },
    { cx: 248, midis: [47, 35] },
  ]
  for (const [columnIndex, column] of bassColumns.entries()) {
    events.push(latticeEvent(column.midis.map((midi) => latticeNote({
      cx: column.cx,
      midi,
      clef: 'bass',
      stem: 'up',
    })), columnIndex * 2, 2))
  }
  return events
}

describe('reconstructDottedCadenceArpeggioGrid', () => {
  it('recovers the staggered melody, sustain, and bass cadence lanes', () => {
    const source = dottedCadenceArpeggioFixture()
    const rebuilt = reconstructDottedCadenceArpeggioGrid(source, 16)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(20)
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 1 && event.type === 'note',
    ).map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
      [6, 1],
      [7, 6],
    ])
    expect(rebuilt.find(
      (event) => event.sourceVoice === 1 && event.type === 'rest',
    )).toMatchObject({ startDivision: 13, durationDivisions: 3, dotted: true })
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.type,
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([
      ['note', 0, 6],
      ['rest', 6, 1],
      ['note', 7, 4],
      ['rest', 11, 1],
      ['note', 12, 4],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]])
  })

  it.each([
    ['ambiguous central stem ownership', { wrongCentralStem: true }],
    ['a terminal chord outside the final bass column', { misalignedTerminal: true }],
  ])('abstains for %s', (_label, options) => {
    const source = dottedCadenceArpeggioFixture(options)
    expect(reconstructDottedCadenceArpeggioGrid(source, 16)).toBe(source)
  })
})

function dottedChordOffbeatFixture({
  laterFourNoteChord = false,
  wrongOffbeatStem = false,
  misalignedBass = false,
} = {}) {
  const events = []
  const trebleCounts = laterFourNoteChord
    ? [3, 2, 2, 3, 4, 2, 2, 3]
    : [4, 2, 2, 3, 3, 2, 2, 3]
  const bassCounts = [1, 2, 1, 2, 1, 2, 1, 2]
  for (let index = 0; index < 8; index += 1) {
    const cx = 100 + index * 20
    const offbeat = [1, 2, 5, 6].includes(index)
    events.push(latticeEvent(
      Array.from({ length: trebleCounts[index] }, (_, noteIndex) => latticeNote({
        cx,
        midi: 80 - noteIndex * 4 - (index % 4),
        stem: wrongOffbeatStem && offbeat ? 'up' : offbeat ? 'down' : 'up',
      })),
      index * 2,
      2,
    ))
    events.push(latticeEvent(
      Array.from({ length: bassCounts[index] }, (_, noteIndex) => latticeNote({
        cx: cx + (misalignedBass && index === 6 ? 8 : 0),
        midi: 48 - noteIndex * 7 - (index % 2) * 4,
        clef: 'bass',
        stem: 'up',
      })),
      index * 2,
      2,
    ))
  }
  return events
}

describe('reconstructDottedChordOffbeatPairLattice', () => {
  it.each([
    ['an opening four-note pulse', false],
    ['a later four-note pulse', true],
  ])('recovers sustained and offbeat chord lanes for %s', (_label, laterFourNoteChord) => {
    const source = dottedChordOffbeatFixture({ laterFourNoteChord })
    const rebuilt = reconstructDottedChordOffbeatPairLattice(source, 16)

    expect(rebuilt.flatMap((event) => event.notes ?? [])).toHaveLength(33)
    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 6], [6, 2], [8, 6], [14, 2]])
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 2 && event.type === 'note',
    ).map((event) => event.startDivision)).toEqual([2, 4, 10, 12])
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 2 && event.type === 'rest',
    ).map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 2],
      [6, 4],
      [14, 2],
    ])
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(8)
  })

  it.each([
    ['unsupported offbeat stem ownership', { wrongOffbeatStem: true }],
    ['a broken staff-column alignment', { misalignedBass: true }],
  ])('abstains for %s', (_label, options) => {
    const source = dottedChordOffbeatFixture(options)
    expect(reconstructDottedChordOffbeatPairLattice(source, 16)).toBe(source)
  })
})

function syncopatedChordBassFixture({
  missingLowerHead = false,
  missingBass = false,
  sparse = false,
  missingSparseMelody = false,
} = {}) {
  const events = []
  const bassIndexes = new Set([0, 1, 2, 3, 5, 6, 7, 9])
  const chordIndexes = new Set(sparse ? [0, 4, 5, 7] : [0, 1, 2, 4, 5, 7, 9])
  const melodyIndexes = new Set([0, 1, 2, 3, 4, 5, 7, 8, 9, 10])
  for (let index = 0; index < 11; index += 1) {
    const cx = 100 + index * 24
    if (bassIndexes.has(index) && !(missingBass && index === 9)) {
      events.push(latticeEvent([
        latticeNote({ cx, midi: 36 + (index % 2) * 12, clef: 'bass', stem: 'up' }),
      ], index, 1))
    }
    if (chordIndexes.has(index)) {
      const lowerCount = sparse
        ? [0, 7].includes(index) ? 1 : 2
        : index >= 7 || (missingLowerHead && index === 2) ? 1 : 2
      const notes = Array.from({ length: lowerCount }, (_, noteIndex) => {
        const note = latticeNote({ cx, midi: 62 - noteIndex * 4, stem: 'down' })
        note.beams = index >= 7 ? 2 : 0
        return note
      })
      events.push(latticeEvent(notes, index, 1))
    }
    if (melodyIndexes.has(index) && !(missingSparseMelody && index === 5)) {
      const note = latticeNote({ cx, midi: 72 - (index % 3), stem: 'up' })
      note.beams = index >= 7 && index <= 9 ? 2 : 0
      events.push(latticeEvent([note], index, 1))
    }
  }
  return events
}

describe('reconstructSyncopatedChordBassOstinatoGrid', () => {
  it.each([
    ['the complete texture', false],
    ['one source-visible lower-head miss', true],
  ])('recovers independent bass, lower-chord, and melody lanes for %s', (_label, missingLowerHead) => {
    const source = syncopatedChordBassFixture({ missingLowerHead })
    const rebuilt = reconstructSyncopatedChordBassOstinatoGrid(source, 16)

    expect(rebuilt.filter((event) => event.sourceVoice === 5).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual(Array.from({ length: 8 }, (_, index) => [index * 2, 2]))
    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 2], [2, 2], [4, 3], [7, 1], [8, 4], [12, 2], [14, 2]])
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 2], [2, 2], [4, 2], [6, 1], [7, 1], [8, 4], [12, 1], [13, 1], [14, 1], [15, 1]])
  })

  it('abstains when the complete eight-note bass grid is absent', () => {
    const source = syncopatedChordBassFixture({ missingBass: true })
    expect(reconstructSyncopatedChordBassOstinatoGrid(source, 16)).toBe(source)
  })

  it.each([
    ['a complete sparse melody', false],
    ['one source-visible melody-head miss', true],
  ])('recovers structural rests for %s', (_label, missingSparseMelody) => {
    const rebuilt = reconstructSyncopatedChordBassOstinatoGrid(
      syncopatedChordBassFixture({ sparse: true, missingSparseMelody }),
      16,
    )

    expect(rebuilt.filter(
      (event) => event.sourceVoice === 1 && event.type === 'note',
    ).map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [0, 2], [7, 1], [8, 4], [12, 2],
    ])
    expect(rebuilt.filter(
      (event) => event.sourceVoice === 1 && event.type === 'rest',
    ).map((event) => [event.startDivision, event.durationDivisions])).toEqual([
      [2, 2], [4, 2], [6, 1], [14, 2],
    ])
    const expectedMelodyStarts = missingSparseMelody
      ? [0, 2, 4, 6, 7, 12, 13, 14, 15]
      : [0, 2, 4, 6, 7, 8, 12, 13, 14, 15]
    expect(rebuilt.filter((event) => event.sourceVoice === 2).map(
      (event) => event.startDivision,
    )).toEqual(expectedMelodyStarts)
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(8)
  })
})

function offsetChordBassQuintupletFixture({ incompleteChord = false } = {}) {
  const events = []
  const trebleGroups = [
    [100, 110, 110, 110],
    [140, 150, 150, 150],
    [215, 215],
    [255, 265, 265, 265],
  ]
  const bassGroups = [
    [110, 110],
    [150, 150, 150],
    [215],
    [255, 265, 265],
  ]
  for (const [groupIndex, xs] of trebleGroups.entries()) {
    const notes = xs.map((cx, noteIndex) => {
      const note = latticeNote({
        cx,
        midi: 84 - groupIndex * 2 - noteIndex * 4,
        stem: noteIndex === 0 ? 'down' : 'up',
      })
      if (groupIndex === 3) {
        note.noteheadGlyph = 'half'
        note.hollow = true
        note.durationType = 'half'
        note.durationDivisions = 8
      }
      note.beams = noteIndex === xs.length - 1 ? 2 : 0
      return note
    })
    if (incompleteChord && groupIndex === 1) notes.pop()
    events.push(latticeEvent(notes, groupIndex * 2, 1))
  }
  for (const [groupIndex, xs] of bassGroups.entries()) {
    events.push(latticeEvent(xs.map((cx, noteIndex) => latticeNote({
      cx,
      midi: 48 - groupIndex * 2 - noteIndex * 7,
      clef: 'bass',
      stem: noteIndex === 0 ? 'down' : 'up',
    })), groupIndex * 2, 1))
  }
  for (const [index, cx] of [310, 330, 350, 390, 410].entries()) {
    const note = latticeNote({ cx, midi: 45 - index * 3, clef: 'bass', stem: 'down' })
    note.beams = index === 1 || index === 3 ? 2 : 0
    events.push(latticeEvent([note], 10 + index, 1))
  }
  const inner = latticeNote({ cx: 360, midi: 43, clef: 'bass', stem: 'up' })
  inner.flags = 1
  events.push(latticeEvent([inner], 13, 1))
  return events
}

const offsetChordTupletSource = {
  glyphs: [{ text: '5', x: 360, y: 235 }],
  measureBox: { x0: 0, x1: 440, y0: 0, y1: 180 },
  imageData: { width: 440, height: 260 },
}

describe('reconstructOffsetChordBassQuintupletGrid', () => {
  it('recovers aligned displaced chords, the printed quintuplet, and its inner note', () => {
    const rebuilt = reconstructOffsetChordBassQuintupletGrid(
      offsetChordBassQuintupletFixture(),
      16,
      offsetChordTupletSource,
    )

    expect(rebuilt.filter((event) => event.sourceVoice === 1).map((event) => [
      event.startDivision,
      event.durationDivisions,
      event.notes.length,
    ])).toEqual([[0, 2, 4], [2, 4, 4], [6, 2, 2], [8, 8, 4]])
    expect(rebuilt.filter((event) => event.sourceVoice === 5)).toHaveLength(9)
    expect(rebuilt.filter((event) => event.timeModification).map((event) =>
      event.timeModification.slotIndex)).toEqual([0, 1, 2, 3, 4])
    expect(rebuilt.find((event) => event.sourceVoice === 6)).toMatchObject({
      startDivision: 14,
      durationDivisions: 2,
    })
    const xml = buildOmrMusicXml({
      measures: [{ measureNumber: 1, events: rebuilt }],
      includeDisclaimer: false,
    })
    expect(xml).toContain('<divisions>20</divisions>')
    expect(xml).toContain('<duration>4</duration>')
  })

  it('abstains without the printed 5 or with an incomplete source chord', () => {
    const complete = offsetChordBassQuintupletFixture()
    expect(reconstructOffsetChordBassQuintupletGrid(complete, 16, {
      ...offsetChordTupletSource,
      glyphs: [],
    })).toBe(complete)
    const incomplete = offsetChordBassQuintupletFixture({ incompleteChord: true })
    expect(reconstructOffsetChordBassQuintupletGrid(
      incomplete,
      16,
      offsetChordTupletSource,
    )).toBe(incomplete)
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

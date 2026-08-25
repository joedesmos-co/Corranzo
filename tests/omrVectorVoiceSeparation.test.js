import { describe, expect, it } from 'vitest'
import {
  alignOpeningEventStarts,
  applyTerminalSameClefChordQuarterDurations,
  buildVectorEvents,
  coalesceSameOnsetChordEvents,
  extendPenultimateHalfBeforeFinalQuarter,
  notesShareStemComponent,
  partitionSameOnsetWrittenVoiceEvents,
  reassignInterstaffBoundaryCohorts,
  reconstructWholeSustainEighthLattice,
  reconcileSeparatedWrittenVoiceEvents,
  resolveWrittenDurationOverlaps,
  resnapDenseChordOnsets,
  splitMixedClefEvents,
} from '../src/features/omr/processVectorOmrPage.js'
import { packJointPolyphonicRhythm } from '../src/features/omr/jointPolyphonicRhythm.js'
import { recoverVectorTupletEvents } from '../src/features/omr/recoverDigitGatedTriplets.js'
import { applyVectorPrimaryBeamTopology } from '../src/features/omr/applyVectorBeamTopology.js'
import {
  insertMixedMeasureRests,
  VECTOR_REST_SKIP_REASONS,
} from '../src/features/omr/detectVectorRests.js'
import { buildMeasureStructureUnits } from '../src/features/omr/measureStructureSemantics.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const measureBox = { measureNumber: 1, page: 1 }
const meter = { beats: 4, beatType: 4 }

function sourceStem({ x, tipY, cy, direction = 'up' }) {
  return {
    x,
    tipY,
    length: Math.abs(cy - tipY),
    direction,
    side: direction === 'up' ? 'right' : 'left',
  }
}

function sourceNote({
  midi,
  cx,
  cy,
  positionInMeasure,
  glyph,
  duration,
  durationType,
  clef = 'bass',
  stem,
  beams = 0,
  dotted = false,
  ...extra
}) {
  return {
    midi,
    naturalMidi: midi,
    cx,
    cy,
    xNorm: cx / 200,
    yNorm: cy / 200,
    positionInMeasure,
    clef,
    noteheadGlyph: glyph,
    hollowGlyph: glyph === 'half' || glyph === 'whole',
    hollow: glyph === 'half' || glyph === 'whole',
    durationDivisions: duration,
    durationType,
    stem,
    beams,
    beamStrength: beams ? 20 : 0,
    dotted,
    confidence: 0.9,
    source: 'vector-glyph',
    ...extra,
  }
}

function halfDyadAndMovingVoice({
  openGlyph = 'half',
  openDuration = openGlyph === 'whole' ? 16 : 8,
  movingDuration = 2,
  movingType = 'eighth',
  dotted = false,
  start = 0,
} = {}) {
  const position = start / 16
  const openStemX = 8
  const movingStemX = 21
  const notes = [
    sourceNote({
      midi: 54,
      cx: 14,
      cy: 30,
      positionInMeasure: position,
      glyph: openGlyph,
      duration: openDuration,
      durationType: openGlyph,
      dotted,
      stem:
        openGlyph === 'whole'
          ? null
          : sourceStem({ x: openStemX, tipY: 70, cy: 30, direction: 'down' }),
      tieStop: true,
    }),
    sourceNote({
      midi: 42,
      cx: 14,
      cy: 56,
      positionInMeasure: position,
      glyph: openGlyph,
      duration: openDuration,
      durationType: openGlyph,
      dotted,
      stem:
        openGlyph === 'whole'
          ? null
          : sourceStem({ x: openStemX, tipY: 20, cy: 56, direction: 'up' }),
    }),
    sourceNote({
      midi: 49,
      cx: 17,
      cy: 43,
      positionInMeasure: position,
      glyph: 'black',
      duration: movingDuration,
      durationType: movingType,
      stem: sourceStem({ x: movingStemX, tipY: 12, cy: 43, direction: 'up' }),
      beams: movingDuration === 1 ? 2 : movingDuration === 2 ? 1 : 0,
    }),
  ]
  for (let division = start + movingDuration; division < 16; division += movingDuration) {
    notes.push(
      sourceNote({
        midi: 49 + division,
        cx: 17 + division * 9,
        cy: 43,
        positionInMeasure: division / 16,
        glyph: 'black',
        duration: movingDuration,
        durationType: movingType,
        stem: sourceStem({
          x: movingStemX + division * 9,
          tipY: 12,
          cy: 43,
          direction: 'up',
        }),
        beams: movingDuration === 1 ? 2 : movingDuration === 2 ? 1 : 0,
      }),
    )
  }
  return notes
}

function mixedEvent(notes, startDivision = 0) {
  return {
    type: 'note',
    startDivision,
    durationDivisions: 2,
    durationType: 'eighth',
    measureNumber: 1,
    page: 1,
    cx: 15,
    notes,
  }
}

function noteInventory(events) {
  return events.flatMap((event) => event.notes ?? [])
}

describe('vector mixed-written voice separation', () => {
  it('splits a half-note chord from a separately beamed same-staff countervoice', () => {
    const source = halfDyadAndMovingVoice()
    const events = buildVectorEvents(source, measureBox, meter)
    const opening = events.filter((event) => event.startDivision === 0)
    const sustain = opening.find((event) => event.vectorVoiceLane === 'sustain')
    const moving = opening.find((event) => event.vectorVoiceLane === 'moving')

    expect(sustain).toMatchObject({ durationDivisions: 8, durationType: 'half' })
    expect(sustain?.notes.map((note) => note.midi)).toEqual([54, 42])
    expect(moving).toMatchObject({ durationDivisions: 2, durationType: 'eighth' })
    expect(moving?.notes.map((note) => note.midi)).toEqual([49])
    expect(events.filter((event) => event.vectorVoiceSeparated)).toHaveLength(2)
    expect(events.every((event) => event.startDivision + event.durationDivisions <= 16)).toBe(true)
    expect(new Set(noteInventory(events))).toEqual(new Set(source))
    expect(noteInventory(events)).toHaveLength(source.length)
  })

  it('keeps a half sustain independent from moving quarter notes', () => {
    const events = buildVectorEvents(
      halfDyadAndMovingVoice({ movingDuration: 4, movingType: 'quarter' }),
      measureBox,
      meter,
    )
    expect(events.find((event) => event.vectorVoiceLane === 'sustain')?.durationDivisions).toBe(8)
    expect(
      events.filter((event) => event.notes?.every((note) => note.noteheadGlyph === 'black'))
        .every((event) => event.durationDivisions === 4),
    ).toBe(true)
  })

  it('keeps a sparse half and quarter countervoice on their shared source onset', () => {
    const notes = [
      sourceNote({
        midi: 60,
        cx: 20,
        cy: 30,
        positionInMeasure: 0,
        glyph: 'half',
        duration: 8,
        durationType: 'half',
        stem: sourceStem({ x: 16, tipY: 70, cy: 30, direction: 'down' }),
      }),
      sourceNote({
        midi: 52,
        cx: 28,
        cy: 50,
        positionInMeasure: 0,
        glyph: 'black',
        duration: 4,
        durationType: 'quarter',
        stem: sourceStem({ x: 32, tipY: 20, cy: 50, direction: 'up' }),
      }),
    ]
    const events = buildVectorEvents(notes, measureBox, meter)
    const lanes = events.filter((event) => event.vectorVoiceSeparated)
    expect(lanes).toHaveLength(2)
    expect(lanes.map((event) => event.startDivision)).toEqual([0, 0])
    expect(lanes.map((event) => event.durationDivisions).sort((a, b) => a - b)).toEqual([4, 8])
  })

  it('keeps a whole-note chord independent from a moving countervoice', () => {
    const events = buildVectorEvents(
      halfDyadAndMovingVoice({
        openGlyph: 'whole',
        openDuration: 16,
        movingDuration: 4,
        movingType: 'quarter',
      }),
      measureBox,
      meter,
    )
    expect(events.find((event) => event.vectorVoiceLane === 'sustain')).toMatchObject({
      durationDivisions: 16,
      durationType: 'whole',
    })
  })

  it('ignores an adjacent moving stem falsely probed through a whole-note head', () => {
    const sharedProbe = sourceStem({ x: 21, tipY: 15, cy: 45, direction: 'up' })
    const whole = sourceNote({
      midi: 52,
      cx: 17,
      cy: 52,
      positionInMeasure: 0,
      glyph: 'whole',
      duration: 16,
      durationType: 'whole',
      stem: { ...sharedProbe, length: 37 },
    })
    const moving = sourceNote({
      midi: 56,
      cx: 17,
      cy: 45,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 2,
      durationType: 'eighth',
      stem: { ...sharedProbe },
      beams: 1,
    })

    expect(notesShareStemComponent(whole, moving)).toBe(true)
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent([whole, moving])],
      16,
    )
    expect(partitioned.map((event) => [
      event.vectorVoiceLane,
      event.durationDivisions,
      event.notes.map((note) => note.midi),
    ])).toEqual([
      ['sustain', 16, [52]],
      ['moving', 2, [56]],
    ])
  })

  it('reconstructs a complete paired eighth lattice above a whole sustain', () => {
    const approximateStarts = [0, 3, 5, 7, 9, 11, 13, 14]
    const whole = sourceNote({
      midi: 52,
      cx: 20,
      cy: 52,
      positionInMeasure: 0,
      glyph: 'whole',
      duration: 16,
      durationType: 'whole',
      stem: sourceStem({ x: 24, tipY: 15, cy: 52 }),
    })
    const bass = Array.from({ length: 8 }, (_, index) => sourceNote({
      midi: 56 + index,
      cx: 20 + index * 18,
      cy: 45,
      positionInMeasure: approximateStarts[index] / 16,
      glyph: 'black',
      duration: index < 2 ? 1 : 4,
      durationType: index < 2 ? 'sixteenth' : 'quarter',
      stem: sourceStem({ x: 24 + index * 18, tipY: 15, cy: 45 }),
      beams: index < 2 ? 2 : 0,
    }))
    const treble = Array.from({ length: 8 }, (_, index) => sourceNote({
      midi: 72 + index,
      cx: 20 + index * 18,
      cy: 20,
      positionInMeasure: approximateStarts[index] / 16,
      glyph: 'black',
      duration: 2,
      durationType: 'eighth',
      clef: 'treble',
      stem: sourceStem({ x: 24 + index * 18, tipY: 2, cy: 20 }),
      beams: 1,
    }))
    const opening = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent([whole, bass[0]])],
      16,
    )
    const events = [
      ...opening,
      { ...mixedEvent([treble[0]], approximateStarts[0]), cx: treble[0].cx },
      ...bass.slice(1).flatMap((note, index) => [
        { ...mixedEvent([note], approximateStarts[index + 1]), cx: note.cx },
        {
          ...mixedEvent([treble[index + 1]], approximateStarts[index + 1]),
          cx: treble[index + 1].cx,
        },
      ]),
    ]

    const reconstructed = reconstructWholeSustainEighthLattice(events, 16)
    const moving = reconstructed.filter((event) => event.vectorVoiceLane !== 'sustain')
    expect([...new Set(moving.map((event) => event.startDivision))]).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14,
    ])
    expect(moving.every((event) => event.durationDivisions === 2)).toBe(true)
    expect(
      moving.find((event) => event.vectorVoiceLane === 'moving'),
    ).toMatchObject({
      vectorVoiceSourceStartDivision: 0,
      vectorVoiceWrittenDurationDivisions: 2,
    })
    expect(
      reconstructed.find((event) => event.vectorVoiceLane === 'sustain'),
    ).toMatchObject({ durationDivisions: 16 })
  })

  it('abstains from whole-sustain lattice recovery for uneven or single-clef columns', () => {
    const latticeEvent = (index, clef, cx = 20 + index * 18) => {
      const note = sourceNote({
        midi: 56 + index,
        cx,
        cy: clef === 'treble' ? 20 : 45,
        positionInMeasure: index / 8,
        glyph: 'black',
        duration: 2,
        durationType: 'eighth',
        clef,
        stem: sourceStem({ x: cx + 4, tipY: 2, cy: clef === 'treble' ? 20 : 45 }),
        beams: 1,
      })
      return { ...mixedEvent([note], index * 2), cx }
    }
    const sustain = {
      ...mixedEvent([sourceNote({
        midi: 52,
        cx: 20,
        cy: 52,
        positionInMeasure: 0,
        glyph: 'whole',
        duration: 16,
        durationType: 'whole',
        stem: null,
      })]),
      vectorVoiceLane: 'sustain',
      vectorVoiceSeparated: true,
    }
    const paired = Array.from({ length: 8 }, (_, index) => [
      latticeEvent(index, 'bass'),
      latticeEvent(index, 'treble'),
    ]).flat()
    const uneven = [sustain, ...paired.map((event, index) =>
      index >= 14
        ? { ...event, cx: event.cx + 20, notes: event.notes.map((note) => ({ ...note, cx: note.cx + 20 })) }
        : event,
    )]
    expect(reconstructWholeSustainEighthLattice(uneven, 16)).toBe(uneven)

    const singleClef = [
      sustain,
      ...Array.from({ length: 8 }, (_, index) => [
        latticeEvent(index, 'bass'),
        latticeEvent(index, 'bass'),
      ]).flat(),
    ]
    expect(reconstructWholeSustainEighthLattice(singleClef, 16)).toBe(singleClef)
  })

  it('preserves a source-dotted sustained voice and its tie against moving notes', () => {
    const source = halfDyadAndMovingVoice({ openDuration: 12, dotted: true })
    const events = buildVectorEvents(source, measureBox, meter)
    const sustain = events.find((event) => event.vectorVoiceLane === 'sustain')
    expect(sustain).toMatchObject({
      startDivision: 0,
      durationDivisions: 12,
      durationType: 'half',
      dotted: true,
    })
    expect(sustain?.notes.find((note) => note.midi === 54)?.tieStop).toBe(true)
    expect(events.some((event) => event.startDivision > 0 && event.startDivision < 12)).toBe(true)
  })

  it('caps a separated half lane at the barline without overflowing', () => {
    const notes = halfDyadAndMovingVoice({ start: 12, movingDuration: 2 })
      .filter((note) => note.positionInMeasure >= 12 / 16)
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent(notes.slice(0, 3), 12)],
      16,
    )
    expect(partitioned.find((event) => event.vectorVoiceLane === 'sustain')).toMatchObject({
      startDivision: 12,
      durationDivisions: 4,
      durationType: 'quarter',
    })
    expect(partitioned.every((event) => event.startDivision + event.durationDivisions <= 16)).toBe(true)
  })

  it('keeps a true same-value open chord as one chord event', () => {
    const notes = halfDyadAndMovingVoice().slice(0, 2)
    const events = buildVectorEvents(notes, measureBox, meter)
    expect(events).toHaveLength(1)
    expect(events[0].notes).toHaveLength(2)
    expect(events[0]).toMatchObject({ durationDivisions: 8, durationType: 'half' })
    expect(events[0].vectorVoiceSeparated).toBeUndefined()
  })

  it('keeps filled seconds and clusters on one shared stem as one chord', () => {
    const shared = sourceStem({ x: 20, tipY: 10, cy: 40, direction: 'up' })
    const notes = [60, 61, 64].map((midi, index) =>
      sourceNote({
        midi,
        cx: 16 + index,
        cy: 40 + index * 4,
        positionInMeasure: 0,
        glyph: 'black',
        duration: 4,
        durationType: 'quarter',
        clef: 'treble',
        stem: { ...shared },
      }),
    )
    const events = buildVectorEvents(notes, measureBox, meter)
    expect(events).toHaveLength(1)
    expect(events[0].notes).toHaveLength(3)
  })

  it('abstains for an ambiguous mixed group on one connected stem', () => {
    const shared = sourceStem({ x: 20, tipY: 5, cy: 45, direction: 'up' })
    const notes = [
      sourceNote({
        midi: 60,
        cx: 16,
        cy: 35,
        positionInMeasure: 0,
        glyph: 'half',
        duration: 8,
        durationType: 'half',
        stem: { ...shared },
      }),
      sourceNote({
        midi: 64,
        cx: 17,
        cy: 45,
        positionInMeasure: 0,
        glyph: 'black',
        duration: 4,
        durationType: 'quarter',
        stem: { ...shared },
      }),
    ]
    const events = [mixedEvent(notes)]
    expect(partitionSameOnsetWrittenVoiceEvents(events, 16)).toBe(events)
  })

  it('abstains when filled heads beside a stemless whole use disconnected stems', () => {
    const notes = [
      sourceNote({
        midi: 60,
        cx: 16,
        cy: 30,
        positionInMeasure: 0,
        glyph: 'whole',
        duration: 16,
        durationType: 'whole',
        stem: null,
      }),
      sourceNote({
        midi: 52,
        cx: 17,
        cy: 45,
        positionInMeasure: 0,
        glyph: 'black',
        duration: 4,
        durationType: 'quarter',
        stem: sourceStem({ x: 21, tipY: 15, cy: 45 }),
      }),
      sourceNote({
        midi: 48,
        cx: 17,
        cy: 75,
        positionInMeasure: 0,
        glyph: 'black',
        duration: 4,
        durationType: 'quarter',
        stem: sourceStem({ x: 21, tipY: 55, cy: 75 }),
      }),
    ]
    const events = [mixedEvent(notes)]
    expect(partitionSameOnsetWrittenVoiceEvents(events, 16)).toBe(events)
  })

  it('abstains when a member has unknown glyph provenance', () => {
    const notes = halfDyadAndMovingVoice().slice(0, 3)
    notes[2] = { ...notes[2], noteheadGlyph: null }
    const events = [mixedEvent(notes)]
    expect(partitionSameOnsetWrittenVoiceEvents(events, 16)).toBe(events)
  })

  it('abstains for tuplets and time-modified notes', () => {
    const notes = halfDyadAndMovingVoice().slice(0, 3)
    notes[2].timeModification = { actualNotes: 3, normalNotes: 2 }
    const events = [mixedEvent(notes)]
    expect(partitionSameOnsetWrittenVoiceEvents(events, 16)).toBe(events)
  })

  it('abstains for a mixed-glyph unison rather than duplicating one pitch lane', () => {
    const notes = halfDyadAndMovingVoice().slice(0, 3)
    notes[2].midi = notes[0].midi
    const events = [mixedEvent(notes)]
    expect(partitionSameOnsetWrittenVoiceEvents(events, 16)).toBe(events)
  })

  it('distinguishes disconnected collinear stems but rejects overlapping segments', () => {
    const upper = sourceNote({
      midi: 67,
      cx: 20,
      cy: 30,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      stem: sourceStem({ x: 24, tipY: 5, cy: 30 }),
    })
    const lower = sourceNote({
      midi: 52,
      cx: 20,
      cy: 70,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 4,
      durationType: 'quarter',
      stem: sourceStem({ x: 24, tipY: 45, cy: 70 }),
    })
    expect(notesShareStemComponent(upper, lower)).toBe(false)
    lower.stem.tipY = 25
    lower.stem.length = 45
    expect(notesShareStemComponent(upper, lower)).toBe(true)
  })

  it('moves only a connected interstaff boundary head into its alternate cohort', () => {
    const upperStem = sourceStem({ x: 20, tipY: 5, cy: 34 })
    const upper = sourceNote({
      midi: 55,
      cx: 16,
      cy: 28,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      clef: 'treble',
      stem: { ...upperStem },
      pitchMapping: {
        staffRole: 'upper',
        clef: 'treble',
        clefSign: 'treble',
        midi: 55,
        lineYs: [0.04, 0.065, 0.09, 0.115, 0.14],
      },
    })
    const boundary = sourceNote({
      midi: 67,
      cx: 16,
      cy: 34,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      clef: 'bass',
      stem: { ...upperStem },
      beams: 1,
      pitchMapping: {
        staffRole: 'lower',
        clef: 'bass',
        clefSign: 'bass',
        midi: 67,
        lineYs: [0.171, 0.176, 0.181, 0.186, 0.191],
        alternateStaffRole: 'upper',
        alternateClef: 'treble',
        alternateClefSign: 'treble',
        alternateMidi: 52,
      },
    })
    const lower = sourceNote({
      midi: 40,
      cx: 16,
      cy: 90,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 4,
      durationType: 'quarter',
      clef: 'bass',
      stem: sourceStem({ x: 20, tipY: 65, cy: 90 }),
    })
    const originalObjects = new Set([upper, boundary, lower])
    const split = splitMixedClefEvents([mixedEvent([upper, boundary, lower])])
    const treble = split.find((event) => event.notes?.[0]?.clef === 'treble')
    const bass = split.find((event) => event.notes?.[0]?.clef === 'bass')

    expect(treble?.notes.map((note) => note.midi)).toEqual([55, 52])
    expect(bass?.notes.map((note) => note.midi)).toEqual([40])
    expect(boundary).toMatchObject({
      clef: 'treble',
      midi: 52,
      naturalMidi: 52,
      beams: 0,
      interstaffBoundaryCohortAdjusted: true,
      pitchMapping: {
        lineYs: [0.04, 0.065, 0.09, 0.115, 0.14],
      },
      pitchAlteration: {
        naturalMidi: 52,
        keySignatureFifths: 0,
      },
    })
    expect(boundary.boundaryCohortOriginalRhythm).toMatchObject({ beams: 1 })
    expect(new Set(noteInventory(split))).toEqual(originalObjects)
  })

  it('does not move an interstaff note without a connected alternate cohort', () => {
    const candidate = sourceNote({
      midi: 67,
      cx: 20,
      cy: 40,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      clef: 'bass',
      stem: sourceStem({ x: 24, tipY: 15, cy: 40 }),
      pitchMapping: {
        staffRole: 'lower',
        clef: 'bass',
        clefSign: 'bass',
        midi: 67,
        lineYs: [0.191, 0.196, 0.201, 0.206, 0.211],
        alternateStaffRole: 'upper',
        alternateClef: 'treble',
        alternateClefSign: 'treble',
        alternateMidi: 52,
      },
    })
    const lower = sourceNote({
      midi: 52,
      cx: 20,
      cy: 75,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 4,
      durationType: 'quarter',
      clef: 'bass',
      stem: sourceStem({ x: 24, tipY: 50, cy: 75 }),
    })
    expect(reassignInterstaffBoundaryCohorts([candidate, lower])).toEqual([candidate, lower])
    expect(candidate).toMatchObject({ clef: 'bass', midi: 67 })
    expect(candidate.interstaffBoundaryCohortAdjusted).toBeUndefined()
  })

  it('abstains when collinear stems belong to vertically distant staff cohorts', () => {
    const upper = sourceNote({
      midi: 66,
      cx: 20,
      cy: 42,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      clef: 'treble',
      stem: sourceStem({ x: 24, tipY: 10, cy: 42 }),
      pitchMapping: {
        staffRole: 'upper',
        clef: 'treble',
        clefSign: 'treble',
        midi: 66,
        lineYs: [0.1, 0.125, 0.15, 0.175, 0.2],
      },
    })
    const candidate = sourceNote({
      midi: 67,
      cx: 20,
      cy: 58,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      clef: 'bass',
      stem: sourceStem({ x: 24, tipY: 35, cy: 58 }),
      pitchMapping: {
        staffRole: 'lower',
        clef: 'bass',
        clefSign: 'bass',
        midi: 67,
        lineYs: [0.31, 0.335, 0.36, 0.385, 0.41],
        alternateStaffRole: 'upper',
        alternateClef: 'treble',
        alternateClefSign: 'treble',
        alternateMidi: 52,
      },
    })
    const lower = sourceNote({
      midi: 52,
      cx: 20,
      cy: 80,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 4,
      durationType: 'quarter',
      clef: 'bass',
      stem: sourceStem({ x: 30, tipY: 55, cy: 80 }),
    })

    expect(notesShareStemComponent(upper, candidate)).toBe(true)
    reassignInterstaffBoundaryCohorts([upper, candidate, lower])
    expect(candidate).toMatchObject({ clef: 'bass', midi: 67 })
    expect(candidate.interstaffBoundaryCohortAdjusted).toBeUndefined()
  })

  it('does not reassign an altered boundary head after measure pitch state is resolved', () => {
    const sharedStem = sourceStem({ x: 20, tipY: 5, cy: 34 })
    const upper = sourceNote({
      midi: 55,
      cx: 16,
      cy: 28,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      clef: 'treble',
      stem: { ...sharedStem },
      pitchMapping: {
        staffRole: 'upper',
        clef: 'treble',
        clefSign: 'treble',
        midi: 55,
        lineYs: [0.04, 0.065, 0.09, 0.115, 0.14],
      },
    })
    const boundary = sourceNote({
      midi: 68,
      cx: 16,
      cy: 34,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      clef: 'bass',
      stem: { ...sharedStem },
      alter: 1,
      accidental: { type: 'sharp', alter: 1 },
      pitchAlteration: {
        localAccidental: 'sharp',
        measureAccidentalState: 1,
      },
      pitchMapping: {
        staffRole: 'lower',
        clef: 'bass',
        clefSign: 'bass',
        midi: 67,
        lineYs: [0.171, 0.176, 0.181, 0.186, 0.191],
        alternateStaffRole: 'upper',
        alternateClef: 'treble',
        alternateClefSign: 'treble',
        alternateMidi: 52,
      },
    })
    const lower = sourceNote({
      midi: 40,
      cx: 16,
      cy: 90,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 4,
      durationType: 'quarter',
      clef: 'bass',
      stem: sourceStem({ x: 20, tipY: 65, cy: 90 }),
    })

    reassignInterstaffBoundaryCohorts([upper, boundary, lower])
    expect(boundary).toMatchObject({ clef: 'bass', midi: 68, alter: 1 })
    expect(boundary.interstaffBoundaryCohortAdjusted).toBeUndefined()

    const keyedBoundary = {
      ...boundary,
      midi: 67,
      naturalMidi: 67,
      alter: null,
      accidental: null,
      pitchAlteration: {
        keySignatureFifths: 1,
        keyAlteration: null,
        localAccidental: null,
        measureAccidentalState: null,
      },
    }
    reassignInterstaffBoundaryCohorts([upper, keyedBoundary, lower])
    expect(keyedBoundary).toMatchObject({ clef: 'bass', midi: 67 })
    expect(keyedBoundary.interstaffBoundaryCohortAdjusted).toBeUndefined()
  })

  it('uses a connected upper filled cohort to reject one false local beam', () => {
    const upperStem = sourceStem({ x: 22, tipY: 6, cy: 38 })
    const peer = sourceNote({
      midi: 60,
      cx: 18,
      cy: 30,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 4,
      durationType: 'quarter',
      clef: 'treble',
      stem: { ...upperStem },
      pitchMapping: {
        staffRole: 'upper',
        clef: 'treble',
        clefSign: 'treble',
        midi: 60,
        lineYs: [0.03, 0.06, 0.09, 0.12, 0.15],
      },
    })
    const boundary = sourceNote({
      midi: 67,
      cx: 18,
      cy: 38,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 2,
      durationType: 'eighth',
      clef: 'bass',
      stem: { ...upperStem },
      beams: 1,
      pitchMapping: {
        staffRole: 'lower',
        clef: 'bass',
        clefSign: 'bass',
        midi: 67,
        lineYs: [0.191, 0.196, 0.201, 0.206, 0.211],
        alternateStaffRole: 'upper',
        alternateClef: 'treble',
        alternateClefSign: 'treble',
        alternateMidi: 52,
      },
    })
    const bassHalf = sourceNote({
      midi: 45,
      cx: 18,
      cy: 90,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      clef: 'bass',
      stem: sourceStem({ x: 22, tipY: 65, cy: 90 }),
    })
    splitMixedClefEvents([mixedEvent([peer, boundary, bassHalf])])
    expect(boundary).toMatchObject({
      clef: 'treble',
      midi: 52,
      beams: 0,
      durationDivisions: 4,
      durationType: 'quarter',
    })
    expect(boundary.boundaryCohortOriginalRhythm).toMatchObject({
      beams: 1,
      durationDivisions: 2,
    })
  })

  it('prevents chord coalescing and joint packing from remerging separated lanes', () => {
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent(halfDyadAndMovingVoice().slice(0, 3))],
      16,
    )
    const coalesced = coalesceSameOnsetChordEvents(partitioned)
    const packed = packJointPolyphonicRhythm(coalesced, { totalDivisions: 16 })
    expect(coalesced).toHaveLength(2)
    expect(packed).toMatchObject({
      applied: false,
      reason: 'explicit-vector-voice-partition',
    })
    expect(packed.events).toBe(coalesced)
  })

  it('does not resnap one lane of an odd-onset dense source partition', () => {
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent(halfDyadAndMovingVoice().slice(0, 3), 3)],
      16,
    )
    const denseChords = Array.from({ length: 5 }, (_, index) => {
      const startDivision = 1 + index * 2
      const cx = 70 + index * 15
      const stem = sourceStem({ x: cx + 4, tipY: 12, cy: 45 })
      return {
        ...mixedEvent(
          [60 + index, 64 + index].map((midi, noteIndex) =>
            sourceNote({
              midi,
              cx: cx + noteIndex,
              cy: 40 + noteIndex * 7,
              positionInMeasure: startDivision / 16,
              glyph: 'black',
              duration: 2,
              durationType: 'eighth',
              clef: 'treble',
              stem: { ...stem },
            }),
          ),
          startDivision,
        ),
        durationDivisions: 2,
      }
    })
    const input = [...partitioned, ...denseChords]
    const result = resnapDenseChordOnsets(input, 16)
    expect(result).toBe(input)
    expect(
      result.filter((event) => event.vectorVoiceSeparated).map((event) => event.startDivision),
    ).toEqual([3, 3])
  })

  it('does not promote the direct quarter lane with a penultimate-half heuristic', () => {
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [
        mixedEvent(
          halfDyadAndMovingVoice({ movingDuration: 4, movingType: 'quarter' }).slice(0, 3),
          4,
        ),
      ],
      16,
    )
    const closing = {
      ...mixedEvent([
        sourceNote({
          midi: 57,
          cx: 80,
          cy: 50,
          positionInMeasure: 0.5,
          glyph: 'black',
          duration: 4,
          durationType: 'quarter',
          stem: sourceStem({ x: 84, tipY: 20, cy: 50 }),
        }),
      ], 8),
      durationDivisions: 4,
      durationType: 'quarter',
    }
    const input = [...partitioned, closing]
    expect(extendPenultimateHalfBeforeFinalQuarter(input, meter, 16)).toBe(input)
    expect(partitioned.find((event) => event.vectorVoiceLane === 'moving')?.durationDivisions).toBe(4)
  })

  it('does not promote a terminal moving lane or reorder late ownership indices', () => {
    const sharedMovingStem = sourceStem({ x: 26, tipY: 15, cy: 52 })
    const source = [
      sourceNote({
        midi: 60,
        cx: 20,
        cy: 30,
        positionInMeasure: 0.5,
        glyph: 'half',
        duration: 8,
        durationType: 'half',
        stem: sourceStem({ x: 16, tipY: 70, cy: 30, direction: 'down' }),
      }),
      sourceNote({
        midi: 52,
        cx: 22,
        cy: 48,
        positionInMeasure: 0.5,
        glyph: 'black',
        duration: 2,
        durationType: 'eighth',
        stem: { ...sharedMovingStem },
      }),
      sourceNote({
        midi: 48,
        cx: 22,
        cy: 56,
        positionInMeasure: 0.5,
        glyph: 'black',
        duration: 2,
        durationType: 'eighth',
        stem: { ...sharedMovingStem },
      }),
    ]
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent(source, 8)],
      16,
    )
    expect(applyTerminalSameClefChordQuarterDurations(partitioned, 16)).toBe(partitioned)

    const mutated = partitioned.map((event) => ({
      ...event,
      startDivision: event.vectorVoiceLane === 'sustain' ? 9 : 10,
      durationDivisions: 1,
      durationType: 'sixteenth',
    }))
    const reconciled = reconcileSeparatedWrittenVoiceEvents(mutated, 16)
    expect(reconciled.map((event) => event.vectorVoiceLane)).toEqual(
      mutated.map((event) => event.vectorVoiceLane),
    )
    expect(reconciled.map((event) => event.startDivision)).toEqual([8, 8])
  })

  it('lets a high-confidence connected beam refine the provisional moving value', () => {
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [
        mixedEvent(
          halfDyadAndMovingVoice({ movingDuration: 4, movingType: 'quarter' }).slice(0, 3),
        ),
      ],
      16,
    )
    const next = {
      ...mixedEvent([
        sourceNote({
          midi: 51,
          cx: 40,
          cy: 43,
          positionInMeasure: 2 / 16,
          glyph: 'black',
          duration: 2,
          durationType: 'eighth',
          stem: sourceStem({ x: 44, tipY: 12, cy: 43 }),
        }),
      ], 2),
      durationDivisions: 2,
      durationType: 'eighth',
    }
    const events = [...partitioned, next]
    const movingIndex = events.findIndex((event) => event.vectorVoiceLane === 'moving')
    const nextIndex = events.indexOf(next)
    const ownership = (eventIndex) => ({
      eventIndex,
      ownerships: [{
        beamGroupId: 'direct-primary',
        attachedBeamIds: ['beam-1'],
        beamCount: 1,
        beamConfidence: 0.92,
        confidence: 0.92,
      }],
    })
    const topology = applyVectorPrimaryBeamTopology(events, {
      eventOwnership: [ownership(movingIndex), ownership(nextIndex)],
    })
    const reconciled = reconcileSeparatedWrittenVoiceEvents(topology, 16)
    const moving = reconciled.find((event) => event.vectorVoiceLane === 'moving')
    const sustain = reconciled.find((event) => event.vectorVoiceLane === 'sustain')

    expect(moving).toMatchObject({
      startDivision: 0,
      durationDivisions: 2,
      durationType: 'eighth',
      beamTopologyDurationAdjusted: true,
      vectorVoiceWrittenDurationDivisions: 2,
      vectorVoiceBeamTopologyWrittenDurationAdjusted: true,
    })
    expect(sustain).toMatchObject({ durationDivisions: 8, durationType: 'half' })
  })

  it('lets source dot geometry refine a provisional moving lane to a dotted eighth', () => {
    const source = [
      sourceNote({
        midi: 60,
        cx: 20,
        cy: 30,
        positionInMeasure: 0,
        glyph: 'half',
        duration: 8,
        durationType: 'half',
        stem: sourceStem({ x: 16, tipY: 70, cy: 30, direction: 'down' }),
      }),
      sourceNote({
        midi: 52,
        cx: 28,
        cy: 50,
        positionInMeasure: 0,
        glyph: 'black',
        duration: 6,
        durationType: 'quarter',
        stem: sourceStem({ x: 32, tipY: 20, cy: 50, direction: 'up' }),
        dotted: true,
      }),
      sourceNote({
        midi: 54,
        cx: 60,
        cy: 50,
        positionInMeasure: 0.18,
        glyph: 'black',
        duration: 1,
        durationType: 'sixteenth',
        stem: sourceStem({ x: 64, tipY: 20, cy: 50, direction: 'up' }),
        beams: 2,
      }),
    ]
    const events = buildVectorEvents(source, measureBox, meter)
    const moving = events.find((event) => event.vectorVoiceLane === 'moving')
    const sustain = events.find((event) => event.vectorVoiceLane === 'sustain')

    expect(moving).toMatchObject({
      startDivision: 0,
      durationDivisions: 3,
      durationType: 'eighth',
      dotted: true,
      dottedSubdivisionBaseRefined: true,
      vectorVoiceWrittenDurationDivisions: 3,
      vectorVoiceDottedSubdivisionWrittenDurationAdjusted: true,
    })
    expect(moving?.notes[0]).toMatchObject({
      durationDivisions: 3,
      durationType: 'eighth',
      dotted: true,
    })
    expect(sustain).toMatchObject({ durationDivisions: 8, durationType: 'half' })
  })

  it('does not move one source lane during delayed-opening alignment', () => {
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent(halfDyadAndMovingVoice().slice(0, 3), 2)],
      16,
    )
    const closing = { ...mixedEvent([halfDyadAndMovingVoice()[3]], 8), durationDivisions: 4 }
    const input = [...partitioned, closing]
    expect(alignOpeningEventStarts(input, 4)).toBe(input)
    expect(partitioned.map((event) => event.startDivision)).toEqual([2, 2])
  })

  it('does not let a dotted predecessor shift or regap an independent source column', () => {
    const dotted = {
      ...mixedEvent([
        sourceNote({
          midi: 60,
          cx: 5,
          cy: 45,
          positionInMeasure: 0,
          glyph: 'black',
          duration: 6,
          durationType: 'quarter',
          stem: sourceStem({ x: 9, tipY: 15, cy: 45 }),
          dotted: true,
        }),
      ]),
      durationDivisions: 6,
      durationType: 'quarter',
      dotted: true,
    }
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent(halfDyadAndMovingVoice().slice(0, 3), 4)],
      16,
    )
    const tail = { ...mixedEvent([halfDyadAndMovingVoice()[3]], 12), durationDivisions: 4 }
    const input = [dotted, ...partitioned, tail]
    expect(resolveWrittenDurationOverlaps(input, 16)).toBe(input)
    expect(partitioned.map((event) => event.startDivision)).toEqual([4, 4])
    expect(dotted.durationDivisions).toBe(6)
  })

  it('keeps a written half sustain outside a digit-gated moving triplet lane', () => {
    const half = sourceNote({
      midi: 60,
      cx: 100,
      cy: 35,
      positionInMeasure: 0,
      glyph: 'half',
      duration: 8,
      durationType: 'half',
      stem: sourceStem({ x: 94, tipY: 72, cy: 35, direction: 'down' }),
    })
    const firstMoving = sourceNote({
      midi: 52,
      cx: 100,
      cy: 55,
      positionInMeasure: 0,
      glyph: 'black',
      duration: 2,
      durationType: 'eighth',
      stem: sourceStem({ x: 106, tipY: 20, cy: 55, direction: 'up' }),
      beams: 1,
    })
    const partitioned = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent([half, firstMoving])],
      16,
    )
    const movingTail = Array.from({ length: 11 }, (_, index) => {
      const slot = index + 1
      const cx = 100 + slot * 30
      return {
        ...mixedEvent([
          sourceNote({
            midi: 52 + (slot % 5),
            cx,
            cy: 55,
            positionInMeasure: slot / 12,
            glyph: 'black',
            duration: 2,
            durationType: 'eighth',
            stem: sourceStem({ x: cx + 4, tipY: 20, cy: 55, direction: 'up' }),
            beams: 1,
          }),
        ], (slot * 16) / 12),
        cx,
        durationDivisions: 2,
        durationType: 'eighth',
      }
    })
    const result = recoverVectorTupletEvents([...partitioned, ...movingTail], {
      glyphs: [145, 265, 385].map((x) => ({ text: '3', x, y: 20 })),
      measureBox: { x0: 0.1, x1: 0.9, y0: 0.05, y1: 0.55 },
      imageData: { width: 500, height: 200 },
      beats: 4,
      totalDivisions: 16,
    })
    const sustain = result.events.find((event) => event.vectorVoiceLane === 'sustain')
    const moving = result.events.find((event) => event.vectorVoiceLane === 'moving')

    expect(result).toMatchObject({ recovered: true, mode: 'full-bar' })
    expect(sustain).toMatchObject({
      startDivision: 0,
      durationDivisions: 8,
      durationType: 'half',
    })
    expect(sustain?.timeModification).toBeUndefined()
    expect(moving).toMatchObject({
      startDivision: 0,
      durationType: 'eighth',
      tupletRecovered: true,
      timeModification: { actualNotes: 3, normalNotes: 2 },
    })
    expect(moving?.durationDivisions).toBeCloseTo(16 / 12, 6)
    expect(result.events).toHaveLength(13)
  })

  it('abstains from inserting a colliding rest into a proven source voice column', () => {
    const notes = [
      sourceNote({
        midi: 60,
        cx: 20,
        cy: 30,
        positionInMeasure: 0,
        glyph: 'half',
        duration: 8,
        durationType: 'half',
        stem: sourceStem({ x: 16, tipY: 70, cy: 30, direction: 'down' }),
      }),
      sourceNote({
        midi: 52,
        cx: 28,
        cy: 50,
        positionInMeasure: 0,
        glyph: 'black',
        duration: 2,
        durationType: 'eighth',
        stem: sourceStem({ x: 32, tipY: 20, cy: 50, direction: 'up' }),
        beams: 1,
      }),
    ]
    const partitioned = buildVectorEvents(notes, measureBox, meter)
    const rest = {
      cx: 10,
      cy: 50,
      positionInMeasure: 0,
      durationType: 'sixteenth',
      clef: 'bass',
      source: 'vector-glyph',
      confidence: 0.88,
    }
    const result = insertMixedMeasureRests(partitioned, [rest], {
      measureBox,
      totalDivisions: 16,
    })
    const productionEvents = buildVectorEvents(notes, measureBox, meter, { rests: [rest] })

    expect(result).toMatchObject({
      appliedCount: 0,
      skipped: [
        { reason: VECTOR_REST_SKIP_REASONS.VECTOR_VOICE_PARTITION_COLLISION },
      ],
    })
    expect(result.events.filter((event) => event.type === 'rest')).toHaveLength(0)
    expect(result.events.filter((event) => event.vectorVoiceSeparated).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 8], [0, 2]])
    expect(productionEvents.filter((event) => event.type === 'rest')).toHaveLength(0)
    expect(productionEvents.filter((event) => event.vectorVoiceSeparated).map((event) => [
      event.startDivision,
      event.durationDivisions,
    ])).toEqual([[0, 8], [0, 2]])
  })

  it('serializes independent voices with backup while preserving chord markers per lane', () => {
    const source = halfDyadAndMovingVoice({ movingDuration: 4, movingType: 'quarter' })
    const events = buildVectorEvents(source, measureBox, meter)
    const measure = { measureNumber: 1, page: 1, systemIndex: 0, events }
    const xml = buildOmrMusicXml({
      measures: [measure],
      includeDisclaimer: false,
      instrument: { id: 'piano', notation: { grandStaff: true } },
    })
    const parsed = parseMusicXml(xml, 'voice-separation.musicxml').notes
      .filter((note) => !note.isRest)
    const opening = parsed.filter((note) => note.quarterTime === 0)
    const openMidis = opening.filter((note) => note.midi === 54 || note.midi === 42)
    const moving = opening.find((note) => note.midi === 49)

    expect(new Set(openMidis.map((note) => note.voice)).size).toBe(1)
    expect(moving?.voice).not.toBe(openMidis[0]?.voice)
    expect(openMidis.every((note) => note.durationQuarters === 2)).toBe(true)
    expect(moving?.durationQuarters).toBe(1)
    expect((xml.match(/<backup>/g) ?? []).length).toBeGreaterThan(0)
    expect((xml.match(/<chord\/>/g) ?? []).length).toBe(1)
  })

  it('keeps stemless-whole and moving voice numbers stable if recovery reorders events', () => {
    const events = partitionSameOnsetWrittenVoiceEvents(
      [
        mixedEvent(
          halfDyadAndMovingVoice({
            openGlyph: 'whole',
            openDuration: 16,
            movingDuration: 2,
            movingType: 'eighth',
          }).slice(0, 3),
        ),
      ],
      16,
    )
    const voicesByMidi = (orderedEvents) => {
      const xml = buildOmrMusicXml({
        measures: [{ measureNumber: 1, events: orderedEvents }],
        includeDisclaimer: false,
        instrument: { id: 'piano', notation: { grandStaff: true } },
      })
      return new Map(
        parseMusicXml(xml, 'voice-order.musicxml').notes
          .filter((note) => !note.isRest)
          .map((note) => [note.midi, note.voice]),
      )
    }
    const original = voicesByMidi(events)
    const reordered = voicesByMidi([...events].reverse())

    expect(reordered).toEqual(original)
    expect(original.get(49)).toBe(2)
    expect(original.get(54)).toBe(4)
    expect(original.get(42)).toBe(4)
  })

  it('keeps an explicitly separated open chord intact despite opposing local stem directions', () => {
    const events = partitionSameOnsetWrittenVoiceEvents(
      [mixedEvent(halfDyadAndMovingVoice().slice(0, 3))],
      16,
    )
    const measure = {
      measureNumber: 1,
      events,
      beamStemGraph: {
        eventOwnership: events.map((event, eventIndex) => ({
          eventIndex,
          ownerships: event.notes.map((note, noteIndex) => ({
            attachedStemId: `s-${eventIndex}-${noteIndex}`,
            stemDirection: noteStemDirectionForTest(note),
            stemConfidence: 0.95,
            confidence: 0.95,
            attachedBeamIds: [],
            beamCount: note.beams ?? 0,
          })),
        })),
      },
    }
    const structure = buildMeasureStructureUnits(measure)
    const sustainUnits = structure.units.filter(
      (unit) => unit.event.vectorVoiceLane === 'sustain',
    )
    expect(sustainUnits).toHaveLength(1)
    expect(sustainUnits[0].notes).toHaveLength(2)
    expect(structure.diagnostics.polyphonicStaffs).toEqual(['bass'])
    expect(new Set(structure.units.map((unit) => unit.voice)).size).toBe(2)
  })
})

function noteStemDirectionForTest(note) {
  return typeof note?.stem === 'string' ? note.stem : note?.stem?.direction ?? null
}

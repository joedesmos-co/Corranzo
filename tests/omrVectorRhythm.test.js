import { describe, expect, it } from 'vitest'
import {
  buildVectorEvents,
  applyTerminalSameClefChordQuarterDurations,
  durationMeta,
  extendCombinedGrandStaffOpening,
  extendDurationsPerClefVoice,
  extendPenultimateHalfBeforeFinalQuarter,
  eventsShareHarmonicPitch,
  hasConfidentQuarterInference,
  hasBeamEvidenceForNotes,
  isDenseSubdivisionRun,
  openingBassSubdivisionCap,
  openingBassChordSustainSpan,
  refineEventDurationsFromBeamEvidence,
  refineOpeningBassSubdivisionDurations,
  refineUnsupportedUpperChordOverhangs,
  sparseHarmonicHalfSpan,
  sameClefBeatQuarterFloor,
  terminalHarmonicHalfSpan,
  terminalSameClefChordQuarterSpan,
  shouldInferRhythmFromPositions,
  unsupportedUpperChordOverhangCap,
} from '../src/features/omr/processVectorOmrPage.js'
import { summarizeVectorRhythmDiagnostics } from '../src/features/omr/vectorRhythmDiagnostics.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const measureBox = { measureNumber: 1, page: 1 }

function onsets(positions) {
  return positions.map(({ x, positionInMeasure, clef = 'treble', midi = 60 + x }) => ({
    cx: x,
    midi,
    naturalMidi: midi,
    clef,
    positionInMeasure,
  }))
}

function durations(events) {
  return events.map((event) => event.durationDivisions)
}

describe('durationMeta snaps a division span to the nearest note value', () => {
  it('maps exact standard spans', () => {
    expect(durationMeta(12)).toMatchObject({ durationType: 'half', dotted: true })
    expect(durationMeta(4)).toMatchObject({ durationType: 'quarter', dotted: false })
  })
})

describe('shouldInferRhythmFromPositions', () => {
  it('keeps quarter indexing when onsets sit on the beat grid', () => {
    const groups = [
      { notes: [{ positionInMeasure: 0 }] },
      { notes: [{ positionInMeasure: 0.25 }] },
      { notes: [{ positionInMeasure: 0.5 }] },
      { notes: [{ positionInMeasure: 0.75 }] },
    ]
    expect(shouldInferRhythmFromPositions(groups, 4)).toBe(false)
  })

  it('switches to position rhythm when spacing is finer than quarters', () => {
    const groups = [
      { notes: [{ positionInMeasure: 0 }] },
      { notes: [{ positionInMeasure: 0.125 }] },
      { notes: [{ positionInMeasure: 0.25 }] },
      { notes: [{ positionInMeasure: 0.375 }] },
    ]
    expect(shouldInferRhythmFromPositions(groups, 4)).toBe(true)
  })
})

describe('buildVectorEvents infers duration from gap to next onset', () => {
  it('keeps near-zero position columns on beat 0 instead of snapping to beat 2', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 0, positionInMeasure: 0.0625 },
        { x: 30, positionInMeasure: 0.25 },
        { x: 60, positionInMeasure: 0.5 },
        { x: 90, positionInMeasure: 0.75 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    expect(events[0].startDivision).toBe(0)
    expect(events[1].startDivision).toBe(4)
  })

  it('aligns the opening column to beat 0 when clef padding shifts position to 0.125', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 0, positionInMeasure: 0.125 },
        { x: 30, positionInMeasure: 0.25 },
        { x: 60, positionInMeasure: 0.5 },
        { x: 90, positionInMeasure: 0.75 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    expect(events[0].startDivision).toBe(0)
    expect(events[0].durationDivisions).toBe(2)
  })

  it('renders four spaced onsets in 4/4 as four quarters (not stretched)', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 0, positionInMeasure: 0 },
        { x: 15, positionInMeasure: 0.25 },
        { x: 30, positionInMeasure: 0.5 },
        { x: 45, positionInMeasure: 0.75 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    expect(durations(events)).toEqual([4, 4, 4, 4])
  })

  it('renders eighth-note spacing when onsets are finer than quarter index slots', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 0, positionInMeasure: 0 },
        { x: 15, positionInMeasure: 0.125 },
        { x: 30, positionInMeasure: 0.25 },
        { x: 45, positionInMeasure: 0.375 },
        { x: 60, positionInMeasure: 0.5 },
        { x: 75, positionInMeasure: 0.625 },
        { x: 90, positionInMeasure: 0.75 },
        { x: 105, positionInMeasure: 0.875 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    expect(durations(events)).toEqual([2, 2, 2, 2, 2, 2, 2, 2])
  })

  it('merges dense chord fragments that share a beat slot before rhythm inference', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 60, positionInMeasure: 0.25, midi: 60 },
        { x: 68, positionInMeasure: 0.26, midi: 64 },
        { x: 76, positionInMeasure: 0.27, midi: 67 },
        { x: 120, positionInMeasure: 0.5, midi: 72 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    expect(events).toHaveLength(2)
    const chord = events.find((event) => (event.notes?.length ?? 0) === 3)
    expect(chord).toBeTruthy()
    expect(chord.durationDivisions).toBe(4)
  })

  it('snaps dense measures to sixteenth divisions instead of coarser eighth slots', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 0, positionInMeasure: 0.125, midi: 60 },
        { x: 15, positionInMeasure: 0.1875, midi: 62 },
        { x: 30, positionInMeasure: 0.25, midi: 64 },
        { x: 45, positionInMeasure: 0.3125, midi: 65 },
        { x: 60, positionInMeasure: 0.375, midi: 67 },
        { x: 75, positionInMeasure: 0.4375, midi: 69 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const starts = events
      .filter((event) => event.type === 'note')
      .map((event) => event.startDivision)
    expect(starts).toEqual([0, 3, 4, 5, 6, 7])
    expect(new Set(starts).size).toBe(6)
  })

  it('splits mixed-clef groups into overlapping bass and treble durations', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 38 },
        { x: 11, positionInMeasure: 0.05, clef: 'treble', midi: 74 },
        { x: 70, positionInMeasure: 0.32, clef: 'bass', midi: 48 },
        { x: 71, positionInMeasure: 0.32, clef: 'bass', midi: 53 },
        { x: 72, positionInMeasure: 0.32, clef: 'bass', midi: 57 },
        { x: 73, positionInMeasure: 0.32, clef: 'treble', midi: 62 },
        { x: 110, positionInMeasure: 0.55, clef: 'treble', midi: 74 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )

    const bass = events.find((event) => event.notes?.[0]?.clef === 'bass' && event.startDivision === 0)
    const openingTreble = events.find(
      (event) => event.notes?.[0]?.clef === 'treble' && event.startDivision === 0,
    )
    const innerBass = events.find(
      (event) => event.notes?.[0]?.clef === 'bass' && event.startDivision === 4,
    )
    const closingTreble = events.find(
      (event) => event.notes?.length === 1 && event.startDivision === 8,
    )

    expect(bass?.durationDivisions).toBe(12)
    expect(openingTreble?.durationDivisions).toBe(4)
    expect(innerBass?.durationDivisions).toBe(8)
    expect(closingTreble?.durationDivisions).toBe(4)
  })

  it('keeps a closing upper voice on its own beat when merging chord fragments', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 43 },
        { x: 70, positionInMeasure: 0.35, clef: 'treble', midi: 59 },
        { x: 71, positionInMeasure: 0.36, clef: 'treble', midi: 62 },
        { x: 72, positionInMeasure: 0.37, clef: 'treble', midi: 66 },
        { x: 110, positionInMeasure: 0.62, clef: 'treble', midi: 81 },
        { x: 73, positionInMeasure: 0.35, clef: 'treble', midi: 78 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const closing = events.find((event) => event.notes?.[0]?.midi === 81)
    const auxiliary = events.find((event) => event.notes?.[0]?.midi === 78)
    expect(closing?.startDivision).toBe(8)
    expect(closing?.durationDivisions).toBe(4)
    expect(auxiliary?.durationDivisions).toBe(4)
  })

  it('extends a same-beat treble tone that reappears in the next harmony', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 38 },
        { x: 11, positionInMeasure: 0.05, clef: 'treble', midi: 69 },
        { x: 70, positionInMeasure: 0.35, clef: 'bass', midi: 57 },
        { x: 71, positionInMeasure: 0.35, clef: 'treble', midi: 61 },
        { x: 72, positionInMeasure: 0.35, clef: 'treble', midi: 66 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const treble = events.find((event) => event.notes?.[0]?.midi === 69)
    expect(treble?.durationDivisions).toBe(12)
  })

  it('extends a high same-start treble when its pitch class returns in the inner chord', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 42 },
        { x: 11, positionInMeasure: 0.05, clef: 'treble', midi: 73 },
        { x: 70, positionInMeasure: 0.35, clef: 'treble', midi: 57 },
        { x: 71, positionInMeasure: 0.35, clef: 'treble', midi: 61 },
        { x: 72, positionInMeasure: 0.35, clef: 'treble', midi: 66 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const treble = events.find((event) => event.notes?.[0]?.midi === 73)
    expect(treble?.durationDivisions).toBe(12)
  })

  it('extends a same-start melody when only bass and an inner chord fill the bar', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 38 },
        { x: 11, positionInMeasure: 0.05, clef: 'treble', midi: 64 },
        { x: 70, positionInMeasure: 0.35, clef: 'treble', midi: 53 },
        { x: 71, positionInMeasure: 0.35, clef: 'treble', midi: 57 },
        { x: 72, positionInMeasure: 0.35, clef: 'treble', midi: 62 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const treble = events.find((event) => event.notes?.[0]?.midi === 64)
    expect(treble?.durationDivisions).toBe(12)
  })

  it('extends a same-start pickup to a half when the closing tone lands on the final beat', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 38 },
        { x: 11, positionInMeasure: 0.05, clef: 'treble', midi: 74 },
        { x: 70, positionInMeasure: 0.35, clef: 'bass', midi: 48 },
        { x: 71, positionInMeasure: 0.35, clef: 'bass', midi: 54 },
        { x: 72, positionInMeasure: 0.35, clef: 'bass', midi: 57 },
        { x: 73, positionInMeasure: 0.35, clef: 'bass', midi: 62 },
        { x: 110, positionInMeasure: 0.62, clef: 'treble', midi: 74 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const openingTreble = events.find(
      (event) => event.notes?.[0]?.clef === 'treble' && event.startDivision === 0,
    )
    expect(openingTreble?.durationDivisions).toBe(8)
  })

  it('keeps a semitone pickup cluster short while the shared harmony becomes a half', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 40 },
        { x: 70, positionInMeasure: 0.35, clef: 'treble', midi: 61 },
        { x: 71, positionInMeasure: 0.35, clef: 'treble', midi: 64 },
        { x: 72, positionInMeasure: 0.35, clef: 'treble', midi: 69 },
        { x: 73, positionInMeasure: 0.35, clef: 'treble', midi: 73 },
        { x: 74, positionInMeasure: 0.36, clef: 'treble', midi: 74 },
        { x: 75, positionInMeasure: 0.37, clef: 'treble', midi: 76 },
        { x: 110, positionInMeasure: 0.62, clef: 'treble', midi: 73 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const core = events.find((event) => event.notes?.some((note) => note.midi === 69))
    const pickup = events.find((event) => event.notes?.[0]?.midi === 74)
    expect(core?.durationDivisions).toBe(8)
    expect(pickup?.durationDivisions).toBe(4)
  })

  it('keeps a same-beat upper neighbor short when it does not return in the next harmony', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 38 },
        { x: 11, positionInMeasure: 0.05, clef: 'treble', midi: 79 },
        { x: 70, positionInMeasure: 0.35, clef: 'treble', midi: 57 },
        { x: 71, positionInMeasure: 0.35, clef: 'treble', midi: 61 },
        { x: 72, positionInMeasure: 0.35, clef: 'treble', midi: 66 },
        { x: 110, positionInMeasure: 0.62, clef: 'treble', midi: 73 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const neighbor = events.find((event) => event.notes?.[0]?.midi === 79)
    expect(neighbor?.durationDivisions).toBe(4)
  })

  it('extends opening bass when the next group is upper-register content without treble clef tags', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.08, clef: 'bass', midi: 43 },
        { x: 80, positionInMeasure: 0.38, clef: 'bass', midi: 59 },
        { x: 82, positionInMeasure: 0.39, clef: 'bass', midi: 62 },
        { x: 84, positionInMeasure: 0.4, clef: 'bass', midi: 66 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    expect(events[0]?.durationDivisions).toBe(12)
  })

  it('extends a same-start pedal doubling that matches the opening bass pitch class', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 40 },
        { x: 11, positionInMeasure: 0.05, clef: 'treble', midi: 64 },
        { x: 70, positionInMeasure: 0.35, clef: 'treble', midi: 55 },
        { x: 71, positionInMeasure: 0.35, clef: 'treble', midi: 59 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const treble = events.find((event) => event.notes?.[0]?.midi === 64)
    expect(treble?.durationDivisions).toBe(12)
  })

  it('extends bass across intervening treble onsets on the same staff voice', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0, clef: 'bass', midi: 40 },
        { x: 30, positionInMeasure: 0.25, clef: 'treble', midi: 60 },
        { x: 50, positionInMeasure: 0.5, clef: 'treble', midi: 62 },
        { x: 12, positionInMeasure: 0.5, clef: 'bass', midi: 43 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const openingBass = events.find((event) => event.notes?.[0]?.midi === 40)
    expect(openingBass?.durationDivisions).toBeGreaterThanOrEqual(8)
    expect(openingBass?.perClefDurationAdjusted).toBe(true)
  })
})

describe('extendDurationsPerClefVoice', () => {
  it('lengthens bass when the next global onset belongs to treble', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          notes: [{ clef: 'bass', midi: 40 }],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 60 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 4,
          notes: [{ clef: 'bass', midi: 43 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(8)
    expect(events[0].perClefDurationAdjusted).toBe(true)
  })

  it('does not stretch beamed eighths across a foreign-clef onset', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 72, durationDivisions: 2, beams: 1 }],
        },
        {
          type: 'note',
          startDivision: 2,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 40 }],
        },
        {
          type: 'note',
          startDivision: 12,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 74 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(2)
  })

  it('still lengthens inferred quarters when a foreign clef interrupts the gap', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 2,
          notes: [
            {
              clef: 'treble',
              midi: 72,
              durationDivisions: 4,
              confidence: 0.8,
              stem: { x: 1, tipY: 1 },
              hollow: false,
            },
          ],
        },
        {
          type: 'note',
          startDivision: 2,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 40 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 74 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(8)
    expect(events[0].perClefDurationAdjusted).toBe(true)
  })

  it('lengthens stem-inferred quarters when the next same-clef onset is a beat away', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          notes: [
            {
              clef: 'treble',
              midi: 72,
              durationDivisions: 4,
              confidence: 0.8,
              stem: { x: 1, tipY: 1 },
              hollow: false,
              beams: 0,
              beamStrength: 0,
            },
          ],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 74 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(4)
  })

  it('does not apply quarter ink inference on subdivision grid gaps', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 2,
          notes: [
            {
              clef: 'treble',
              midi: 72,
              durationDivisions: 4,
              confidence: 0.8,
              stem: { x: 1, tipY: 1 },
              hollow: false,
            },
          ],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 74 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(2)
  })

  it('extends across a non-beamed same-clef fragment to reach a quarter', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          notes: [
            {
              clef: 'treble',
              midi: 72,
              durationDivisions: 4,
              confidence: 0.8,
              stem: { x: 1, tipY: 1 },
              hollow: false,
            },
          ],
        },
        {
          type: 'note',
          startDivision: 2,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 73 }],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 74 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(4)
  })

  it('does not stretch beamed notes across a foreign-clef onset', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 38, durationDivisions: 2, beams: 1 }],
        },
        {
          type: 'note',
          startDivision: 2,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 72 }],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 40, durationDivisions: 2, beams: 1 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(2)
  })

  it('extends treble to a half beat across same-pitch chord fragments', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 3,
          notes: [{ clef: 'treble', midi: 65 }],
        },
        {
          type: 'note',
          startDivision: 11,
          durationDivisions: 3,
          notes: [{ clef: 'bass', midi: 40 }],
        },
        {
          type: 'note',
          startDivision: 11,
          durationDivisions: 3,
          notes: [{ clef: 'treble', midi: 65 }],
        },
        {
          type: 'note',
          startDivision: 16,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 67 }],
        },
      ],
      16,
    )
    const opening = events.find(
      (event) => event.startDivision === 8 && event.notes?.[0]?.midi === 65,
    )
    expect(opening?.durationDivisions).toBe(8)
    expect(opening?.perClefDurationAdjusted).toBe(true)
  })

  it('does not extend beamed eighth runs even when pitches repeat', () => {
    const clefEvents = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        notes: [{ clef: 'treble', midi: 72, beams: 1 }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        notes: [{ clef: 'treble', midi: 72, beams: 1 }],
      },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 2,
        notes: [{ clef: 'treble', midi: 72 }],
      },
    ]
    expect(sparseHarmonicHalfSpan(clefEvents, 0, 16)).toBeNull()
  })

  it('does not extend sixteenth-grid gaps at beat zero', () => {
    const clefEvents = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 3,
        notes: [{ clef: 'treble', midi: 41 }],
      },
      {
        type: 'note',
        startDivision: 3,
        durationDivisions: 3,
        notes: [{ clef: 'treble', midi: 41 }],
      },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 4,
        notes: [{ clef: 'treble', midi: 43 }],
      },
    ]
    expect(sparseHarmonicHalfSpan(clefEvents, 0, 16)).toBeNull()
    expect(terminalHarmonicHalfSpan(clefEvents, 0, 16)).toBeNull()
  })

  it('extends split same-onset chord tones from an eighth to a quarter on the beat grid', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 67 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 71 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 74 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 43 }],
        },
        {
          type: 'note',
          startDivision: 10,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 43 }],
        },
        {
          type: 'note',
          startDivision: 12,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 67 }],
        },
      ],
      16,
    )
    const trebleAtBeatTwo = events.filter((event) => event.startDivision === 8 && event.notes?.[0]?.clef === 'treble')
    expect(trebleAtBeatTwo.every((event) => event.durationDivisions === 4)).toBe(true)
    expect(events.find((event) => event.notes?.[0]?.midi === 43 && event.startDivision === 8)?.durationDivisions).toBe(2)
  })

  it('extends a same-clef harmonic chord from an eighth to a quarter on the beat grid', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 2,
          notes: [
            { clef: 'treble', midi: 67 },
            { clef: 'treble', midi: 71 },
            { clef: 'treble', midi: 74 },
          ],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 43 }],
        },
        {
          type: 'note',
          startDivision: 10,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 43 }],
        },
        {
          type: 'note',
          startDivision: 12,
          durationDivisions: 2,
          notes: [{ clef: 'treble', midi: 67 }],
        },
      ],
      16,
    )
    expect(events.find((event) => event.notes?.some((note) => note.midi === 74))?.durationDivisions).toBe(4)
    expect(events.find((event) => event.notes?.[0]?.midi === 43 && event.startDivision === 8)?.durationDivisions).toBe(2)
  })

  it('does not extend single-voice eighths that re-enter on the offbeat', () => {
    expect(
      sameClefBeatQuarterFloor(
        [
          { startDivision: 8, durationDivisions: 2, notes: [{ clef: 'bass', midi: 43 }] },
          { startDivision: 10, durationDivisions: 2, notes: [{ clef: 'bass', midi: 43 }] },
        ],
        0,
        16,
        2,
      ),
    ).toBeNull()
  })

  it('extends the last bass attack in a measure to a half beat', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 8,
          notes: [{ clef: 'bass', midi: 40 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 3,
          notes: [{ clef: 'bass', midi: 65 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 3,
          notes: [{ clef: 'treble', midi: 77 }],
        },
      ],
      16,
    )
    const bass = events.find(
      (event) => event.startDivision === 8 && event.notes?.[0]?.clef === 'bass',
    )
    expect(bass?.durationDivisions).toBe(8)
    expect(bass?.perClefDurationAdjusted).toBe(true)
  })

  it('extends terminal same-clef chord eighths on the beat grid to quarters', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 6,
          notes: [{ clef: 'treble', midi: 72 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 2,
          notes: [
            { clef: 'treble', midi: 74, durationDivisions: 4 },
            { clef: 'treble', midi: 71, durationDivisions: 4 },
            { clef: 'treble', midi: 67, durationDivisions: 4 },
          ],
        },
        {
          type: 'note',
          startDivision: 10,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 43 }],
        },
      ],
      16,
    )
    const terminalChord = events.find(
      (event) => event.startDivision === 8 && event.notes?.[0]?.clef === 'treble',
    )
    expect(terminalChord?.durationDivisions).toBe(4)
    expect(terminalChord?.perClefDurationAdjusted).toBe(true)
  })

  it('does not extend terminal beamed chord eighths to quarters', () => {
    const clefEvents = [
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 2,
        notes: [
          { clef: 'treble', midi: 74, beams: 1 },
          { clef: 'treble', midi: 71 },
        ],
      },
    ]
    expect(terminalSameClefChordQuarterSpan(clefEvents, 0, 16)).toBeNull()
  })

  it('applies terminal chord quarters after upstream onset realignment', () => {
    const events = applyTerminalSameClefChordQuarterDurations(
      [
        {
          type: 'note',
          startDivision: 9,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 68 }],
        },
        {
          type: 'note',
          startDivision: 12,
          durationDivisions: 2,
          notes: [
            { clef: 'treble', midi: 70 },
            { clef: 'treble', midi: 67 },
          ],
        },
        {
          type: 'note',
          startDivision: 15,
          durationDivisions: 1,
          notes: [{ clef: 'bass', midi: 34 }],
        },
      ],
      16,
    )
    const terminalChord = events.find(
      (event) => event.startDivision === 12 && event.notes?.[0]?.clef === 'treble',
    )
    expect(terminalChord?.durationDivisions).toBe(4)
    expect(terminalChord?.terminalSameClefChordQuarterAdjusted).toBe(true)
  })

  it('extends an opening bass chord over a same-clef inner voice', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          notes: [
            { clef: 'bass', midi: 72, durationDivisions: 16, hollow: true },
            { clef: 'bass', midi: 67, durationDivisions: 4 },
            { clef: 'bass', midi: 63, durationDivisions: 16, hollow: true },
          ],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          notes: [{ clef: 'bass', midi: 63 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 4,
          notes: [{ clef: 'bass', midi: 38 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(8)
    expect(events[0].perClefDurationAdjusted).toBe(true)
  })

  it('does not treat beamed opening bass chords as sustained half notes', () => {
    const clefEvents = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [
          { clef: 'bass', midi: 48, durationDivisions: 2, beams: 1 },
          { clef: 'bass', midi: 43, durationDivisions: 4 },
          { clef: 'bass', midi: 36, durationDivisions: 4 },
        ],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 4,
        notes: [{ clef: 'bass', midi: 43 }],
      },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 4,
        notes: [{ clef: 'bass', midi: 48 }],
      },
    ]
    expect(openingBassChordSustainSpan(clefEvents, 0, 16)).toBeNull()
  })

  it('caps plain opening bass notes before a dense subdivision run', () => {
    const events = refineOpeningBassSubdivisionDurations(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 12,
          notes: [{ clef: 'bass', midi: 41, durationDivisions: 4 }],
        },
        {
          type: 'note',
          startDivision: 3,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 41, durationDivisions: 4 }],
        },
        {
          type: 'note',
          startDivision: 5,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 41, durationDivisions: 4 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(2)
    expect(events[0].openingBassSubdivisionAdjusted).toBe(true)
  })

  it('keeps opening bass notes when long-tone ink evidence is present', () => {
    const clefEvents = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 12,
        notes: [{ clef: 'bass', midi: 41, durationDivisions: 12, hollow: true }],
      },
      {
        type: 'note',
        startDivision: 3,
        durationDivisions: 2,
        notes: [{ clef: 'bass', midi: 41, durationDivisions: 4 }],
      },
      {
        type: 'note',
        startDivision: 5,
        durationDivisions: 2,
        notes: [{ clef: 'bass', midi: 41, durationDivisions: 4 }],
      },
    ]
    expect(openingBassSubdivisionCap(clefEvents, 0, 16)).toBeNull()
  })

  it('caps unsupported upper-chord five-division overhangs to a quarter', () => {
    const events = extendDurationsPerClefVoice(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          notes: [
            { clef: 'treble', midi: 79, durationDivisions: 4 },
            { clef: 'treble', midi: 72, durationDivisions: 4 },
            { clef: 'treble', midi: 69, durationDivisions: 4 },
          ],
        },
        {
          type: 'note',
          startDivision: 2,
          durationDivisions: 2,
          notes: [{ clef: 'bass', midi: 43, durationDivisions: 2 }],
        },
        {
          type: 'note',
          startDivision: 5,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 79, durationDivisions: 4 }],
        },
      ],
      16,
    )
    const upperChord = events.find((event) => event.startDivision === 0)
    expect(upperChord?.durationDivisions).toBe(4)
  })

  it('keeps five-division upper chords when longer ink evidence is present', () => {
    const clefEvents = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [
          { clef: 'treble', midi: 79, durationDivisions: 6 },
          { clef: 'treble', midi: 72, durationDivisions: 4 },
          { clef: 'treble', midi: 69, durationDivisions: 4 },
        ],
      },
      {
        type: 'note',
        startDivision: 5,
        durationDivisions: 4,
        notes: [{ clef: 'treble', midi: 79, durationDivisions: 4 }],
      },
    ]
    expect(unsupportedUpperChordOverhangCap(clefEvents, 0, 5)).toBeNull()
  })

  it('refines emitted unsupported upper-chord five-division overhangs', () => {
    const events = refineUnsupportedUpperChordOverhangs([
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 5,
        notes: [
          { clef: 'treble', midi: 79, durationDivisions: 4 },
          { clef: 'treble', midi: 72, durationDivisions: 4 },
          { clef: 'treble', midi: 69, durationDivisions: 4 },
        ],
      },
      {
        type: 'note',
        startDivision: 5,
        durationDivisions: 4,
        notes: [{ clef: 'treble', midi: 79, durationDivisions: 4 }],
      },
    ])
    expect(events[0].durationDivisions).toBe(4)
    expect(events[0].unsupportedUpperChordOverhangAdjusted).toBe(true)
  })
})

describe('refineEventDurationsFromBeamEvidence', () => {
  it('caps beamed notes that were stretched too long', () => {
    const events = refineEventDurationsFromBeamEvidence(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 72, beams: 1, durationDivisions: 2 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(2)
    expect(events[0].beamDurationAdjusted).toBe(true)
  })

  it('leaves non-beamed durations unchanged', () => {
    const events = refineEventDurationsFromBeamEvidence(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          notes: [{ clef: 'treble', midi: 72, durationDivisions: 4 }],
        },
      ],
      16,
    )
    expect(events[0].durationDivisions).toBe(4)
    expect(events[0].beamDurationAdjusted).toBeUndefined()
  })
})

describe('hasBeamEvidenceForNotes', () => {
  it('detects beam count and strength', () => {
    expect(hasBeamEvidenceForNotes([{ beams: 1 }])).toBe(true)
    expect(hasBeamEvidenceForNotes([{ beamStrength: 10 }])).toBe(true)
    expect(hasBeamEvidenceForNotes([{ beams: 0, beamStrength: 0 }])).toBe(false)
  })
})

describe('per-clef rhythm helpers', () => {
  it('detects shared harmonic pitch between chord fragments', () => {
    expect(
      eventsShareHarmonicPitch(
        { notes: [{ midi: 65 }, { midi: 69 }] },
        { notes: [{ midi: 69 }] },
      ),
    ).toBe(true)
    expect(
      eventsShareHarmonicPitch(
        { notes: [{ midi: 65 }] },
        { notes: [{ midi: 67 }] },
      ),
    ).toBe(false)
  })

  it('detects dense subdivision runs', () => {
    expect(isDenseSubdivisionRun(2, 2)).toBe(true)
    expect(isDenseSubdivisionRun(2, 8)).toBe(false)
  })

  it('requires stemmed non-beamed noteheads for quarter inference', () => {
    expect(
      hasConfidentQuarterInference([
        {
          durationDivisions: 4,
          confidence: 0.8,
          stem: { x: 1, tipY: 1 },
          hollow: false,
          beams: 0,
          beamStrength: 0,
        },
      ]),
    ).toBe(true)
    expect(
      hasConfidentQuarterInference([
        { durationDivisions: 4, confidence: 0.8, stem: null, hollow: true },
      ]),
    ).toBe(false)
    expect(
      hasConfidentQuarterInference(
        [
          {
            durationDivisions: 4,
            confidence: 0.8,
            stem: { x: 1, tipY: 1 },
            hollow: false,
          },
        ],
        2,
      ),
    ).toBe(false)
  })
})

describe('summarizeVectorRhythmDiagnostics', () => {
  it('reports voice assignments and overlapping duration groups', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 10, positionInMeasure: 0.05, clef: 'bass', midi: 38 },
        { x: 11, positionInMeasure: 0.05, clef: 'treble', midi: 74 },
        { x: 70, positionInMeasure: 0.32, clef: 'treble', midi: 62 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const diagnostics = summarizeVectorRhythmDiagnostics(events, [], 16)
    expect(diagnostics.voiceAssignments.some((entry) => entry.voice === 2)).toBe(true)
    expect(
      diagnostics.serializationSequence.some(
        (entry) => entry.type === 'forward' || entry.type === 'backup',
      ),
    ).toBe(true)
    expect(diagnostics.overlappingGroups.overlapCount).toBeGreaterThan(0)
  })
})

describe('extendPenultimateHalfBeforeFinalQuarter', () => {
  it('extends a dense beat-1 chord to a half before a beat-2 closing note', () => {
    const events = extendPenultimateHalfBeforeFinalQuarter(
      [
        { type: 'note', startDivision: 0, durationDivisions: 12, notes: [{ clef: 'bass' }] },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          notes: [{ clef: 'treble' }, { clef: 'bass' }],
        },
        { type: 'note', startDivision: 8, durationDivisions: 8, notes: [{ clef: 'treble' }] },
      ],
      { beats: 3, beatType: 4 },
      12,
    )
    expect(events[1].durationDivisions).toBe(8)
    expect(events[2].durationDivisions).toBe(4)
  })

  it('leaves evenly spaced single-note beats unchanged', () => {
    const events = extendPenultimateHalfBeforeFinalQuarter(
      [
        { type: 'note', startDivision: 0, durationDivisions: 4, notes: [{ clef: 'treble' }] },
        { type: 'note', startDivision: 4, durationDivisions: 4, notes: [{ clef: 'treble' }] },
        { type: 'note', startDivision: 8, durationDivisions: 4, notes: [{ clef: 'treble' }] },
        { type: 'note', startDivision: 12, durationDivisions: 4, notes: [{ clef: 'treble' }] },
      ],
      { beats: 4, beatType: 4 },
      16,
    )
    expect(events.map((event) => event.durationDivisions)).toEqual([4, 4, 4, 4])
  })
})

describe('extendCombinedGrandStaffOpening', () => {
  it('extends a lone opening bass through a later treble entry', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [{ clef: 'bass', midi: 43 }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 12,
        durationType: 'half',
        notes: [{ clef: 'treble', midi: 66 }],
      },
    ]
    const extended = extendCombinedGrandStaffOpening(events, 16)
    expect(extended[0].durationDivisions).toBe(12)
    expect(extended[0].durationType).toBe('half')
    expect(extended[0].dotted).toBe(true)
  })

  it('keeps a quarter opening treble when the voice rearticulates before the closing echo', () => {
    const events = extendCombinedGrandStaffOpening(
      [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ clef: 'bass', midi: 35 }],
        },
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ clef: 'treble', midi: 71 }],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ clef: 'bass', midi: 66 }, { clef: 'bass', midi: 62 }, { clef: 'bass', midi: 59 }],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ clef: 'treble', midi: 69 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ clef: 'treble', midi: 71 }],
        },
      ],
      12,
    )
    expect(events[1].durationDivisions).toBe(4)
    expect(events[1].durationType).toBe('quarter')
  })
})

describe('buildOmrMusicXml overlapping grand-staff rhythm', () => {
  it('writes extended bass and treble durations with backup/forward in one voice', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 4, positionInMeasure: 0.1, clef: 'bass', midi: 43 },
        { x: 120, positionInMeasure: 0.45, clef: 'treble', midi: 66 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const xml = buildOmrMusicXml({
      measures: [{ measureNumber: 1, uncertain: false, events }],
    })
    const timing = parseMusicXml(xml, 'grand-staff.omr.musicxml')
    const bass = timing.notes.find((note) => note.label === 'G2')
    const treble = timing.notes.find((note) => note.label === 'F#4')
    expect(bass?.durationQuarters).toBe(3)
    expect(treble?.durationQuarters).toBe(2)
  })
})

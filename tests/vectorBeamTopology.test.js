import { describe, expect, it } from 'vitest'
import {
  applyVectorPrimaryBeamTopology,
  summarizeAppliedVectorBeamTopology,
} from '../src/features/omr/applyVectorBeamTopology.js'
import { buildMeasureBeamValues } from '../src/features/omr/buildOmrMusicXml.js'

function graphFor(groupId, eventIndexes, { level = 1, confidence = 0.92 } = {}) {
  return {
    eventOwnership: eventIndexes.map((eventIndex) => ({
      eventIndex,
      ownerships: [
        {
          beamGroupId: groupId,
          attachedBeamIds: [`${groupId}-beam`],
          beamCount: level,
          beamConfidence: confidence,
        },
      ],
    })),
  }
}

describe('vector primary-beam topology promotion', () => {
  it('recovers a connected dotted-eighth, dotted-eighth, eighth group after a beat floor', () => {
    const input = [
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [{ midi: 77, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 11,
        durationDivisions: 3,
        durationType: 'eighth',
        dotted: true,
        notes: [{ midi: 75, clef: 'treble', dotted: true }],
      },
      {
        type: 'note',
        startDivision: 14,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 77, clef: 'treble' }],
      },
    ]

    const output = applyVectorPrimaryBeamTopology(
      input,
      graphFor('rg-1-1', [0, 1, 2]),
    )

    expect(output.map((event) => event.durationDivisions)).toEqual([3, 3, 2])
    expect(output.map((event) => event.durationType)).toEqual([
      'eighth',
      'eighth',
      'eighth',
    ])
    expect(output.map((event) => event.dotted)).toEqual([true, true, false])
    expect(output.map((event) => event.beams)).toEqual([1, 1, 1])
    expect(
      output.every((event) => event.beamTopologyGroupId === 'rg-1-1'),
    ).toBe(true)
    expect(summarizeAppliedVectorBeamTopology(output)).toEqual({
      appliedEventCount: 3,
      appliedGroupCount: 1,
      durationAdjustedCount: 1,
    })
  })

  it('does not override explicit dot or hollow-notehead evidence', () => {
    const input = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 6,
        durationType: 'quarter',
        dotted: true,
        notes: [{ midi: 72, clef: 'treble', dotted: true }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 8,
        durationType: 'half',
        notes: [{ midi: 74, clef: 'treble', hollowGlyph: true }],
      },
    ]

    const output = applyVectorPrimaryBeamTopology(
      input,
      graphFor('rg-control', [0, 1]),
    )

    expect(output.map((event) => event.durationDivisions)).toEqual([6, 8])
    expect(output.map((event) => event.durationType)).toEqual([
      'quarter',
      'half',
    ])
  })

  it('keeps secondary-beam and tuplet evidence diagnostic-only', () => {
    const secondary = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 72, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 74, clef: 'treble' }],
      },
    ]
    expect(
      applyVectorPrimaryBeamTopology(
        secondary,
        graphFor('secondary', [0, 1], { level: 2 }),
      ),
    ).toBe(secondary)

    const tuplet = secondary.map((event) => ({
      ...event,
      timeModification: { actualNotes: 3, normalNotes: 2 },
    }))
    expect(
      applyVectorPrimaryBeamTopology(
        tuplet,
        graphFor('tuplet', [0, 1]),
      ),
    ).toBe(tuplet)
  })

  it('never overrides written durations below full beam-bar confidence', () => {
    // A flag stroke bridging two nearby stems can pass the 0.7 grouping floor
    // (guitar-standard-chords regression) but must not rewrite durations.
    const input = [
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 69, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 4,
        durationType: 'quarter',
        notes: [{ midi: 67, clef: 'treble' }],
      },
    ]

    const output = applyVectorPrimaryBeamTopology(
      input,
      graphFor('rg-flag-bridge', [0, 1], { confidence: 0.86 }),
    )

    expect(output.map((event) => event.durationDivisions)).toEqual([2, 4])
    expect(output.map((event) => event.durationType)).toEqual([
      'eighth',
      'quarter',
    ])
    expect(summarizeAppliedVectorBeamTopology(output)).toEqual({
      appliedEventCount: 2,
      appliedGroupCount: 1,
      durationAdjustedCount: 0,
    })
  })

  it('requires a multi-event group with strong attached-beam confidence', () => {
    const input = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 72, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 74, clef: 'treble' }],
      },
    ]
    expect(
      applyVectorPrimaryBeamTopology(
        input,
        graphFor('weak', [0, 1], { confidence: 0.69 }),
      ),
    ).toBe(input)
    expect(
      applyVectorPrimaryBeamTopology(input, graphFor('orphan', [0])),
    ).toBe(input)
  })
})

describe('MusicXML beam topology boundaries', () => {
  it('does not join contiguous events from different detected beam groups', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        durationType: 'eighth',
        beams: 1,
        beamTopologyGroupId: 'a',
        notes: [{ clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        durationType: 'eighth',
        beams: 1,
        beamTopologyGroupId: 'a',
        notes: [{ clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 2,
        durationType: 'eighth',
        beams: 1,
        beamTopologyGroupId: 'b',
        notes: [{ clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 6,
        durationDivisions: 2,
        durationType: 'eighth',
        beams: 1,
        beamTopologyGroupId: 'b',
        notes: [{ clef: 'treble' }],
      },
    ]
    const values = buildMeasureBeamValues(events)
    expect(events.map((event) => values.get(event))).toEqual([
      [{ number: 1, value: 'begin' }],
      [{ number: 1, value: 'end' }],
      [{ number: 1, value: 'begin' }],
      [{ number: 1, value: 'end' }],
    ])
  })
})

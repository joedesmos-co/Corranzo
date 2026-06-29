import { describe, expect, it } from 'vitest'
import { summarizeVectorChordGrouping } from '../src/features/omr/omrChordGroupingDiagnostics.js'
import {
  buildVectorEvents,
  coalesceSameOnsetChordEvents,
} from '../src/features/omr/processVectorOmrPage.js'

const measureBox = { measureNumber: 12, page: 1 }

function onsets(positions) {
  return positions.map(({ x, positionInMeasure, clef = 'treble', midi = 60 + x }) => ({
    cx: x,
    midi,
    naturalMidi: midi,
    clef,
    positionInMeasure,
  }))
}

describe('summarizeVectorChordGrouping', () => {
  it('reports onset voices and fragmentation', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [{ midi: 43, clef: 'bass', cx: 10 }],
      },
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [{ midi: 60, clef: 'treble', cx: 11 }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 4,
        notes: [
          { midi: 64, clef: 'treble', cx: 70 },
          { midi: 67, clef: 'treble', cx: 71 },
        ],
      },
    ]
    const summary = summarizeVectorChordGrouping(events)
    expect(summary.onsetCount).toBe(2)
    expect(summary.onsets[0].voices).toEqual([2, 1])
    expect(summary.onsets[1].noteCount).toBe(2)
  })

  it('reports backup/forward serialization for multi-voice onsets', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [{ midi: 43, clef: 'bass' }],
      },
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [{ midi: 60, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 4,
        notes: [
          { midi: 64, clef: 'treble' },
          { midi: 67, clef: 'treble' },
        ],
      },
    ]
    const summary = summarizeVectorChordGrouping(events)
    expect(summary.backupCount).toBe(1)
    expect(summary.forwardCount).toBe(0)
    expect(summary.sequence.some((entry) => entry.type === 'chord')).toBe(true)
  })
})

describe('vector chord grouping regressions', () => {
  it('keeps horizontally distant same-slot notes as separate attacks', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 60, positionInMeasure: 0.25, midi: 60 },
        { x: 120, positionInMeasure: 0.26, midi: 64 },
        { x: 180, positionInMeasure: 0.5, midi: 67 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const noteEvents = events.filter((event) => event.type === 'note')
    expect(noteEvents).toHaveLength(3)
    expect(noteEvents.some((event) => (event.notes?.length ?? 0) > 1)).toBe(false)
  })

  it('does not merge two same-slot sequential notes spaced like eighths', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 60, positionInMeasure: 0.24, midi: 60 },
        { x: 72, positionInMeasure: 0.26, midi: 64 },
        { x: 120, positionInMeasure: 0.5, midi: 67 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const noteEvents = events.filter((event) => event.type === 'note')
    expect(noteEvents).toHaveLength(3)
    expect(noteEvents.every((event) => (event.notes?.length ?? 0) === 1)).toBe(true)
  })

  it('still merges spread chord tones within the horizontal merge window', () => {
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
    const chord = events.find((event) => (event.notes?.length ?? 0) === 3)
    expect(chord).toBeTruthy()
    expect(events.filter((event) => event.type === 'note')).toHaveLength(2)
  })

  it('does not coalesce distant fragments that share a snapped onset', () => {
    const events = coalesceSameOnsetChordEvents([
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 4,
        notes: [{ midi: 60, clef: 'treble', cx: 60 }],
      },
      {
        type: 'note',
        startDivision: 4,
        durationDivisions: 4,
        notes: [{ midi: 64, clef: 'treble', cx: 120 }],
      },
    ])
    expect(events.filter((event) => event.type === 'note')).toHaveLength(2)
  })
})

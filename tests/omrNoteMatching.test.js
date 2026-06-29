import { describe, expect, it } from 'vitest'
import { dedupeNoteheads, noteheadDedupeKey } from '../src/features/omr/omrNoteDedupe.js'
import {
  countEmittedNoteheads,
  groupTruthNotesByMeasure,
  summarizeMeasureNoteMatching,
  summarizeNoteMatchingReport,
} from '../src/features/omr/omrNoteMatchingDiagnostics.js'
import { buildVectorEvents } from '../src/features/omr/processVectorOmrPage.js'

const measureBox = { measureNumber: 12, page: 1 }

describe('dedupeNoteheads', () => {
  it('keeps spatially distinct heads that share a mapped MIDI', () => {
    const notes = [
      { midi: 60, clef: 'treble', cx: 40, cy: 140 },
      { midi: 60, clef: 'treble', cx: 90, cy: 140 },
    ]
    expect(dedupeNoteheads(notes)).toHaveLength(2)
    expect(noteheadDedupeKey(notes[0])).not.toBe(noteheadDedupeKey(notes[1]))
  })

  it('removes duplicate detections at the same place', () => {
    const notes = [
      { midi: 64, clef: 'treble', cx: 40, cy: 140 },
      { midi: 64, clef: 'treble', cx: 41, cy: 140 },
    ]
    expect(dedupeNoteheads(notes)).toHaveLength(1)
  })
})

describe('summarizeMeasureNoteMatching', () => {
  it('reports grouping loss between detection and emission', () => {
    const summary = summarizeMeasureNoteMatching({
      measureNumber: 3,
      page: 1,
      vectorNoteCount: 8,
      events: [
        { type: 'note', notes: [{ midi: 60 }, { midi: 64 }] },
        { type: 'note', notes: [{ midi: 67 }] },
      ],
    })
    expect(summary.detectedNoteheads).toBe(8)
    expect(summary.emittedNoteheads).toBe(3)
    expect(summary.dedupedDuringGrouping).toBe(5)
  })
})

describe('buildVectorEvents dense dedupe', () => {
  it('preserves repeated pitch columns at different horizontal positions', () => {
    const events = buildVectorEvents(
      [
        { cx: 40, cy: 140, midi: 60, naturalMidi: 60, clef: 'treble', positionInMeasure: 0.125 },
        { cx: 90, cy: 140, midi: 60, naturalMidi: 60, clef: 'treble', positionInMeasure: 0.25 },
        { cx: 140, cy: 140, midi: 64, naturalMidi: 64, clef: 'treble', positionInMeasure: 0.375 },
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const emitted = countEmittedNoteheads(events)
    expect(emitted).toBe(3)
  })
})

describe('summarizeNoteMatchingReport', () => {
  it('joins truth counts per measure', () => {
    const truth = groupTruthNotesByMeasure([
      { measureNumber: 1, midi: 60, isRest: false },
      { measureNumber: 1, midi: 64, isRest: false },
      { measureNumber: 2, midi: 67, isRest: false },
    ])
    const report = summarizeNoteMatchingReport(
      [
        {
          measureNumber: 1,
          page: 1,
          vectorNoteCount: 3,
          events: [{ type: 'note', notes: [{ midi: 60 }, { midi: 64 }] }],
        },
      ],
      truth,
    )
    expect(report.totals.detectedNoteheads).toBe(3)
    expect(report.totals.emittedNoteheads).toBe(2)
    expect(report.perMeasure[0].truthNoteheads).toBe(2)
  })
})

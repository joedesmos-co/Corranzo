import { describe, expect, it } from 'vitest'
import {
  alignOpeningGroupStart,
  buildVectorEvents,
  coalesceSameOnsetChordEvents,
  refineSparseChordColumnStarts,
  shouldInferRhythmFromPositions,
} from '../src/features/omr/processVectorOmrPage.js'
import { OMR_DIVISIONS_PER_QUARTER } from '../src/features/omr/omrRhythmConstants.js'
import { packJointPolyphonicRhythm } from '../src/features/omr/jointPolyphonicRhythm.js'

const measureBox = { measureNumber: 8, page: 1 }

function chordTone({ cx, cy, midi, positionInMeasure, clef = 'treble' }) {
  return {
    cx,
    cy,
    midi,
    naturalMidi: midi,
    clef,
    positionInMeasure,
    noteheadGlyph: 'black',
    source: 'vector-glyph',
  }
}

function openEChord(cx, positionInMeasure) {
  // Recovered extreme stack sharing one stem/column.
  const midis = [40, 47, 52, 55, 59, 64]
  return midis.map((midi, index) =>
    chordTone({
      cx,
      cy: 700 + index * 18,
      midi,
      positionInMeasure,
    }),
  )
}

describe('alignOpeningGroupStart', () => {
  it('left-shifts a delayed first-beat grid so recovered chord tones share barline onset', () => {
    const starts = [2, 4, 6, 8, 11]
    const groups = [
      { positionInMeasure: 0.164, notes: openEChord(745, 0.164) },
      { positionInMeasure: 0.255, notes: openEChord(763, 0.255).slice(0, 5) },
      { positionInMeasure: 0.345, notes: openEChord(781, 0.345) },
      { positionInMeasure: 0.525, notes: openEChord(816, 0.525).slice(0, 2) },
      { positionInMeasure: 0.705, notes: openEChord(852, 0.705) },
    ]
    expect(alignOpeningGroupStart(starts, groups, 4, true)).toEqual([0, 2, 4, 6, 9])
  })

  it('eighth-floors a dense-snap delayed chord opening before translating the grid', () => {
    const starts = [3, 4, 6, 8, 11]
    const groups = [
      { positionInMeasure: 0.164, notes: openEChord(745, 0.164) },
      { positionInMeasure: 0.255, notes: openEChord(763, 0.255) },
      { positionInMeasure: 0.345, notes: openEChord(781, 0.345) },
      { positionInMeasure: 0.525, notes: openEChord(816, 0.525) },
      { positionInMeasure: 0.705, notes: openEChord(852, 0.705) },
    ]
    expect(alignOpeningGroupStart(starts, groups, 4, true)).toEqual([0, 2, 4, 6, 9])
  })

  it('does not shift when the first column is already on the barline', () => {
    const starts = [0, 2, 4, 7, 11]
    const groups = [{ positionInMeasure: 0.03, notes: openEChord(190, 0.03).slice(0, 2) }]
    expect(alignOpeningGroupStart(starts, groups, 4, true)).toEqual(starts)
  })

  it('rejects ambiguous late orphans instead of force-merging into the opening beat', () => {
    const starts = [8, 10, 12]
    const groups = [
      { positionInMeasure: 0.55, notes: [chordTone({ cx: 500, cy: 800, midi: 40, positionInMeasure: 0.55 })] },
      { positionInMeasure: 0.7, notes: [chordTone({ cx: 560, cy: 800, midi: 47, positionInMeasure: 0.7 })] },
      { positionInMeasure: 0.85, notes: [chordTone({ cx: 620, cy: 800, midi: 52, positionInMeasure: 0.85 })] },
    ]
    expect(alignOpeningGroupStart(starts, groups, 4, true)).toEqual(starts)
  })

  it('does not force-merge an ambiguous recovered orphan onto a distant chord onset', () => {
    const starts = [3, 8]
    const groups = [
      {
        positionInMeasure: 0.18,
        notes: [chordTone({ cx: 220, cy: 820, midi: 40, positionInMeasure: 0.18 })],
      },
      {
        positionInMeasure: 0.55,
        notes: openEChord(420, 0.55),
      },
    ]
    // Single recovered orphan + later chord is not chord-dominated at the opening.
    expect(alignOpeningGroupStart(starts, groups, 4, true)).toEqual(starts)
  })
})

describe('refineSparseChordColumnStarts', () => {
  it('expands a compressed chord-column tail onto the quarter grid', () => {
    expect(refineSparseChordColumnStarts([0, 2, 4, 6, 9], 4, 16)).toEqual([0, 2, 4, 8, 12])
  })

  it('leaves an already quarter-spaced tail alone', () => {
    expect(refineSparseChordColumnStarts([0, 2, 4, 8, 12], 4, 16)).toEqual([0, 2, 4, 8, 12])
  })
})

describe('recovered ledger tone rhythm integration', () => {
  it('keeps several recovered open-E ledger tones on one shared onset after packing', () => {
    // Five columns (> beats) forces position packing like guitar-standard m8.
    const notes = [
      ...openEChord(200, 0.16),
      ...openEChord(260, 0.26).map((note, index) =>
        chordTone({
          ...note,
          midi: [41, 48, 53, 57, 61, 64][index],
          cx: 260,
          positionInMeasure: 0.26,
        }),
      ),
      ...openEChord(320, 0.36),
      ...openEChord(420, 0.55).slice(0, 2),
      ...openEChord(520, 0.74),
    ]
    const events = buildVectorEvents(notes, measureBox, { beats: 4, beatType: 4 })
    const noteEvents = events.filter((event) => event.type === 'note')
    const opening = noteEvents.find((event) =>
      (event.notes ?? []).some((note) => note.midi === 40 && Math.round(note.cx) === 200),
    )
    expect(opening).toBeTruthy()
    expect(opening.startDivision).toBe(0)
    const openingMidis = (opening.notes ?? []).map((note) => note.midi).sort((a, b) => a - b)
    expect(openingMidis).toEqual([40, 47, 52, 55, 59, 64])
  })

  it('lets a recovered low tone join its existing visual chord onset', () => {
    const upper = [
      chordTone({ cx: 300, cy: 710, midi: 64, positionInMeasure: 0.17 }),
      chordTone({ cx: 300, cy: 730, midi: 59, positionInMeasure: 0.17 }),
      chordTone({ cx: 300, cy: 745, midi: 55, positionInMeasure: 0.17 }),
    ]
    const recovered = [
      chordTone({ cx: 300, cy: 760, midi: 52, positionInMeasure: 0.17 }),
      chordTone({ cx: 300, cy: 780, midi: 47, positionInMeasure: 0.17 }),
      chordTone({ cx: 300, cy: 805, midi: 40, positionInMeasure: 0.17 }),
    ]
    const events = buildVectorEvents([...upper, ...recovered], measureBox, { beats: 4, beatType: 4 })
    const chord = events.find((event) => event.type === 'note')
    expect(chord.startDivision).toBe(0)
    expect(chord.notes.map((note) => note.midi).sort((a, b) => a - b)).toEqual([
      40, 47, 52, 55, 59, 64,
    ])
  })

  it('keeps a recovered independent bass attack separate from a later chord', () => {
    const notes = [
      chordTone({ cx: 180, cy: 800, midi: 40, positionInMeasure: 0.05 }),
      ...openEChord(420, 0.55),
    ]
    const events = buildVectorEvents(notes, measureBox, { beats: 4, beatType: 4 }).filter(
      (event) => event.type === 'note',
    )
    expect(events.length).toBeGreaterThanOrEqual(2)
    const first = events[0]
    const second = events.find((event) => event.startDivision > first.startDivision)
    expect(first.notes).toHaveLength(1)
    expect(first.notes[0].midi).toBe(40)
    expect((second?.notes?.length ?? 0)).toBeGreaterThan(1)
  })

  it('does not merge opposing Guitar voices that share only register proximity', () => {
    const lowerVoice = [
      chordTone({ cx: 300, cy: 820, midi: 40, positionInMeasure: 0.2, clef: 'treble' }),
      chordTone({ cx: 300, cy: 800, midi: 47, positionInMeasure: 0.2, clef: 'treble' }),
    ]
    const upperVoice = [
      chordTone({ cx: 360, cy: 700, midi: 64, positionInMeasure: 0.45, clef: 'treble' }),
      chordTone({ cx: 360, cy: 720, midi: 67, positionInMeasure: 0.45, clef: 'treble' }),
    ]
    const events = buildVectorEvents([...lowerVoice, ...upperVoice], measureBox, {
      beats: 4,
      beatType: 4,
    }).filter((event) => event.type === 'note')
    expect(events.length).toBe(2)
    expect(Math.abs((events[0].notes[0].cx ?? 0) - (events[1].notes[0].cx ?? 0))).toBeGreaterThan(20)
  })

  it('retains recovered chord duration through coalesce and joint polyphonic packing', () => {
    const notes = openEChord(240, 0.15)
    const events = buildVectorEvents(notes, measureBox, { beats: 4, beatType: 4 })
    const coalesced = coalesceSameOnsetChordEvents(events)
    const packed = packJointPolyphonicRhythm(coalesced, { totalDivisions: 16 })
    const chord = (packed.events ?? coalesced).find((event) => event.type === 'note')
    expect(chord.notes.map((note) => note.midi).sort((a, b) => a - b)).toEqual([
      40, 47, 52, 55, 59, 64,
    ])
    expect(chord.startDivision).toBe(0)
    expect(chord.durationDivisions).toBeGreaterThanOrEqual(OMR_DIVISIONS_PER_QUARTER)
  })

  it('does not invent a duplicate semantic note when only notation glyphs are present', () => {
    const notes = openEChord(250, 0.16)
    const events = buildVectorEvents(notes, measureBox, { beats: 4, beatType: 4 }).filter(
      (event) => event.type === 'note',
    )
    expect(events).toHaveLength(1)
    expect(events[0].notes).toHaveLength(6)
  })

  it('does not collapse dense multi-column recovered rhythm into one onset', () => {
    const notes = [
      ...openEChord(200, 0.16),
      ...openEChord(280, 0.34),
      ...openEChord(360, 0.52),
      ...openEChord(440, 0.7),
      ...openEChord(520, 0.88),
    ]
    const events = buildVectorEvents(notes, measureBox, { beats: 4, beatType: 4 }).filter(
      (event) => event.type === 'note',
    )
    expect(events.length).toBeGreaterThanOrEqual(4)
    const starts = [...new Set(events.map((event) => event.startDivision))].sort((a, b) => a - b)
    expect(starts[0]).toBe(0)
    expect(starts.length).toBeGreaterThanOrEqual(4)
  })

  it('preserves TAB/string metadata on recovered chord tones', () => {
    const notes = openEChord(250, 0.16).map((note, index) => ({
      ...note,
      string: 6 - index,
      fret: index === 0 ? 0 : index,
      tab: true,
    }))
    const events = buildVectorEvents(notes, measureBox, { beats: 4, beatType: 4 }).filter(
      (event) => event.type === 'note',
    )
    expect(events).toHaveLength(1)
    expect(events[0].startDivision).toBe(0)
    const stringsByMidi = new Map(
      events[0].notes.map((note) => [note.midi, note.string]),
    )
    expect(stringsByMidi.get(40)).toBe(6)
    expect(stringsByMidi.get(64)).toBe(1)
    expect(events[0].notes.every((note) => note.tab === true)).toBe(true)
  })

  it('does not invent a notation-plus-TAB duplicate when both share one column', () => {
    const notation = openEChord(250, 0.16)
    const tabDupes = openEChord(252, 0.16).map((note) => ({
      ...note,
      source: 'tab-glyph',
      string: 6,
      fret: 0,
    }))
    const events = buildVectorEvents([...notation, ...tabDupes], measureBox, {
      beats: 4,
      beatType: 4,
    }).filter((event) => event.type === 'note')
    const midis = events.flatMap((event) => (event.notes ?? []).map((note) => note.midi))
    const unique = [...new Set(midis)]
    expect(unique.sort((a, b) => a - b)).toEqual([40, 47, 52, 55, 59, 64])
    expect(midis.length).toBeLessThanOrEqual(unique.length + 1)
  })
})

import { describe, expect, it } from 'vitest'
import {
  ADJACENT_SLOT_MAX_DX,
  beginAdjacentSlotDiagnostics,
  evaluateAdjacentSlotChordShare,
  peekAdjacentSlotDiagnostics,
  takeAdjacentSlotDiagnostics,
} from '../src/features/omr/omrAdjacentSlotChordGrouping.js'
import {
  buildVectorEvents,
  coalesceSameOnsetChordEvents,
  resnapDenseChordOnsets,
} from '../src/features/omr/processVectorOmrPage.js'

const measureBox = { measureNumber: 4, page: 1 }

function head(partial) {
  return {
    naturalMidi: partial.midi,
    clef: 'treble',
    confidence: 0.9,
    ...partial,
  }
}

describe('evaluateAdjacentSlotChordShare', () => {
  it('accepts stacked same-staff tones within tight dx', () => {
    const verdict = evaluateAdjacentSlotChordShare(
      [head({ cx: 100, cy: 120, midi: 60, stemDirection: 'up' })],
      [head({ cx: 103, cy: 100, midi: 64, stemDirection: 'up' })],
    )
    expect(verdict.ok).toBe(true)
  })

  it('rejects opposing stems without shared stem group', () => {
    const verdict = evaluateAdjacentSlotChordShare(
      [head({ cx: 100, cy: 90, midi: 72, stemDirection: 'up' })],
      [head({ cx: 102, cy: 140, midi: 55, stemDirection: 'down' })],
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('opposing-stems-independent-voice')
  })

  it('rejects grace notes', () => {
    const verdict = evaluateAdjacentSlotChordShare(
      [head({ cx: 100, cy: 100, midi: 67, isGrace: true })],
      [head({ cx: 101, cy: 120, midi: 60 })],
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('grace-or-ornament')
  })

  it('rejects dx above adjacent-slot threshold', () => {
    const verdict = evaluateAdjacentSlotChordShare(
      [head({ cx: 100, cy: 120, midi: 60 })],
      [head({ cx: 100 + ADJACENT_SLOT_MAX_DX + 1, cy: 100, midi: 64 })],
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('dx-above-threshold')
  })

  it('rejects conflicting beam groups', () => {
    const verdict = evaluateAdjacentSlotChordShare(
      [head({ cx: 100, cy: 110, midi: 60, beams: 1, beamGroupId: 'bg-a' })],
      [head({ cx: 103, cy: 90, midi: 64, beams: 1, beamGroupId: 'bg-b' })],
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('conflicting-beam-group')
  })
})

describe('adjacent-slot chord grouping (geometry)', () => {
  it('1. reunites adjacent-slot tones from one visual chord', () => {
    beginAdjacentSlotDiagnostics()
    const events = buildVectorEvents(
      [
        head({ cx: 100, cy: 120, midi: 60, positionInMeasure: 0.22, stemDirection: 'up' }),
        head({ cx: 103, cy: 100, midi: 64, positionInMeasure: 0.31, stemDirection: 'up' }),
        head({ cx: 105, cy: 80, midi: 67, positionInMeasure: 0.32, stemDirection: 'up' }),
        head({ cx: 170, cy: 100, midi: 62, positionInMeasure: 0.45 }),
        head({ cx: 230, cy: 100, midi: 64, positionInMeasure: 0.6 }),
        head({ cx: 290, cy: 100, midi: 65, positionInMeasure: 0.75 }),
        head({ cx: 350, cy: 100, midi: 67, positionInMeasure: 0.9 }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const chord = events.find(
      (event) =>
        event.type === 'note' &&
        [60, 64, 67].every((midi) => (event.notes ?? []).some((note) => note.midi === midi)),
    )
    expect(chord).toBeTruthy()
    expect(chord.notes).toHaveLength(3)
    const diag = takeAdjacentSlotDiagnostics()
    expect(diag?.accepted).toBeGreaterThan(0)
  })

  it('2. keeps existing same-slot chord grouping', () => {
    const events = buildVectorEvents(
      [
        head({ cx: 80, cy: 120, midi: 60, positionInMeasure: 0.25 }),
        head({ cx: 82, cy: 100, midi: 64, positionInMeasure: 0.25 }),
        head({ cx: 84, cy: 80, midi: 67, positionInMeasure: 0.25 }),
        head({ cx: 160, cy: 100, midi: 72, positionInMeasure: 0.5 }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const chord = events.find((event) => (event.notes?.length ?? 0) === 3)
    expect(chord).toBeTruthy()
  })

  it('3. keeps two adjacent sixteenth-note chords separate', () => {
    const events = buildVectorEvents(
      [
        head({ cx: 100, cy: 110, midi: 60, positionInMeasure: 0.2, beams: 2, beamGroupId: 'g1' }),
        head({ cx: 101, cy: 90, midi: 64, positionInMeasure: 0.2, beams: 2, beamGroupId: 'g1' }),
        head({ cx: 130, cy: 110, midi: 62, positionInMeasure: 0.28, beams: 2, beamGroupId: 'g2' }),
        head({ cx: 131, cy: 90, midi: 65, positionInMeasure: 0.28, beams: 2, beamGroupId: 'g2' }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const noteEvents = events.filter((event) => event.type === 'note')
    expect(noteEvents.length).toBeGreaterThanOrEqual(2)
    expect(noteEvents.every((event) => (event.notes?.length ?? 0) <= 2)).toBe(true)
    const mergedAcross = noteEvents.some(
      (event) =>
        (event.notes ?? []).some((note) => note.midi === 60) &&
        (event.notes ?? []).some((note) => note.midi === 62),
    )
    expect(mergedAcross).toBe(false)
  })

  it('4. keeps mixed voices at nearly identical x separate across adjacent slots', () => {
    const events = buildVectorEvents(
      [
        head({
          cx: 120,
          cy: 90,
          midi: 72,
          positionInMeasure: 0.22,
          stemDirection: 'up',
          voice: 1,
        }),
        head({
          cx: 122,
          cy: 140,
          midi: 55,
          positionInMeasure: 0.31,
          stemDirection: 'down',
          voice: 2,
        }),
        head({ cx: 200, cy: 100, midi: 67, positionInMeasure: 0.5 }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const merged = events.some(
      (event) =>
        event.type === 'note' &&
        (event.notes ?? []).some((note) => note.midi === 72) &&
        (event.notes ?? []).some((note) => note.midi === 55),
    )
    expect(merged).toBe(false)
  })

  it('5. keeps opposing stems separate', () => {
    const verdict = evaluateAdjacentSlotChordShare(
      [head({ cx: 150, cy: 95, midi: 69, stemDirection: 'up' })],
      [head({ cx: 152, cy: 135, midi: 57, stemDirection: 'down' })],
    )
    expect(verdict.ok).toBe(false)
  })

  it('6. reunites shared-stem displaced chord tones across adjacent slots', () => {
    const events = buildVectorEvents(
      [
        head({
          cx: 100,
          cy: 120,
          midi: 60,
          positionInMeasure: 0.22,
          stemDirection: 'up',
          stemGroupId: 'stem-1',
        }),
        head({
          cx: 108,
          cy: 100,
          midi: 62,
          positionInMeasure: 0.31,
          stemDirection: 'up',
          stemGroupId: 'stem-1',
        }),
        head({
          cx: 101,
          cy: 80,
          midi: 67,
          positionInMeasure: 0.32,
          stemDirection: 'up',
          stemGroupId: 'stem-1',
        }),
        head({ cx: 200, cy: 100, midi: 64, positionInMeasure: 0.55 }),
        head({ cx: 260, cy: 100, midi: 65, positionInMeasure: 0.7 }),
        head({ cx: 320, cy: 100, midi: 67, positionInMeasure: 0.85 }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const chord = events.find(
      (event) =>
        event.type === 'note' &&
        [60, 62, 67].every((midi) => (event.notes ?? []).some((note) => note.midi === midi)),
    )
    expect(chord).toBeTruthy()
  })

  it('7. keeps beamed neighboring events separate', () => {
    const events = buildVectorEvents(
      [
        head({
          cx: 100,
          cy: 100,
          midi: 64,
          positionInMeasure: 0.22,
          beams: 1,
          beamGroupId: 'beam-a',
        }),
        head({
          cx: 104,
          cy: 100,
          midi: 65,
          positionInMeasure: 0.31,
          beams: 1,
          beamGroupId: 'beam-b',
        }),
        head({ cx: 180, cy: 100, midi: 67, positionInMeasure: 0.5 }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const merged = events.some(
      (event) =>
        event.type === 'note' &&
        (event.notes ?? []).some((note) => note.midi === 64) &&
        (event.notes ?? []).some((note) => note.midi === 65),
    )
    expect(merged).toBe(false)
  })

  it('8. keeps a grace note beside a chord separate', () => {
    const events = buildVectorEvents(
      [
        head({
          cx: 95,
          cy: 90,
          midi: 71,
          positionInMeasure: 0.22,
          isGrace: true,
        }),
        head({ cx: 100, cy: 110, midi: 60, positionInMeasure: 0.31, stemDirection: 'up' }),
        head({ cx: 101, cy: 90, midi: 64, positionInMeasure: 0.32, stemDirection: 'up' }),
        head({ cx: 180, cy: 100, midi: 67, positionInMeasure: 0.55 }),
        head({ cx: 240, cy: 100, midi: 69, positionInMeasure: 0.7 }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const graceAloneOrSeparate = events.every((event) => {
      if (event.type !== 'note') return true
      const hasGrace = (event.notes ?? []).some((note) => note.isGrace)
      const hasPrincipal = (event.notes ?? []).some((note) => !note.isGrace)
      return !(hasGrace && hasPrincipal)
    })
    expect(graceAloneOrSeparate).toBe(true)
  })

  it('9. rejects ambiguous geometry (dx too wide for adjacent-slot)', () => {
    beginAdjacentSlotDiagnostics()
    const events = buildVectorEvents(
      [
        head({ cx: 100, cy: 120, midi: 60, positionInMeasure: 0.22 }),
        head({ cx: 118, cy: 100, midi: 64, positionInMeasure: 0.31 }),
        head({ cx: 200, cy: 100, midi: 67, positionInMeasure: 0.5 }),
        head({ cx: 260, cy: 100, midi: 69, positionInMeasure: 0.65 }),
        head({ cx: 320, cy: 100, midi: 71, positionInMeasure: 0.8 }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const merged = events.some(
      (event) =>
        event.type === 'note' &&
        (event.notes ?? []).some((note) => note.midi === 60) &&
        (event.notes ?? []).some((note) => note.midi === 64),
    )
    expect(merged).toBe(false)
    const diag = takeAdjacentSlotDiagnostics()
    expect((diag?.rejected ?? 0) + (diag?.accepted ?? 0)).toBeGreaterThan(0)
  })

  it('10. complete chord moves as one event through gap packing and resnap', () => {
    const events = buildVectorEvents(
      [
        head({ cx: 100, cy: 120, midi: 60, positionInMeasure: 0.22, stemDirection: 'up' }),
        head({ cx: 103, cy: 100, midi: 64, positionInMeasure: 0.31, stemDirection: 'up' }),
        head({ cx: 105, cy: 80, midi: 67, positionInMeasure: 0.32, stemDirection: 'up' }),
        head({ cx: 100, cy: 200, midi: 40, clef: 'bass', positionInMeasure: 0.22 }),
        head({ cx: 160, cy: 110, midi: 62, positionInMeasure: 0.45, stemDirection: 'up' }),
        head({ cx: 163, cy: 90, midi: 65, positionInMeasure: 0.46, stemDirection: 'up' }),
        head({ cx: 160, cy: 200, midi: 42, clef: 'bass', positionInMeasure: 0.45 }),
        head({ cx: 220, cy: 110, midi: 64, positionInMeasure: 0.65, stemDirection: 'up' }),
        head({ cx: 221, cy: 90, midi: 67, positionInMeasure: 0.66, stemDirection: 'up' }),
        head({ cx: 220, cy: 200, midi: 43, clef: 'bass', positionInMeasure: 0.65 }),
        head({ cx: 280, cy: 110, midi: 65, positionInMeasure: 0.8, stemDirection: 'up' }),
        head({ cx: 281, cy: 90, midi: 69, positionInMeasure: 0.81, stemDirection: 'up' }),
        head({ cx: 280, cy: 200, midi: 45, clef: 'bass', positionInMeasure: 0.8 }),
      ],
      measureBox,
      { beats: 4, beatType: 4 },
    )
    const trebleChord = events.find(
      (event) =>
        event.type === 'note' &&
        (event.notes?.[0]?.clef ?? 'treble') === 'treble' &&
        [60, 64, 67].every((midi) => (event.notes ?? []).some((note) => note.midi === midi)),
    )
    expect(trebleChord).toBeTruthy()
    const start = trebleChord.startDivision
    const coalesced = coalesceSameOnsetChordEvents(events)
    const afterCoalesce = coalesced.find(
      (event) =>
        event.type === 'note' &&
        [60, 64, 67].every((midi) => (event.notes ?? []).some((note) => note.midi === midi)),
    )
    expect(afterCoalesce?.startDivision).toBe(start)
    const resnapped = resnapDenseChordOnsets(coalesced, 16)
    const afterResnap = resnapped.filter(
      (event) =>
        event.type === 'note' &&
        [60, 64, 67].every((midi) => (event.notes ?? []).some((note) => note.midi === midi)),
    )
    expect(afterResnap).toHaveLength(1)
    expect(new Set(afterResnap.map((event) => event.startDivision)).size).toBe(1)
  })
})

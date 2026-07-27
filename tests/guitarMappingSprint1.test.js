/**
 * Guitar Mapping Sprint 1 — joint chord assignment, continuity, sustain.
 */
import { describe, expect, it } from 'vitest'
import { getInstrument, INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import {
  assignChordPositions,
  candidatePositionsForMidi,
  deriveTabPositions,
  midiForStringFret,
  stringFretForMidi,
} from '../src/features/instruments/fretboard.js'
import {
  evaluateGuitarMapping,
  GUITAR_MAPPING_FAILURE,
} from '../src/features/instruments/guitarMappingQuality.js'

const GUITAR = getInstrument(INSTRUMENT_IDS.GUITAR).strings

function note(midi, timeSeconds, durationSeconds = 0.5, extra = {}) {
  return { midi, timeSeconds, durationSeconds, id: `${midi}@${timeSeconds}`, ...extra }
}

describe('Guitar Mapping Sprint 1', () => {
  it('maps ascending and descending scales with continuity', () => {
    const ascending = [40, 42, 44, 45, 47, 49, 50, 52].map((midi, index) =>
      note(midi, index * 0.5),
    )
    const descending = [...ascending].reverse().map((entry, index) =>
      note(entry.midi, 4 + index * 0.5),
    )
    const derived = deriveTabPositions([...ascending, ...descending], GUITAR)
    expect(derived.every((entry) => entry.string != null)).toBe(true)
    const metrics = evaluateGuitarMapping(derived, GUITAR)
    expect(metrics.sameStringConflicts).toBe(0)
    expect(metrics.invalidAssignments).toBe(0)
    expect(metrics.maxJump).toBeLessThanOrEqual(5)
  })

  it('retains repeated notes on the same string when reasonable', () => {
    const notes = [
      note(64, 0),
      note(64, 0.5),
      note(64, 1.0),
      note(67, 1.5),
      note(64, 2.0),
    ]
    const derived = deriveTabPositions(notes, GUITAR)
    expect(derived[0].string).toBe(derived[1].string)
    expect(derived[1].string).toBe(derived[2].string)
    expect(derived[4].string).toBe(derived[0].string)
  })

  it('assigns distinct strings for two-note double-stops', () => {
    const notes = [note(60, 0), note(64, 0)]
    const derived = deriveTabPositions(notes, GUITAR)
    expect(derived[0].string).not.toBe(derived[1].string)
    for (const entry of derived) {
      expect(midiForStringFret(GUITAR, entry.string, entry.fret)).toBe(entry.midi)
    }
  })

  it('jointly maps three- to six-note chords without same-string conflicts', () => {
    const shapes = [
      [48, 52, 55],
      [48, 52, 55, 60],
      [40, 47, 52, 56, 59, 64],
    ]
    for (const midis of shapes) {
      const notes = midis.map((midi) => note(midi, 0))
      const derived = deriveTabPositions(notes, GUITAR)
      const strings = derived.map((entry) => entry.string)
      expect(strings.every((value) => value != null)).toBe(true)
      expect(new Set(strings).size).toBe(midis.length)
      const spanFrets = derived.map((entry) => entry.fret).filter((fret) => fret > 0)
      if (spanFrets.length >= 2) {
        expect(Math.max(...spanFrets) - Math.min(...spanFrets)).toBeLessThanOrEqual(5)
      }
    }
  })

  it('chooses among multiple valid positions using continuity', () => {
    // Park hand near fret 5, then place E4 — prefer B-string fret 5 over open high E.
    const notes = [
      note(64, 0, 0.4, { string: 2, fret: 5 }),
      note(64, 0.5),
    ]
    const derived = deriveTabPositions(notes, GUITAR)
    expect(derived[1]).toMatchObject({ string: 2, fret: 5, tabDerived: true })
  })

  it('does not assign a new attack onto a string held by a different sustained pitch', () => {
    const notes = [
      note(40, 0, 2.0), // low E sustained
      note(45, 0.5, 0.5), // should not steal string 6 while 40 still holds it
    ]
    const derived = deriveTabPositions(notes, GUITAR)
    expect(derived[0].string).toBe(6)
    expect(derived[1].string).not.toBe(derived[0].string)
    expect(midiForStringFret(GUITAR, derived[1].string, derived[1].fret)).toBe(45)
  })

  it('handles position shifts without invalid assignments', () => {
    const notes = [
      note(48, 0),
      note(50, 0.4),
      note(52, 0.8),
      note(60, 1.2),
      note(64, 1.6),
      note(67, 2.0),
    ]
    const derived = deriveTabPositions(notes, GUITAR)
    const metrics = evaluateGuitarMapping(derived, GUITAR)
    expect(metrics.invalidAssignments).toBe(0)
    expect(metrics.sameStringConflicts).toBe(0)
  })

  it('keeps open-position passages playable', () => {
    const notes = [40, 45, 50, 55, 59, 64].map((midi, index) => note(midi, index * 0.4))
    const derived = deriveTabPositions(notes, GUITAR)
    expect(derived.every((entry) => entry.fret <= 3)).toBe(true)
  })

  it('respects the configured maximum fret', () => {
    const high = note(40 + GUITAR.fretCount, 0) // top of low-E string
    const derived = deriveTabPositions([high], GUITAR)
    expect(derived[0].fret).toBeLessThanOrEqual(GUITAR.fretCount)
    expect(midiForStringFret(GUITAR, derived[0].string, derived[0].fret)).toBe(high.midi)
    expect(stringFretForMidi(GUITAR, 21)).toBeNull()
    expect(stringFretForMidi(GUITAR, 100)).toBeNull()
  })

  it('supports alternate tunings when provided', () => {
    const dropD = {
      ...GUITAR,
      tuning: [64, 59, 55, 50, 45, 38],
    }
    const derived = deriveTabPositions([note(38, 0)], dropD)
    expect(derived[0]).toMatchObject({ string: 6, fret: 0 })
    expect(candidatePositionsForMidi(dropD, 38)).toContainEqual({ string: 6, fret: 0 })
  })

  it('assignChordPositions remains jointly valid for open C', () => {
    const assigned = assignChordPositions(GUITAR, [48, 52, 55, 60, 64])
    const strings = [...assigned.values()].map((position) => position.string)
    expect(new Set(strings).size).toBe(5)
  })

  it('quality evaluator flags same-string conflicts', () => {
    const bad = [
      { midi: 60, timeSeconds: 0, string: 2, fret: 1 },
      { midi: 64, timeSeconds: 0, string: 2, fret: 5 },
    ]
    const metrics = evaluateGuitarMapping(bad, GUITAR)
    expect(metrics.sameStringConflicts).toBeGreaterThan(0)
    expect(metrics.failureCounts[GUITAR_MAPPING_FAILURE.SAME_STRING_CONFLICT]).toBeGreaterThan(0)
  })

  it('never changes midi while deriving frets', () => {
    const notes = [note(55, 0), note(59, 0), note(62, 0)]
    const midis = notes.map((entry) => entry.midi)
    const derived = deriveTabPositions(notes, GUITAR)
    expect(derived.map((entry) => entry.midi)).toEqual(midis)
  })
})

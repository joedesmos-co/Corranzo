/**
 * Instrument core: registry invariants, selection persistence, fretboard math.
 * Piano must be the default everywhere so legacy behavior is unchanged.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_INSTRUMENT_ID,
  INSTRUMENT_IDS,
  STANDARD_GUITAR_TUNING,
  getInstrument,
  isSupportedInstrumentId,
  listInstruments,
  normalizeInstrumentId,
} from '../src/features/instruments/instruments.js'
import {
  loadSelectedInstrumentId,
  saveSelectedInstrumentId,
} from '../src/features/instruments/instrumentStorage.js'
import {
  assignChordPositions,
  candidatePositionsForMidi,
  deriveTabPositions,
  describeTabPosition,
  detectOctaveShiftForPlayability,
  midiForStringFret,
  stringFretForMidi,
} from '../src/features/instruments/fretboard.js'

const GUITAR_STRINGS = getInstrument(INSTRUMENT_IDS.GUITAR).strings

describe('instrument registry', () => {
  it('supports exactly piano and guitar, defaulting to piano', () => {
    expect(listInstruments().map((item) => item.id)).toEqual(['piano', 'guitar'])
    expect(DEFAULT_INSTRUMENT_ID).toBe('piano')
    expect(isSupportedInstrumentId('piano')).toBe(true)
    expect(isSupportedInstrumentId('guitar')).toBe(true)
    expect(isSupportedInstrumentId('violin')).toBe(false)
  })

  it('normalizes unknown, legacy, and missing ids to piano', () => {
    expect(normalizeInstrumentId(undefined)).toBe('piano')
    expect(normalizeInstrumentId(null)).toBe('piano')
    expect(normalizeInstrumentId('harp')).toBe('piano')
    expect(normalizeInstrumentId('guitar')).toBe('guitar')
    expect(getInstrument('nonsense').id).toBe('piano')
  })

  it('piano definition matches today\'s behavior (grand staff, keyboard lane)', () => {
    const piano = getInstrument('piano')
    expect(piano.omr.stavesPerSystem).toBe(2)
    expect(piano.notation.grandStaff).toBe(true)
    expect(piano.notation.supportsTablature).toBe(false)
    expect(piano.visualPractice.kind).toBe('keyboard')
    expect(piano.strings).toBeNull()
  })

  it('guitar definition models six standard-tuned strings', () => {
    const guitar = getInstrument('guitar')
    expect(guitar.strings.count).toBe(6)
    expect(guitar.strings.tuning).toEqual([64, 59, 55, 50, 45, 40])
    expect(guitar.notation.supportsTablature).toBe(true)
    expect(guitar.visualPractice.kind).toBe('fretboard')
  })
})

describe('instrument storage', () => {
  beforeEach(() => {
    const store = new Map()
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    }
  })

  it('defaults to piano when nothing is stored', () => {
    expect(loadSelectedInstrumentId()).toBe('piano')
  })

  it('round-trips a guitar selection', () => {
    expect(saveSelectedInstrumentId('guitar')).toBe(true)
    expect(loadSelectedInstrumentId()).toBe('guitar')
  })

  it('sanitizes corrupt stored values to piano', () => {
    globalThis.localStorage.setItem('corranzo-instrument-v1', 'theremin')
    expect(loadSelectedInstrumentId()).toBe('piano')
  })

  it('degrades gracefully without localStorage', () => {
    delete globalThis.localStorage
    expect(loadSelectedInstrumentId()).toBe('piano')
    expect(saveSelectedInstrumentId('guitar')).toBe(false)
  })
})

describe('fretboard math', () => {
  it('maps open strings and fretted notes to sounding MIDI', () => {
    expect(midiForStringFret(GUITAR_STRINGS, 6, 0)).toBe(40) // low E
    expect(midiForStringFret(GUITAR_STRINGS, 1, 0)).toBe(64) // high E
    expect(midiForStringFret(GUITAR_STRINGS, 5, 3)).toBe(48) // C3 on A string
    expect(midiForStringFret(GUITAR_STRINGS, 2, 1)).toBe(60) // middle C on B string
    expect(midiForStringFret(GUITAR_STRINGS, 6, 99)).toBeNull()
    expect(midiForStringFret(GUITAR_STRINGS, 7, 0)).toBeNull()
  })

  it('enumerates every playable position for a pitch', () => {
    const positions = candidatePositionsForMidi(GUITAR_STRINGS, 64) // E4
    expect(positions).toContainEqual({ string: 1, fret: 0 })
    expect(positions).toContainEqual({ string: 2, fret: 5 })
    expect(positions).toContainEqual({ string: 3, fret: 9 })
    for (const position of positions) {
      expect(midiForStringFret(GUITAR_STRINGS, position.string, position.fret)).toBe(64)
    }
  })

  it('prefers open strings and low frets', () => {
    expect(stringFretForMidi(GUITAR_STRINGS, 64)).toEqual({ string: 1, fret: 0 })
    expect(stringFretForMidi(GUITAR_STRINGS, 40)).toEqual({ string: 6, fret: 0 })
    const c3 = stringFretForMidi(GUITAR_STRINGS, 48)
    expect(c3).toEqual({ string: 5, fret: 3 })
  })

  it('returns null for unplayable pitches', () => {
    expect(stringFretForMidi(GUITAR_STRINGS, 21)).toBeNull() // A0 — below low E
    expect(stringFretForMidi(GUITAR_STRINGS, 100)).toBeNull()
  })

  it('assigns chord notes to distinct strings (open C chord fits)', () => {
    // C major: C3 E3 G3 C4 E4
    const assigned = assignChordPositions(GUITAR_STRINGS, [48, 52, 55, 60, 64])
    const strings = [...assigned.values()].map((position) => position.string)
    expect(new Set(strings).size).toBe(strings.length)
    expect(assigned.size).toBe(5)
    for (const [midi, position] of assigned) {
      expect(midiForStringFret(GUITAR_STRINGS, position.string, position.fret)).toBe(midi)
    }
  })

  it('detects written-octave scores and shifts them into range', () => {
    // Sounding-range melody: no shift.
    expect(detectOctaveShiftForPlayability(GUITAR_STRINGS, [40, 45, 50, 64])).toBe(0)
    // Written an octave up (mostly above the fretboard): shift down.
    expect(detectOctaveShiftForPlayability(GUITAR_STRINGS, [89, 91, 93, 96])).toBe(-12)
  })

  it('derives positions only for notes missing them; explicit tab wins', () => {
    const notes = [
      { midi: 48, timeSeconds: 0 },
      { midi: 64, timeSeconds: 0.5, string: 2, fret: 5 }, // explicit — keep
      { midi: 55, timeSeconds: 1 },
      { isRest: true, midi: null, timeSeconds: 1.5 },
    ]
    const derived = deriveTabPositions(notes, GUITAR_STRINGS)
    expect(derived[0].string).toBe(5)
    expect(derived[0].fret).toBe(3)
    expect(derived[0].tabDerived).toBe(true)
    expect(derived[1]).toMatchObject({ string: 2, fret: 5 })
    expect(derived[1].tabDerived).toBeUndefined()
    expect(derived[2].string).not.toBeNull()
    expect(derived[3].string).toBeUndefined()
    // Input untouched.
    expect(notes[0].string).toBeUndefined()
  })

  it('gives simultaneous chord notes distinct strings', () => {
    const notes = [
      { midi: 48, timeSeconds: 2 },
      { midi: 52, timeSeconds: 2 },
      { midi: 55, timeSeconds: 2 },
      { midi: 60, timeSeconds: 2 },
    ]
    const derived = deriveTabPositions(notes, GUITAR_STRINGS)
    const strings = derived.map((note) => note.string)
    expect(strings.every((value) => value != null)).toBe(true)
    expect(new Set(strings).size).toBe(4)
  })

  it('describes positions in player terms', () => {
    expect(describeTabPosition({ string: 6, fret: 0 }, GUITAR_STRINGS)).toBe('open E string')
    expect(describeTabPosition({ string: 5, fret: 3 }, GUITAR_STRINGS)).toBe(
      'fret 3 · A string',
    )
    expect(describeTabPosition(null, GUITAR_STRINGS)).toBeNull()
  })
})

describe('tuning constant', () => {
  it('standard tuning is EADGBE low-to-high (string 6 → 1)', () => {
    expect([...STANDARD_GUITAR_TUNING].reverse()).toEqual([40, 45, 50, 55, 59, 64])
  })
})

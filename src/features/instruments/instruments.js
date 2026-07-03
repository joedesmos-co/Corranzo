/**
 * Instrument registry — the single place the app learns what an instrument is.
 *
 * Every practice session belongs to an instrument. Consumers read capabilities
 * off the definition (never `if (id === 'piano')` branches) so adding a future
 * instrument means adding a definition here plus a voice module — not touching
 * feature code.
 *
 * Only Piano and Guitar are supported. Piano is the universal default: every
 * legacy code path, stored record, and saved session without an explicit
 * instrument resolves to Piano, which keeps pre-instrument behavior identical.
 */

export const INSTRUMENT_IDS = {
  PIANO: 'piano',
  GUITAR: 'guitar',
}

export const DEFAULT_INSTRUMENT_ID = INSTRUMENT_IDS.PIANO

/**
 * Standard guitar tuning, MusicXML string numbering: string 1 is the highest
 * (treble-most) string. Values are sounding MIDI notes — E4 B3 G3 D3 A2 E2.
 */
export const STANDARD_GUITAR_TUNING = [64, 59, 55, 50, 45, 40]

const DEFINITIONS = {
  [INSTRUMENT_IDS.PIANO]: {
    id: INSTRUMENT_IDS.PIANO,
    label: 'Piano',
    /** Key into the playback voice registry (playback/instrumentVoices.js). */
    voiceId: 'piano',
    midiRange: { min: 21, max: 108 },
    /** Fretted-string geometry; null for keyboard instruments. */
    strings: null,
    notation: {
      /** Clef signs this instrument's scores typically use. */
      clefs: ['treble', 'bass'],
      grandStaff: true,
      supportsTablature: false,
    },
    omr: {
      partName: 'Piano',
      /** Grand staff — two 5-line staves per system. */
      stavesPerSystem: 2,
      supportsTablature: false,
    },
    visualPractice: {
      /** Which lane/strip Visual Practice renders. */
      kind: 'keyboard',
    },
    playback: {
      /** Matches today's piano voice-mix behavior. */
      maxPolyphony: 72,
    },
  },

  [INSTRUMENT_IDS.GUITAR]: {
    id: INSTRUMENT_IDS.GUITAR,
    label: 'Guitar',
    voiceId: 'guitar',
    midiRange: { min: 40, max: 88 }, // E2 .. E6 (19th fret, string 1)
    strings: {
      count: 6,
      tuning: STANDARD_GUITAR_TUNING,
      fretCount: 19,
      /** Derivation prefers hand positions at or below this fret. */
      preferredMaxFret: 12,
    },
    notation: {
      clefs: ['treble'],
      grandStaff: false,
      supportsTablature: true,
      /** Guitar sounds an octave below written treble-clef pitch. */
      writtenOctaveOffset: -1,
    },
    omr: {
      partName: 'Guitar',
      /** Notation-only default; TAB / mixed systems are detected per page. */
      stavesPerSystem: 1,
      supportsTablature: true,
    },
    visualPractice: {
      kind: 'fretboard',
    },
    playback: {
      /** Six strings — six simultaneous voices. */
      maxPolyphony: 6,
    },
  },
}

export const SUPPORTED_INSTRUMENT_IDS = Object.freeze(Object.keys(DEFINITIONS))

export function isSupportedInstrumentId(id) {
  return typeof id === 'string' && Object.hasOwn(DEFINITIONS, id)
}

/** Normalize any stored/legacy value to a supported id (default: piano). */
export function normalizeInstrumentId(id) {
  return isSupportedInstrumentId(id) ? id : DEFAULT_INSTRUMENT_ID
}

/** Resolve an instrument definition; unknown/missing ids resolve to Piano. */
export function getInstrument(id) {
  return DEFINITIONS[normalizeInstrumentId(id)]
}

export function listInstruments() {
  return SUPPORTED_INSTRUMENT_IDS.map((id) => DEFINITIONS[id])
}

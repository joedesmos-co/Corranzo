/** Minimum confidence before emitting a detected musical detail into MusicXML. */
export const OMR_MUSICAL_CONFIDENCE = {
  EMIT: 0.72,
  KEY: 0.7,
  ACCIDENTAL: 0.68,
  TEMPO: 0.7,
  REPEAT: 0.75,
  ENDING: 0.78,
  DYNAMIC: 0.7,
  ARTICULATION: 0.68,
  PEDAL: 0.75,
}

export const OMR_DISCLAIMER =
  'Generated from PDF — may contain mistakes. Upload MusicXML/MXL for best quality.'

/** Sharps in key-signature order (semitone offset from C major scale degree). */
export const SHARP_ORDER_SEMITONES = [5, 0, 7, 2, 9, 4, 11]

/** Flats in key-signature order. */
export const FLAT_ORDER_SEMITONES = [11, 4, 9, 2, 7, 0, 5]

/** Common tempo words → quarter BPM (safe defaults). */
export const TEMPO_WORD_BPM = {
  grave: 45,
  largo: 50,
  lent: 54,
  lento: 54,
  adagio: 68,
  andante: 76,
  moderato: 108,
  allegretto: 112,
  allegro: 120,
  vivace: 144,
  presto: 168,
}

export const OMR_DEFAULT_KEY = { fifths: 0, mode: 'major' }

/** Quarter-note clicks only (default). */
export const METRONOME_SUBDIVISION = {
  QUARTER: 'quarter',
  EIGHTH: 'eighth',
  TRIPLET: 'triplet',
  SIXTEENTH: 'sixteenth',
}

export const METRONOME_SUBDIVISION_OPTIONS = [
  { value: METRONOME_SUBDIVISION.QUARTER, label: 'Quarter notes' },
  { value: METRONOME_SUBDIVISION.EIGHTH, label: 'Eighth notes' },
  { value: METRONOME_SUBDIVISION.TRIPLET, label: 'Triplets' },
  { value: METRONOME_SUBDIVISION.SIXTEENTH, label: 'Sixteenth notes' },
]

/** Count-in length in measures before playback begins. */
export const METRONOME_COUNT_IN = {
  OFF: 0,
  ONE_MEASURE: 1,
  TWO_MEASURES: 2,
}

export const METRONOME_COUNT_IN_OPTIONS = [
  { value: METRONOME_COUNT_IN.OFF, label: 'Off' },
  { value: METRONOME_COUNT_IN.ONE_MEASURE, label: '1 measure' },
  { value: METRONOME_COUNT_IN.TWO_MEASURES, label: '2 measures' },
]

export function subdivisionDivisions(subdivision) {
  switch (subdivision) {
    case METRONOME_SUBDIVISION.EIGHTH:
      return 2
    case METRONOME_SUBDIVISION.TRIPLET:
      return 3
    case METRONOME_SUBDIVISION.SIXTEENTH:
      return 4
    default:
      return 1
  }
}

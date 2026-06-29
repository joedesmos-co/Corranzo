import { OMR_DEFAULT_BEATS } from './omrConstants.js'

/** MusicXML divisions per quarter note for experimental OMR output. */
export const OMR_DIVISIONS_PER_QUARTER = 4

/** Total divisions in a 4/4 measure (divisions=4 → quarter=4, measure=16). */
export const OMR_MEASURE_DIVISIONS = OMR_DEFAULT_BEATS * OMR_DIVISIONS_PER_QUARTER

export const OMR_DURATION_DIVISIONS = {
  whole: 16,
  half: 8,
  quarter: 4,
  eighth: 2,
  sixteenth: 1,
}

export const OMR_RHYTHM_CONFIDENCE = {
  HIGH: 0.75,
  MEDIUM: 0.6,
  LOW: 0.45,
}

/** Max horizontal distance (px) to merge noteheads into one chord. */
export const OMR_CHORD_MERGE_X = 10

/** Minimum measure-level confidence before falling back to even quarters. */
export const OMR_MEASURE_FALLBACK_THRESHOLD = 0.58

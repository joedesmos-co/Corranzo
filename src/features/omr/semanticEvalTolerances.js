/**
 * Documented musical-unit tolerances for the semantic MusicXML evaluator.
 *
 * FROZEN for recognition quality sprints (see docs/OMR_RECOGNITION_QUALITY.md).
 * Prefer quarter-note units (and BPM for tempo) over wall-clock milliseconds.
 * Seconds appear only for performed-playback mode where the timeline is already
 * tempo-mapped.
 */

export const SEMANTIC_EVALUATOR_VERSION = '2.0.0'
export const SEMANTIC_EVAL_SCHEMA_VERSION = 2

/** Minimum coverage of supported truth elements before a class score is "reliable". */
export const SEMANTIC_EVAL_MIN_RELIABLE_COVERAGE = 0.25

/**
 * Default tolerances. All quarter values are absolute differences in quarter notes
 * after MusicXML divisions normalization (duration/divisions).
 */
export const SEMANTIC_EVAL_TOLERANCES = Object.freeze({
  /** Matched onsets may differ by this many quarters. */
  onsetToleranceQuarters: 0.125,
  /** Matched durations may differ by this many quarters. */
  durationToleranceQuarters: 0.125,
  /** Candidate pairing window (hard reject beyond this). */
  matchWindowQuarters: 0.75,
  /** Rest pairing window. */
  restMatchWindowQuarters: 0.5,
  /** Chord members share an onset if within this. */
  chordOnsetToleranceQuarters: 0.08,
  /** Written measure length may differ by this many quarters. */
  measureLengthToleranceQuarters: 0.125,
  /** Tempo map events may differ by this many BPM. */
  tempoToleranceBpm: 2,
  /** Tempo events align if within this many quarters. */
  tempoOnsetToleranceQuarters: 0.5,
  /**
   * Performed-playback only: absolute seconds tolerances after tempo mapping.
   * Prefer comparing written quarters when mode is `written`.
   */
  playbackDurationToleranceSeconds: 0.35,
  measureTimingToleranceSeconds: 0.2,
  /** Floating-point equality for quarter arithmetic. */
  quarterEpsilon: 1e-6,
  /** Alignment: gap penalty for inserting/deleting a measure. */
  alignmentGapPenalty: 2.5,
  /** Alignment: max fingerprint distance still considered a plausible pair. */
  alignmentMaxPairCost: 4.5,
  /** Below this coverage, class score is marked unreliable. */
  minReliableCoverage: SEMANTIC_EVAL_MIN_RELIABLE_COVERAGE,
})

export const SEMANTIC_EVAL_DEFAULTS = Object.freeze({
  ...SEMANTIC_EVAL_TOLERANCES,
  /**
   * `written` — compare written measures / markings (ignores repeat expansion).
   * `performed` — compare performed timeline / sounding duration.
   * `both` — run written note comparison + performed playback section.
   */
  mode: 'both',
  topDefectLimit: 20,
  worstMeasureLimit: 10,
  enharmonicPolicy: 'midi', // compare sounding pitch via MIDI; ignore spelling
})

export function resolveSemanticEvalOptions(options = {}) {
  return { ...SEMANTIC_EVAL_DEFAULTS, ...options }
}

/** Human-readable tolerance documentation for reports. */
export function describeSemanticEvalTolerances(options = SEMANTIC_EVAL_DEFAULTS) {
  return {
    onsetToleranceQuarters: options.onsetToleranceQuarters,
    durationToleranceQuarters: options.durationToleranceQuarters,
    matchWindowQuarters: options.matchWindowQuarters,
    restMatchWindowQuarters: options.restMatchWindowQuarters,
    chordOnsetToleranceQuarters: options.chordOnsetToleranceQuarters,
    measureLengthToleranceQuarters: options.measureLengthToleranceQuarters,
    tempoToleranceBpm: options.tempoToleranceBpm,
    tempoOnsetToleranceQuarters: options.tempoOnsetToleranceQuarters,
    playbackDurationToleranceSeconds: options.playbackDurationToleranceSeconds,
    measureTimingToleranceSeconds: options.measureTimingToleranceSeconds,
    quarterEpsilon: options.quarterEpsilon,
    units:
      'Primary comparison uses normalized quarter-note units (MusicXML duration/divisions). ' +
      'Seconds are used only in performed-playback mode.',
  }
}

export const MIC_CHORD_MODES = {
  ANY_TONE: 'any-tone',
  BASS: 'bass',
  TOP: 'top',
}

export const WFY_MATCH_DEFAULTS = {
  exactPitch: true,
  allowOctaveMistakes: false,
  transpositionEnabled: false,
  transpositionOffset: 0,
  chordWindowMs: 450,
  /** Collect hand-separated notes within this window when matching polyphonic checkpoints (MIDI). */
  musicalEventWindowMs: 180,
  /** Mic collects one pitch at a time — allow longer gaps between chord tones. */
  micChordSequenceWindowMs: 2400,
  micChordMode: MIC_CHORD_MODES.ANY_TONE,
  // Cents tolerance for accepting a microphone pitch as the expected note. A
  // little slack absorbs real-world tuning/intonation. MIDI input is exact and
  // ignores this.
  micCentsTolerance: 30,
}

export const CHORD_WINDOW_MS_MIN = 200
export const CHORD_WINDOW_MS_MAX = 2000
export const MUSICAL_EVENT_WINDOW_MS_MIN = 120
export const MUSICAL_EVENT_WINDOW_MS_MAX = 180
export const MIC_CHORD_SEQUENCE_WINDOW_MS_MIN = 1500
export const MIC_CHORD_SEQUENCE_WINDOW_MS_MAX = 4000
export const TRANSPOSITION_MIN = -24
export const TRANSPOSITION_MAX = 24
export const MIC_CENTS_TOLERANCE_MIN = 15
export const MIC_CENTS_TOLERANCE_MAX = 50

/**
 * Normalize raw settings from UI into values safe for matching.
 */
export function normalizeMatchSettings(settings) {
  const base = { ...WFY_MATCH_DEFAULTS, ...settings }

  let transpositionOffset = Number(base.transpositionOffset) || 0
  if (!base.transpositionEnabled) {
    transpositionOffset = 0
  } else {
    transpositionOffset = Math.min(
      TRANSPOSITION_MAX,
      Math.max(TRANSPOSITION_MIN, transpositionOffset),
    )
  }

  const chordWindowMs = Math.min(
    CHORD_WINDOW_MS_MAX,
    Math.max(CHORD_WINDOW_MS_MIN, Number(base.chordWindowMs) || WFY_MATCH_DEFAULTS.chordWindowMs),
  )

  const musicalEventWindowMs = Math.min(
    MUSICAL_EVENT_WINDOW_MS_MAX,
    Math.max(
      MUSICAL_EVENT_WINDOW_MS_MIN,
      Number(base.musicalEventWindowMs) || WFY_MATCH_DEFAULTS.musicalEventWindowMs,
    ),
  )

  const micChordSequenceWindowMs = Math.min(
    MIC_CHORD_SEQUENCE_WINDOW_MS_MAX,
    Math.max(
      MIC_CHORD_SEQUENCE_WINDOW_MS_MIN,
      Number(base.micChordSequenceWindowMs) || WFY_MATCH_DEFAULTS.micChordSequenceWindowMs,
    ),
  )

  let exactPitch = Boolean(base.exactPitch)
  let allowOctaveMistakes = Boolean(base.allowOctaveMistakes)
  if (!exactPitch && !allowOctaveMistakes) {
    exactPitch = true
  }

  const micChordMode = Object.values(MIC_CHORD_MODES).includes(base.micChordMode)
    ? base.micChordMode
    : MIC_CHORD_MODES.ANY_TONE

  const micCentsTolerance = Math.min(
    MIC_CENTS_TOLERANCE_MAX,
    Math.max(
      MIC_CENTS_TOLERANCE_MIN,
      Number(base.micCentsTolerance) || WFY_MATCH_DEFAULTS.micCentsTolerance,
    ),
  )

  return {
    exactPitch,
    allowOctaveMistakes,
    transpositionEnabled: Boolean(base.transpositionEnabled),
    transpositionOffset,
    chordWindowMs,
    musicalEventWindowMs,
    micChordSequenceWindowMs,
    micChordMode,
    micCentsTolerance,
  }
}

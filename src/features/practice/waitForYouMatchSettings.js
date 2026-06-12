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
  micChordMode: MIC_CHORD_MODES.ANY_TONE,
}

export const CHORD_WINDOW_MS_MIN = 200
export const CHORD_WINDOW_MS_MAX = 2000
export const TRANSPOSITION_MIN = -24
export const TRANSPOSITION_MAX = 24

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

  let exactPitch = Boolean(base.exactPitch)
  let allowOctaveMistakes = Boolean(base.allowOctaveMistakes)
  if (!exactPitch && !allowOctaveMistakes) {
    exactPitch = true
  }

  const micChordMode = Object.values(MIC_CHORD_MODES).includes(base.micChordMode)
    ? base.micChordMode
    : MIC_CHORD_MODES.ANY_TONE

  return {
    exactPitch,
    allowOctaveMistakes,
    transpositionEnabled: Boolean(base.transpositionEnabled),
    transpositionOffset,
    chordWindowMs,
    micChordMode,
  }
}

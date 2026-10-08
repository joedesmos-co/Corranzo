/**
 * Chord-tone accumulator (Stage 4 P2) — EXPERIMENTAL, offline only.
 *
 * Production V3 demands all expected chord tones + musical + confident in
 * the SAME 3 consecutive frames. Measured 2026-10-07 on real piano dense
 * harmony: V2 hears every anchor tone across the clip, but never all four
 * at once — sparse per-frame detection makes simultaneity impossible, so
 * dense chords can never advance no matter how well they are played.
 *
 * This accumulator applies the MIDI rolled-chord semantics to microphone
 * evidence instead: per-tone hits with expiry inside a sliding window,
 * COMPLETE when every expected tone has independent hits. Each hit still
 * requires its own musical, gate-open, confident frame — sparse V2 blips
 * and manufactured phantoms cannot complete it alone.
 *
 * Anti-manufacture properties (pinned by tests):
 * - unexpected tones never contribute and never reset progress;
 * - each tone needs minHits independent frames (default 2);
 * - hits expire after windowMs (default 500);
 * - reset() on checkpoint change (no cross-chord leakage).
 *
 * Pure + testable. NOT wired into the live hook (see Stage-4 report).
 */

export const CHORD_ACCUMULATOR_DEFAULTS = {
  /** Tones must re-prove inside this sliding window. */
  windowMs: 500,
  /** Independent musical+confident frames required per tone. */
  minHits: 2,
  /** Per-tone confidence bar for a hit. */
  minConfidence: 0.3,
}

export function createChordToneAccumulator({ expectedMidis = [], ...options } = {}) {
  const config = { ...CHORD_ACCUMULATOR_DEFAULTS, ...options }
  const expected = [...new Set(expectedMidis)].sort((a, b) => a - b)
  return { config, expected, hits: new Map(expected.map((midi) => [midi, []])) }
}

export function resetChordToneAccumulator(state) {
  if (!state) {
    return
  }
  for (const midi of state.hits.keys()) {
    state.hits.set(midi, [])
  }
}

/**
 * @param {object} state accumulator
 * @param {object} frame { timeMs, tones: [{ midi, confidence }], musical }
 *   tones = expected∩detected with per-tone evidence; musical = frame
 *   passed the musical-acceptance gate with the gate open.
 * @returns {{ completed, matchedMidis, pendingMidis }}
 */
export function pushChordToneFrame(state, { timeMs, tones = [], musical = false } = {}) {
  if (!state || !Number.isFinite(timeMs)) {
    throw new TypeError('pushChordToneFrame requires state and timeMs')
  }
  if (musical) {
    for (const tone of tones ?? []) {
      if (!state.hits.has(tone.midi)) {
        continue
      }
      if ((tone.confidence ?? 0) < state.config.minConfidence) {
        continue
      }
      state.hits.get(tone.midi).push(timeMs)
    }
  }
  const cutoff = timeMs - state.config.windowMs
  const matchedMidis = []
  const pendingMidis = []
  for (const midi of state.expected) {
    const fresh = (state.hits.get(midi) ?? []).filter((hit) => hit >= cutoff)
    state.hits.set(midi, fresh)
    if (fresh.length >= state.config.minHits) {
      matchedMidis.push(midi)
    } else {
      pendingMidis.push(midi)
    }
  }
  return {
    completed: state.expected.length > 0 && pendingMidis.length === 0,
    matchedMidis,
    pendingMidis,
  }
}

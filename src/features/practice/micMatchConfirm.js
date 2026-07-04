/**
 * Confidence gate for advancing Wait For You from live microphone input.
 *
 * The mic preview evaluates a match every analysis frame. A single confident
 * frame is too twitchy to advance on (a real signal wobbles), and waiting for a
 * discrete stabilizer note-on can miss sustained notes entirely. So we advance
 * when the SAME correct match (a COMPLETE outcome) holds for a few consecutive
 * confident frames — clear pitch, gate open. Pure + testable: state in, verdict
 * out, no audio or React here.
 */

/** Clarity a single-note frame needs before it counts toward a confirm. */
export const MIC_MATCH_MIN_CLARITY = 0.5

/** Consecutive confident frames required before committing an advance. */
export const MIC_MATCH_CONFIRM_FRAMES = 3

export function createMatchConfirmState() {
  return { key: '', count: 0 }
}

export function resetMatchConfirmState(state) {
  if (!state) {
    return
  }
  state.key = ''
  state.count = 0
}

/**
 * Feed one frame's verdict for a match `key`. Returns true once the same key has
 * been confirmed `threshold` consecutive confident frames — the caller should
 * then commit the advance and reset the state.
 */
export function confirmConfidentMatch(
  state,
  key,
  confident,
  { threshold = MIC_MATCH_CONFIRM_FRAMES } = {},
) {
  if (!state) {
    return false
  }
  if (confident && key === state.key) {
    state.count += 1
  } else {
    state.key = confident ? key : ''
    state.count = confident ? 1 : 0
  }
  return state.count >= threshold
}

/** A single-note frame is confident when the gate is open and pitch is clear. */
export function frameConfidentForMatch(frame, { minClarity = MIC_MATCH_MIN_CLARITY } = {}) {
  return Boolean(frame?.gateOpen) && (frame?.clarity ?? 0) >= minClarity
}

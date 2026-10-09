import { WFY_STATUS } from './waitForYouEngine.js'
import { WFY_INPUT_OUTCOME } from './waitForYouInputFeedback.js'
import { VISUAL_LANE_OUTCOME } from './visualLaneFeedback.js'

/**
 * Shared score note-state model for Preview / Play Along / Wait For You.
 *
 * The Practice Engine (checkpoints + evaluator) determines musical truth;
 * this module only maps engine state to per-note display states for the
 * score overlay. It never decides advancement.
 *
 * States:
 * - completed: already played checkpoint (subtle green on the score)
 * - current: the required checkpoint right now (clear blue + outline)
 * - current-partial: chord with some tones matched (per-tone split upstream)
 * - wrong: brief error flash on the current checkpoint (red, CSS-timed)
 * - upcoming: default score color (no highlight rendered)
 */

export const SCORE_NOTE_STATE = {
  COMPLETED: 'completed',
  CURRENT: 'current',
  CURRENT_PARTIAL: 'current-partial',
  WRONG: 'wrong',
  /** Past Play Along miss: muted outline, no pulse (nonintrusive). */
  MISSED: 'missed',
  UPCOMING: 'upcoming',
}

/** Cap for the completed trail so huge pieces stay cheap. Most recent first. */
export const COMPLETED_TRAIL_CAP = 100

function toMatchedIndexSet(matchedIndices) {
  if (!matchedIndices) {
    return new Set()
  }
  if (matchedIndices instanceof Set) {
    return new Set(matchedIndices)
  }
  if (Array.isArray(matchedIndices)) {
    return new Set(matchedIndices.filter((index) => Number.isInteger(index)))
  }
  return new Set()
}

/**
 * Resolve the display state for every checkpoint relevant to Wait For You.
 * Only the current checkpoint and the completed trail are returned;
 * upcoming checkpoints intentionally render in the normal score color.
 */
export function resolveWfyScoreNoteStates({
  checkpoints = [],
  checkpointIndex = 0,
  status = WFY_STATUS.WAITING,
  inputFeedback = null,
} = {}) {
  const states = new Map()
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    return states
  }
  if (status !== WFY_STATUS.WAITING) {
    return states
  }

  const clampedIndex = Math.max(0, Math.min(checkpointIndex, checkpoints.length - 1))
  const trailStart = Math.max(0, clampedIndex - COMPLETED_TRAIL_CAP)
  for (let index = trailStart; index < clampedIndex; index += 1) {
    states.set(index, SCORE_NOTE_STATE.COMPLETED)
  }

  const feedbackOutcome = inputFeedback?.outcome ?? WFY_INPUT_OUTCOME.IDLE
  if (feedbackOutcome === WFY_INPUT_OUTCOME.WRONG) {
    states.set(clampedIndex, SCORE_NOTE_STATE.WRONG)
  } else if (
    feedbackOutcome === WFY_INPUT_OUTCOME.CHORD_PARTIAL ||
    feedbackOutcome === WFY_INPUT_OUTCOME.CHORD_WAITING
  ) {
    const matched = toMatchedIndexSet(inputFeedback?.matchedIndices)
    states.set(
      clampedIndex,
      matched.size > 0 ? SCORE_NOTE_STATE.CURRENT_PARTIAL : SCORE_NOTE_STATE.CURRENT,
    )
  } else {
    states.set(clampedIndex, SCORE_NOTE_STATE.CURRENT)
  }

  return states
}

/**
 * Per-tone completion for a chord checkpoint. Returns one entry per entry of
 * checkpoint.expectedMidis: { midi, completed }. Single-note checkpoints
 * return a single entry. Matching is by exact MIDI number (accidentals are
 * already encoded in the MIDI number, so no enharmonic guessing).
 */
export function resolveChordToneStates(checkpoint, matchedIndices) {
  const expected = Array.isArray(checkpoint?.expectedMidis) && checkpoint.expectedMidis.length > 0
    ? [...checkpoint.expectedMidis]
    : checkpoint?.expectedMidi != null
      ? [checkpoint.expectedMidi]
      : []
  if (expected.length === 0) {
    return []
  }
  const matched = toMatchedIndexSet(matchedIndices)
  return expected.map((midi, index) => ({
    midi,
    index,
    completed: matched.has(index),
  }))
}

/**
 * Map a checkpoint note to its expected-tone index (for per-box coloring).
 * Notes sharing a MIDI number map to the same tone. Returns -1 when the
 * note's pitch is not part of the expected chord (should not happen for
 * engine-built checkpoints, but the overlay must never mis-color).
 */
export function expectedToneIndexForMidi(checkpoint, midi) {
  const expected = Array.isArray(checkpoint?.expectedMidis) && checkpoint.expectedMidis.length > 0
    ? checkpoint.expectedMidis
    : checkpoint?.expectedMidi != null
      ? [checkpoint.expectedMidi]
      : []
  const found = expected.indexOf(midi)
  return found >= 0 ? found : -1
}

/**
 * Current score event at a practice time: the last checkpoint with
 * onset at or before time (small epsilon for float boundaries). Used by
 * Preview and Play Along, which follow the timeline instead of waiting.
 */
export function findScoreEventIndexAtTime(checkpoints, timeSeconds, epsilon = 0.005) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    return -1
  }
  const time = Number(timeSeconds)
  if (!Number.isFinite(time)) {
    return -1
  }
  let current = -1
  for (let index = 0; index < checkpoints.length; index += 1) {
    const onset = Number(checkpoints[index]?.timeSeconds)
    if (!Number.isFinite(onset)) {
      continue
    }
    if (onset <= time + epsilon) {
      current = index
    } else {
      break
    }
  }
  return current
}

/**
 * Map a Play Along lane outcome to a score display state. Unknown outcomes
 * degrade to CURRENT (highlight the event, claim nothing about accuracy).
 */
export function mapPlayAlongOutcomeToScoreState(outcome) {
  switch (outcome) {
    case VISUAL_LANE_OUTCOME.CORRECT:
    case VISUAL_LANE_OUTCOME.EARLY:
    case VISUAL_LANE_OUTCOME.LATE:
    case VISUAL_LANE_OUTCOME.SUSTAIN:
    case VISUAL_LANE_OUTCOME.PLAYED:
      return SCORE_NOTE_STATE.COMPLETED
    case VISUAL_LANE_OUTCOME.WRONG:
    case VISUAL_LANE_OUTCOME.MISSED:
      return SCORE_NOTE_STATE.WRONG
    default:
      return SCORE_NOTE_STATE.CURRENT
  }
}

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
import {
  MIC_AC_MAX_TRACKED_HZ,
  MIC_AC_MIN_TRACKED_HZ,
} from '../microphone-input/pitchDetection.js'

/** Clarity a single-note frame needs before it counts toward a confirm. */
export const MIC_MATCH_MIN_CLARITY = 0.5

/** Consecutive confident frames required before committing an advance. */
export const MIC_MATCH_CONFIRM_FRAMES = 3

/**
 * Max pitch drift (cents) between consecutive confirming frames for a
 * single-note match. A played note holds its pitch across the ~50ms confirm
 * window (vibrato at ±18¢ / 5.5Hz moves ≈12¢ per frame pair); talking sweeps
 * whole semitones through the window, so drifting frames restart the count.
 */
export const MIC_MATCH_PITCH_DRIFT_CENTS = 25

export function createMatchConfirmState() {
  return { key: '', count: 0, anchorCents: null }
}

export function resetMatchConfirmState(state) {
  if (!state) {
    return
  }
  state.key = ''
  state.count = 0
  state.anchorCents = null
}

/**
 * Feed one frame's verdict for a match `key`. Returns true once the same key has
 * been confirmed `threshold` consecutive confident frames — the caller should
 * then commit the advance and reset the state.
 *
 * When `pitchCents` is provided (single-note matches), consecutive frames must
 * also hold pitch within `driftLimitCents` of the run's anchor; a drifting
 * (speech-like) pitch restarts the run at the new anchor. Frames without a
 * usable pitch estimate leave the anchor unchanged.
 */
export function confirmConfidentMatch(
  state,
  key,
  confident,
  {
    threshold = MIC_MATCH_CONFIRM_FRAMES,
    pitchCents = null,
    driftLimitCents = MIC_MATCH_PITCH_DRIFT_CENTS,
  } = {},
) {
  if (!state) {
    return false
  }
  if (confident && key === state.key) {
    const drifted =
      pitchCents != null &&
      state.anchorCents != null &&
      Math.abs(pitchCents - state.anchorCents) > driftLimitCents
    if (drifted) {
      state.anchorCents = pitchCents
      state.count = 1
    } else {
      if (state.anchorCents == null && pitchCents != null) {
        state.anchorCents = pitchCents
      }
      state.count += 1
    }
  } else {
    state.key = confident ? key : ''
    state.count = confident ? 1 : 0
    state.anchorCents = confident ? pitchCents : null
  }
  return state.count >= threshold
}

/** A single-note frame is confident when the gate is open and pitch is clear. */
export function frameConfidentForMatch(frame, { minClarity = MIC_MATCH_MIN_CLARITY } = {}) {
  return Boolean(frame?.gateOpen) && (frame?.clarity ?? 0) >= minClarity
}

/** Extra slack over the match tolerance before contradicting the V2 detector. */
export const MIC_PITCH_CORROBORATION_SLACK_CENTS = 15

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

/**
 * Cross-check a single-expected-note V2 match against the independent
 * autocorrelation pitch estimate (`frame.midiFloat`).
 *
 * The score-informed detector only probes the EXPECTED note's harmonics, so a
 * neighboring played pitch (a semitone off, or a quarter-tone detune) leaks
 * energy into the probe and can read as "expected note present". The
 * autocorrelation tracker follows the true played pitch, so when it clearly
 * disagrees with the expected note — beyond match tolerance plus slack — the
 * frame must not confirm an advance. Octave-invariant: autocorrelation octave
 * flips are plausible on harmonic-rich tones and never count as contradiction.
 *
 * Only applies inside the tracker's resolvable band: when the expected
 * fundamental or the estimate itself falls outside [minTrackedHz, maxTrackedHz]
 * the autocorrelation value is boundary-pinned garbage (deep piano bass pins
 * at the short-period search bound), so it is not evidence either way.
 */
export function frameCorroboratesSingleNote(
  frame,
  expectedMidi,
  {
    centsTolerance = 35,
    slackCents = MIC_PITCH_CORROBORATION_SLACK_CENTS,
    minTrackedHz = MIC_AC_MIN_TRACKED_HZ,
    maxTrackedHz = MIC_AC_MAX_TRACKED_HZ,
  } = {},
) {
  const midiFloat = frame?.midiFloat
  if (midiFloat == null || !Number.isFinite(midiFloat) || expectedMidi == null) {
    return true
  }
  const expectedFrequency = midiToFrequency(expectedMidi)
  if (expectedFrequency < minTrackedHz || expectedFrequency > maxTrackedHz) {
    return true
  }
  const estimateFrequency = midiToFrequency(midiFloat)
  if (estimateFrequency < minTrackedHz || estimateFrequency > maxTrackedHz) {
    return true
  }
  const wrapped = (((midiFloat - expectedMidi) % 12) + 12) % 12
  const distanceCents = Math.min(wrapped, 12 - wrapped) * 100
  return distanceCents <= centsTolerance + slackCents
}

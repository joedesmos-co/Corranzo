/**
 * Turn a noisy stream of per-frame pitch estimates into reliable note-ons.
 *
 * Reliability rules:
 *  - skip the attack transient at note onset (pitch is unstable then),
 *  - require a stable pitch held for a few frames above a confidence floor,
 *  - suppress octave-jump glitches (a transient ±12 jump shouldn't reset or
 *    re-trigger the note),
 *  - require a short silence gap before the same note can fire again
 *    (sustain / reverb should not re-trigger).
 */
export function createNoteStabilizer({
  holdFrames = 6,
  semitoneTolerance = 1,
  minClarity = 0.42,
  minSilenceFrames = 12,
  minSameNoteGapMs = 200,
  minRms = 0.01,
  attackFrames = 2,
  octaveReject = true,
} = {}) {
  return {
    holdFrames,
    semitoneTolerance,
    minClarity,
    minSilenceFrames,
    minSameNoteGapMs,
    minRms,
    attackFrames,
    octaveReject,
    candidateMidi: null,
    stableCount: 0,
    silenceFrames: 0,
    onsetFrames: 0,
    octaveGlitch: 0,
    armed: true,
    lastEmitAt: 0,
    lastEmitMidi: null,
  }
}

function isSamePitch(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance
}

export function pushStableNote(
  state,
  { midi, clarity, rms = 0, now = Date.now() },
) {
  const belowThreshold =
    midi == null || clarity < state.minClarity || rms < state.minRms

  if (belowThreshold) {
    state.silenceFrames += 1
    state.onsetFrames = 0
    state.octaveGlitch = 0
    if (state.silenceFrames >= state.minSilenceFrames) {
      state.candidateMidi = null
      state.stableCount = 0
      state.armed = true
    }
    return null
  }

  state.silenceFrames = 0
  state.onsetFrames += 1

  // Ignore the attack transient right after a note onset — pitch estimates are
  // unstable during the initial hammer/pluck and produce false notes.
  if (state.onsetFrames <= state.attackFrames) {
    return null
  }

  if (!state.armed) {
    state.candidateMidi = midi
    state.stableCount = 0
    return null
  }

  if (
    state.lastEmitMidi != null &&
    midi === state.lastEmitMidi &&
    now - state.lastEmitAt < state.minSameNoteGapMs
  ) {
    return null
  }

  // Octave-jump suppression: a single-frame ±12 jump from a building candidate
  // is almost always a harmonic/octave estimation error. Ignore it unless the
  // octave persists (≥2 frames), in which case switch the candidate.
  if (
    state.octaveReject &&
    state.candidateMidi != null &&
    Math.abs(midi - state.candidateMidi) === 12
  ) {
    state.octaveGlitch += 1
    if (state.octaveGlitch < 2) {
      return null
    }
    state.candidateMidi = midi
    state.stableCount = 1
    state.octaveGlitch = 0
    return null
  }
  state.octaveGlitch = 0

  if (
    state.candidateMidi == null ||
    !isSamePitch(state.candidateMidi, midi, state.semitoneTolerance)
  ) {
    state.candidateMidi = midi
    state.stableCount = 1
    return null
  }

  state.stableCount += 1
  if (state.stableCount < state.holdFrames) {
    return null
  }

  state.candidateMidi = null
  state.stableCount = 0
  state.armed = false
  state.lastEmitAt = now
  state.lastEmitMidi = midi
  return midi
}

export function resetNoteStabilizer(state) {
  if (!state) {
    return
  }
  state.candidateMidi = null
  state.stableCount = 0
  state.silenceFrames = 0
  state.onsetFrames = 0
  state.octaveGlitch = 0
  state.armed = true
  state.lastEmitMidi = null
}

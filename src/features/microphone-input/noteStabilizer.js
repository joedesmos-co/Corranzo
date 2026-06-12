/**
 * Require stable pitch + a short silence gap between note-ons (reduces sustain/reverb re-triggers).
 */
export function createNoteStabilizer({
  holdFrames = 6,
  semitoneTolerance = 1,
  minClarity = 0.42,
  minSilenceFrames = 12,
  minSameNoteGapMs = 200,
  minRms = 0.01,
} = {}) {
  return {
    holdFrames,
    semitoneTolerance,
    minClarity,
    minSilenceFrames,
    minSameNoteGapMs,
    minRms,
    candidateMidi: null,
    stableCount: 0,
    silenceFrames: 0,
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
    if (state.silenceFrames >= state.minSilenceFrames) {
      state.candidateMidi = null
      state.stableCount = 0
      state.armed = true
    }
    return null
  }

  state.silenceFrames = 0

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
  state.armed = true
  state.lastEmitMidi = null
}

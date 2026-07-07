/**
 * Wait For You mic attack/release gating.
 *
 * After one checkpoint advance the latch arms: a sustained or ringing note must
 * not consume future checkpoints. The latch rearms on full release (gate closes
 * for a few frames) OR on clear evidence of a NEW attack while the previous
 * note still rings:
 *   1. an energy rise above the ringing note's decaying envelope, or
 *   2. a different expected note detected AND dominant on the independent
 *      pitch tracker.
 * Same-note repeats never rearm on pitch evidence alone — they need the energy
 * rise or a real release, so one sustained note cannot consume repeated
 * checkpoints.
 */

export const MIC_ATTACK_RELEASE_FRAMES = 4

/** A new attack must exceed the ringing note's decayed envelope by this ratio. */
export const MIC_ATTACK_REARM_RISE_RATIO = 1.6

/**
 * Absolute cents distance for "the new expected note now dominates the pitch
 * tracker". Deliberately not octave-invariant: a ringing note's harmonics must
 * not rearm an octave-related next checkpoint.
 */
export const MIC_ATTACK_REARM_DOMINANCE_CENTS = 75
export const MIC_ATTACK_REARM_SCORE_CONFIDENCE = 0.48
export const MIC_ATTACK_REARM_SCORE_RATIO = 2.2
export const MIC_ATTACK_REARM_SMALL_RISE_RATIO = 1.08

export function createMicAttackLatchState() {
  return {
    awaitingRelease: false,
    gateClosedFrames: 0,
    consumedMidis: [],
    envelopeRms: null,
  }
}

export function resetMicAttackLatch(state) {
  if (!state) {
    return
  }
  state.awaitingRelease = false
  state.gateClosedFrames = 0
  state.consumedMidis = []
  state.envelopeRms = null
}

export function updateMicAttackRelease(
  state,
  gateOpen,
  { releaseFrames = MIC_ATTACK_RELEASE_FRAMES, rms = null } = {},
) {
  if (!state) {
    return
  }
  if (gateOpen) {
    state.gateClosedFrames = 0
    // Track the ringing note's decaying envelope (running minimum since the
    // consume). A later frame that jumps back above this floor is a new attack.
    if (state.awaitingRelease && rms != null && Number.isFinite(rms)) {
      state.envelopeRms = state.envelopeRms == null ? rms : Math.min(state.envelopeRms, rms)
    }
    return
  }
  state.gateClosedFrames += 1
  if (state.awaitingRelease && state.gateClosedFrames >= releaseFrames) {
    resetMicAttackLatch(state)
  }
}

export function canAcceptMicAttackMatch(state) {
  return Boolean(state && !state.awaitingRelease)
}

export function markMicAttackConsumed(state, { consumedMidis = [] } = {}) {
  if (!state) {
    return
  }
  state.awaitingRelease = true
  state.gateClosedFrames = 0
  state.consumedMidis = consumedMidis.filter((midi) => Number.isFinite(midi))
  state.envelopeRms = null
}

function absCentsToNearest(midiFloat, midis) {
  let best = Infinity
  for (const midi of midis) {
    best = Math.min(best, Math.abs(midiFloat - midi) * 100)
  }
  return best
}

function pitchClass(midi) {
  return ((midi % 12) + 12) % 12
}

function octaveRelatedToAny(midi, midis = []) {
  return midis.some((other) => pitchClass(other) === pitchClass(midi))
}

function bestExpectedNoteEvidence(frame, expectedMidis = []) {
  let best = null
  for (const note of frame?.v2Notes ?? []) {
    if (!expectedMidis.includes(note?.midi)) {
      continue
    }
    if (!note?.detected) {
      continue
    }
    if (!best || (note.confidence ?? 0) > (best.confidence ?? 0)) {
      best = note
    }
  }
  return best
}

/**
 * Return the evidence type that should rearm the latch while the previous note
 * still rings (gate never closed). Rearming only unlocks matching — the musical
 * acceptance, confidence confirm, and corroboration gates still stand between
 * the frame and an advance, so speech/noise cannot exploit this path.
 */
export function getMicAttackRearmReason(
  state,
  frame,
  {
    expectedMidis = [],
    riseRatio = MIC_ATTACK_REARM_RISE_RATIO,
    smallRiseRatio = MIC_ATTACK_REARM_SMALL_RISE_RATIO,
    dominanceCents = MIC_ATTACK_REARM_DOMINANCE_CENTS,
    scoreConfidence = MIC_ATTACK_REARM_SCORE_CONFIDENCE,
    scoreRatio = MIC_ATTACK_REARM_SCORE_RATIO,
  } = {},
) {
  if (!state?.awaitingRelease || !frame?.gateOpen) {
    return null
  }

  // 1. Energy rise: any real new attack (same or different note) jumps above
  // the previous note's decayed envelope.
  const rms = frame.filteredRms ?? frame.rms ?? null
  if (
    rms != null &&
    Number.isFinite(rms) &&
    state.envelopeRms != null &&
    state.envelopeRms > 0 &&
    rms >= state.envelopeRms * riseRatio
  ) {
    return 'energy-rise'
  }

  // 2. Different-note dominance: the next checkpoint expects a note the
  // previous advance did not consume, the detector hears it, and the
  // independent pitch tracker sits on it (the ringing note lost dominance).
  // Same-note repeats never take this path — they need the energy rise or a
  // full release above.
  const consumed = new Set(state.consumedMidis ?? [])
  const newExpected = expectedMidis.filter((midi) => !consumed.has(midi))
  if (!newExpected.length) {
    return null
  }
  const detectsNewExpected = (frame.v2DetectedMidis ?? []).some((midi) =>
    newExpected.includes(midi),
  )
  if (!detectsNewExpected) {
    return null
  }
  const midiFloat = frame.midiFloat ?? frame.midi
  if (midiFloat != null && Number.isFinite(midiFloat)) {
    if (absCentsToNearest(midiFloat, newExpected) <= dominanceCents) {
      return 'different-note-dominance'
    }
  }

  // 3. Score-informed transition: real instruments can leave the independent
  // pitch tracker pinned to the old ringing note while V2 already sees the new
  // target. Accept only strong expected-note evidence plus a small decay-relative
  // energy lift, and never for octave-related targets where a ringing harmonic
  // can masquerade as the next note.
  const consumedMidis = [...consumed]
  const nonOctaveNewExpected = newExpected.filter(
    (midi) => !octaveRelatedToAny(midi, consumedMidis),
  )
  const noteEvidence = bestExpectedNoteEvidence(frame, nonOctaveNewExpected)
  const smallRise =
    rms != null &&
    Number.isFinite(rms) &&
    state.envelopeRms != null &&
    state.envelopeRms > 0 &&
    rms >= state.envelopeRms * smallRiseRatio
  if (
    noteEvidence &&
    smallRise &&
    (noteEvidence.confidence ?? 0) >= scoreConfidence &&
    (noteEvidence.ratio ?? 0) >= scoreRatio
  ) {
    return 'score-informed-transition'
  }

  return null
}

/**
 * True when a NEW attack should rearm the latch while the previous note still
 * rings (gate never closed).
 */
export function shouldRearmMicAttack(state, frame, options = {}) {
  return Boolean(getMicAttackRearmReason(state, frame, options))
}

export function rearmMicAttackLatch(state) {
  resetMicAttackLatch(state)
}

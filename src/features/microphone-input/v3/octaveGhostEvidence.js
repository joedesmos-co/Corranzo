/**
 * Octave-ghost evidence from the played note's ODD partial.
 *
 * Physical basis: when the note one octave BELOW an expectation is
 * sounding, the expectation's fundamental band is that note's 2nd
 * partial. The lower note's 3rd partial sits at exactly 1.5x the
 * expectation's fundamental — a HALF-INTEGER ratio that a genuinely
 * struck note never produces (real partials are integer multiples).
 * The detection layer (v2 scoreInformedChordScorer) measures that band
 * as `halfPartialRatio` on each scored note; this module is the
 * expectation-layer decision, so a future recogniser can supply the same
 * evidence and reuse the rule.
 *
 * This is NOT a re-run of a rejected energy heuristic: rejected
 * approaches compared the expectation's own band with its parent's even
 * partials (which are shared by a real octave), or used flux/span/
 * persistence. The 1.5f band is a frequency a real upper octave does not
 * occupy. Measured on real acoustic guitar: ghosts 0.13-0.22, true notes
 * 0.02-0.08.
 *
 * Trade (documented): a chord or single-note expectation an octave above
 * a note that is ALSO sounding is acoustically ambiguous — the player may have
 * struck both. The rule refuses to advance in that case (it cannot prove
 * the upper note), which is the safe direction: a missed note is
 * recoverable, a false advancement is not.
 */

/**
 * @param {object} frame mic frame (v2Notes carry halfPartialRatio)
 * @param {number[]} expectedMidis expected pitches for this checkpoint
 * @param {object} options { octaveGhostHalfPartialRatio }
 * @returns {number|null} the played pitch to report as unexpected, or null
 */
export function octaveGhostFromHalfPartial(frame, expectedMidis = [], options = {}) {
  // SINGLE-note expectations only. In chords the 1.5f band is lit by real
  // chord members (a fifth above: C4's 1.5f IS G4) and by spectral leakage
  // between strong partials, and the dominant can itself be an octave
  // flip — measured on real triads, so the test is not reliable there.
  // Chord octave expectations remain a documented limitation.
  if (!Array.isArray(expectedMidis) || expectedMidis.length !== 1) {
    return null
  }
  const expected = new Set(expectedMidis)
  const threshold = Number.isFinite(options.octaveGhostHalfPartialRatio)
    ? options.octaveGhostHalfPartialRatio
    : 0.1
  const weakConfidence = Number.isFinite(options.octaveGhostMinExpectedConfidence)
    ? options.octaveGhostMinExpectedConfidence
    : 0.5
  const dominant = dominantPitch(frame)
  const roundedDominant = dominant == null ? null : Math.round(dominant)
  const blindHeard = new Set([
    ...(frame?.unexpectedMidis ?? []),
    ...(frame?.blindDetectedMidis ?? []),
    ...(frame?.ringingMidis ?? []),
  ])

  for (const expectedMidi of expectedMidis) {
    const lower = expectedMidi - 12
    // A REAL octave chord: the lower octave is itself expected, so its
    // 3rd partial is expected too. Never veto that.
    if (expected.has(lower)) {
      continue
    }
    const note = (frame?.v2Notes ?? []).find((entry) => entry.midi === expectedMidi)
    const ratio = Number.isFinite(note?.halfPartialRatio) ? note.halfPartialRatio : null
    if (ratio == null || ratio < threshold) {
      continue
    }
    const fundamental = Number.isFinite(note?.fundamentalEnergy) ? note.fundamentalEnergy : null
    // A vanishing fundamental makes the ratio noise-dominated; never veto on it.
    if (fundamental != null && fundamental < 1e-5) {
      continue
    }
    // Independent evidence that the LOWER octave is the sounding note:
    // it is the frame's dominant pitch, it was heard blindly / unexpectedly,
    // or the expected (upper) tone's own confidence is ghost-level. A real
    // chord tone keeps a high confidence even when its 1.5f band is lit by
    // another chord member (e.g. E4 over a B4 fifth).
    const lowerIsDominant = roundedDominant === lower
    const lowerHeard = blindHeard.has(lower)
    // Weak-confidence evidence applies to SINGLE-note expectations only:
    // chord tones legitimately share energy (measured 0.42-0.52 in a real
    // triad), and a fifth above a chord tone lights its 1.5f band (C4's
    // 1.5f IS G4), so confidence must not veto inside a chord. For a
    // chord, the lower octave must actually be the dominant/blind-heard.
    const ghostLevelConfidence = expectedMidis.length === 1 && Number.isFinite(note?.confidence)
      ? note.confidence < weakConfidence
      : false
    if (lowerIsDominant || lowerHeard || ghostLevelConfidence) {
      return lower
    }
  }
  return null
}

/**
 * Dominant-disagreement guard for a SINGLE expected note.
 *
 * A harmonic (or spectral leak) can satisfy the score-informed evidence
 * for an expectation that the player is not actually producing, while
 * the engine's confidence for that expectation stays low. Measured on
 * six real clips: ghost/leak confidence 0.28-0.46, genuinely struck
 * notes 0.57-0.91. Octave-away dominants are normally treated as safe
 * (the monophonic estimator can flip octaves); a genuine flip keeps the
 * expected note's confidence high, so only the low-confidence case is
 * refused.
 *
 * @returns {number|null} the played pitch to report as unexpected
 */
export function dominantDisagreement(frame, expectedMidis = [], options = {}) {
  if (!Array.isArray(expectedMidis) || expectedMidis.length !== 1) {
    return null
  }
  const expectedMidi = expectedMidis[0]
  const threshold = Number.isFinite(options.octaveGhostMinExpectedConfidence)
    ? options.octaveGhostMinExpectedConfidence
    : 0.5
  const octaveSafeCents = Number.isFinite(options.octaveSafeWrongToneCents)
    ? options.octaveSafeWrongToneCents
    : 55
  const dominant = dominantPitch(frame)
  if (dominant == null) {
    return null
  }
  const cents = pitchClassCents(dominant, expectedMidi)
  const octaveApart = Math.abs(Math.round(dominant) - expectedMidi) >= 12
  const materiallyDifferent = octaveApart || cents > octaveSafeCents
  if (!materiallyDifferent) {
    return null
  }
  const note = (frame?.v2Notes ?? []).find((entry) => entry.midi === expectedMidi)
  const confidence = Number.isFinite(note?.confidence) ? note.confidence : null
  if (confidence == null || confidence >= threshold) {
    return null
  }
  return Math.round(dominant)
}

function pitchClassCents(midiFloat, midi) {
  const delta = (((midiFloat - midi) % 12) + 12) % 12
  return Math.min(delta, 12 - delta) * 100
}

function dominantPitch(frame) {
  const value = frame?.spectral?.dominantMidi
    ?? frame?.dominantPitchMidiFloat
    ?? frame?.dominantPitchMidi
    ?? frame?.midiFloat
    ?? frame?.midi
  return Number.isFinite(value) ? value : null
}

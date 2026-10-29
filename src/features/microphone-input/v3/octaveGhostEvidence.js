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
    // Physical precondition: the lower octave must actually be the
    // sounding note (the frame's dominant pitch) or be independently heard.
    // Confidence is NOT used: real low piano/electric notes measure 0.28-0.48
    // with a lit 1.5f band (measured on piano-schubert-single and
    // electric-gtechs-low), and vetoing them was a false rejection.
    if (lowerIsDominant || lowerHeard) {
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

/**
 * Semitone-leak refusal using time-frequency RESOLUTION evidence.
 *
 * A played note's energy leaks into the semitone above/below in a short
 * analysis window; a longer window narrows the main lobe. The detection
 * layer measures the expected pitch and the played (monophonic) pitch in
 * the same long window (frame.resolutionEvidence); when the played pitch
 * is a semitone away and either
 *   - the expected pitch falls below the detection ratio at resolution, or
 *   - the played pitch is materially stronger (>= factor x),
 * the expectation is spectral leakage, not a played note.
 *
 * True notes are untouched: the evidence exists only when the monophonic
 * pitch is a semitone from the expectation, and a real note's own ratio
 * stays high (measured: 3.0-5.8 vs neighbours 1.2-2.4 on real guitar).
 *
 * @returns {number|null} the played pitch to report as unexpected
 */
export function semitoneLeakFromResolution(frame, expectedMidis = [], options = {}) {
  if (!Array.isArray(expectedMidis) || expectedMidis.length !== 1) {
    return null
  }
  const evidence = frame?.resolutionEvidence
  if (!evidence || !Number.isFinite(evidence.expectedRatio)) {
    return null
  }
  if (evidence.expectedMidi !== expectedMidis[0]) {
    return null
  }
  // A leak veto is only valid when the independent monophonic tracker is on
  // the semitone neighbour (or elsewhere), not on the expected pitch itself.
  // Measured: GuitarSet jazz F3 is detected at confidence 0.9 with dominant
  // exactly 53, but an 8192-window decay frame flags neighbour 54; the veto
  // invalidated the real note. Agreeing dominant means decay, not leakage.
  const dominant = dominantPitch(frame)
  if (dominant != null && Math.round(dominant) === expectedMidis[0]) {
    return null
  }
  const floor = Number.isFinite(options.resolutionLeakFloor) ? options.resolutionLeakFloor : 1.35
  const factor = Number.isFinite(options.resolutionLeakFactor) ? options.resolutionLeakFactor : 1.8
  // The expectation must be UNSUPPORTED at resolution (below the detector
  // floor) AND a semitone neighbour must be materially stronger. A real
  // note keeps a high ratio; the played note's leakage does not.
  if (evidence.expectedRatio >= floor) {
    return null
  }
  const neighbors = Array.isArray(evidence.neighbors) ? evidence.neighbors : []
  const strongest = neighbors.reduce(
    (best, entry) => (Number.isFinite(entry.ratio) && entry.ratio > (best?.ratio ?? 0) ? entry : best),
    null,
  )
  if (!strongest || Math.abs(strongest.midi - evidence.expectedMidi) !== 1) {
    return null
  }
  if (strongest.ratio < evidence.expectedRatio * factor) {
    return null
  }
  return strongest.midi
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

import {
  ATTACK_PHASE,
  RECOGNITION_OUTCOME,
  RECOGNITION_TIMING,
  createAttack,
  createChordCandidate,
  createConfidenceBreakdown,
  createMicFrame,
  createPitchCandidate,
  createRecognitionDecision,
  createRecognitionId,
  createRecognitionWindow,
} from './micRecognitionIr.js'

export const PIANO_RECOGNITION_DEFAULTS = Object.freeze({
  rollingWindowMs: 720,
  sustainWindowMs: 1600,
  dominantWrongToneMinClarity: 0.5,
  octaveSafeWrongToneCents: 55,
})

function finite(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp01(value) {
  return Math.min(1, Math.max(0, finite(value, 0)))
}

function uniqueMidis(values = []) {
  return [...new Set((values ?? []).map(Number).filter(Number.isFinite))]
}

function checkpointId(expectation) {
  return expectation?.id ?? expectation?.sourceCheckpointId ?? null
}

function expectedMidis(expectation) {
  return uniqueMidis(expectation?.event?.expectedMidis ?? [])
}

export function createPianoRecognitionState(checkpoint = null) {
  return {
    schemaVersion: 3,
    checkpointId: checkpointId(checkpoint),
    windowStartMs: null,
    attemptStartMs: null,
    activeAttackId: null,
    matchedNotes: [],
    ringingMidis: [],
    sustainPedalDown: false,
    attemptInvalid: false,
    consumed: false,
    decisionCount: 0,
  }
}

function cloneState(state, expectation) {
  if (!state || state.checkpointId !== checkpointId(expectation)) {
    return createPianoRecognitionState(expectation)
  }
  return {
    ...state,
    matchedNotes: (state.matchedNotes ?? []).map((note) => ({ ...note })),
    ringingMidis: [...(state.ringingMidis ?? [])],
  }
}

function rawEvidence(frame = {}) {
  if (Array.isArray(frame.pitchCandidates)) {
    return frame.pitchCandidates.map((candidate) => ({
      midi: candidate.midi,
      detected: Boolean(candidate.detected),
      confidence: candidate.confidence?.overall ?? 0,
      ratio: candidate.harmonicEvidence?.ratio ?? null,
      fundamentalEnergy: candidate.harmonicEvidence?.fundamentalEnergy ?? null,
      harmonicSupport: candidate.harmonicEvidence?.support ?? null,
      companionRelief: Boolean(candidate.debug?.pianoCompanionRelief),
      source: candidate.source ?? 'recognition-ir',
      evidenceRef: candidate.id ?? null,
    }))
  }
  return (frame.v2Notes ?? []).map((note) => ({
    midi: note.midi,
    detected: Boolean(note.detected),
    confidence: note.confidence ?? 0,
    ratio: note.ratio ?? null,
    fundamentalEnergy: note.fundamentalEnergy ?? null,
    harmonicSupport: note.harmonicSupport ?? null,
    companionRelief: Boolean(note.pianoCompanionRelief),
    source: 'v2-score-informed',
    evidenceRef: null,
  }))
}

function frameMusical(frame, explicit) {
  if (explicit != null) return Boolean(explicit)
  if (frame?.signal?.musical != null) return Boolean(frame.signal.musical)
  if (frame?.musical != null) return Boolean(frame.musical)
  return false
}

function frameGateOpen(frame) {
  return Boolean(frame?.signal?.gateOpen ?? frame?.gateOpen)
}

function ringingMidis(frame) {
  return uniqueMidis(frame?.ringingMidis ?? frame?.signal?.ringingMidis ?? [])
}

function centsToNearestPitchClass(midiFloat, midis) {
  let nearest = Infinity
  for (const midi of midis) {
    const delta = (((midiFloat - midi) % 12) + 12) % 12
    nearest = Math.min(nearest, Math.min(delta, 12 - delta) * 100)
  }
  return nearest
}

function unexpectedMidis(frame, expected, options) {
  const unexpected = uniqueMidis([
    ...(frame?.unexpectedMidis ?? []),
    ...(frame?.blindDetectedMidis ?? []),
  ]).filter((midi) => !expected.includes(midi))
  const dominant = finite(
    frame?.spectral?.dominantMidi ?? frame?.dominantPitchMidiFloat ?? frame?.midiFloat,
  )
  const clarity = finite(frame?.spectral?.clarity ?? frame?.clarity, 0)
  if (
    dominant != null &&
    clarity >= options.dominantWrongToneMinClarity &&
    centsToNearestPitchClass(dominant, expected) > options.octaveSafeWrongToneCents
  ) {
    unexpected.push(Math.round(dominant))
  }
  return uniqueMidis(unexpected)
}

function normalizeAttack(attack, frame, expectation, timeMs) {
  const fresh = Boolean(attack?.fresh ?? frame?.freshAttack)
  return {
    id: attack?.id ?? (fresh
      ? createRecognitionId('piano-attack', checkpointId(expectation), timeMs)
      : null),
    fresh,
    confidence: clamp01(attack?.confidence ?? (fresh ? 1 : 0)),
    kind: attack?.kind ?? frame?.attackKind ?? null,
  }
}

function recognitionWindowMs(expectation, state, options) {
  const rollMs = finite(expectation?.timing?.rollToleranceMs, 0)
  const sustainMs = state.sustainPedalDown || expectation?.sustain?.expected
    ? options.sustainWindowMs
    : 0
  return Math.max(1, rollMs, sustainMs, options.rollingWindowMs)
}

function pruneState(state, now, windowMs) {
  state.matchedNotes = state.matchedNotes.filter((note) => now - note.lastSeenMs <= windowMs)
  if (!state.matchedNotes.length && state.attemptStartMs != null && now - state.attemptStartMs > windowMs) {
    state.windowStartMs = now
    state.attemptStartMs = null
    state.activeAttackId = null
    state.attemptInvalid = false
  }
}

function addEvidence(state, evidence, now, attackId, sustained) {
  const existing = state.matchedNotes.find((note) => note.midi === evidence.midi)
  if (existing) {
    existing.lastSeenMs = now
    existing.maxConfidence = Math.max(existing.maxConfidence, clamp01(evidence.confidence))
    existing.sustained = existing.sustained || sustained
    return
  }
  state.matchedNotes.push({
    midi: evidence.midi,
    firstSeenMs: now,
    lastSeenMs: now,
    maxConfidence: clamp01(evidence.confidence),
    attackId,
    sustained,
  })
}

function matchedMidis(state) {
  return uniqueMidis(state.matchedNotes.map((note) => note.midi))
}

function confidenceFor({ expectation, state, attack, musical, gateOpen }) {
  const expected = expectedMidis(expectation)
  const matched = matchedMidis(state)
  const pitch = state.matchedNotes.length
    ? state.matchedNotes.reduce((sum, note) => sum + note.maxConfidence, 0) / state.matchedNotes.length
    : 0
  const completion = expected.length ? matched.length / expected.length : 0
  const attackConfidence = attack.fresh
    ? attack.confidence
    : state.activeAttackId || expectation?.event?.kind === 'tied-hold' ? 0.65 : 0
  return createConfidenceBreakdown({
    overall: clamp01(
      pitch * 0.35 + completion * 0.3 + (musical && gateOpen ? 0.15 : 0) +
      attackConfidence * 0.12 + (state.sustainPedalDown ? 0.08 : 0),
    ),
    signal: musical && gateOpen ? 1 : 0,
    pitch,
    harmony: completion,
    temporal: state.attemptStartMs == null ? 0 : 1,
    attack: attackConfidence,
    expectation: completion,
    instrument: 1,
    rejection: state.attemptInvalid ? 0 : 1,
    reasons: [
      `${matched.length}/${expected.length} piano tones`,
      state.sustainPedalDown ? 'sustain pedal active' : 'sustain pedal inactive',
    ],
  })
}

function buildIr({ expectation, state, frame, evidence, unexpected, attack, timeMs, outcome, reason, advance, confidence }) {
  const expected = expectedMidis(expectation)
  const matched = matchedMidis(state)
  const missing = expected.filter((midi) => !matched.includes(midi))
  const candidates = evidence.map((note) => createPitchCandidate({
    id: createRecognitionId('piano-pitch', checkpointId(expectation), timeMs, note.midi),
    midi: note.midi,
    detected: note.detected,
    lifecycle: matched.includes(note.midi) ? 'active' : 'candidate',
    source: note.source,
    confidence: {
      overall: clamp01(note.confidence),
      pitch: clamp01(note.confidence),
      expectation: expected.includes(note.midi) ? 1 : 0,
      instrument: 1,
    },
    harmonicEvidence: {
      ratio: finite(note.ratio),
      fundamentalEnergy: finite(note.fundamentalEnergy),
      support: finite(note.harmonicSupport),
    },
    evidenceRefs: note.evidenceRef ? [note.evidenceRef] : [],
    debug: { pianoCompanionRelief: note.companionRelief },
  }))
  const chord = createChordCandidate({
    id: createRecognitionId('piano-chord', checkpointId(expectation), timeMs),
    midis: expected,
    pitchCandidateIds: candidates.map((candidate) => candidate.id),
    matchedMidis: matched,
    missingMidis: missing,
    unexpectedMidis: unexpected,
    requiredToneCount: expected.length,
    complete: outcome === RECOGNITION_OUTCOME.ACCEPTED,
    rolled: Boolean(expectation?.event?.allowsRollingCompletion),
    confidence,
    progress: {
      matchedCount: matched.length,
      requiredCount: expected.length,
      sustainPedalDown: state.sustainPedalDown,
    },
  })
  const attackIr = attack.id ? createAttack({
    id: attack.id,
    timeMs,
    phase: attack.fresh ? ATTACK_PHASE.ATTACK : ATTACK_PHASE.HOLD,
    pitchCandidateIds: candidates.map((candidate) => candidate.id),
    isFresh: attack.fresh,
    confidence: { overall: attack.confidence, attack: attack.confidence },
    debug: { kind: attack.kind },
  }) : null
  const micFrame = createMicFrame({
    id: createRecognitionId('piano-frame', checkpointId(expectation), timeMs),
    sequence: finite(frame?.sequence, state.decisionCount),
    timeMs,
    sampleRate: finite(frame?.sampleRate, 44100),
    windowMs: finite(frame?.windowMs, 46.4),
    signal: {
      gateOpen: frameGateOpen(frame),
      musical: frameMusical(frame),
      rms: finite(frame?.filteredRms ?? frame?.rms),
      noiseFloor: finite(frame?.noiseFloor),
    },
    spectral: {
      dominantMidi: finite(frame?.dominantPitchMidiFloat ?? frame?.midiFloat),
      clarity: finite(frame?.clarity),
    },
    pitchCandidates: candidates,
    chordCandidates: [chord],
    attackIds: attackIr ? [attackIr.id] : [],
  })
  const windowId = createRecognitionId('piano-window', checkpointId(expectation), state.windowStartMs ?? timeMs)
  const window = createRecognitionWindow({
    id: windowId,
    checkpointId: checkpointId(expectation),
    startTimeMs: state.windowStartMs ?? timeMs,
    endTimeMs: timeMs,
    frames: [micFrame],
    attacks: attackIr ? [attackIr] : [],
    pitchCandidates: candidates,
    chordCandidates: [chord],
    ringingMidis: state.ringingMidis,
    chordProgress: chord.progress,
  })
  const decision = createRecognitionDecision({
    checkpointId: checkpointId(expectation),
    windowId,
    timeMs,
    outcome,
    timing: RECOGNITION_TIMING.UNTIMED,
    reason,
    advance,
    matchedMidis: matched,
    missingMidis: missing,
    unexpectedMidis: unexpected,
    ringingMidis: state.ringingMidis,
    attackId: attackIr?.id ?? null,
    confidence,
    progress: chord.progress,
    evidenceRefs: [micFrame.id, chord.id],
  })
  return { frame: micFrame, window, decision }
}

/**
 * Evaluate one microphone frame against a score-aware Piano expectation.
 * Upstream pitch detections are never weakened here: chords complete only when
 * every expected tone has independently crossed the detector's existing gate.
 */
export function evaluatePianoRecognition({
  expectation,
  frame = {},
  state = null,
  timeMs = null,
  attack: attackInput = null,
  musical = null,
  options: optionOverrides = {},
} = {}) {
  if (expectation?.instrument !== 'piano') {
    throw new TypeError('evaluatePianoRecognition requires a piano PerformanceCheckpoint')
  }
  const expected = expectedMidis(expectation)
  if (!expected.length) {
    throw new TypeError('Piano expectation must contain at least one expected MIDI')
  }
  const now = Math.max(0, finite(timeMs ?? frame?.timeMs, 0))
  const options = { ...PIANO_RECOGNITION_DEFAULTS, ...optionOverrides }
  const next = cloneState(state, expectation)
  next.checkpointId = checkpointId(expectation)
  next.decisionCount += 1
  next.ringingMidis = ringingMidis(frame)
  next.sustainPedalDown = Boolean(frame?.sustainPedalDown ?? frame?.signal?.sustainPedalDown)
  if (next.windowStartMs == null) next.windowStartMs = now
  const windowMs = recognitionWindowMs(expectation, next, options)
  pruneState(next, now, windowMs)

  const attack = normalizeAttack(attackInput, frame, expectation, now)
  const withinAttempt = next.attemptStartMs != null && now - next.attemptStartMs <= windowMs
  if (attack.fresh) {
    if (!withinAttempt || next.attemptInvalid || next.consumed) {
      next.matchedNotes = []
      next.windowStartMs = now
      next.attemptInvalid = false
      next.consumed = false
    }
    next.activeAttackId = attack.id
    next.attemptStartMs = withinAttempt ? next.attemptStartMs : now
  }

  const musicalFrame = frameMusical(frame, musical)
  const gateOpen = frameGateOpen(frame)
  const evidence = rawEvidence(frame)
  const detected = evidence.filter((note) => note.detected && expected.includes(note.midi))
  const unexpected = unexpectedMidis(frame, expected, options)
  const tiedHold = expectation?.event?.kind === 'tied-hold' || expectation?.ties?.attackRequired === false
  let outcome = RECOGNITION_OUTCOME.IGNORED
  let reason = 'no-actionable-evidence'
  let advance = false

  if (next.consumed) {
    outcome = RECOGNITION_OUTCOME.HOLD
    reason = 'checkpoint-already-consumed'
  } else if (!musicalFrame) {
    outcome = RECOGNITION_OUTCOME.REJECTED
    reason = 'non-musical-input'
  } else if (!gateOpen && !tiedHold) {
    outcome = RECOGNITION_OUTCOME.IGNORED
    reason = 'noise-gate-closed'
  } else if (unexpected.length) {
    next.attemptInvalid = true
    next.matchedNotes = []
    outcome = RECOGNITION_OUTCOME.REJECTED
    reason = 'unexpected-tone'
  } else if (tiedHold) {
    const held = expected.filter((midi) => next.ringingMidis.includes(midi) || detected.some((note) => note.midi === midi))
    for (const midi of held) {
      addEvidence(next, { midi, confidence: 1 }, now, null, true)
    }
    outcome = held.length === expected.length ? RECOGNITION_OUTCOME.HOLD : RECOGNITION_OUTCOME.PROGRESS
    reason = held.length === expected.length ? 'expected-tied-sustain-held' : 'waiting-for-tied-sustain'
  } else {
    const hasAttackAuthority = Boolean(next.activeAttackId)
    if (hasAttackAuthority) {
      for (const note of detected) {
        const staleRing = next.ringingMidis.includes(note.midi) && !withinAttempt && !attack.fresh
        if (!staleRing) addEvidence(next, note, now, next.activeAttackId, next.sustainPedalDown)
      }
    }
    const matched = matchedMidis(next)
    if (matched.length === expected.length && hasAttackAuthority && !next.attemptInvalid) {
      outcome = RECOGNITION_OUTCOME.ACCEPTED
      reason = expectation?.event?.allowsRollingCompletion
        ? 'expected-rolled-piano-event-complete'
        : 'expected-piano-event-complete'
      advance = true
      next.consumed = true
    } else if (matched.length) {
      outcome = RECOGNITION_OUTCOME.PROGRESS
      reason = 'piano-chord-progress'
    } else if (detected.length && !hasAttackAuthority) {
      outcome = RECOGNITION_OUTCOME.HOLD
      reason = 'ringing-without-new-attack'
    }
  }

  const confidence = confidenceFor({ expectation, state: next, attack, musical: musicalFrame, gateOpen })
  return {
    state: next,
    ...buildIr({
      expectation,
      state: next,
      frame: { ...frame, musical: musicalFrame },
      evidence,
      unexpected,
      attack,
      timeMs: now,
      outcome,
      reason,
      advance,
      confidence,
    }),
  }
}

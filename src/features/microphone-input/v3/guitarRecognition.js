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

export const GUITAR_RECOGNITION_DEFAULTS = Object.freeze({
  rollingWindowMs: 900,
  octaveSafeWrongToneCents: 65,
  dominantWrongToneMinClarity: 0.5,
})

function finite(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp01(value) {
  return Math.min(1, Math.max(0, finite(value, 0)))
}

function uniqueMidis(values = []) {
  return [...new Set((values ?? []).map(Number).filter((midi) => Number.isFinite(midi)))]
}

function checkpointId(expectation) {
  return expectation?.id ?? expectation?.sourceCheckpointId ?? null
}

export function createGuitarRecognitionState(checkpoint = null) {
  return {
    schemaVersion: 3,
    checkpointId: checkpointId(checkpoint),
    windowStartMs: null,
    lastEvidenceTimeMs: null,
    activeAttackId: null,
    attemptStartMs: null,
    attemptInvalid: false,
    matchedNotes: [],
    ringingMidis: [],
    consumed: false,
    decisionCount: 0,
  }
}

function cloneState(state, expectation) {
  const expectedCheckpointId = checkpointId(expectation)
  if (!state || state.checkpointId !== expectedCheckpointId) {
    return createGuitarRecognitionState(expectation)
  }
  return {
    ...state,
    matchedNotes: (state.matchedNotes ?? []).map((entry) => ({ ...entry })),
    ringingMidis: [...(state.ringingMidis ?? [])],
  }
}

function expectedNotes(expectation) {
  return expectation?.event?.expectedNotes ?? []
}

function expectedMidis(expectation) {
  return uniqueMidis(
    expectation?.event?.expectedMidis?.length
      ? expectation.event.expectedMidis
      : expectedNotes(expectation).map((note) => note.midi),
  )
}

function expectedNoteForMidi(expectation, midi) {
  return expectedNotes(expectation).find((note) => note.midi === midi) ?? null
}

function rawPitchEvidence(frame = {}) {
  if (Array.isArray(frame.pitchCandidates)) {
    return frame.pitchCandidates.map((candidate) => ({
      midi: candidate.midi,
      detected: Boolean(candidate.detected),
      confidence: candidate.confidence?.overall ?? 0,
      ratio: candidate.debug?.ratio ?? candidate.harmonicEvidence?.ratio ?? null,
      harmonicSupport: candidate.harmonicEvidence?.support ?? null,
      source: candidate.source ?? 'recognition-ir',
      evidenceRef: candidate.id ?? null,
    }))
  }
  return (frame.v2Notes ?? []).map((note) => ({
    midi: note.midi,
    detected: Boolean(note.detected),
    confidence: note.confidence ?? 0,
    ratio: note.ratio ?? null,
    harmonicSupport: note.harmonicSupport ?? null,
    fundamentalEnergy: note.fundamentalEnergy ?? null,
    maskingRescored: Boolean(note.maskingRescored),
    harmonicProbe: Boolean(note.harmonicProbe),
    source: 'v2-score-informed',
    evidenceRef: null,
  }))
}

function frameGateOpen(frame) {
  return Boolean(frame?.signal?.gateOpen ?? frame?.gateOpen)
}

function frameMusical(frame, explicit) {
  if (explicit != null) {
    return Boolean(explicit)
  }
  if (frame?.signal?.musical != null) {
    return Boolean(frame.signal.musical)
  }
  if (frame?.musical != null) {
    return Boolean(frame.musical)
  }
  return false
}

function frameRingingMidis(frame) {
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

function unexpectedMidisFromFrame(frame, expected, options) {
  const unexpected = uniqueMidis([
    ...(frame?.unexpectedMidis ?? []),
    ...(frame?.blindDetectedMidis ?? []),
  ]).filter((midi) => !expected.includes(midi))
  const dominant = finite(
    frame?.spectral?.dominantMidi ??
    frame?.dominantPitchMidiFloat ??
    frame?.dominantPitchMidi ??
    frame?.midiFloat ??
    frame?.midi,
  )
  const clarity = finite(frame?.clarity ?? frame?.spectral?.clarity, 0)
  if (
    dominant != null &&
    clarity >= options.dominantWrongToneMinClarity &&
    centsToNearestPitchClass(dominant, expected) > options.octaveSafeWrongToneCents
  ) {
    unexpected.push(Math.round(dominant))
  }
  return uniqueMidis(unexpected)
}

function normalizeAttack(attack, timeMs, expectation, frame) {
  const techniques = expectedNotes(expectation)
    .flatMap((note) => note.techniques ?? [])
    .map((technique) => typeof technique === 'string' ? technique : technique?.kind)
    .filter(Boolean)
  const kind = attack?.kind ?? frame?.attackKind ?? null
  const legato =
    kind === 'hammer-on' ||
    kind === 'pull-off' ||
    (Boolean(frame?.legatoTransition) && techniques.some(
      (technique) => technique === 'hammer-on' || technique === 'pull-off',
    ))
  const fresh = Boolean(attack?.fresh || frame?.freshAttack || legato)
  if (!fresh && !attack?.id) {
    return { id: null, fresh: false, legato, kind, confidence: 0 }
  }
  return {
    id: attack?.id ?? createRecognitionId('guitar-attack', checkpointId(expectation), timeMs),
    fresh,
    legato,
    kind,
    confidence: clamp01(attack?.confidence ?? (fresh ? 1 : 0)),
  }
}

function rollingWindowMs(expectation, options) {
  return Math.max(
    1,
    finite(expectation?.timing?.rollToleranceMs, null) ?? options.rollingWindowMs,
  )
}

function pruneMatchedNotes(state, timeMs, windowMs) {
  state.matchedNotes = state.matchedNotes.filter(
    (entry) => timeMs - entry.lastSeenMs <= windowMs,
  )
  if (!state.matchedNotes.length && state.attemptStartMs != null && timeMs - state.attemptStartMs > windowMs) {
    state.attemptStartMs = null
    state.activeAttackId = null
    state.attemptInvalid = false
  }
}

function addMatchedEvidence(state, evidence, expectation, timeMs, attackId) {
  const note = expectedNoteForMidi(expectation, evidence.midi)
  const existing = state.matchedNotes.find((entry) => entry.midi === evidence.midi)
  if (existing) {
    existing.lastSeenMs = timeMs
    existing.maxConfidence = Math.max(existing.maxConfidence, clamp01(evidence.confidence))
    existing.ratio = Math.max(existing.ratio ?? 0, finite(evidence.ratio, 0))
    return
  }
  state.matchedNotes.push({
    midi: evidence.midi,
    firstSeenMs: timeMs,
    lastSeenMs: timeMs,
    maxConfidence: clamp01(evidence.confidence),
    ratio: finite(evidence.ratio, null),
    string: note?.string ?? null,
    fret: note?.fret ?? null,
    attackId,
  })
}

function matchedMidisFromState(state) {
  return uniqueMidis(state.matchedNotes.map((entry) => entry.midi))
}

function bassAnchorRequired(expectation) {
  const expected = expectedMidis(expectation)
  const required = expectation?.event?.requiredToneCount ?? expected.length
  return expected.length >= 3 && required < expected.length
}

function hasBassAnchor(expectation, matched) {
  if (!bassAnchorRequired(expectation)) {
    return true
  }
  const explicitBass = expectedNotes(expectation)
    .filter((note) => note.string === 5 || note.string === 6)
    .map((note) => note.midi)
  const anchors = explicitBass.length
    ? explicitBass
    : [Math.min(...expectedMidis(expectation))]
  return anchors.some((midi) => matched.includes(midi))
}

function confidenceForProgress({ expectation, state, evidence, attack, musical, gateOpen }) {
  const expected = expectedMidis(expectation)
  const matched = matchedMidisFromState(state)
  const required = Math.max(1, expectation?.event?.requiredToneCount ?? expected.length)
  const pitchValues = state.matchedNotes.map((entry) => entry.maxConfidence)
  const pitch = pitchValues.length
    ? pitchValues.reduce((sum, value) => sum + value, 0) / pitchValues.length
    : 0
  const positioned = expectedNotes(expectation).filter(
    (note) => note.string != null && note.fret != null,
  )
  const matchedPositioned = positioned.filter((note) => matched.includes(note.midi))
  const instrument = positioned.length ? matchedPositioned.length / positioned.length : 0.5
  const harmony = Math.min(1, matched.length / required)
  const expectationScore = expected.length ? matched.length / expected.length : 0
  const signal = gateOpen && musical ? 1 : 0
  const attackConfidence = attack.fresh ? attack.confidence : state.activeAttackId ? 0.65 : 0
  const overall = clamp01(
    pitch * 0.32 +
    harmony * 0.24 +
    expectationScore * 0.14 +
    signal * 0.12 +
    attackConfidence * 0.1 +
    instrument * 0.08,
  )
  return createConfidenceBreakdown({
    overall,
    signal,
    pitch,
    harmony,
    temporal: state.attemptStartMs == null ? 0 : 1,
    attack: attackConfidence,
    expectation: expectationScore,
    instrument,
    rejection: evidence.length ? 1 : 0,
    reasons: [
      `${matched.length}/${required} required tones`,
      positioned.length ? `${matchedPositioned.length}/${positioned.length} positioned tones` : 'no string/fret metadata',
    ],
  })
}

function buildIr({
  expectation,
  state,
  frame,
  evidence,
  unexpectedMidis,
  attack,
  timeMs,
  outcome,
  reason,
  advance,
  confidence,
}) {
  const expected = expectedMidis(expectation)
  const matched = matchedMidisFromState(state)
  const missing = expected.filter((midi) => !matched.includes(midi))
  const pitchCandidates = evidence.map((entry) => {
    const expectedNote = expectedNoteForMidi(expectation, entry.midi)
    return createPitchCandidate({
      id: createRecognitionId('guitar-pitch', checkpointId(expectation), timeMs, entry.midi),
      midi: entry.midi,
      detected: entry.detected,
      lifecycle: matched.includes(entry.midi) ? 'active' : 'candidate',
      source: entry.source,
      confidence: {
        overall: clamp01(entry.confidence),
        pitch: clamp01(entry.confidence),
        expectation: expected.includes(entry.midi) ? 1 : 0,
        instrument: expectedNote?.string != null ? 1 : null,
      },
      harmonicEvidence: {
        ratio: finite(entry.ratio, null),
        support: finite(entry.harmonicSupport, null),
        fundamentalEnergy: finite(entry.fundamentalEnergy, null),
        maskingRescored: Boolean(entry.maskingRescored),
        harmonicProbe: Boolean(entry.harmonicProbe),
      },
      stringFretEvidence: expectedNote?.string == null
        ? null
        : { string: expectedNote.string, fret: expectedNote.fret },
      evidenceRefs: entry.evidenceRef ? [entry.evidenceRef] : [],
    })
  })
  const chordCandidate = createChordCandidate({
    id: createRecognitionId('guitar-chord', checkpointId(expectation), timeMs),
    midis: expected,
    pitchCandidateIds: pitchCandidates.map((candidate) => candidate.id),
    matchedMidis: matched,
    missingMidis: missing,
    unexpectedMidis,
    requiredToneCount: expectation?.event?.requiredToneCount ?? expected.length,
    complete: outcome === RECOGNITION_OUTCOME.ACCEPTED,
    rolled: Boolean(expectation?.event?.allowsRollingCompletion),
    confidence,
    progress: {
      matchedCount: matched.length,
      requiredCount: expectation?.event?.requiredToneCount ?? expected.length,
      bassAnchorPresent: hasBassAnchor(expectation, matched),
    },
  })
  const attackIr = attack.id
    ? createAttack({
        id: attack.id,
        timeMs,
        phase: attack.fresh ? ATTACK_PHASE.ATTACK : ATTACK_PHASE.HOLD,
        pitchCandidateIds: pitchCandidates.map((candidate) => candidate.id),
        isFresh: attack.fresh,
        confidence: { overall: attack.confidence, attack: attack.confidence },
        debug: { kind: attack.kind, legato: attack.legato },
      })
    : null
  const micFrame = createMicFrame({
    id: createRecognitionId('guitar-frame', checkpointId(expectation), timeMs),
    sequence: finite(frame?.sequence, state.decisionCount),
    timeMs,
    sampleRate: finite(frame?.sampleRate, 44100),
    windowMs: finite(frame?.windowMs, 46.4),
    signal: {
      gateOpen: frameGateOpen(frame),
      musical: frameMusical(frame),
      rms: finite(frame?.filteredRms ?? frame?.rms, null),
      noiseFloor: finite(frame?.noiseFloor, null),
      signalShape: frame?.signalShape ?? null,
    },
    spectral: {
      dominantMidi: finite(frame?.dominantPitchMidiFloat ?? frame?.midiFloat ?? frame?.midi, null),
      clarity: finite(frame?.clarity, null),
    },
    pitchCandidates,
    chordCandidates: [chordCandidate],
    attackIds: attackIr ? [attackIr.id] : [],
  })
  const windowId = createRecognitionId(
    'guitar-window',
    checkpointId(expectation),
    state.windowStartMs ?? timeMs,
  )
  const window = createRecognitionWindow({
    id: windowId,
    checkpointId: checkpointId(expectation),
    startTimeMs: state.windowStartMs ?? timeMs,
    endTimeMs: timeMs,
    frames: [micFrame],
    attacks: attackIr ? [attackIr] : [],
    pitchCandidates,
    chordCandidates: [chordCandidate],
    ringingMidis: state.ringingMidis,
    chordProgress: chordCandidate.progress,
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
    unexpectedMidis,
    ringingMidis: state.ringingMidis,
    attackId: attackIr?.id ?? null,
    confidence,
    progress: chordCandidate.progress,
    evidenceRefs: [micFrame.id, chordCandidate.id],
  })
  return { frame: micFrame, window, decision }
}

/**
 * Evaluate one frame against a score-aware Guitar expectation. The function is
 * deterministic and returns a new serializable state plus auditable IR.
 */
export function evaluateGuitarRecognition({
  expectation,
  frame = {},
  state = null,
  timeMs = null,
  attack: attackInput = null,
  musical = null,
  options: optionOverrides = {},
} = {}) {
  if (expectation?.instrument !== 'guitar') {
    throw new TypeError('evaluateGuitarRecognition requires a guitar PerformanceCheckpoint')
  }
  const expected = expectedMidis(expectation)
  if (!expected.length) {
    throw new TypeError('Guitar expectation must contain at least one expected MIDI')
  }
  const now = Math.max(0, finite(timeMs ?? frame?.timeMs, 0))
  const options = { ...GUITAR_RECOGNITION_DEFAULTS, ...optionOverrides }
  const next = cloneState(state, expectation)
  next.checkpointId = checkpointId(expectation)
  next.decisionCount += 1
  next.ringingMidis = frameRingingMidis(frame)
  if (next.windowStartMs == null) {
    next.windowStartMs = now
  }
  const windowMs = rollingWindowMs(expectation, options)
  pruneMatchedNotes(next, now, windowMs)

  const attack = normalizeAttack(attackInput, now, expectation, frame)
  const withinAttempt =
    next.attemptStartMs != null && now - next.attemptStartMs <= windowMs
  if (attack.fresh) {
    if (!withinAttempt || next.attemptInvalid || next.consumed) {
      next.matchedNotes = []
      next.windowStartMs = now
      next.attemptInvalid = false
      next.consumed = false
    }
    next.activeAttackId = attack.id
    next.attemptStartMs = next.attemptStartMs != null && withinAttempt
      ? next.attemptStartMs
      : now
  }

  const musicalFrame = frameMusical(frame, musical)
  const gateOpen = frameGateOpen(frame)
  const evidence = rawPitchEvidence(frame)
    .filter((entry) => entry.detected && expected.includes(entry.midi))
  const unexpected = unexpectedMidisFromFrame(frame, expected, options)

  let outcome = RECOGNITION_OUTCOME.IGNORED
  let reason = 'no-actionable-evidence'
  let advance = false

  if (next.consumed) {
    outcome = RECOGNITION_OUTCOME.HOLD
    reason = 'checkpoint-already-consumed'
  } else if (!musicalFrame) {
    outcome = RECOGNITION_OUTCOME.REJECTED
    reason = 'non-musical-input'
  } else if (!gateOpen && !attack.legato) {
    outcome = RECOGNITION_OUTCOME.IGNORED
    reason = 'noise-gate-closed'
  } else if (unexpected.length) {
    next.attemptInvalid = true
    next.matchedNotes = []
    outcome = RECOGNITION_OUTCOME.REJECTED
    reason = 'unexpected-tone'
  } else {
    const hasAttackAuthority = Boolean(next.activeAttackId || attack.legato)
    if (hasAttackAuthority) {
      for (const entry of evidence) {
        if (next.ringingMidis.includes(entry.midi) && !withinAttempt && !attack.fresh && !attack.legato) {
          continue
        }
        addMatchedEvidence(next, entry, expectation, now, next.activeAttackId)
      }
      if (evidence.length) {
        next.lastEvidenceTimeMs = now
      }
    }

    const matched = matchedMidisFromState(next)
    const required = Math.max(1, expectation.event.requiredToneCount ?? expected.length)
    const complete = matched.length >= required && hasBassAnchor(expectation, matched)
    if (!matched.length && evidence.length && !hasAttackAuthority) {
      outcome = RECOGNITION_OUTCOME.HOLD
      reason = 'ringing-without-new-attack'
    } else if (complete && hasAttackAuthority && !next.attemptInvalid) {
      outcome = RECOGNITION_OUTCOME.ACCEPTED
      reason = attack.legato ? 'expected-legato-transition' : 'expected-guitar-event-complete'
      advance = true
      next.consumed = true
    } else if (matched.length) {
      outcome = RECOGNITION_OUTCOME.PROGRESS
      reason = 'guitar-chord-progress'
    } else if (evidence.length) {
      outcome = RECOGNITION_OUTCOME.HOLD
      reason = 'fresh-attack-required'
    }
  }

  const confidence = confidenceForProgress({
    expectation,
    state: next,
    evidence,
    attack,
    musical: musicalFrame,
    gateOpen,
  })
  const ir = buildIr({
    expectation,
    state: next,
    frame: { ...frame, musical: musicalFrame },
    evidence,
    unexpectedMidis: unexpected,
    attack,
    timeMs: now,
    outcome,
    reason,
    advance,
    confidence,
  })
  return { state: next, ...ir }
}

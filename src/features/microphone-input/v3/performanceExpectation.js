import { createPerformanceCheckpoint } from './micRecognitionIr.js'

export const PERFORMANCE_MODE = Object.freeze({
  WAIT_FOR_YOU: 'wait-for-you',
  PLAY_ALONG: 'play-along',
})

export const EXPECTED_EVENT_KIND = Object.freeze({
  NOTE: 'note',
  DOUBLE_STOP: 'double-stop',
  CHORD: 'chord',
  TIED_HOLD: 'tied-hold',
})

export const EXPECTATION_TIMING_DEFAULTS = Object.freeze({
  [PERFORMANCE_MODE.WAIT_FOR_YOU]: Object.freeze({
    earlyWindowMs: 250,
    targetLeadMs: 75,
    targetTailMs: 180,
    lateWindowMs: 900,
  }),
  [PERFORMANCE_MODE.PLAY_ALONG]: Object.freeze({
    earlyWindowMs: 150,
    targetLeadMs: 60,
    targetTailMs: 120,
    lateWindowMs: 280,
  }),
})

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function unique(values = []) {
  return [...new Set((values ?? []).filter((value) => value != null))]
}

function normalizeInstrument(instrument) {
  const value = String(instrument ?? 'unknown').toLowerCase()
  if (value.includes('guitar')) {
    return 'guitar'
  }
  if (value.includes('piano') || value.includes('keyboard')) {
    return 'piano'
  }
  return value || 'unknown'
}

function eventKind(checkpoint, noteCount, ties) {
  if (checkpoint?.isTiedContinuation || (ties.isContinuation && noteCount <= 1)) {
    return EXPECTED_EVENT_KIND.TIED_HOLD
  }
  if (noteCount === 2) {
    return EXPECTED_EVENT_KIND.DOUBLE_STOP
  }
  if (noteCount > 2) {
    return EXPECTED_EVENT_KIND.CHORD
  }
  return EXPECTED_EVENT_KIND.NOTE
}

function expectedStringFretMap(checkpoint) {
  const byKey = new Map()
  for (const entry of checkpoint?.expectedStringFrets ?? []) {
    const midi = finiteOrNull(entry?.midi)
    const string = finiteOrNull(entry?.string)
    const fret = finiteOrNull(entry?.fret)
    if (string == null || fret == null) {
      continue
    }
    byKey.set(`${midi ?? 'none'}:${entry?.noteId ?? 'none'}`, {
      string,
      fret,
      midi,
      noteId: entry?.noteId ?? null,
    })
    if (midi != null && !byKey.has(`${midi}:none`)) {
      byKey.set(`${midi}:none`, { string, fret, midi, noteId: entry?.noteId ?? null })
    }
  }
  return byKey
}

function sourceNotes(checkpoint) {
  const explicitNotes = (checkpoint?.notes ?? []).filter((note) => finiteOrNull(note?.midi) != null)
  if (explicitNotes.length) {
    return explicitNotes
  }
  const midis = checkpoint?.expectedMidis?.length
    ? checkpoint.expectedMidis
    : checkpoint?.expectedMidi != null
      ? [checkpoint.expectedMidi]
      : []
  return midis.map((midi, index) => ({
    id: `${checkpoint?.id ?? 'checkpoint'}-expected-${index}`,
    midi,
  }))
}

function buildExpectedNotes(checkpoint) {
  const positions = expectedStringFretMap(checkpoint)
  const seen = new Set()
  const result = []
  for (const [index, note] of sourceNotes(checkpoint).entries()) {
    const midi = finiteOrNull(note.midi)
    if (midi == null || midi < 0 || midi > 127) {
      continue
    }
    const noteId = note.id ?? null
    const explicitPosition = finiteOrNull(note.string) != null && finiteOrNull(note.fret) != null
      ? { string: Number(note.string), fret: Number(note.fret), midi, noteId }
      : positions.get(`${midi}:${noteId ?? 'none'}`) ?? positions.get(`${midi}:none`) ?? null
    const occurrenceKey = noteId ?? `${midi}:${explicitPosition?.string ?? 'none'}:${index}`
    if (seen.has(occurrenceKey)) {
      continue
    }
    seen.add(occurrenceKey)
    result.push({
      occurrenceId: String(occurrenceKey),
      noteId,
      midi,
      pitchClass: ((Math.round(midi) % 12) + 12) % 12,
      label: note.label ?? null,
      string: explicitPosition?.string ?? null,
      fret: explicitPosition?.fret ?? null,
      voice: note.voice ?? null,
      staff: note.staff ?? null,
      partId: note.partId ?? null,
      durationMs: finiteOrNull(note.durationSeconds) == null
        ? null
        : Math.max(0, Number(note.durationSeconds) * 1000),
      tieStart: Boolean(note.tieStart),
      tieStop: Boolean(note.tieStop),
      suppressAttack: Boolean(note.suppressPlaybackAttack),
      muted: Boolean(
        note.muted ||
        note.guitarTechniques?.some?.((technique) =>
          (typeof technique === 'string' ? technique : technique?.kind) === 'muted'),
      ),
      techniques: Array.isArray(note.guitarTechniques) ? [...note.guitarTechniques] : [],
    })
  }
  return result
}

function buildTies(checkpoint, notes) {
  const continuationIds = []
  for (const note of checkpoint?.notes ?? []) {
    for (const continuation of note?.tiedContinuations ?? []) {
      if (continuation?.id != null) {
        continuationIds.push(String(continuation.id))
      }
    }
  }
  return {
    isContinuation: Boolean(
      checkpoint?.isTiedContinuation ||
      (notes.length > 0 && notes.every((note) => note.tieStop && note.suppressAttack)),
    ),
    hasTiedSustain: Boolean(
      checkpoint?.hasTiedSustain ||
      notes.some((note) => note.tieStart || note.tieStop) ||
      continuationIds.length,
    ),
    attackRequired: !(
      checkpoint?.isTiedContinuation ||
      (notes.length > 0 && notes.every((note) => note.suppressAttack))
    ),
    continuationNoteIds: unique(continuationIds),
  }
}

function resolveRequiredToneCount(checkpoint, instrument, kind, noteCount) {
  if (kind === EXPECTED_EVENT_KIND.TIED_HOLD) {
    return 0
  }
  if (noteCount <= 2) {
    return noteCount
  }
  if (instrument !== 'guitar') {
    return noteCount
  }
  const explicit = finiteOrNull(
    checkpoint?.minimumRequiredTones ?? checkpoint?.minimumChordTonesRequired,
  )
  if (explicit != null) {
    return Math.max(2, Math.min(noteCount, Math.round(explicit)))
  }
  if (noteCount === 3) {
    return 2
  }
  if (noteCount === 4) {
    return 3
  }
  return Math.min(noteCount, 3)
}

function checkpointSummary(checkpoint, index) {
  if (!checkpoint) {
    return null
  }
  const midis = unique(
    checkpoint.expectedMidis?.length
      ? checkpoint.expectedMidis.map(finiteOrNull)
      : [finiteOrNull(checkpoint.expectedMidi)],
  )
  return {
    id: checkpoint.id ?? null,
    index,
    timeMs: finiteOrNull(checkpoint.timeSeconds) == null
      ? null
      : Number(checkpoint.timeSeconds) * 1000,
    measure: checkpoint.measureNumber ?? null,
    beat: checkpoint.beat ?? null,
    midis,
    sharesToneWithCurrent: false,
  }
}

function resolveTiming(checkpoint, mode, timingOptions = {}) {
  const defaults = EXPECTATION_TIMING_DEFAULTS[mode] ?? EXPECTATION_TIMING_DEFAULTS[PERFORMANCE_MODE.WAIT_FOR_YOU]
  const targetMs = Math.max(0, (finiteOrNull(checkpoint?.timeSeconds) ?? 0) * 1000)
  const earlyWindowMs = Math.max(0, finiteOrNull(timingOptions.earlyWindowMs) ?? defaults.earlyWindowMs)
  const targetLeadMs = Math.max(0, finiteOrNull(timingOptions.targetLeadMs) ?? defaults.targetLeadMs)
  const targetTailMs = Math.max(0, finiteOrNull(timingOptions.targetTailMs) ?? defaults.targetTailMs)
  const lateWindowMs = Math.max(targetTailMs, finiteOrNull(timingOptions.lateWindowMs) ?? defaults.lateWindowMs)
  const rollToleranceMs = Math.max(
    0,
    finiteOrNull(timingOptions.rollToleranceMs) ??
      finiteOrNull(checkpoint?.rollingWindowMs) ??
      0,
  )
  return {
    clock: mode === PERFORMANCE_MODE.PLAY_ALONG ? 'continuous-playhead' : 'checkpoint-held',
    targetMs,
    earlyStartMs: Math.max(0, targetMs - earlyWindowMs),
    targetStartMs: Math.max(0, targetMs - targetLeadMs),
    targetEndMs: targetMs + targetTailMs,
    lateEndMs: targetMs + lateWindowMs,
    rollToleranceMs,
  }
}

function maxDurationMs(notes) {
  const values = notes.map((note) => note.durationMs).filter((value) => Number.isFinite(value))
  return values.length ? Math.max(...values) : null
}

/**
 * Construct the score-aware expected musical event for one practice target.
 */
export function buildPerformanceExpectation({
  checkpoint,
  checkpointIndex = null,
  checkpoints = [],
  instrument = 'unknown',
  mode = PERFORMANCE_MODE.WAIT_FOR_YOU,
  timing = {},
  diagnostics = [],
  debug = {},
} = {}) {
  if (!checkpoint?.id) {
    throw new TypeError('buildPerformanceExpectation requires a checkpoint with an id')
  }
  if (!Object.values(PERFORMANCE_MODE).includes(mode)) {
    throw new TypeError(`Unsupported performance mode: ${mode}`)
  }
  const index = checkpointIndex == null
    ? Math.max(0, checkpoints.findIndex((candidate) => candidate?.id === checkpoint.id))
    : Math.max(0, Math.round(Number(checkpointIndex)))
  const resolvedInstrument = normalizeInstrument(instrument)
  const expectedNotes = buildExpectedNotes(checkpoint)
  const ties = buildTies(checkpoint, expectedNotes)
  const kind = eventKind(checkpoint, expectedNotes.length, ties)
  const expectedMidis = unique(expectedNotes.map((note) => note.midi))
  const requiredToneCount = resolveRequiredToneCount(
    checkpoint,
    resolvedInstrument,
    kind,
    expectedNotes.length,
  )
  const resolvedTiming = resolveTiming(checkpoint, mode, timing)
  const durationMs = maxDurationMs(expectedNotes)
  const previous = checkpointSummary(checkpoints[index - 1], index - 1)
  const next = checkpointSummary(checkpoints[index + 1], index + 1)
  if (previous) {
    previous.sharesToneWithCurrent = previous.midis.some((midi) => expectedMidis.includes(midi))
  }
  if (next) {
    next.sharesToneWithCurrent = next.midis.some((midi) => expectedMidis.includes(midi))
  }

  return createPerformanceCheckpoint({
    index,
    sourceCheckpointId: checkpoint.id,
    mode,
    instrument: resolvedInstrument,
    event: {
      kind,
      label: checkpoint.displayLabel ?? checkpoint.label ?? null,
      chordSymbol: checkpoint.chordSymbol ?? null,
      expectedNotes,
      expectedMidis,
      chordTones: unique(expectedMidis.map((midi) => ((Math.round(midi) % 12) + 12) % 12)),
      noteCount: expectedNotes.length,
      distinctPitchCount: expectedMidis.length,
      requiredToneCount,
      requiresAllTones: requiredToneCount >= expectedNotes.length,
      allowsRollingCompletion: expectedNotes.length > 1 && resolvedTiming.rollToleranceMs > 0,
    },
    score: {
      measure: checkpoint.measureNumber ?? null,
      beat: checkpoint.beat ?? null,
      quarterTime: finiteOrNull(checkpoint.quarterTime),
      timeSeconds: finiteOrNull(checkpoint.timeSeconds),
      repeatPass: checkpoint.repeatPass ?? 1,
      voices: unique(expectedNotes.map((note) => note.voice)),
      staves: unique(expectedNotes.map((note) => note.staff)),
      partIds: unique(expectedNotes.map((note) => note.partId)),
    },
    timing: resolvedTiming,
    ties,
    sustain: {
      expected: Boolean(ties.hasTiedSustain || (durationMs != null && durationMs > 300)),
      durationMs,
      expectedUntilMs: durationMs == null ? null : resolvedTiming.targetMs + durationMs,
      ringingMayCarryForward: Boolean(
        ties.hasTiedSustain ||
        (next?.sharesToneWithCurrent && durationMs != null && durationMs > 0),
      ),
    },
    neighbors: { previous, next },
    policy: {
      oneNoteMayComplete: expectedNotes.length === 1 && kind !== EXPECTED_EVENT_KIND.TIED_HOLD,
      doubleStopRequiresBoth: kind === EXPECTED_EVENT_KIND.DOUBLE_STOP,
      chordUsesQuorum: expectedNotes.length >= 3 && requiredToneCount < expectedNotes.length,
      requiresFreshAttack: ties.attackRequired,
      rejectUnexpectedTone: true,
      preserveSpeechNoiseRejection: true,
      stringFretMetadataAvailable: expectedNotes.some(
        (note) => note.string != null && note.fret != null,
      ),
    },
    diagnostics,
    evidenceRefs: [checkpoint.id],
    debug,
  })
}

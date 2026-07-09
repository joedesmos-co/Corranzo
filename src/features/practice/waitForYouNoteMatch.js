import { findMatchingExpectedIndex, matchesAnyExpected, pitchMatches } from './midiPitchMatch.js'
import {
  CHORD_WINDOW_MS_MAX,
  CHORD_WINDOW_MS_MIN,
  MIC_CHORD_COLLECTION_WINDOW_MS_MAX,
  MIC_CHORD_COLLECTION_WINDOW_MS_MIN,
  MUSICAL_EVENT_WINDOW_MS_MAX,
  MUSICAL_EVENT_WINDOW_MS_MIN,
  ROLLED_CHORD_TOTAL_CAP_MS,
  ROLLED_CHORD_TOTAL_CAP_MS_MAX,
  ROLLED_CHORD_TOTAL_CAP_MS_MIN,
} from './waitForYouMatchSettings.js'
import {
  evaluateMicChordCollection,
  MIC_CHORD_MATCH_COMPLETE,
  MIC_CHORD_MATCH_PROGRESS,
  MIC_CHORD_MATCH_WRONG,
  resolveMicChordCollectionWindowMs,
} from './waitForYouMicChordCollection.js'
import {
  GUITAR_CHORD_SHAPE_WINDOW_MS as DEFAULT_GUITAR_CHORD_SHAPE_WINDOW_MS,
  GUITAR_HIGH_STRING_STICKY_MS,
  buildExpectedStringByMidi,
  isHighGuitarString,
  isLowGuitarString,
  isUpperGuitarStringForMasking,
  minimumGuitarChordTonesRequired,
} from './guitarChordShapeCheckpoint.js'

export { DEFAULT_GUITAR_CHORD_SHAPE_WINDOW_MS as GUITAR_CHORD_SHAPE_WINDOW_MS }

export const MATCH_OUTCOME = {
  NO_EXPECTED: 'no-expected',
  COMPLETE: 'complete',
  WRONG: 'wrong',
  CHORD_PROGRESS: 'chord-progress',
}

/**
 * Normalize checkpoint expected pitches to an array.
 */
export function getExpectedMidis(checkpoint) {
  if (!checkpoint) {
    return []
  }
  let midis = []
  if (Array.isArray(checkpoint.expectedMidis) && checkpoint.expectedMidis.length > 0) {
    midis = [...checkpoint.expectedMidis]
  } else if (checkpoint.expectedMidi != null) {
    midis = [checkpoint.expectedMidi]
  }
  return [...new Set(midis)]
}

export function createMusicalEventBufferState() {
  return {
    matchedIndices: new Set(),
    timeoutId: null,
    lastPlayedMidi: null,
    attemptStartMs: null,
    lastMatchMs: null,
  }
}

/** @deprecated alias — same buffer state used for polyphonic matching */
export function createChordMatchState() {
  return createMusicalEventBufferState()
}

export function resetMusicalEventBufferState(state) {
  if (!state) {
    return
  }
  if (state.timeoutId != null) {
    clearTimeout(state.timeoutId)
    state.timeoutId = null
  }
  state.matchedIndices.clear()
  state.lastPlayedMidi = null
  state.attemptStartMs = null
  state.lastMatchMs = null
}

export function resetChordMatchState(state) {
  resetMusicalEventBufferState(state)
}

/** Score grouping window — not used for MIDI rolled-chord input timing. */
export function resolveMusicalEventWindowMs(settings = {}) {
  return Math.min(
    MUSICAL_EVENT_WINDOW_MS_MAX,
    Math.max(
      MUSICAL_EVENT_WINDOW_MS_MIN,
      Number(settings.musicalEventWindowMs) || 180,
    ),
  )
}

/** Sliding gap between rolled MIDI chord tones (from match settings). */
export function resolveRolledChordSlideWindowMs(settings = {}) {
  return Math.min(
    CHORD_WINDOW_MS_MAX,
    Math.max(CHORD_WINDOW_MS_MIN, Number(settings.chordWindowMs) || 500),
  )
}

/** Hard cap for a full rolled MIDI chord attempt from the first matched tone. */
export function resolveRolledChordTotalCapMs(settings = {}) {
  const raw = Number(settings.rolledChordTotalCapMs)
  if (!Number.isFinite(raw) || raw <= 0) {
    return ROLLED_CHORD_TOTAL_CAP_MS
  }
  return Math.min(
    ROLLED_CHORD_TOTAL_CAP_MS_MAX,
    Math.max(ROLLED_CHORD_TOTAL_CAP_MS_MIN, raw),
  )
}

export function resolveMicChordSequenceWindowMs(settings = {}) {
  return resolveMicChordCollectionWindowMs(settings)
}

function resetPolyphonicAttempt(state) {
  if (state.timeoutId != null) {
    clearTimeout(state.timeoutId)
    state.timeoutId = null
  }
  state.matchedIndices.clear()
  state.attemptStartMs = null
  state.lastMatchMs = null
}

function ensurePolyphonicAttemptFresh(state, slideWindowMs, totalCapMs, now = Date.now()) {
  if (state.attemptStartMs == null) {
    return
  }
  if (now - state.attemptStartMs > totalCapMs) {
    resetPolyphonicAttempt(state)
    return
  }
  if (state.lastMatchMs != null && now - state.lastMatchMs > slideWindowMs) {
    resetPolyphonicAttempt(state)
  }
}

function schedulePolyphonicSlideReset(state, slideWindowMs) {
  if (state.timeoutId != null) {
    clearTimeout(state.timeoutId)
  }
  state.timeoutId = setTimeout(() => {
    resetPolyphonicAttempt(state)
  }, slideWindowMs)
}

function evaluatePolyphonicInput(checkpoint, playedMidi, bufferState, settings) {
  const expected = getExpectedMidis(checkpoint)
  const slideWindowMs = resolveRolledChordSlideWindowMs(settings)
  const totalCapMs = resolveRolledChordTotalCapMs(settings)
  const now = Date.now()

  ensurePolyphonicAttemptFresh(bufferState, slideWindowMs, totalCapMs, now)
  bufferState.lastPlayedMidi = playedMidi

  const couldMatch = matchesAnyExpected(playedMidi, expected, settings)
  const matchIndex = findMatchingExpectedIndex(
    playedMidi,
    expected,
    bufferState.matchedIndices,
    settings,
  )

  if (matchIndex == null) {
    if (couldMatch) {
      return {
        outcome: MATCH_OUTCOME.CHORD_PROGRESS,
        expected,
        matchedIndices: new Set(bufferState.matchedIndices),
        isChord: true,
        playedMidi,
        matchedCount: bufferState.matchedIndices.size,
        totalExpected: expected.length,
        duplicate: true,
      }
    }
    return {
      outcome: MATCH_OUTCOME.WRONG,
      expected,
      matchedIndices: new Set(bufferState.matchedIndices),
      isChord: true,
      playedMidi,
      couldMatch,
    }
  }

  if (bufferState.attemptStartMs == null) {
    bufferState.attemptStartMs = now
  }
  bufferState.lastMatchMs = now
  bufferState.matchedIndices.add(matchIndex)
  schedulePolyphonicSlideReset(bufferState, slideWindowMs)

  if (bufferState.matchedIndices.size >= expected.length) {
    resetMusicalEventBufferState(bufferState)
    return {
      outcome: MATCH_OUTCOME.COMPLETE,
      expected,
      matchedIndices: new Set(expected.map((_, index) => index)),
      isChord: true,
      playedMidi,
    }
  }

  return {
    outcome: MATCH_OUTCOME.CHORD_PROGRESS,
    expected,
    matchedIndices: new Set(bufferState.matchedIndices),
    isChord: true,
    playedMidi,
    matchedCount: bufferState.matchedIndices.size,
    totalExpected: expected.length,
  }
}

/**
 * Evaluate a MIDI note-on against the current checkpoint.
 * Pure function — does not call onMatch; caller handles COMPLETE.
 */
export function evaluateNoteInput(checkpoint, playedMidi, bufferState, settings) {
  if (!checkpoint) {
    return {
      outcome: MATCH_OUTCOME.NO_EXPECTED,
      expected: [],
      matchedIndices: bufferState?.matchedIndices ?? new Set(),
      isChord: false,
    }
  }

  const expected = getExpectedMidis(checkpoint)
  if (expected.length === 0) {
    return {
      outcome: MATCH_OUTCOME.NO_EXPECTED,
      expected,
      matchedIndices: bufferState.matchedIndices,
      isChord: false,
    }
  }

  if (expected.length === 1) {
    bufferState.lastPlayedMidi = playedMidi
    const index = findMatchingExpectedIndex(
      playedMidi,
      expected,
      new Set(),
      settings,
    )
    if (index == null) {
      return {
        outcome: MATCH_OUTCOME.WRONG,
        expected,
        matchedIndices: bufferState.matchedIndices,
        isChord: false,
        playedMidi,
      }
    }
    return {
      outcome: MATCH_OUTCOME.COMPLETE,
      expected,
      matchedIndices: new Set([0]),
      isChord: false,
      playedMidi,
    }
  }

  return evaluatePolyphonicInput(checkpoint, playedMidi, bufferState, settings)
}

/**
 * Map engine outcome to feedback outcome enum.
 */
export function toFeedbackOutcome(matchOutcome, matchedCount) {
  if (matchOutcome === MATCH_OUTCOME.WRONG) {
    return 'wrong'
  }
  if (matchOutcome === MATCH_OUTCOME.COMPLETE) {
    return 'correct'
  }
  if (matchOutcome === MATCH_OUTCOME.CHORD_PROGRESS) {
    return matchedCount > 0 ? 'chord-partial' : 'chord-waiting'
  }
  return 'idle'
}

/**
 * Targets for experimental mic chord checkpoints (monophonic — not full polyphony).
 */
export function getMicChordMatchTargets(checkpoint, settings) {
  const expected = getExpectedMidis(checkpoint)
  if (expected.length <= 1) {
    return { expected, isChord: false, mode: 'single' }
  }

  const mode = settings?.micChordMode ?? 'any-tone'
  const bass = Math.min(...expected)
  const top = Math.max(...expected)

  if (mode === 'bass') {
    return { expected: [bass], isChord: true, mode: 'bass', fullExpected: expected }
  }
  if (mode === 'top') {
    return { expected: [top], isChord: true, mode: 'top', fullExpected: expected }
  }
  return { expected, isChord: true, mode: 'any-tone', fullExpected: expected }
}

/**
 * Microphone: one stable pitch at a time. Chords use experimental single-tone matching only.
 */
export function evaluateMicNoteInput(checkpoint, playedMidi, settings) {
  const targets = getMicChordMatchTargets(checkpoint, settings)
  const expected = targets.fullExpected ?? targets.expected

  if (targets.expected.length === 0) {
    return {
      outcome: MATCH_OUTCOME.NO_EXPECTED,
      expected,
      matchedIndices: new Set(),
      isChord: false,
    }
  }

  const index = findMatchingExpectedIndex(
    playedMidi,
    targets.expected,
    new Set(),
    settings,
  )
  if (index == null) {
    return {
      outcome: MATCH_OUTCOME.WRONG,
      expected,
      matchedIndices: new Set(),
      isChord: targets.isChord,
      playedMidi,
      micChordMode: targets.mode,
    }
  }

  const matchedMidi = targets.expected[index]
  const fullIndex =
    targets.isChord && targets.fullExpected
      ? targets.fullExpected.indexOf(matchedMidi)
      : index

  if (targets.isChord && targets.mode === 'any-tone' && expected.length > 1) {
    return {
      outcome: MATCH_OUTCOME.CHORD_PROGRESS,
      expected,
      matchedIndices: new Set([fullIndex >= 0 ? fullIndex : index]),
      isChord: true,
      playedMidi,
      micChordMode: targets.mode,
      matchedCount: 1,
      totalExpected: expected.length,
    }
  }

  return {
    outcome: MATCH_OUTCOME.COMPLETE,
    expected,
    matchedIndices: new Set([fullIndex >= 0 ? fullIndex : index]),
    isChord: targets.isChord,
    playedMidi,
    micChordMode: targets.mode,
  }
}

/**
 * Mic polyphony: collect stable pitches sequentially within the mic chord window.
 */
export function evaluateMicNoteInputWithBuffer(checkpoint, playedMidi, bufferState, settings) {
  const fullExpected = getExpectedMidis(checkpoint)
  if (fullExpected.length <= 1) {
    return evaluateMicNoteInput(checkpoint, playedMidi, settings)
  }

  const targets = getMicChordMatchTargets(checkpoint, settings)
  if (targets.mode !== 'any-tone') {
    return evaluateMicNoteInput(checkpoint, playedMidi, settings)
  }

  const result = evaluateMicChordCollection({
    expected: fullExpected,
    playedMidi,
    state: bufferState,
    settings,
    micChordMode: targets.mode,
  })

  if (result.outcome === MIC_CHORD_MATCH_COMPLETE) {
    return { ...result, outcome: MATCH_OUTCOME.COMPLETE }
  }
  if (result.outcome === MIC_CHORD_MATCH_WRONG) {
    return { ...result, outcome: MATCH_OUTCOME.WRONG }
  }
  return { ...result, outcome: MATCH_OUTCOME.CHORD_PROGRESS }
}

export function createGuitarChordShapeBufferState() {
  return {
    heardMidis: new Set(),
    windowStartMs: null,
    stickyHighMidis: new Map(),
  }
}

export function resetGuitarChordShapeBufferState(state) {
  if (!state) {
    return
  }
  state.heardMidis.clear()
  state.windowStartMs = null
  state.stickyHighMidis?.clear?.()
}

function pruneStickyHighMidis(bufferState, now, stickyMs = GUITAR_HIGH_STRING_STICKY_MS) {
  if (!bufferState?.stickyHighMidis?.size) {
    return
  }
  for (const [midi, lastSeenMs] of bufferState.stickyHighMidis.entries()) {
    if (now - lastSeenMs > stickyMs) {
      bufferState.stickyHighMidis.delete(midi)
    }
  }
}

function rememberGuitarHeardMidis(
  bufferState,
  detectedMidis,
  expected,
  stringByMidi,
  settings,
  now,
) {
  for (const detected of detectedMidis ?? []) {
    for (const expectedMidi of expected) {
      if (!pitchMatches(detected, expectedMidi, settings ?? {})) {
        continue
      }
      bufferState.heardMidis.add(expectedMidi)
      if (isUpperGuitarStringForMasking(stringByMidi.get(expectedMidi))) {
        bufferState.stickyHighMidis.set(expectedMidi, now)
      }
    }
  }
}

function guitarMidiPitchClass(midi) {
  return ((midi % 12) + 12) % 12
}

/**
 * Drop weak V2 grazes so noise cannot accumulate chord tones across the rolling window.
 */
export function filterGuitarChordDetectedMidis(
  frame,
  detectedMidis = [],
  expected = [],
  stringByMidi = new Map(),
  heardLowInBuffer = false,
) {
  if (!frame?.v2Active) {
    return detectedMidis ?? []
  }

  const lowPitchClassesInFrame = new Set(
    (detectedMidis ?? [])
      .filter((midi) => isLowGuitarString(stringByMidi.get(midi)))
      .map((midi) => guitarMidiPitchClass(midi)),
  )
  const lowPresent = lowPitchClassesInFrame.size > 0 || heardLowInBuffer
  const dyad = expected.length === 2

  return (detectedMidis ?? []).filter((midi) => {
    if (!expected.includes(midi)) {
      return false
    }
    const note = (frame.v2Notes ?? []).find((entry) => entry?.midi === midi)
    if (!note?.detected) {
      return false
    }
    const stringNum = stringByMidi.get(midi)
    const midiPitchClass = guitarMidiPitchClass(midi)

    // Masking-rescored upper tones that share pitch class with a confirmed low string
    // are usually octave harmonics, not a separately plucked note.
    if (
      note.maskingRescored &&
      isUpperGuitarStringForMasking(stringNum) &&
      lowPitchClassesInFrame.has(midiPitchClass)
    ) {
      return false
    }

    let minConfidence = isHighGuitarString(stringNum)
      ? 0.24
      : isUpperGuitarStringForMasking(stringNum)
        ? 0.28
        : 0.36
    let minRatio = isHighGuitarString(stringNum)
      ? 1.18
      : isUpperGuitarStringForMasking(stringNum)
        ? 1.22
        : 1.38

    if (dyad && lowPresent) {
      if (isHighGuitarString(stringNum)) {
        minConfidence = 0.14
        minRatio = 1.08
      } else if (
        isUpperGuitarStringForMasking(stringNum) &&
        !lowPitchClassesInFrame.has(midiPitchClass)
      ) {
        minConfidence = 0.16
        minRatio = 1.1
      }
    }

    return (note.confidence ?? 0) >= minConfidence && (note.ratio ?? 0) >= minRatio
  })
}

function guitarHeardExpectedMidi(bufferState, expectedMidi, stringByMidi, now) {
  if (bufferState?.heardMidis?.has(expectedMidi)) {
    return true
  }
  if (!isUpperGuitarStringForMasking(stringByMidi.get(expectedMidi))) {
    return false
  }
  const lastSeenMs = bufferState?.stickyHighMidis?.get(expectedMidi)
  return lastSeenMs != null && now - lastSeenMs <= GUITAR_HIGH_STRING_STICKY_MS
}

function guitarChordQuorumComplete(expected, matchedIndices, required) {
  if (matchedIndices.size < required) {
    return false
  }
  if (expected.length === 3 && matchedIndices.size < expected.length) {
    let bassIndex = 0
    for (let index = 1; index < expected.length; index += 1) {
      if (expected[index] < expected[bassIndex]) {
        bassIndex = index
      }
    }
    if (!matchedIndices.has(bassIndex)) {
      return false
    }
  }
  return true
}

/**
 * Guitar mic: accumulate expected chord tones across a short strum window.
 * Completes when enough tones are heard — not every tone one-at-a-time.
 */
export function evaluateGuitarChordShapeMicInput(
  checkpoint,
  detectedMidis = [],
  bufferState = null,
  settings = {},
  frame = null,
) {
  const expected = getExpectedMidis(checkpoint)
  const stringByMidi = buildExpectedStringByMidi(checkpoint?.expectedStringFrets)
  const heardLowInBuffer = bufferState?.heardMidis
    ? [...bufferState.heardMidis].some((midi) => isLowGuitarString(stringByMidi.get(midi)))
    : false
  const filteredMidis = frame
    ? filterGuitarChordDetectedMidis(
        frame,
        detectedMidis,
        expected,
        stringByMidi,
        heardLowInBuffer,
      )
    : detectedMidis
  const required =
    checkpoint?.minimumRequiredTones ??
    checkpoint?.minimumChordTonesRequired ??
    minimumGuitarChordTonesRequired(expected.length)
  const windowMs =
    Number(settings.guitarChordShapeWindowMs) ||
    Number(checkpoint?.rollingWindowMs) ||
    DEFAULT_GUITAR_CHORD_SHAPE_WINDOW_MS
  const now = Date.now()

  if (bufferState) {
    pruneStickyHighMidis(bufferState, now)
    if (bufferState.windowStartMs == null) {
      bufferState.windowStartMs = now
    } else if (now - bufferState.windowStartMs > windowMs) {
      const retainedHighMidis = new Set()
      for (const midi of bufferState.heardMidis) {
        if (guitarHeardExpectedMidi(bufferState, midi, stringByMidi, now)) {
          retainedHighMidis.add(midi)
        }
      }
      bufferState.heardMidis.clear()
      for (const midi of retainedHighMidis) {
        bufferState.heardMidis.add(midi)
      }
      bufferState.windowStartMs = now
    }
    rememberGuitarHeardMidis(
      bufferState,
      filteredMidis,
      expected,
      stringByMidi,
      settings,
      now,
    )
  }

  const matchedIndices = new Set()
  for (let index = 0; index < expected.length; index += 1) {
    const expectedMidi = expected[index]
    const heardInFrame = filteredMidis.some((midi) =>
      pitchMatches(midi, expectedMidi, settings ?? {}),
    )
    const heardInBuffer = guitarHeardExpectedMidi(bufferState, expectedMidi, stringByMidi, now)
    if (heardInFrame || heardInBuffer) {
      matchedIndices.add(index)
    }
  }

  const matchedCount = matchedIndices.size
  const heardLowString = [...matchedIndices].some((index) =>
    isLowGuitarString(stringByMidi.get(expected[index])),
  )
  const missingHighStringMidis = expected.filter(
    (midi, index) =>
      !matchedIndices.has(index) && isHighGuitarString(stringByMidi.get(midi)),
  )
  const base = {
    expected,
    matchedIndices,
    isChord: true,
    playedMidi: filteredMidis?.[0] ?? detectedMidis?.[0] ?? null,
    micEngineMode: checkpoint?.isPianoChordMic ? 'piano-chord-rolling' : 'guitar-chord-shape',
    detectedMidis: [...(filteredMidis ?? detectedMidis ?? [])],
    matchedCount,
    totalExpected: expected.length,
    requiredTones: required,
    isGuitarChordShape: Boolean(checkpoint?.isGuitarChordShape),
    isRollingChordMic: Boolean(checkpoint?.isRollingChordMic),
    isPianoChordMic: Boolean(checkpoint?.isPianoChordMic),
    heardLowString,
    missingHighStringMidis,
  }

  if (guitarChordQuorumComplete(expected, matchedIndices, required)) {
    if (bufferState) {
      resetGuitarChordShapeBufferState(bufferState)
    }
    return { ...base, outcome: MATCH_OUTCOME.COMPLETE }
  }
  if (matchedCount > 0) {
    return { ...base, outcome: MATCH_OUTCOME.CHORD_PROGRESS }
  }
  return { ...base, outcome: MATCH_OUTCOME.WRONG }
}

/**
 * Mic Engine V2 — simultaneous score-informed chord/single-note evaluation.
 *
 * Completion follows the mic chord mode: any-tone requires every chord tone
 * heard together; bass/top modes complete from their single required tone
 * (matching what those settings promise the player).
 */
export function evaluateMicScoreInformedInput(checkpoint, detectedMidis = [], settings) {
  if (checkpoint?.isRollingChordMic) {
    return evaluateGuitarChordShapeMicInput(checkpoint, detectedMidis, null, settings)
  }
  const expected = getExpectedMidis(checkpoint)
  const targets = getMicChordMatchTargets(checkpoint, settings)
  const fullExpected = targets.fullExpected ?? expected

  if (fullExpected.length === 0) {
    return {
      outcome: MATCH_OUTCOME.NO_EXPECTED,
      expected: fullExpected,
      matchedIndices: new Set(),
      isChord: false,
    }
  }

  const matchedIndices = new Set()
  for (let index = 0; index < fullExpected.length; index += 1) {
    const expectedMidi = fullExpected[index]
    const heard = (detectedMidis ?? []).some((midi) =>
      pitchMatches(midi, expectedMidi, settings ?? {}),
    )
    if (heard) {
      matchedIndices.add(index)
    }
  }

  const requiredMatched = targets.expected.every((requiredMidi) =>
    (detectedMidis ?? []).some((midi) => pitchMatches(midi, requiredMidi, settings ?? {})),
  )

  if (requiredMatched) {
    return {
      outcome: MATCH_OUTCOME.COMPLETE,
      expected: fullExpected,
      matchedIndices,
      isChord: fullExpected.length > 1,
      playedMidi: detectedMidis?.[0] ?? null,
      micEngineMode: 'v2-score-informed',
      detectedMidis: [...(detectedMidis ?? [])],
    }
  }

  if (matchedIndices.size > 0) {
    return {
      outcome: MATCH_OUTCOME.CHORD_PROGRESS,
      expected: fullExpected,
      matchedIndices,
      isChord: fullExpected.length > 1,
      playedMidi: detectedMidis?.[0] ?? null,
      micEngineMode: 'v2-score-informed',
      detectedMidis: [...(detectedMidis ?? [])],
      matchedCount: matchedIndices.size,
      totalExpected: fullExpected.length,
    }
  }

  return {
    outcome: MATCH_OUTCOME.WRONG,
    expected: fullExpected,
    matchedIndices,
    isChord: fullExpected.length > 1,
    playedMidi: detectedMidis?.[0] ?? null,
    micEngineMode: 'v2-score-informed',
    detectedMidis: [...(detectedMidis ?? [])],
    micChordMode: targets.mode,
  }
}

/**
 * @deprecated Use evaluateNoteInput — kept for tests importing tryMatchCheckpoint
 */
export function tryMatchCheckpoint(checkpoint, playedMidi, chordState, onMatch, settings) {
  const result = evaluateNoteInput(checkpoint, playedMidi, chordState, settings ?? {
    transpositionOffset: 0,
    allowOctaveMistakes: false,
    chordWindowMs: 500,
    musicalEventWindowMs: 180,
  })
  if (result.outcome === MATCH_OUTCOME.COMPLETE) {
    onMatch()
    return true
  }
  return false
}

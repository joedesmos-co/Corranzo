import { findMatchingExpectedIndex, matchesAnyExpected } from './midiPitchMatch.js'
import {
  MIC_CHORD_SEQUENCE_WINDOW_MS_MAX,
  MIC_CHORD_SEQUENCE_WINDOW_MS_MIN,
  MUSICAL_EVENT_WINDOW_MS_MAX,
  MUSICAL_EVENT_WINDOW_MS_MIN,
} from './waitForYouMatchSettings.js'

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
    windowStartMs: null,
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
  state.windowStartMs = null
}

export function resetChordMatchState(state) {
  resetMusicalEventBufferState(state)
}

export function resolveMusicalEventWindowMs(settings = {}) {
  return Math.min(
    MUSICAL_EVENT_WINDOW_MS_MAX,
    Math.max(
      MUSICAL_EVENT_WINDOW_MS_MIN,
      Number(settings.musicalEventWindowMs) || 180,
    ),
  )
}

export function resolveMicChordSequenceWindowMs(settings = {}) {
  return Math.min(
    MIC_CHORD_SEQUENCE_WINDOW_MS_MAX,
    Math.max(
      MIC_CHORD_SEQUENCE_WINDOW_MS_MIN,
      Number(settings.micChordSequenceWindowMs) || 2400,
    ),
  )
}

function ensureMusicalEventWindow(state, windowMs, now = Date.now()) {
  if (state.windowStartMs == null || now - state.windowStartMs > windowMs) {
    resetMusicalEventBufferState(state)
    state.windowStartMs = now
  }
}

function scheduleMusicalEventReset(state, windowMs) {
  if (state.timeoutId != null) {
    clearTimeout(state.timeoutId)
  }
  const elapsed = Date.now() - (state.windowStartMs ?? Date.now())
  const remaining = Math.max(0, windowMs - elapsed)
  state.timeoutId = setTimeout(() => {
    resetMusicalEventBufferState(state)
  }, remaining)
}

function evaluatePolyphonicInput(checkpoint, playedMidi, bufferState, settings) {
  const expected = getExpectedMidis(checkpoint)
  const windowMs = resolveMusicalEventWindowMs(settings)
  const now = Date.now()

  ensureMusicalEventWindow(bufferState, windowMs, now)
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

  bufferState.matchedIndices.add(matchIndex)
  scheduleMusicalEventReset(bufferState, windowMs)

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
 * Mic polyphony: collect stable pitches within the musical-event window.
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

  const windowMs = resolveMicChordSequenceWindowMs(settings)
  const now = Date.now()
  ensureMusicalEventWindow(bufferState, windowMs, now)

  const couldMatch = matchesAnyExpected(playedMidi, fullExpected, settings)
  const matchIndex = findMatchingExpectedIndex(
    playedMidi,
    fullExpected,
    bufferState.matchedIndices,
    settings,
  )

  if (matchIndex == null) {
    if (couldMatch) {
      return {
        outcome: MATCH_OUTCOME.CHORD_PROGRESS,
        expected: fullExpected,
        matchedIndices: new Set(bufferState.matchedIndices),
        isChord: true,
        playedMidi,
        micChordMode: targets.mode,
        duplicate: true,
      }
    }
    return {
      outcome: MATCH_OUTCOME.WRONG,
      expected: fullExpected,
      matchedIndices: new Set(bufferState.matchedIndices),
      isChord: true,
      playedMidi,
      micChordMode: targets.mode,
    }
  }

  bufferState.matchedIndices.add(matchIndex)
  scheduleMusicalEventReset(bufferState, windowMs)

  if (bufferState.matchedIndices.size >= fullExpected.length) {
    resetMusicalEventBufferState(bufferState)
    return {
      outcome: MATCH_OUTCOME.COMPLETE,
      expected: fullExpected,
      matchedIndices: new Set(fullExpected.map((_, index) => index)),
      isChord: true,
      playedMidi,
      micChordMode: targets.mode,
    }
  }

  return {
    outcome: MATCH_OUTCOME.CHORD_PROGRESS,
    expected: fullExpected,
    matchedIndices: new Set(bufferState.matchedIndices),
    isChord: true,
    playedMidi,
    micChordMode: targets.mode,
    matchedCount: bufferState.matchedIndices.size,
    totalExpected: fullExpected.length,
  }
}

/**
 * @deprecated Use evaluateNoteInput — kept for tests importing tryMatchCheckpoint
 */
export function tryMatchCheckpoint(checkpoint, playedMidi, chordState, onMatch, settings) {
  const result = evaluateNoteInput(checkpoint, playedMidi, chordState, settings ?? {
    transpositionOffset: 0,
    allowOctaveMistakes: false,
    chordWindowMs: 450,
    musicalEventWindowMs: 150,
  })
  if (result.outcome === MATCH_OUTCOME.COMPLETE) {
    onMatch()
    return true
  }
  return false
}

import { findMatchingExpectedIndex, matchesAnyExpected } from './midiPitchMatch.js'

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
  if (Array.isArray(checkpoint.expectedMidis) && checkpoint.expectedMidis.length > 0) {
    return [...checkpoint.expectedMidis]
  }
  if (checkpoint.expectedMidi != null) {
    return [checkpoint.expectedMidi]
  }
  return []
}

export function createChordMatchState() {
  return {
    matchedIndices: new Set(),
    timeoutId: null,
    lastPlayedMidi: null,
  }
}

export function resetChordMatchState(state) {
  if (!state) {
    return
  }
  if (state.timeoutId != null) {
    clearTimeout(state.timeoutId)
    state.timeoutId = null
  }
  state.matchedIndices.clear()
  state.lastPlayedMidi = null
}

function scheduleChordReset(state, windowMs) {
  if (state.timeoutId != null) {
    clearTimeout(state.timeoutId)
  }
  state.timeoutId = setTimeout(() => {
    resetChordMatchState(state)
  }, windowMs)
}

/**
 * Evaluate a MIDI note-on against the current checkpoint.
 * Pure function — does not call onMatch; caller handles COMPLETE.
 */
export function evaluateNoteInput(checkpoint, playedMidi, chordState, settings) {
  const expected = getExpectedMidis(checkpoint)
  if (expected.length === 0) {
    return {
      outcome: MATCH_OUTCOME.NO_EXPECTED,
      expected,
      matchedIndices: chordState.matchedIndices,
      isChord: false,
    }
  }

  const isChord = expected.length > 1
  const windowMs = settings.chordWindowMs

  chordState.lastPlayedMidi = playedMidi

  if (!isChord) {
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
        matchedIndices: chordState.matchedIndices,
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

  const matchIndex = findMatchingExpectedIndex(
    playedMidi,
    expected,
    chordState.matchedIndices,
    settings,
  )

  if (matchIndex == null) {
    const couldMatch = matchesAnyExpected(playedMidi, expected, settings)
    return {
      outcome: MATCH_OUTCOME.WRONG,
      expected,
      matchedIndices: chordState.matchedIndices,
      isChord: true,
      playedMidi,
      couldMatch,
    }
  }

  chordState.matchedIndices.add(matchIndex)
  scheduleChordReset(chordState, windowMs)

  if (chordState.matchedIndices.size >= expected.length) {
    resetChordMatchState(chordState)
    return {
      outcome: MATCH_OUTCOME.COMPLETE,
      expected,
      matchedIndices: new Set(expected.map((_, i) => i)),
      isChord: true,
      playedMidi,
    }
  }

  return {
    outcome: MATCH_OUTCOME.CHORD_PROGRESS,
    expected,
    matchedIndices: new Set(chordState.matchedIndices),
    isChord: true,
    playedMidi,
    matchedCount: chordState.matchedIndices.size,
    totalExpected: expected.length,
  }
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
 * @deprecated Use evaluateNoteInput — kept for tests importing tryMatchCheckpoint
 */
export function tryMatchCheckpoint(checkpoint, playedMidi, chordState, onMatch, settings) {
  const result = evaluateNoteInput(checkpoint, playedMidi, chordState, settings ?? {
    transpositionOffset: 0,
    allowOctaveMistakes: false,
    chordWindowMs: 450,
  })
  if (result.outcome === MATCH_OUTCOME.COMPLETE) {
    onMatch()
    return true
  }
  return false
}

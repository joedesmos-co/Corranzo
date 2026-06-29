import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import { findMatchingExpectedIndex, matchesAnyExpected } from './midiPitchMatch.js'
import { missingLabels } from './waitForYouGuidance.js'
import {
  MIC_CHORD_COLLECTION_WINDOW_MS_MAX,
  MIC_CHORD_COLLECTION_WINDOW_MS_MIN,
  MIC_CHORD_STABLE_HITS_MAX,
  MIC_CHORD_STABLE_HITS_MIN,
  MIC_CHORD_WRONG_STREAK_LIMIT,
} from './waitForYouMatchSettings.js'

export const MIC_CHORD_MATCH_COMPLETE = 'complete'
export const MIC_CHORD_MATCH_PROGRESS = 'chord-progress'
export const MIC_CHORD_MATCH_WRONG = 'wrong'

export function createMicChordCollectionState() {
  return {
    matchedIndices: new Set(),
    pendingIndex: null,
    pendingHits: 0,
    wrongStreak: 0,
    windowStartMs: null,
    timeoutId: null,
    lastPlayedMidi: null,
  }
}

export function resetMicChordCollectionProgress(state) {
  if (!state) {
    return
  }
  state.matchedIndices.clear()
  state.pendingIndex = null
  state.pendingHits = 0
  state.wrongStreak = 0
  state.lastPlayedMidi = null
}

export function resetMicChordCollectionState(state) {
  if (!state) {
    return
  }
  if (state.timeoutId != null) {
    clearTimeout(state.timeoutId)
    state.timeoutId = null
  }
  resetMicChordCollectionProgress(state)
  state.windowStartMs = null
}

export function resolveMicChordCollectionWindowMs(settings = {}) {
  const raw =
    settings.micChordCollectionWindowMs ??
    settings.micChordSequenceWindowMs ??
    3500
  return Math.min(
    MIC_CHORD_COLLECTION_WINDOW_MS_MAX,
    Math.max(MIC_CHORD_COLLECTION_WINDOW_MS_MIN, Number(raw) || 3500),
  )
}

export function resolveMicChordStableHitsRequired(settings = {}) {
  const raw = settings.micChordStableHitsRequired ?? 2
  return Math.min(
    MIC_CHORD_STABLE_HITS_MAX,
    Math.max(MIC_CHORD_STABLE_HITS_MIN, Math.round(Number(raw) || 2)),
  )
}

export function resolveMicChordWrongStreakLimit(settings = {}) {
  const raw = settings.micChordWrongStreakLimit ?? MIC_CHORD_WRONG_STREAK_LIMIT
  return Math.max(1, Math.round(Number(raw) || MIC_CHORD_WRONG_STREAK_LIMIT))
}

export function micChordHeardLabels(expected, matchedIndices) {
  return expected
    .map((midi, index) => ({ midi, index }))
    .filter(({ index }) => matchedIndices.has(index))
    .map(({ midi }) => midiToNoteLabel(midi))
}

export function buildMicChordProgressMessage({
  heardLabels = [],
  remainingLabels = [],
  softWrongLabel = null,
  windowReset = false,
  includeHint = true,
} = {}) {
  const hint =
    'Mic chord mode: play notes one at a time, or use MIDI for chords together.'
  const parts = []

  if (windowReset) {
    parts.push('Time ran out — play each note again.')
  } else if (softWrongLabel) {
    parts.push(`Wrong note (${softWrongLabel}) — keep going.`)
  }

  if (heardLabels.length && remainingLabels.length) {
    parts.push(`Heard: ${heardLabels.join(' + ')}. Still need: ${remainingLabels.join(', ')}.`)
  } else if (heardLabels.length) {
    parts.push(`Heard: ${heardLabels.join(' + ')}.`)
  } else if (remainingLabels.length) {
    parts.push(`Still need: ${remainingLabels.join(', ')}.`)
  }

  let message = parts.join(' ')
  if (includeHint && message) {
    message = `${message} ${hint}`
  } else if (includeHint && !message) {
    message = hint
  }
  return message
}

function scheduleMicChordWindowReset(state, windowMs) {
  if (state.timeoutId != null) {
    clearTimeout(state.timeoutId)
  }
  const elapsed = Date.now() - (state.windowStartMs ?? Date.now())
  const remaining = Math.max(0, windowMs - elapsed)
  state.timeoutId = setTimeout(() => {
    resetMicChordCollectionProgress(state)
    state.windowStartMs = Date.now()
    state.timeoutId = null
  }, remaining)
}

function ensureMicChordWindow(state, windowMs, now = Date.now()) {
  if (state.windowStartMs == null) {
    state.windowStartMs = now
    return { windowReset: false }
  }
  if (now - state.windowStartMs > windowMs) {
    resetMicChordCollectionProgress(state)
    state.windowStartMs = now
    return { windowReset: true }
  }
  return { windowReset: false }
}

function buildProgressResult({
  expected,
  state,
  playedMidi,
  micChordMode,
  windowReset = false,
  softWrong = false,
  duplicate = false,
}) {
  const matchedIndices = new Set(state.matchedIndices)
  const heardLabels = micChordHeardLabels(expected, matchedIndices)
  const remaining = missingLabels(expected, matchedIndices)
  const playedLabel = playedMidi != null ? midiToNoteLabel(playedMidi) : null

  return {
    outcome: MIC_CHORD_MATCH_PROGRESS,
    expected,
    matchedIndices,
    isChord: true,
    playedMidi,
    playedLabel,
    micChordMode,
    matchedCount: matchedIndices.size,
    totalExpected: expected.length,
    heardLabels,
    remainingLabels: remaining,
    windowReset,
    softWrong,
    duplicate,
    message: buildMicChordProgressMessage({
      heardLabels,
      remainingLabels: remaining,
      softWrongLabel: softWrong ? playedLabel : null,
      windowReset,
    }),
  }
}

/**
 * Mic chord collection: sequential stable detections within a long window.
 */
export function evaluateMicChordCollection({
  expected,
  playedMidi,
  state,
  settings,
  micChordMode = 'any-tone',
}) {
  const windowMs = resolveMicChordCollectionWindowMs(settings)
  const stableRequired = resolveMicChordStableHitsRequired(settings)
  const wrongLimit = resolveMicChordWrongStreakLimit(settings)
  const now = Date.now()

  const { windowReset } = ensureMicChordWindow(state, windowMs, now)
  state.lastPlayedMidi = playedMidi

  if (windowReset) {
    scheduleMicChordWindowReset(state, windowMs)
    return buildProgressResult({
      expected,
      state,
      playedMidi,
      micChordMode,
      windowReset: true,
    })
  }

  scheduleMicChordWindowReset(state, windowMs)

  const couldMatch = matchesAnyExpected(playedMidi, expected, settings)
  const matchIndex = findMatchingExpectedIndex(
    playedMidi,
    expected,
    state.matchedIndices,
    settings,
  )

  if (matchIndex == null) {
    if (couldMatch) {
      return buildProgressResult({
        expected,
        state,
        playedMidi,
        micChordMode,
        duplicate: true,
      })
    }

    state.pendingIndex = null
    state.pendingHits = 0
    state.wrongStreak += 1

    if (state.wrongStreak >= wrongLimit) {
      return {
        outcome: MIC_CHORD_MATCH_WRONG,
        expected,
        matchedIndices: new Set(state.matchedIndices),
        isChord: true,
        playedMidi,
        playedLabel: midiToNoteLabel(playedMidi),
        micChordMode,
        heardLabels: micChordHeardLabels(expected, state.matchedIndices),
        remainingLabels: missingLabels(expected, state.matchedIndices),
      }
    }

    return buildProgressResult({
      expected,
      state,
      playedMidi,
      micChordMode,
      softWrong: true,
    })
  }

  state.wrongStreak = 0

  if (state.pendingIndex === matchIndex) {
    state.pendingHits += 1
  } else {
    state.pendingIndex = matchIndex
    state.pendingHits = 1
  }

  if (state.pendingHits < stableRequired) {
    return buildProgressResult({
      expected,
      state,
      playedMidi,
      micChordMode,
    })
  }

  state.matchedIndices.add(matchIndex)
  state.pendingIndex = null
  state.pendingHits = 0

  if (state.matchedIndices.size >= expected.length) {
    resetMicChordCollectionState(state)
    return {
      outcome: MIC_CHORD_MATCH_COMPLETE,
      expected,
      matchedIndices: new Set(expected.map((_, index) => index)),
      isChord: true,
      playedMidi,
      micChordMode,
      heardLabels: expected.map((midi) => midiToNoteLabel(midi)),
      remainingLabels: [],
    }
  }

  return buildProgressResult({
    expected,
    state,
    playedMidi,
    micChordMode,
  })
}

import { findVisualTargetIndex } from './visualPracticeLane.js'
import {
  PLAY_ALONG_MISS_AFTER_SECONDS,
  VISUAL_EARLY_INPUT_SECONDS,
  VISUAL_LANE_OUTCOME,
} from './visualLaneFeedback.js'
import {
  createMusicalEventBufferState,
  evaluateNoteInput,
  getExpectedMidis,
  MATCH_OUTCOME,
  resetMusicalEventBufferState,
} from './waitForYouNoteMatch.js'

export function createPlayAlongFeedbackState() {
  return {
    outcomes: new Map(),
    activeGroupId: null,
    matchBuffer: createMusicalEventBufferState(),
  }
}

export function resetPlayAlongFeedbackState(state) {
  if (!state) {
    return
  }
  state.outcomes.clear()
  state.activeGroupId = null
  resetMusicalEventBufferState(state.matchBuffer)
}

function playAlongWindowStart(group) {
  return group.timeSeconds - VISUAL_EARLY_INPUT_SECONDS
}

function playAlongWindowEnd(group) {
  return group.timeSeconds + PLAY_ALONG_MISS_AFTER_SECONDS
}

/**
 * Mark groups the playhead has passed without a correct hit as missed.
 */
export function updatePlayAlongMisses(state, groups, currentTime) {
  if (!state || !groups?.length) {
    return
  }
  const time = Number(currentTime)
  if (!Number.isFinite(time)) {
    return
  }
  for (const group of groups) {
    if (state.outcomes.has(group.id)) {
      continue
    }
    if (time > playAlongWindowEnd(group)) {
      state.outcomes.set(group.id, VISUAL_LANE_OUTCOME.MISSED)
    }
  }
}

export function resolvePlayAlongTargetIndex(groups, currentTime) {
  return findVisualTargetIndex(groups, currentTime, VISUAL_EARLY_INPUT_SECONDS)
}

/**
 * Evaluate one played MIDI pitch against the active Play Along target.
 * Returns the lane outcome to apply, or null when out of window / no target.
 */
export function evaluatePlayAlongNoteInput(
  state,
  groups,
  currentTime,
  playedMidi,
  matchSettings = {},
) {
  if (!state || !groups?.length || playedMidi == null) {
    return null
  }
  const time = Number(currentTime)
  if (!Number.isFinite(time)) {
    return null
  }

  const targetIndex = resolvePlayAlongTargetIndex(groups, time)
  const targetGroup = groups[targetIndex]
  if (!targetGroup) {
    return null
  }

  if (time < playAlongWindowStart(targetGroup) || time > playAlongWindowEnd(targetGroup)) {
    return null
  }

  if (state.activeGroupId !== targetGroup.id) {
    state.activeGroupId = targetGroup.id
    resetMusicalEventBufferState(state.matchBuffer)
  }

  const existing = state.outcomes.get(targetGroup.id)
  if (existing === VISUAL_LANE_OUTCOME.CORRECT) {
    return null
  }

  const checkpoint = {
    expectedMidis: targetGroup.midis?.length ? targetGroup.midis : getExpectedMidis(targetGroup),
    isChord: Boolean(targetGroup.isChord),
    isGuitarChordShape: Boolean(targetGroup.isGuitarChordShape),
    isRollingChordMic: Boolean(targetGroup.isRollingChordMic),
    isPianoChordMic: Boolean(targetGroup.isPianoChordMic),
    guitarChordShape: targetGroup.guitarChordShape ?? null,
    expectedStringFrets: targetGroup.expectedStringFrets ?? null,
  }

  const result = evaluateNoteInput(checkpoint, playedMidi, state.matchBuffer, matchSettings)

  if (result.outcome === MATCH_OUTCOME.COMPLETE) {
    state.outcomes.set(targetGroup.id, VISUAL_LANE_OUTCOME.CORRECT)
    return VISUAL_LANE_OUTCOME.CORRECT
  }

  if (result.outcome === MATCH_OUTCOME.WRONG) {
    state.outcomes.set(targetGroup.id, VISUAL_LANE_OUTCOME.WRONG)
    return VISUAL_LANE_OUTCOME.WRONG
  }

  return null
}

export function playAlongOutcomesMap(state) {
  return state?.outcomes ?? new Map()
}

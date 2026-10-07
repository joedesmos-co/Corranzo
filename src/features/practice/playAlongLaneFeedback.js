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

/**
 * Play Along timing windows (bounded evaluator, ALL input sources).
 *
 * Musical rationale (absolute, not tempo-scaled so fast passages stay
 * playable and slow passages stay strict):
 * - Early edge 150 ms ≈ a 32nd note at quarter=120 BPM (500 ms beat). It
 *   absorbs human anticipation and MIDI/keyboard latency without crediting
 *   the previous beat's note.
 * - Late edge 280 ms ≈ just over half a beat at 120 BPM. It allows
 *   expressive lag and legato overlap while preventing a late note from
 *   stealing credit for the following onset.
 * - Miss declared after the late edge: the playhead has audibly passed and
 *   the player did not produce the pitch in time.
 * Do NOT tune these numbers merely to make tests pass; Ordem: they are the
 * audible contract the tests verify.
 */
export function playAlongWindowStart(group) {
  return group.timeSeconds - VISUAL_EARLY_INPUT_SECONDS
}

export function playAlongWindowEnd(group) {
  return group.timeSeconds + PLAY_ALONG_MISS_AFTER_SECONDS
}

/**
 * Classify a (pitch-matched) attack by its score-time delta:
 * too-early | early (accepted) | on-time | late (accepted) | too-late.
 * Pitch mismatches are 'wrong' regardless of timing (handled by the
 * pitch matcher, not here).
 */
export function classifyPlayAlongTimingDelta(deltaSeconds) {
  const delta = Number(deltaSeconds)
  if (!Number.isFinite(delta)) return 'ignored'
  if (delta < -VISUAL_EARLY_INPUT_SECONDS) return 'too-early'
  if (delta < -0.06) return 'early'
  if (delta <= 0.06) return 'on-time'
  if (delta <= PLAY_ALONG_MISS_AFTER_SECONDS) return 'late'
  return 'too-late'
}

export function timingDeltaForGroup(group, currentTime) {
  if (!group) return null
  const time = Number(currentTime)
  if (!Number.isFinite(time)) return null
  return time - Number(group.timeSeconds)
}

/**
 * Mark groups the playhead has passed without a correct hit as missed.
 */
export function updatePlayAlongMisses(state, groups, currentTime) {
  if (!state || !groups?.length) {
    return false
  }
  const time = Number(currentTime)
  if (!Number.isFinite(time)) {
    return false
  }
  let changed = false
  for (const group of groups) {
    if (state.outcomes.has(group.id)) {
      continue
    }
    if (time > playAlongWindowEnd(group)) {
      state.outcomes.set(group.id, VISUAL_LANE_OUTCOME.MISSED)
      changed = true
    }
  }
  return changed
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

/**
 * Seek semantics: drop outcomes that belong to the previous timeline
 * traversal. Every outcome whose group onset is AFTER the seek position is
 * stale future (misses/hits from a pass the player just abandoned) and is
 * removed. Outcomes at or before the seek position are kept — they already
 * happened. The natural miss pass re-marks skipped groups as the playhead
 * advances, so forward seeks need no special fabrication.
 */
export function prunePlayAlongOutcomesAfterSeek(state, groups, seekTimeSeconds) {
  if (!state) return false
  const seekTime = Number(seekTimeSeconds)
  if (!Number.isFinite(seekTime)) return false
  const byId = new Map((groups ?? []).map((group) => [group.id, Number(group.timeSeconds)]))
  let removed = false
  for (const [groupId] of state.outcomes) {
    const onset = byId.get(groupId)
    if (onset != null && Number.isFinite(onset) && onset > seekTime + 1e-6) {
      state.outcomes.delete(groupId)
      removed = true
    }
  }
  if (state.activeGroupId != null) {
    const activeOnset = byId.get(state.activeGroupId)
    if (activeOnset != null && Number.isFinite(activeOnset) && activeOnset > seekTime + 1e-6) {
      state.activeGroupId = null
      resetMusicalEventBufferState(state.matchBuffer)
      removed = true
    }
  }
  return removed
}

/**
 * Loop iteration semantics: the current iteration must not inherit old
 * misses/hits. Prior iterations remain attributable via (attemptId,
 * iterationId) in the ledger when retained; the live lane resets to empty.
 */
export function resetPlayAlongForLoopIteration(state) {
  resetPlayAlongFeedbackState(state)
}

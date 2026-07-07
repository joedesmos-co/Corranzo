/**
 * Visual lane note outcomes — layered on top of temporal past/current/upcoming
 * status for Play Along scoring and Wait For You match feedback.
 */

export const VISUAL_LANE_OUTCOME = {
  NEUTRAL: 'neutral',
  CORRECT: 'correct',
  WRONG: 'wrong',
  MISSED: 'missed',
}

/** How early Play Along / WFY accept input before the note onset (seconds). */
export const VISUAL_EARLY_INPUT_SECONDS = 0.15

/** Grace after onset before a Play Along note is marked missed (seconds). */
export const PLAY_ALONG_MISS_AFTER_SECONDS = 0.28

/**
 * CSS class suffix for a lane note: outcome overrides temporal status when set.
 */
export function resolveLaneNoteClass(temporalStatus, outcome = VISUAL_LANE_OUTCOME.NEUTRAL) {
  if (outcome === VISUAL_LANE_OUTCOME.CORRECT) {
    return 'correct'
  }
  if (outcome === VISUAL_LANE_OUTCOME.WRONG || outcome === VISUAL_LANE_OUTCOME.MISSED) {
    return 'wrong'
  }
  return temporalStatus ?? 'upcoming'
}

/**
 * Attach lane outcomes from a group-id map onto windowed lane groups.
 */
export function applyLaneOutcomes(groups, outcomesByGroupId = null) {
  if (!groups?.length || !outcomesByGroupId) {
    return groups ?? []
  }
  return groups.map((group) => ({
    ...group,
    laneOutcome: outcomesByGroupId.get(group.id) ?? VISUAL_LANE_OUTCOME.NEUTRAL,
  }))
}

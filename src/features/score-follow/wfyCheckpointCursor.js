import { WFY_STATUS } from '../practice/waitForYouEngine.js'
import { WFY_CHECKPOINT_MODE } from '../practice/waitForYouCheckpointMode.js'

/**
 * Wait For You checkpoint-locked cursor (I2).
 *
 * In WFY note mode the canonical checkpoint owns a resolved score position
 * (exact source notehead when OMR geometry exists, onset-mapped otherwise).
 * The shared timeline cursor keeps driving y (system-anchored bar) and all
 * non-WFY modes untouched; only the x column (and page on disagreement)
 * lock to the checkpoint so the playhead sits on the required notehead
 * instead of a time-proportional guess inside the measure.
 *
 * Pure function of engine state — never advances anything.
 */
export function resolveWfyCheckpointCursor({
  practiceMode,
  checkpointMode,
  waitForYouStatus,
  currentCheckpoint,
  noteTarget,
  scoreFollowCursor,
}) {
  const locked =
    practiceMode === 'wait-for-you' &&
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    waitForYouStatus === WFY_STATUS.WAITING &&
    currentCheckpoint != null &&
    noteTarget?.visible === true &&
    Number.isFinite(noteTarget.x)
  if (!locked) {
    return null
  }
  return {
    visible: Boolean(scoreFollowCursor?.visible ?? true),
    page: noteTarget.page ?? scoreFollowCursor?.page ?? 1,
    measureNumber: currentCheckpoint.measureNumber ?? scoreFollowCursor?.measureNumber ?? null,
    x: noteTarget.x,
    y: scoreFollowCursor?.y ?? noteTarget.noteAnchorY ?? noteTarget.y ?? null,
    smoothed: false,
    checkpointLocked: true,
  }
}

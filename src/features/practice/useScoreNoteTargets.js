import { useMemo } from 'react'
import { buildNoteCheckpoints } from './waitForYouCheckpoints.js'
import { resolveNoteTargetPosition } from './noteTargetPosition.js'
import {
  COMPLETED_TRAIL_CAP,
  SCORE_NOTE_STATE,
  findScoreEventIndexAtTime,
  resolveWfyScoreNoteStates,
} from './scoreNoteStates.js'

/**
 * Note-level checkpoints for timeline-following modes (Preview, Play Along).
 * Wait For You builds its own checkpoint list (beat or note mode); the score
 * highlight for timeline modes always wants note events, so it is built here
 * from the same canonical timing model — never a parallel truth.
 */
export function useScoreEventCheckpoints({ timingMap, loopRegion = null, practiceScope = null }) {
  return useMemo(
    () => buildNoteCheckpoints(timingMap, loopRegion, { practiceScope }),
    [timingMap, loopRegion, practiceScope],
  )
}

/**
 * The single score event under the playhead at practiceTime, with its
 * resolved PDF geometry. Read-only: follows the timeline, never advances it.
 */
export function useTimelineScoreTarget({
  checkpoints,
  practiceTime,
  timingMap,
  anchors,
  sourceVisualMap = null,
  preferredRepresentation = null,
  mode = 'play-along',
  enabled = true,
}) {
  const index = useMemo(
    () => (enabled ? findScoreEventIndexAtTime(checkpoints, practiceTime) : -1),
    [enabled, checkpoints, practiceTime],
  )
  const checkpoint = index >= 0 ? (checkpoints?.[index] ?? null) : null
  const target = useMemo(
    () =>
      enabled && checkpoint
        ? resolveNoteTargetPosition({
            checkpoint,
            timingMap,
            anchors,
            sourceVisualMap,
            preferredRepresentation,
            mode,
          })
        : { visible: false, reason: 'timeline-target-disabled' },
    [enabled, checkpoint, timingMap, anchors, sourceVisualMap, preferredRepresentation, mode],
  )
  return { index, checkpoint, target }
}

/**
 * Wait For You score states: the current required checkpoint plus a bounded
 * trail of already-completed checkpoints, each with resolved PDF geometry.
 * Upcoming checkpoints render in the normal score color (no entry returned).
 */
export function useWfyScoreTrail({
  active,
  checkpoints,
  checkpointIndex,
  status,
  inputFeedback,
  timingMap,
  anchors,
  sourceVisualMap = null,
  preferredRepresentation = null,
  enabled = true,
}) {
  const states = useMemo(
    () =>
      enabled && active
        ? resolveWfyScoreNoteStates({
            checkpoints,
            checkpointIndex,
            status,
            inputFeedback,
          })
        : new Map(),
    [enabled, active, checkpoints, checkpointIndex, status, inputFeedback],
  )

  return useMemo(() => {
    if (states.size === 0) {
      return []
    }
    const trail = []
    const ordered = [...states.keys()].sort((left, right) => left - right)
    // Bound geometry resolution: most recent completed first is what the
    // musician sees; older entries beyond the cap keep no highlight.
    const recent = ordered.slice(-(COMPLETED_TRAIL_CAP + 1))
    for (const index of recent) {
      const checkpoint = checkpoints?.[index] ?? null
      if (!checkpoint) {
        continue
      }
      const target = resolveNoteTargetPosition({
        checkpoint,
        timingMap,
        anchors,
        sourceVisualMap,
        preferredRepresentation,
        mode: 'wait-for-you',
      })
      if (!target?.visible) {
        continue
      }
      trail.push({ index, checkpoint, state: states.get(index), target })
    }
    return trail
  }, [states, checkpoints, timingMap, anchors, sourceVisualMap, preferredRepresentation])
}

export { SCORE_NOTE_STATE }

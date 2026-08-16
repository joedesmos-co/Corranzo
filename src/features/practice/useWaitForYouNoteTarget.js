import { useMemo } from 'react'
import { WFY_CHECKPOINT_MODE } from './waitForYouCheckpointMode.js'
import { WFY_STATUS } from './waitForYouEngine.js'
import { resolveNoteTargetPosition } from './noteTargetPosition.js'

export default function useWaitForYouNoteTarget({
  active,
  checkpointMode,
  waitForYouStatus,
  currentCheckpoint,
  timingMap,
  anchors,
  sourceVisualMap = null,
  preferredRepresentation = null,
  mode = 'wait-for-you',
  visiblePageNumber,
}) {
  const target = useMemo(
    () =>
      resolveNoteTargetPosition({
        checkpoint: currentCheckpoint,
        timingMap,
        anchors,
        sourceVisualMap,
        preferredRepresentation,
        mode,
      }),
    [
      currentCheckpoint,
      timingMap,
      anchors,
      sourceVisualMap,
      preferredRepresentation,
      mode,
    ],
  )

  const showOnPage = useMemo(() => {
    const modeAllowsDisplay =
      mode === 'play-along'
        ? active
        : active && waitForYouStatus === WFY_STATUS.WAITING
    if (!modeAllowsDisplay || checkpointMode !== WFY_CHECKPOINT_MODE.NOTE) {
      return false
    }
    if (!target?.visible) {
      return false
    }
    return target.page === visiblePageNumber
  }, [active, checkpointMode, waitForYouStatus, target, visiblePageNumber, mode])

  return {
    target,
    showOnPage,
    wrongPage: Boolean(
      active &&
        mode !== 'play-along' &&
        checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
        waitForYouStatus === WFY_STATUS.WAITING &&
        target?.visible &&
        target.page !== visiblePageNumber,
    ),
  }
}

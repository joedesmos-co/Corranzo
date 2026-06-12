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
  visiblePageNumber,
}) {
  const target = useMemo(
    () =>
      resolveNoteTargetPosition({
        checkpoint: currentCheckpoint,
        timingMap,
        anchors,
      }),
    [currentCheckpoint, timingMap, anchors],
  )

  const showOnPage = useMemo(() => {
    if (
      !active ||
      checkpointMode !== WFY_CHECKPOINT_MODE.NOTE ||
      waitForYouStatus !== WFY_STATUS.WAITING
    ) {
      return false
    }
    if (!target?.visible) {
      return false
    }
    return target.page === visiblePageNumber
  }, [active, checkpointMode, waitForYouStatus, target, visiblePageNumber])

  return {
    target,
    showOnPage,
    wrongPage: Boolean(
      active &&
        checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
        waitForYouStatus === WFY_STATUS.WAITING &&
        target?.visible &&
        target.page !== visiblePageNumber,
    ),
  }
}

import { useCallback, useMemo } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { useScoreFollowCursor } from '../../context/PracticeTickContext.jsx'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import { WFY_STATUS } from '../../features/practice/waitForYouEngine.js'
import usePracticePageFollow from '../../features/practice/usePracticePageFollow.js'

export default function PracticePageFollowController({
  scrollContainerRef,
  pageNumber,
  numPages,
  onGoToPage,
  onPrevPage,
  onNextPage,
}) {
  const { scoreFollow, session, waitForYouNoteTarget } = usePracticeSessionContext()
  const { displayCursor } = useScoreFollowCursor()

  const handleGoToPage = useCallback(
    (page) => {
      if (onGoToPage) {
        onGoToPage(page)
        return
      }
      if (page === pageNumber - 1) {
        onPrevPage?.()
      } else if (page === pageNumber + 1) {
        onNextPage?.()
      }
    },
    [onGoToPage, onNextPage, onPrevPage, pageNumber],
  )

  const pageFollowActive = Boolean(
    scoreFollow.enabled && scoreFollow.canFollow && !scoreFollow.alignmentMode,
  )

  const noteFollowTarget = useMemo(() => {
    if (
      !session.isWaitForYou ||
      session.checkpointMode !== WFY_CHECKPOINT_MODE.NOTE ||
      session.waitForYou.status !== WFY_STATUS.WAITING ||
      !waitForYouNoteTarget?.target?.visible
    ) {
      return null
    }
    return {
      active: true,
      page: waitForYouNoteTarget.target.page,
    }
  }, [
    session.isWaitForYou,
    session.checkpointMode,
    session.waitForYou.status,
    waitForYouNoteTarget?.target?.visible,
    waitForYouNoteTarget?.target?.page,
  ])

  usePracticePageFollow({
    active: pageFollowActive,
    scrollContainerRef,
    cursor: displayCursor,
    noteFollowTarget,
    pageNumber,
    numPages,
    onGoToPage: handleGoToPage,
  })

  return null
}

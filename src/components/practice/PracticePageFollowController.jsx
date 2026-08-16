import { useCallback, useMemo } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { useScoreFollowCursor } from '../../context/PracticeTickContext.jsx'
import usePracticePageFollow from '../../features/practice/usePracticePageFollow.js'
import { isPlaybackVisualsOffEnabled } from '../../features/playback/playbackVisualsDiagnostics.js'

export default function PracticePageFollowController({
  scrollContainerRef,
  pageNumber,
  numPages,
  onGoToPage,
  onPrevPage,
  onNextPage,
}) {
  const { scoreFollow, practiceNoteTarget } = usePracticeSessionContext()
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

  const noteFollowTarget = useMemo(() => {
    const target = practiceNoteTarget?.target
    if (!practiceNoteTarget?.active || !target?.visible) {
      return null
    }
    return {
      active: true,
      page: target.page,
      targetKey: target.targetKey ?? null,
      y: target.noteAnchorY ?? target.y ?? null,
      mode: practiceNoteTarget.mode ?? target.mode ?? null,
    }
  }, [
    practiceNoteTarget?.active,
    practiceNoteTarget?.mode,
    practiceNoteTarget?.target,
  ])

  const pageFollowActive = Boolean(
    !scoreFollow.alignmentMode &&
      !isPlaybackVisualsOffEnabled() &&
      ((scoreFollow.enabled && scoreFollow.canFollow) || noteFollowTarget?.active),
  )

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

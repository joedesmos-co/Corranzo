import { useCallback } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { useScoreFollowCursor } from '../../context/PracticeTickContext.jsx'
import usePracticePageFollow from '../../features/practice/usePracticePageFollow.js'

export default function PracticePageFollowController({
  scrollContainerRef,
  pageNumber,
  numPages,
  onGoToPage,
  onPrevPage,
  onNextPage,
}) {
  const { scoreFollow } = usePracticeSessionContext()
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

  usePracticePageFollow({
    active: pageFollowActive,
    scrollContainerRef,
    cursor: displayCursor,
    pageNumber,
    numPages,
    onGoToPage: handleGoToPage,
  })

  return null
}

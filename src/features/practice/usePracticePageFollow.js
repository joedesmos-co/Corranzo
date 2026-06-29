import { useEffect, useRef } from 'react'

const SCROLL_ALPHA = 0.11
const LOOKAHEAD_RATIO = 0.36
const PAGE_SWITCH_DEBOUNCE_MS = 16
const USER_SCROLL_SUSPEND_MS = 2000

/**
 * Resolve which PDF page page-follow should keep in view.
 * Wait For You note mode uses the checkpoint note target when the playback
 * cursor is hidden.
 */
export function resolvePageFollowTarget({ cursor, noteFollowTarget } = {}) {
  if (noteFollowTarget?.active && Number.isFinite(noteFollowTarget.page)) {
    return noteFollowTarget.page
  }
  if (cursor?.visible && Number.isFinite(cursor.page)) {
    return cursor.page
  }
  return null
}

/**
 * Gentle PDF scroll + page advance to keep the score-follow cursor in view.
 */
export default function usePracticePageFollow({
  active,
  scrollContainerRef,
  cursor,
  noteFollowTarget = null,
  pageNumber,
  numPages,
  onGoToPage,
}) {
  const scrollStateRef = useRef({ top: 0, seeded: false })
  const pageSwitchTimerRef = useRef(null)
  const lastRequestedPageRef = useRef(pageNumber)
  const userScrollUntilRef = useRef(0)

  useEffect(() => {
    const followPage = resolvePageFollowTarget({ cursor, noteFollowTarget })
    if (!active || !scrollContainerRef?.current || followPage == null) {
      return undefined
    }

    if (followPage !== pageNumber && followPage >= 1 && followPage <= (numPages ?? followPage)) {
      if (pageSwitchTimerRef.current) {
        clearTimeout(pageSwitchTimerRef.current)
      }
      pageSwitchTimerRef.current = window.setTimeout(() => {
        if (lastRequestedPageRef.current !== followPage) {
          lastRequestedPageRef.current = followPage
          onGoToPage?.(followPage)
        }
      }, PAGE_SWITCH_DEBOUNCE_MS)
    }

    return () => {
      if (pageSwitchTimerRef.current) {
        clearTimeout(pageSwitchTimerRef.current)
        pageSwitchTimerRef.current = null
      }
    }
  }, [
    active,
    cursor?.page,
    cursor?.visible,
    noteFollowTarget?.active,
    noteFollowTarget?.page,
    pageNumber,
    numPages,
    onGoToPage,
    scrollContainerRef,
  ])

  useEffect(() => {
    lastRequestedPageRef.current = pageNumber
  }, [pageNumber])

  useEffect(() => {
    const container = scrollContainerRef?.current
    if (!active || !container) {
      return undefined
    }

    const markUserScroll = () => {
      userScrollUntilRef.current = Date.now() + USER_SCROLL_SUSPEND_MS
      scrollStateRef.current.top = container.scrollTop
    }

    container.addEventListener('wheel', markUserScroll, { passive: true })
    container.addEventListener('touchmove', markUserScroll, { passive: true })

    return () => {
      container.removeEventListener('wheel', markUserScroll)
      container.removeEventListener('touchmove', markUserScroll)
    }
  }, [active, scrollContainerRef])

  useEffect(() => {
    const followPage = resolvePageFollowTarget({ cursor, noteFollowTarget })
    if (
      !active ||
      !scrollContainerRef?.current ||
      followPage == null ||
      followPage !== pageNumber
    ) {
      scrollStateRef.current.seeded = false
      return undefined
    }

    let frameId = 0

    const tick = () => {
      const container = scrollContainerRef.current
      if (!container) {
        frameId = requestAnimationFrame(tick)
        return
      }

      if (!scrollStateRef.current.seeded) {
        scrollStateRef.current.top = container.scrollTop
        scrollStateRef.current.seeded = true
      }

      const userSuspended = Date.now() < userScrollUntilRef.current
      if (!userSuspended) {
        const containerRect = container.getBoundingClientRect()
        const cursorElement = container.querySelector(
          '.pdf-page-window__slot--active .score-follow-cursor, .pdf-page-frame .score-follow-cursor',
        )
        let cursorPixelY
        if (cursorElement && cursorElement.style.display !== 'none') {
          const cursorRect = cursorElement.getBoundingClientRect()
          cursorPixelY =
            cursorRect.top - containerRect.top + cursorRect.height / 2 + container.scrollTop
        } else {
          const pdfPage = container.querySelector(
            '.pdf-page-window__slot--active .react-pdf__Page, .pdf-page-frame .react-pdf__Page',
          )
          const pageFrame = pdfPage || container.querySelector('.pdf-page-frame')
          if (!pageFrame) {
            frameId = requestAnimationFrame(tick)
            return
          }
          const frameRect = pageFrame.getBoundingClientRect()
          cursorPixelY =
            frameRect.top - containerRect.top + cursor.y * frameRect.height + container.scrollTop
        }
        const targetScrollTop = cursorPixelY - container.clientHeight * LOOKAHEAD_RATIO
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
        const clampedTarget = Math.min(maxScroll, Math.max(0, targetScrollTop))

        const current = scrollStateRef.current.top
        const next = current + (clampedTarget - current) * SCROLL_ALPHA
        scrollStateRef.current.top = next

        if (Math.abs(next - container.scrollTop) > 0.5) {
          container.scrollTop = next
        }
      } else {
        scrollStateRef.current.top = container.scrollTop
      }

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [
    active,
    cursor?.x,
    cursor?.y,
    cursor?.visible,
    cursor?.page,
    noteFollowTarget?.active,
    noteFollowTarget?.page,
    pageNumber,
    scrollContainerRef,
  ])
}

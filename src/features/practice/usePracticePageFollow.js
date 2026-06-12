import { useEffect, useRef } from 'react'

const SCROLL_ALPHA = 0.11
const LOOKAHEAD_RATIO = 0.36
const PAGE_SWITCH_DEBOUNCE_MS = 280

/**
 * Gentle PDF scroll + page advance to keep the score-follow cursor in view.
 */
export default function usePracticePageFollow({
  active,
  scrollContainerRef,
  cursor,
  pageNumber,
  numPages,
  onGoToPage,
}) {
  const scrollStateRef = useRef({ top: 0 })
  const pageSwitchTimerRef = useRef(null)
  const lastRequestedPageRef = useRef(pageNumber)

  useEffect(() => {
    if (!active || !scrollContainerRef?.current || !cursor?.visible) {
      return undefined
    }

    if (cursor.page !== pageNumber && cursor.page >= 1 && cursor.page <= (numPages ?? cursor.page)) {
      if (pageSwitchTimerRef.current) {
        clearTimeout(pageSwitchTimerRef.current)
      }
      pageSwitchTimerRef.current = window.setTimeout(() => {
        if (lastRequestedPageRef.current !== cursor.page) {
          lastRequestedPageRef.current = cursor.page
          onGoToPage?.(cursor.page)
        }
      }, PAGE_SWITCH_DEBOUNCE_MS)
    }

    return () => {
      if (pageSwitchTimerRef.current) {
        clearTimeout(pageSwitchTimerRef.current)
        pageSwitchTimerRef.current = null
      }
    }
  }, [active, cursor?.page, cursor?.visible, pageNumber, numPages, onGoToPage, scrollContainerRef])

  useEffect(() => {
    lastRequestedPageRef.current = pageNumber
  }, [pageNumber])

  useEffect(() => {
    if (!active || !scrollContainerRef?.current || !cursor?.visible || cursor.page !== pageNumber) {
      return undefined
    }

    let frameId = 0

    const tick = () => {
      const container = scrollContainerRef.current
      const pageFrame = container?.querySelector('.pdf-page-frame')
      if (!container || !pageFrame) {
        frameId = requestAnimationFrame(tick)
        return
      }

      const containerRect = container.getBoundingClientRect()
      const frameRect = pageFrame.getBoundingClientRect()
      const cursorPixelY = frameRect.top - containerRect.top + cursor.y * frameRect.height + container.scrollTop
      const targetScrollTop = cursorPixelY - container.clientHeight * LOOKAHEAD_RATIO
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
      const clampedTarget = Math.min(maxScroll, Math.max(0, targetScrollTop))

      const current = scrollStateRef.current.top
      const next = current + (clampedTarget - current) * SCROLL_ALPHA
      scrollStateRef.current.top = next

      if (Math.abs(next - container.scrollTop) > 0.5) {
        container.scrollTop = next
      }

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [active, cursor?.x, cursor?.y, cursor?.visible, cursor?.page, pageNumber, scrollContainerRef])
}

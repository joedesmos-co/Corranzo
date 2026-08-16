import { useEffect, useRef } from 'react'

const SCROLL_ALPHA = 0.11
const LOOKAHEAD_RATIO = 0.36
const PAGE_SWITCH_DEBOUNCE_MS = 16
const USER_SCROLL_SUSPEND_MS = 2000
const DOM_CACHE_REFRESH_FRAMES = 30

/**
 * Resolve which PDF page page-follow should keep in view.
 * An active semantic note target wins in both Wait For You and Play Along;
 * otherwise the long-standing score-follow cursor remains authoritative.
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
  const cursorRef = useRef(cursor)
  const noteFollowTargetRef = useRef(noteFollowTarget)
  const domCacheRef = useRef({
    container: null,
    cursorElement: null,
    noteTargetElements: [],
    noteTargetKey: null,
    pageFrame: null,
    pageNumber: null,
    frameCounter: 0,
  })

  cursorRef.current = cursor
  noteFollowTargetRef.current = noteFollowTarget

  useEffect(() => {
    const followPage = resolvePageFollowTarget({
      cursor: cursorRef.current,
      noteFollowTarget: noteFollowTargetRef.current,
    })
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
    noteFollowTarget?.targetKey,
    pageNumber,
    numPages,
    onGoToPage,
    scrollContainerRef,
  ])

  useEffect(() => {
    lastRequestedPageRef.current = pageNumber
    domCacheRef.current.pageNumber = null
  }, [pageNumber, noteFollowTarget?.targetKey])

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
    const followPage = resolvePageFollowTarget({
      cursor: cursorRef.current,
      noteFollowTarget: noteFollowTargetRef.current,
    })
    if (
      !active ||
      !scrollContainerRef?.current ||
      followPage == null ||
      followPage !== pageNumber
    ) {
      scrollStateRef.current.seeded = false
      domCacheRef.current.pageNumber = null
      return undefined
    }

    let frameId = 0

    const refreshDomCache = (container) => {
      const cache = domCacheRef.current
      cache.container = container
      cache.cursorElement = container.querySelector(
        '.pdf-page-window__slot--active .score-follow-cursor, .pdf-page-frame .score-follow-cursor',
      )
      cache.noteTargetElements = noteFollowTargetRef.current?.active
        ? [
            ...container.querySelectorAll(
              '.pdf-page-window__slot--active [data-practice-note-target="true"], .pdf-page-frame [data-practice-note-target="true"]',
            ),
          ]
        : []
      cache.noteTargetKey = noteFollowTargetRef.current?.targetKey ?? null
      const pdfPage = container.querySelector(
        '.pdf-page-window__slot--active .react-pdf__Page, .pdf-page-frame .react-pdf__Page',
      )
      cache.pageFrame = pdfPage || container.querySelector('.pdf-page-frame')
      cache.pageNumber = pageNumber
      cache.frameCounter = 0
    }

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
        const cache = domCacheRef.current
        const liveNoteTarget = noteFollowTargetRef.current
        if (
          cache.pageNumber !== pageNumber ||
          cache.noteTargetKey !== (liveNoteTarget?.targetKey ?? null) ||
          (liveNoteTarget?.active && cache.noteTargetElements.length === 0) ||
          cache.frameCounter >= DOM_CACHE_REFRESH_FRAMES
        ) {
          refreshDomCache(container)
        } else {
          cache.frameCounter += 1
        }

        const liveCursor = cursorRef.current
        const containerRect = cache.container.getBoundingClientRect()
        let cursorPixelY
        const targetRects = liveNoteTarget?.active
          ? cache.noteTargetElements
              .filter((element) => element.isConnected)
              .map((element) => element.getBoundingClientRect())
              .filter((rect) => rect.width > 0 && rect.height > 0)
          : []
        if (targetRects.length > 0) {
          const top = Math.min(...targetRects.map((rect) => rect.top))
          const bottom = Math.max(...targetRects.map((rect) => rect.bottom))
          cursorPixelY =
            (top + bottom) / 2 - containerRect.top + container.scrollTop
        } else if (liveNoteTarget?.active) {
          // The target page/frame may still be mounting. Do not drift toward a
          // stale playback cursor while the semantic target owns page follow.
          frameId = requestAnimationFrame(tick)
          return
        } else if (cache.cursorElement && cache.cursorElement.style.display !== 'none') {
          const cursorRect = cache.cursorElement.getBoundingClientRect()
          cursorPixelY =
            cursorRect.top - containerRect.top + cursorRect.height / 2 + container.scrollTop
        } else if (cache.pageFrame && Number.isFinite(liveCursor?.y)) {
          const frameRect = cache.pageFrame.getBoundingClientRect()
          cursorPixelY =
            frameRect.top - containerRect.top + liveCursor.y * frameRect.height + container.scrollTop
        } else {
          frameId = requestAnimationFrame(tick)
          return
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
    pageNumber,
    noteFollowTarget?.active,
    noteFollowTarget?.targetKey,
    scrollContainerRef,
  ])
}

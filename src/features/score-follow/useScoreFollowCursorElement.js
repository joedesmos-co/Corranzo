import { useEffect, useRef } from 'react'
import {
  getScoreFollowCursorSnapshot,
  subscribeScoreFollowCursor,
} from './scoreFollowCursorRuntime.js'

function paintCursorElement(element, pageNumber, showCursor) {
  const cursor = getScoreFollowCursorSnapshot()
  const visible =
    showCursor && cursor.visible && cursor.page === pageNumber && cursor.x != null
  if (!visible) {
    element.style.display = 'none'
    return
  }
  element.style.display = ''
  element.style.left = `${cursor.x * 100}%`
  element.style.top = `${cursor.y * 100}%`
}

/**
 * Paint cursor x/y directly on a DOM node — bypasses React style updates per frame.
 */
export default function useScoreFollowCursorElement({
  elementRef,
  pageNumber,
  showCursor,
}) {
  useEffect(() => {
    const element = elementRef.current
    if (!element) {
      return undefined
    }

    const paint = () => {
      paintCursorElement(element, pageNumber, showCursor)
    }

    paint()
    return subscribeScoreFollowCursor(paint)
  }, [elementRef, pageNumber, showCursor])
}

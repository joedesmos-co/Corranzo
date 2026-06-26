import { useEffect, useRef } from 'react'
import {
  getScoreFollowCursorSnapshot,
  subscribeScoreFollowCursor,
} from './scoreFollowCursorRuntime.js'
import { mapAnalysisPointToViewerOverlay } from '../../utils/analysisViewerCoords.js'

function paintCursorElement(element, pageNumber, showCursor, getPageViewRotation) {
  const cursor = getScoreFollowCursorSnapshot()
  const visible =
    showCursor && cursor.visible && cursor.page === pageNumber && cursor.x != null
  if (!visible) {
    element.style.display = 'none'
    return
  }
  const rotation = getPageViewRotation?.(pageNumber) ?? 0
  const mapped = mapAnalysisPointToViewerOverlay(cursor.x, cursor.y, rotation)
  element.style.display = ''
  element.style.left = `${mapped.x * 100}%`
  element.style.top = `${mapped.y * 100}%`
}

/**
 * Paint cursor x/y directly on a DOM node — bypasses React style updates per frame.
 */
export default function useScoreFollowCursorElement({
  elementRef,
  pageNumber,
  showCursor,
  getPageViewRotation,
}) {
  const getPageViewRotationRef = useRef(getPageViewRotation)
  getPageViewRotationRef.current = getPageViewRotation

  useEffect(() => {
    const element = elementRef.current
    if (!element) {
      return undefined
    }

    const paint = () => {
      paintCursorElement(element, pageNumber, showCursor, getPageViewRotationRef.current)
    }

    paint()
    return subscribeScoreFollowCursor(paint)
  }, [elementRef, pageNumber, showCursor, getPageViewRotation])
}

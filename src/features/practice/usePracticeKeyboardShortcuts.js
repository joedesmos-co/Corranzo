import { useEffect, useRef } from 'react'
import { WFY_STATUS } from './waitForYouEngine.js'

function isEditableTarget(target) {
  if (!target || !(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function isPdfFullscreenOpen() {
  return Boolean(document.querySelector('.pdf-fullscreen'))
}

/**
 * Global practice keyboard shortcuts (ignored while typing in form fields).
 */
export default function usePracticeKeyboardShortcuts({
  enabled,
  isPlaying,
  hasMidi,
  hasMusicXml = false,
  isWaitForYou,
  waitForYouStatus = WFY_STATUS.INACTIVE,
  alignmentMode = false,
  playbackLoading = false,
  allowPageKeys = true,
  canPrevPage,
  canNextPage,
  canPrevMeasure,
  canNextMeasure,
  onTogglePlayPause,
  onPrevPage,
  onNextPage,
  onPrevMeasure,
  onNextMeasure,
  onToggleFullscreen,
  onWaitForYouContinue,
}) {
  const handlersRef = useRef({
    onTogglePlayPause,
    onPrevPage,
    onNextPage,
    onPrevMeasure,
    onNextMeasure,
    onToggleFullscreen,
    onWaitForYouContinue,
  })

  handlersRef.current = {
    onTogglePlayPause,
    onPrevPage,
    onNextPage,
    onPrevMeasure,
    onNextMeasure,
    onToggleFullscreen,
    onWaitForYouContinue,
  }

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    function handleKeyDown(event) {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return
      }

      const key = event.key
      const handlers = handlersRef.current

      if (alignmentMode) {
        return
      }

      const canContinueWfy =
        isWaitForYou &&
        waitForYouStatus !== WFY_STATUS.COMPLETE &&
        waitForYouStatus !== WFY_STATUS.NO_CHECKPOINTS

      if (canContinueWfy && (key === 'Enter' || key === 'n' || key === 'N')) {
        event.preventDefault()
        handlers.onWaitForYouContinue?.()
        return
      }

      if (key === ' ' || key === 'Spacebar') {
        if ((hasMusicXml || hasMidi) && !isWaitForYou && !playbackLoading) {
          event.preventDefault()
          handlers.onTogglePlayPause?.()
        }
        return
      }

      if (key === 'f' || key === 'F') {
        event.preventDefault()
        handlers.onToggleFullscreen?.()
        return
      }

      if (key === 'ArrowLeft') {
        if (event.shiftKey) {
          if (canPrevMeasure) {
            event.preventDefault()
            handlers.onPrevMeasure?.()
          }
        } else if (allowPageKeys && !isPdfFullscreenOpen() && canPrevPage) {
          event.preventDefault()
          handlers.onPrevPage?.()
        }
        return
      }

      if (key === 'ArrowRight') {
        if (event.shiftKey) {
          if (canNextMeasure) {
            event.preventDefault()
            handlers.onNextMeasure?.()
          }
        } else if (allowPageKeys && !isPdfFullscreenOpen() && canNextPage) {
          event.preventDefault()
          handlers.onNextPage?.()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    enabled,
    isPlaying,
    hasMidi,
    hasMusicXml,
    isWaitForYou,
    waitForYouStatus,
    alignmentMode,
    playbackLoading,
    allowPageKeys,
    canPrevPage,
    canNextPage,
    canPrevMeasure,
    canNextMeasure,
  ])
}

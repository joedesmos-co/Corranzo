import { useEffect, useRef } from 'react'
import { PRACTICE_MODE } from './practiceMode.js'
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
  onModeChange,
  onAdjustTempo,
  onLoop,
}) {
  const handlersRef = useRef({
    onTogglePlayPause,
    onPrevPage,
    onNextPage,
    onPrevMeasure,
    onNextMeasure,
    onToggleFullscreen,
    onWaitForYouContinue,
    onModeChange,
    onAdjustTempo,
    onLoop,
  })

  handlersRef.current = {
    onTogglePlayPause,
    onPrevPage,
    onNextPage,
    onPrevMeasure,
    onNextMeasure,
    onToggleFullscreen,
    onWaitForYouContinue,
    onModeChange,
    onAdjustTempo,
    onLoop,
  }

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    function handleKeyDown(event) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target) || event.target?.closest?.('[role="dialog"], .tb-popover__panel:not([hidden])')) {
        return
      }

      if (alignmentMode) return
      const key = event.key
      if (event.target?.closest?.('button, a, summary, [role="radio"]') && [' ', 'Spacebar', 'Enter', 'ArrowLeft', 'ArrowRight'].includes(key)) return
      if (['1', '2', '3'].includes(key)) { event.preventDefault(); handlersRef.current.onModeChange?.(Object.values(PRACTICE_MODE)[Number(key) - 1]); return }
      if (['-', '+', '='].includes(key) && hasMusicXml && !playbackLoading) { event.preventDefault(); handlersRef.current.onAdjustTempo?.(key === '-' ? -.05 : .05); return }
      if (key.toLowerCase() === 'l') { event.preventDefault(); handlersRef.current.onLoop?.(); return }
      const handlers = handlersRef.current

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

import { useEffect, useRef } from 'react'
import { shouldRestartLoop } from './practiceLoopRegion.js'

/**
 * Restarts playback at loop start when the practice clock passes loop end.
 */
export default function useLoopPlayback({
  enabled,
  region,
  isPlaying,
  hasPlayback,
  currentTime,
  duration = 0,
  onLoopRestart,
}) {
  const isWrappingRef = useRef(false)

  useEffect(() => {
    if (!enabled || !region?.isValid || !hasPlayback) {
      isWrappingRef.current = false
      return
    }

    const loopEndNearPieceEnd =
      duration > 0 && region.endTimeSeconds >= duration - 0.05
    const atPieceEnd = duration > 0 && currentTime >= duration - 0.001
    const shouldWrap =
      shouldRestartLoop(currentTime, region) || (atPieceEnd && loopEndNearPieceEnd)
    const activePlayback = isPlaying || (atPieceEnd && loopEndNearPieceEnd)

    if (!activePlayback) {
      isWrappingRef.current = false
      return
    }

    if (shouldWrap) {
      if (!isWrappingRef.current) {
        isWrappingRef.current = true
        onLoopRestart(region.startTimeSeconds)
      }
      return
    }

    if (currentTime <= region.startTimeSeconds + 0.1) {
      isWrappingRef.current = false
    }
  }, [enabled, region, isPlaying, hasPlayback, currentTime, duration, onLoopRestart])
}

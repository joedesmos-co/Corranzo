import { useEffect, useRef } from 'react'
import { shouldRestartLoop } from './practiceLoopRegion.js'

/**
 * Restarts playback at loop start when the practice clock passes loop end.
 * MIDI playback only — MusicXML-only mode has no transport to loop.
 */
export default function useLoopPlayback({
  enabled,
  region,
  isPlaying,
  hasMidi,
  currentTime,
  onLoopRestart,
}) {
  const isWrappingRef = useRef(false)

  useEffect(() => {
    if (!enabled || !region?.isValid || !isPlaying || !hasMidi) {
      isWrappingRef.current = false
      return
    }

    if (shouldRestartLoop(currentTime, region)) {
      if (!isWrappingRef.current) {
        isWrappingRef.current = true
        onLoopRestart(region.startTimeSeconds)
      }
      return
    }

    if (currentTime <= region.startTimeSeconds + 0.1) {
      isWrappingRef.current = false
    }
  }, [enabled, region, isPlaying, hasMidi, currentTime, onLoopRestart])
}

import { useCallback, useEffect, useState } from 'react'
import {
  beginAutoPracticeSession,
  checkpointAutoPracticeSession,
  endAutoPracticeSession,
  recordAutoPracticeLoop,
  recordAutoPracticeMeasure,
  recordAutoPracticeTempo,
  recordWfyPracticeEvent,
  snapshotActiveSession,
  tickAutoPracticeSession,
  tryEndAutoPracticeSession,
} from './autoPracticeTracker.js'

/**
 * Tracks local-only practice activity while the Practice view is open.
 * Durably checkpoints the active segment every tick and on
 * visibility/pagehide so reload/background/crash neither double-counts nor
 * silently drops time. Flushes accumulated stats to localStorage when the
 * session ends; failed flushes preserve the checkpoint for retry.
 */
export default function usePracticeStatsTracker({
  active = false,
  piece = null,
  measureNumber = null,
  tempoBpm = null,
  onStatsFlush = null,
  instrumentId = null,
}) {
  const [liveSession, setLiveSession] = useState(null)

  useEffect(() => {
    if (!active || !piece?.id) {
      tryEndAutoPracticeSession()
      setLiveSession(null)
      return undefined
    }

    beginAutoPracticeSession(piece, { instrumentId })
    setLiveSession(snapshotActiveSession())

    const tickId = setInterval(() => {
      tickAutoPracticeSession()
      setLiveSession(snapshotActiveSession())
    }, 1000)

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        checkpointAutoPracticeSession()
        setLiveSession(snapshotActiveSession())
      }
    }
    const handlePageHide = () => {
      checkpointAutoPracticeSession()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      clearInterval(tickId)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      const nextStats = endAutoPracticeSession()
      setLiveSession(null)
      onStatsFlush?.(nextStats)
    }
  }, [active, piece?.id, piece?.title, onStatsFlush, instrumentId])

  useEffect(() => {
    if (!active || measureNumber == null) {
      return
    }
    recordAutoPracticeMeasure(measureNumber)
    setLiveSession(snapshotActiveSession())
  }, [active, measureNumber])

  useEffect(() => {
    if (!active || tempoBpm == null) {
      return
    }
    recordAutoPracticeTempo(tempoBpm)
    setLiveSession(snapshotActiveSession())
  }, [active, tempoBpm])

  const recordWfyEvent = useCallback((type) => {
    recordWfyPracticeEvent(type)
    setLiveSession(snapshotActiveSession())
  }, [])

  const recordLoopCompleted = useCallback(() => {
    recordAutoPracticeLoop()
    setLiveSession(snapshotActiveSession())
  }, [])

  return {
    liveSession,
    recordWfyEvent,
    recordLoopCompleted,
  }
}

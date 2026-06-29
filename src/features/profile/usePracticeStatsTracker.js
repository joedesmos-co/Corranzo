import { useCallback, useEffect, useState } from 'react'
import {
  beginAutoPracticeSession,
  endAutoPracticeSession,
  recordAutoPracticeLoop,
  recordAutoPracticeMeasure,
  recordAutoPracticeTempo,
  recordWfyPracticeEvent,
  snapshotActiveSession,
  tickAutoPracticeSession,
} from './autoPracticeTracker.js'

/**
 * Tracks local-only practice activity while the Practice view is open.
 * Flushes accumulated stats to localStorage when the session ends.
 */
export default function usePracticeStatsTracker({
  active = false,
  piece = null,
  measureNumber = null,
  tempoBpm = null,
  onStatsFlush = null,
}) {
  const [liveSession, setLiveSession] = useState(null)

  useEffect(() => {
    if (!active || !piece?.id) {
      endAutoPracticeSession()
      setLiveSession(null)
      return undefined
    }

    beginAutoPracticeSession(piece)
    setLiveSession(snapshotActiveSession())

    const tickId = setInterval(() => {
      tickAutoPracticeSession()
      setLiveSession(snapshotActiveSession())
    }, 1000)

    return () => {
      clearInterval(tickId)
      const nextStats = endAutoPracticeSession()
      setLiveSession(null)
      onStatsFlush?.(nextStats)
    }
  }, [active, piece?.id, piece?.title, onStatsFlush])

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

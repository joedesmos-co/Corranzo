import { useEffect, useMemo } from 'react'
import { useProfileStats } from '../../context/ProfileStatsContext.jsx'
import { buildPieceIdentity } from './pieceIdentity.js'

const TICK_MS = 1000

/**
 * Records time spent in a ready Practice view without depending on playback,
 * score-follow, MIDI, or microphone internals.
 */
export default function usePracticeStatsTracker({
  enabled = false,
  sessionReady = false,
  pdfMeta,
  musicXmlSource,
  timingMap,
  isDemoPiece = false,
}) {
  const { beginPracticeSession, endPracticeSession } = useProfileStats()

  const piece = useMemo(() => {
    if (!enabled || !sessionReady) {
      return null
    }
    return buildPieceIdentity({
      pdfMeta,
      musicXmlSource,
      timingMap,
      isDemoPiece,
    })
  }, [
    enabled,
    sessionReady,
    pdfMeta,
    musicXmlSource,
    timingMap,
    isDemoPiece,
  ])

  useEffect(() => {
    if (!piece) {
      return undefined
    }

    beginPracticeSession(piece)
    let elapsedSeconds = 0
    let lastTickAt = Date.now()
    let wasVisible =
      typeof document === 'undefined' ||
      document.visibilityState === 'visible'
    let finished = false

    function accrueVisibleTime() {
      const now = Date.now()
      if (wasVisible) {
        elapsedSeconds += Math.max(0, (now - lastTickAt) / 1000)
      }
      lastTickAt = now
    }

    function finishSession() {
      if (finished) {
        return
      }
      accrueVisibleTime()
      finished = true
      endPracticeSession(elapsedSeconds)
    }

    function handleVisibilityChange() {
      accrueVisibleTime()
      wasVisible = document.visibilityState === 'visible'
    }

    const intervalId = window.setInterval(accrueVisibleTime, TICK_MS)
    window.addEventListener('pagehide', finishSession)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('pagehide', finishSession)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      finishSession()
    }
  }, [piece, beginPracticeSession, endPracticeSession])
}

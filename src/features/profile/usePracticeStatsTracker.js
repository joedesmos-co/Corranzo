import { useEffect, useMemo, useRef } from 'react'
import { WFY_INPUT_OUTCOME } from '../practice/waitForYouInputFeedback.js'
import { WFY_INPUT_SOURCE } from '../microphone-input/micInputConstants.js'
import { useProfileStats } from '../../context/ProfileStatsContext.jsx'
import { buildPieceIdentity } from './pieceIdentity.js'

const TICK_MS = 1000
const IDLE_MS = 120000

function mapInputSource(source) {
  if (source === WFY_INPUT_SOURCE.MICROPHONE) {
    return 'microphone'
  }
  if (source === WFY_INPUT_SOURCE.MIDI) {
    return 'midi'
  }
  return 'manual'
}

function isAttemptOutcome(outcome) {
  return (
    outcome === WFY_INPUT_OUTCOME.CORRECT ||
    outcome === WFY_INPUT_OUTCOME.WRONG ||
    outcome === WFY_INPUT_OUTCOME.CHORD_PARTIAL
  )
}

/**
 * Tracks active practice time and Wait For You stats while the Practice view is open.
 * Pauses accrual when the tab is hidden or the user has been idle for two minutes.
 */
export default function usePracticeStatsTracker({
  enabled = false,
  sessionReady = false,
  pdfMeta,
  musicXmlSource,
  timingMap,
  isDemoPiece = false,
  practiceMode,
  isWaitForYou = false,
  wfyInputSource,
  waitForYouInput,
  playback,
  loop,
}) {
  const { beginPracticeSession, endPracticeSession, patchPracticeDraft } = useProfileStats()
  const lastActivityRef = useRef(Date.now())
  const prevOutcomeRef = useRef(null)
  const prevPlaybackTimeRef = useRef(0)
  const pieceRef = useRef(null)

  const piece = useMemo(() => {
    if (!enabled || !sessionReady) {
      return null
    }
    return buildPieceIdentity({ pdfMeta, musicXmlSource, timingMap, isDemoPiece })
  }, [
    enabled,
    sessionReady,
    pdfMeta?.fileName,
    musicXmlSource?.fileName,
    timingMap?.title,
    timingMap?.fileName,
    isDemoPiece,
  ])

  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('pointerdown', bump, { passive: true })
    window.addEventListener('keydown', bump)
    return () => {
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('keydown', bump)
    }
  }, [])

  useEffect(() => {
    lastActivityRef.current = Date.now()
  }, [
    playback?.isPlaying,
    wfyInputSource,
    practiceMode,
    loop?.enabled,
    waitForYouInput?.feedbackOutcome,
  ])

  useEffect(() => {
    prevOutcomeRef.current = null
  }, [wfyInputSource])

  useEffect(() => {
    if (!enabled || !sessionReady || !piece) {
      endPracticeSession()
      pieceRef.current = null
      return undefined
    }

    if (pieceRef.current?.id && pieceRef.current.id !== piece.id) {
      endPracticeSession()
    }

    if (!pieceRef.current || pieceRef.current.id !== piece.id) {
      pieceRef.current = piece
      beginPracticeSession(piece)
    }

    return undefined
  }, [enabled, sessionReady, piece?.id, beginPracticeSession, endPracticeSession, piece])

  useEffect(() => {
    if (!enabled || !sessionReady) {
      return undefined
    }

    const isEngaged = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return false
      }
      return Date.now() - lastActivityRef.current < IDLE_MS
    }

    const id = window.setInterval(() => {
      if (!isEngaged()) {
        return
      }

      const playing = Boolean(playback?.isPlaying)
      const inWfy = isWaitForYou

      patchPracticeDraft((draft) => {
        draft.practiceMode = inWfy ? 'wait-for-you' : 'normal'

        if (playing || inWfy) {
          draft.practiceSecondsActive += 1
        }

        if (inWfy) {
          draft.waitForYouSeconds += 1
          const modeKey = mapInputSource(wfyInputSource)
          draft.inputModesUsed[modeKey] = (draft.inputModesUsed[modeKey] ?? 0) + 1
        }

        if (loop?.enabled && playing) {
          const current = playback?.currentTime ?? 0
          const previous = prevPlaybackTimeRef.current
          if (previous > 1 && current < previous - 0.75) {
            draft.loopsPracticed += 1
          }
          prevPlaybackTimeRef.current = current
        }
      })
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [
    enabled,
    sessionReady,
    isWaitForYou,
    wfyInputSource,
    waitForYouInput?.matchingEnabled,
    playback?.isPlaying,
    playback?.currentTime,
    loop?.enabled,
    patchPracticeDraft,
  ])

  useEffect(() => {
    if (!enabled || !sessionReady) {
      return
    }

    if (wfyInputSource === WFY_INPUT_SOURCE.MANUAL) {
      prevOutcomeRef.current = WFY_INPUT_OUTCOME.IDLE
      return
    }

    const outcome = waitForYouInput?.feedbackOutcome ?? waitForYouInput?.inputFeedback?.outcome
    const previous = prevOutcomeRef.current
    prevOutcomeRef.current = outcome

    if (!outcome || outcome === previous) {
      return
    }

    if (
      previous == null &&
      (outcome === WFY_INPUT_OUTCOME.IDLE || outcome === 'idle')
    ) {
      return
    }

    patchPracticeDraft((draft) => {
      if (isAttemptOutcome(outcome)) {
        draft.wfyNotesAttempted += 1
      }
      if (outcome === WFY_INPUT_OUTCOME.CORRECT) {
        draft.wfyNotesMatched += 1
      }
    })
  }, [
    enabled,
    sessionReady,
    wfyInputSource,
    waitForYouInput?.feedbackOutcome,
    waitForYouInput?.inputFeedback?.outcome,
    patchPracticeDraft,
  ])
}

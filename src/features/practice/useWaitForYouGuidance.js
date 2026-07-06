import { useCallback, useEffect, useMemo, useState } from 'react'
import { WFY_INPUT_OUTCOME } from './waitForYouInputFeedback.js'
import { buildGuidance } from './waitForYouGuidance.js'

/** How long to wait (ms) with no progress before auto-revealing the target note. */
export const WFY_HINT_TIMEOUT_MS = 5000

export function feedbackTrackingKey(inputFeedback) {
  if (!inputFeedback) {
    return null
  }
  return [
    inputFeedback.outcome,
    inputFeedback.message ?? '',
    inputFeedback.playedMidi ?? '',
    inputFeedback.playedLabel ?? '',
  ].join('|')
}

/**
 * Coordinates the Wait For You "practice assistant" state across input sources:
 * counts wrong attempts at the current target, reveals a hint after a timeout or
 * on request, and produces a single guidance object for the UI. Pure logic lives
 * in waitForYouGuidance.js; this hook only owns the per-target state.
 */
export default function useWaitForYouGuidance({
  active,
  currentCheckpoint,
  inputFeedback,
  matchingActive = true,
  complete = false,
  timeoutMs = WFY_HINT_TIMEOUT_MS,
  instrument = null,
  strings = null,
  tabPositions = null,
  chordAsSequence = false,
  guitarChordShapeMode = false,
}) {
  const checkpointId = currentCheckpoint?.id ?? null
  const inputFeedbackKey = feedbackTrackingKey(inputFeedback)
  const [wrongAttempts, setWrongAttempts] = useState(0)
  const [timedOut, setTimedOut] = useState(false)
  const [hintRequested, setHintRequested] = useState(false)
  // Tracked-during-render values let us reset/advance state without setState in an
  // effect (the React-recommended "adjust state when a prop changes" pattern).
  const [trackedCheckpointId, setTrackedCheckpointId] = useState(checkpointId)
  const [trackedFeedbackKey, setTrackedFeedbackKey] = useState(inputFeedbackKey)

  if (checkpointId !== trackedCheckpointId) {
    // New target — forget everything about the previous one.
    setTrackedCheckpointId(checkpointId)
    setTrackedFeedbackKey(inputFeedbackKey)
    setWrongAttempts(0)
    setTimedOut(false)
    setHintRequested(false)
  } else if (inputFeedbackKey && inputFeedbackKey !== trackedFeedbackKey) {
    // A fresh input result: count a wrong attempt, or clear the slate on success.
    setTrackedFeedbackKey(inputFeedbackKey)
    if (inputFeedback.outcome === WFY_INPUT_OUTCOME.WRONG) {
      setWrongAttempts((n) => n + 1)
      setTimedOut(false)
    } else if (inputFeedback.outcome === WFY_INPUT_OUTCOME.CORRECT) {
      setWrongAttempts(0)
      setTimedOut(false)
      setHintRequested(false)
    }
  }

  // Reveal the target if the player stalls. The timer restarts on a new target and
  // on each wrong attempt (they are clearly trying), but NOT on every idle mic
  // frame, so a stuck player still gets help.
  useEffect(() => {
    if (!active || !matchingActive || complete) {
      return undefined
    }
    const id = setTimeout(() => setTimedOut(true), timeoutMs)
    return () => clearTimeout(id)
  }, [active, matchingActive, complete, checkpointId, wrongAttempts, timeoutMs])

  useEffect(() => {
    if (!active) {
      setWrongAttempts(0)
      setTimedOut(false)
      setHintRequested(false)
      setTrackedFeedbackKey(null)
    }
  }, [active])

  const requestHint = useCallback(() => setHintRequested(true), [])

  const guidance = useMemo(
    () =>
      buildGuidance({
        checkpoint: currentCheckpoint,
        inputFeedback,
        wrongAttempts,
        timedOut,
        hintRequested,
        complete,
        matchingActive,
        instrument,
        strings,
        tabPositions,
        chordAsSequence,
        guitarChordShapeMode,
      }),
    [currentCheckpoint, inputFeedback, wrongAttempts, timedOut, hintRequested, complete, matchingActive, instrument, strings, tabPositions, chordAsSequence, guitarChordShapeMode],
  )

  return { guidance, wrongAttempts, timedOut, hintRequested, requestHint }
}

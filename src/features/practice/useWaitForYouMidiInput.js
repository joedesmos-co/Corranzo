import { useCallback, useEffect, useRef, useState } from 'react'
import { WFY_CHECKPOINT_MODE } from './waitForYouCheckpointMode.js'
import {
  buildInputFeedback,
  idleFeedbackForCheckpoint,
  WFY_INPUT_OUTCOME,
} from './waitForYouInputFeedback.js'
import {
  createChordMatchState,
  evaluateNoteInput,
  getExpectedMidis,
  MATCH_OUTCOME,
  resetChordMatchState,
  toFeedbackOutcome,
} from './waitForYouNoteMatch.js'
import { isPlayableCheckpointKind } from './waitForYouCheckpoints.js'

/**
 * Bridges Web MIDI note-on events to Wait For You checkpoint matching.
 */
export default function useWaitForYouMidiInput({
  active,
  checkpointMode,
  currentCheckpoint,
  matchSettings,
  onPlayerInputMatched,
  onWrongNote = null,
  webMidi,
}) {
  const chordStateRef = useRef(createChordMatchState())
  const currentCheckpointRef = useRef(currentCheckpoint)
  currentCheckpointRef.current = currentCheckpoint
  const [inputFeedback, setInputFeedback] = useState(() =>
    idleFeedbackForCheckpoint(currentCheckpoint),
  )

  const matchingEnabled =
    active &&
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    isPlayableCheckpointKind(currentCheckpoint?.kind) &&
    webMidi?.isListening

  const resetFeedback = useCallback(() => {
    setInputFeedback(idleFeedbackForCheckpoint(currentCheckpointRef.current))
    resetChordMatchState(chordStateRef.current)
  }, [])

  useEffect(() => {
    resetFeedback()
  }, [currentCheckpoint?.id, matchSettings, resetFeedback])

  useEffect(() => {
    if (!active) {
      resetFeedback()
    }
  }, [active, resetFeedback])

  const handleNoteOn = useCallback(
    (midi) => {
      if (!matchingEnabled || !currentCheckpoint || !matchSettings) {
        return
      }

      const result = evaluateNoteInput(
        currentCheckpoint,
        midi,
        chordStateRef.current,
        matchSettings,
      )

      if (result.outcome === MATCH_OUTCOME.NO_EXPECTED) {
        return
      }

      const feedbackOutcome = toFeedbackOutcome(
        result.outcome,
        result.matchedIndices?.size ?? 0,
      )

      const feedback = buildInputFeedback({
        outcome: feedbackOutcome,
        playedMidi: midi,
        expectedMidis: result.expected,
        matchedIndices: result.matchedIndices,
        isChord: result.isChord,
      })

      setInputFeedback(feedback)

      if (result.outcome === MATCH_OUTCOME.WRONG) {
        onWrongNote?.()
      }

      if (result.outcome === MATCH_OUTCOME.COMPLETE) {
        onPlayerInputMatched()
      }
    },
    [matchingEnabled, currentCheckpoint, matchSettings, onPlayerInputMatched, onWrongNote],
  )

  useEffect(() => {
    if (!matchingEnabled || !onPlayerInputMatched) {
      return undefined
    }

    return webMidi.subscribeNoteOn(handleNoteOn)
  }, [matchingEnabled, onPlayerInputMatched, webMidi, handleNoteOn])

  return {
    matchingEnabled,
    inputFeedback,
    resetFeedback,
    feedbackOutcome: inputFeedback.outcome,
    isWaitingForChord:
      inputFeedback.outcome === WFY_INPUT_OUTCOME.CHORD_PARTIAL ||
      inputFeedback.outcome === WFY_INPUT_OUTCOME.CHORD_WAITING,
  }
}

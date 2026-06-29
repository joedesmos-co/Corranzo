import { useCallback, useEffect, useRef, useState } from 'react'
import { WFY_CHECKPOINT_MODE } from './waitForYouCheckpointMode.js'
import {
  buildInputFeedback,
  idleFeedbackForCheckpoint,
  WFY_INPUT_OUTCOME,
} from './waitForYouInputFeedback.js'
import { chordLabel } from './waitForYouGuidance.js'
import {
  evaluateMicNoteInput,
  evaluateMicNoteInputWithBuffer,
  getExpectedMidis,
  getMicChordMatchTargets,
  MATCH_OUTCOME,
  toFeedbackOutcome,
} from './waitForYouNoteMatch.js'
import {
  buildMicChordProgressMessage,
  createMicChordCollectionState,
  resetMicChordCollectionState,
} from './waitForYouMicChordCollection.js'
import { MIC_CHORD_MODES } from './waitForYouMatchSettings.js'
import { CHECKPOINT_KIND } from './waitForYouCheckpoints.js'
import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import usePitchDetector from '../microphone-input/usePitchDetector.js'

function micFeedbackFromResult(result) {
  if (result.message) {
    const feedbackOutcome = toFeedbackOutcome(
      result.outcome,
      result.matchedIndices?.size ?? 0,
    )
    return {
      outcome: feedbackOutcome,
      message: result.message,
      tone:
        result.outcome === MATCH_OUTCOME.WRONG
          ? 'error'
          : result.outcome === MATCH_OUTCOME.COMPLETE
            ? 'success'
            : 'partial',
      playedMidi: result.playedMidi,
      playedLabel: result.playedLabel ?? null,
      matchedIndices: result.matchedIndices,
      heardLabels: result.heardLabels ?? [],
      remainingLabels: result.remainingLabels ?? [],
      windowReset: Boolean(result.windowReset),
      softWrong: Boolean(result.softWrong),
    }
  }

  return buildInputFeedback({
    outcome: toFeedbackOutcome(result.outcome, result.matchedIndices?.size ?? 0),
    playedMidi: result.playedMidi,
    expectedMidis: result.expected,
    matchedIndices: result.matchedIndices,
    isChord: result.isChord,
  })
}

/**
 * Bridges microphone pitch detection to Wait For You checkpoint matching.
 */
export default function useWaitForYouMicInput({
  active,
  checkpointMode,
  currentCheckpoint,
  matchSettings,
  onPlayerInputMatched,
  onWrongNote = null,
  microphone,
}) {
  const [inputFeedback, setInputFeedback] = useState(() =>
    idleFeedbackForCheckpoint(currentCheckpoint),
  )
  const [lastHeardMidi, setLastHeardMidi] = useState(null)
  const [liveFrame, setLiveFrame] = useState(null)
  const [calibration, setCalibration] = useState(null)
  const [calibrationKey, setCalibrationKey] = useState(0)
  const feedbackOutcomeRef = useRef(inputFeedback.outcome)
  const collectionStateRef = useRef(createMicChordCollectionState())

  const detectEnabled = Boolean(active && microphone?.isListening)
  const micCentsTolerance = matchSettings?.micCentsTolerance ?? 30
  const expectedMidis = getExpectedMidis(currentCheckpoint)
  const isMicChordCollection =
    expectedMidis.length > 1 &&
    getMicChordMatchTargets(currentCheckpoint, matchSettings).mode === MIC_CHORD_MODES.ANY_TONE

  const matchingEnabled =
    detectEnabled &&
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    currentCheckpoint?.kind === CHECKPOINT_KIND.NOTE

  const resetFeedback = useCallback(() => {
    setInputFeedback(idleFeedbackForCheckpoint(currentCheckpoint))
    setLastHeardMidi(null)
    setLiveFrame(null)
    resetMicChordCollectionState(collectionStateRef.current)
  }, [currentCheckpoint])

  useEffect(() => {
    resetFeedback()
  }, [currentCheckpoint?.id, matchSettings, resetFeedback])

  useEffect(() => {
    feedbackOutcomeRef.current = inputFeedback.outcome
  }, [inputFeedback.outcome])

  useEffect(() => {
    if (!matchingEnabled || !isMicChordCollection) {
      return undefined
    }
    const idleHint = buildMicChordProgressMessage({
      remainingLabels: expectedMidis.map((midi) => midiToNoteLabel(midi)),
      includeHint: true,
    })
    setInputFeedback((previous) =>
      previous.outcome === WFY_INPUT_OUTCOME.IDLE
        ? { ...previous, message: idleHint, micChordMode: true }
        : previous,
    )
  }, [matchingEnabled, isMicChordCollection, currentCheckpoint?.id, expectedMidis])

  const retryCalibration = useCallback(() => {
    setCalibration(null)
    setCalibrationKey((value) => value + 1)
  }, [])

  const evaluateMicMatch = useCallback(
    (playedMidi) => {
      if (!currentCheckpoint || !matchSettings) {
        return null
      }
      if (isMicChordCollection) {
        return evaluateMicNoteInputWithBuffer(
          currentCheckpoint,
          playedMidi,
          collectionStateRef.current,
          matchSettings,
        )
      }
      return evaluateMicNoteInput(currentCheckpoint, playedMidi, matchSettings)
    },
    [currentCheckpoint, matchSettings, isMicChordCollection],
  )

  const handleFrame = useCallback(
    (frame) => {
      setLiveFrame(frame)

      if (!matchingEnabled || !currentCheckpoint || !matchSettings) {
        return
      }

      if (frame.midi == null || !frame.gateOpen) {
        return
      }

      const outcome = feedbackOutcomeRef.current
      if (
        outcome === WFY_INPUT_OUTCOME.CORRECT ||
        outcome === WFY_INPUT_OUTCOME.WRONG
      ) {
        return
      }

      const preview = evaluateMicMatch(frame.midi)
      if (!preview) {
        return
      }

      if (preview.outcome === MATCH_OUTCOME.WRONG) {
        setInputFeedback({
          outcome: WFY_INPUT_OUTCOME.IDLE,
          message: `Hearing ${midiToNoteLabel(frame.midi)} — not in ${chordLabel(expectedMidis)}`,
          tone: 'neutral',
          playedMidi: frame.midi,
          playedLabel: midiToNoteLabel(frame.midi),
        })
        return
      }

      if (
        preview.outcome === MATCH_OUTCOME.CHORD_PROGRESS ||
        preview.outcome === MATCH_OUTCOME.COMPLETE
      ) {
        setInputFeedback({
          ...micFeedbackFromResult(preview),
          outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
        })
      }
    },
    [matchingEnabled, currentCheckpoint, matchSettings, evaluateMicMatch, expectedMidis],
  )

  const handleStableMidi = useCallback(
    (midi) => {
      if (!currentCheckpoint || !matchSettings) {
        return
      }

      setLastHeardMidi(midi)

      const result = evaluateMicMatch(midi)
      if (!result) {
        return
      }

      const feedback = micFeedbackFromResult(result)

      if (feedback.outcome === WFY_INPUT_OUTCOME.CORRECT && result.isChord) {
        feedback.message = `Heard ${chordLabel(result.expected)} — all tones matched.`
      } else if (feedback.outcome === WFY_INPUT_OUTCOME.CORRECT) {
        feedback.message = `Heard ${feedback.playedLabel ?? 'note'} — correct`
      }

      setInputFeedback({ ...feedback, micChordMode: isMicChordCollection })

      if (result.outcome === MATCH_OUTCOME.WRONG) {
        onWrongNote?.()
      }

      if (result.outcome === MATCH_OUTCOME.COMPLETE) {
        onPlayerInputMatched()
      }
    },
    [
      currentCheckpoint,
      matchSettings,
      evaluateMicMatch,
      isMicChordCollection,
      onPlayerInputMatched,
      onWrongNote,
    ],
  )

  usePitchDetector({
    enabled: detectEnabled,
    analyserRef: microphone?.analyser,
    getTimeDomainBuffer: microphone?.getTimeDomainBuffer,
    sampleRate: microphone?.sampleRate ?? 44100,
    centsTolerance: micCentsTolerance,
    onFrame: handleFrame,
    onStableMidi: matchingEnabled ? handleStableMidi : undefined,
    onCalibration: setCalibration,
    calibrationKey,
  })

  const chordTargets = getMicChordMatchTargets(currentCheckpoint, matchSettings)

  return {
    matchingEnabled,
    inputFeedback,
    resetFeedback,
    lastHeardMidi,
    liveFrame,
    calibration: detectEnabled ? calibration : null,
    calibrationStatus: liveFrame?.calibrationStatus ?? calibration?.status ?? null,
    retryCalibration,
    isChordCheckpoint: Boolean(currentCheckpoint?.isChord),
    isMicChordCollection,
    expectedCount: expectedMidis.length,
    chordMicMode: chordTargets.mode,
    feedbackOutcome: inputFeedback.outcome,
  }
}

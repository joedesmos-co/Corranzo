import { useCallback, useEffect, useRef, useState } from 'react'
import { WFY_CHECKPOINT_MODE } from './waitForYouCheckpointMode.js'
import {
  buildInputFeedback,
  idleFeedbackForCheckpoint,
  WFY_INPUT_OUTCOME,
} from './waitForYouInputFeedback.js'
import {
  evaluateMicNoteInput,
  getExpectedMidis,
  getMicChordMatchTargets,
  MATCH_OUTCOME,
  toFeedbackOutcome,
} from './waitForYouNoteMatch.js'
import { MIC_CHORD_MODES } from './waitForYouMatchSettings.js'
import { CHECKPOINT_KIND } from './waitForYouCheckpoints.js'
import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import usePitchDetector from '../microphone-input/usePitchDetector.js'

/**
 * Bridges microphone pitch detection to Wait For You checkpoint matching.
 */
export default function useWaitForYouMicInput({
  active,
  checkpointMode,
  currentCheckpoint,
  matchSettings,
  onPlayerInputMatched,
  microphone,
}) {
  const [inputFeedback, setInputFeedback] = useState(() =>
    idleFeedbackForCheckpoint(currentCheckpoint),
  )
  const [lastHeardMidi, setLastHeardMidi] = useState(null)
  const [liveFrame, setLiveFrame] = useState(null)
  const [calibration, setCalibration] = useState(null)
  const feedbackOutcomeRef = useRef(inputFeedback.outcome)

  const detectEnabled = Boolean(active && microphone?.isListening)
  const micCentsTolerance = matchSettings?.micCentsTolerance ?? 30

  const matchingEnabled =
    detectEnabled &&
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    currentCheckpoint?.kind === CHECKPOINT_KIND.NOTE

  const resetFeedback = useCallback(() => {
    setInputFeedback(idleFeedbackForCheckpoint(currentCheckpoint))
    setLastHeardMidi(null)
    setLiveFrame(null)
  }, [currentCheckpoint])

  useEffect(() => {
    resetFeedback()
  }, [currentCheckpoint?.id, matchSettings, resetFeedback])

  useEffect(() => {
    feedbackOutcomeRef.current = inputFeedback.outcome
  }, [inputFeedback.outcome])

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

      const preview = evaluateMicNoteInput(currentCheckpoint, frame.midi, matchSettings)
      const label = midiToNoteLabel(frame.midi)
      const targets = getMicChordMatchTargets(currentCheckpoint, matchSettings)

      if (preview.outcome === MATCH_OUTCOME.WRONG) {
        setInputFeedback({
          outcome: WFY_INPUT_OUTCOME.IDLE,
          message: `Hearing ${label}… (not the note we are waiting for)`,
          tone: 'neutral',
          playedMidi: frame.midi,
          playedLabel: label,
        })
        return
      }

      if (preview.outcome === MATCH_OUTCOME.COMPLETE) {
        let message = `Hearing ${label}… hold steady`
        if (targets.isChord) {
          if (targets.mode === MIC_CHORD_MODES.BASS) {
            message = `Hearing ${label}… (listening for bass tone)`
          } else if (targets.mode === MIC_CHORD_MODES.TOP) {
            message = `Hearing ${label}… (listening for top tone)`
          } else {
            message = `Hearing ${label}… (any chord tone — experimental)`
          }
        }
        setInputFeedback({
          outcome: WFY_INPUT_OUTCOME.IDLE,
          message,
          tone: 'neutral',
          playedMidi: frame.midi,
          playedLabel: label,
        })
      }
    },
    [matchingEnabled, currentCheckpoint, matchSettings],
  )

  const handleStableMidi = useCallback(
    (midi) => {
      if (!currentCheckpoint || !matchSettings) {
        return
      }

      setLastHeardMidi(midi)

      const result = evaluateMicNoteInput(currentCheckpoint, midi, matchSettings)
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

      if (feedback.outcome === WFY_INPUT_OUTCOME.CORRECT && result.isChord) {
        if (result.micChordMode === MIC_CHORD_MODES.BASS) {
          feedback.message = `Heard ${feedback.playedLabel ?? 'note'} — bass tone matched (mic chord — experimental)`
        } else if (result.micChordMode === MIC_CHORD_MODES.TOP) {
          feedback.message = `Heard ${feedback.playedLabel ?? 'note'} — top tone matched (mic chord — experimental)`
        } else {
          feedback.message = `Heard ${feedback.playedLabel ?? 'note'} — chord tone matched (mic — one note at a time)`
        }
      } else if (feedback.outcome === WFY_INPUT_OUTCOME.CORRECT) {
        feedback.message = `Heard ${feedback.playedLabel ?? 'note'} — correct`
      } else if (feedback.outcome === WFY_INPUT_OUTCOME.WRONG) {
        feedback.message = `Heard ${feedback.playedLabel ?? 'a note'} — not the expected pitch`
      }

      setInputFeedback(feedback)

      if (result.outcome === MATCH_OUTCOME.COMPLETE) {
        onPlayerInputMatched()
      }
    },
    [currentCheckpoint, matchSettings, onPlayerInputMatched],
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
  })

  const isChordCheckpoint = Boolean(currentCheckpoint?.isChord)
  const expectedCount = getExpectedMidis(currentCheckpoint).length
  const chordTargets = getMicChordMatchTargets(currentCheckpoint, matchSettings)

  return {
    matchingEnabled,
    inputFeedback,
    resetFeedback,
    lastHeardMidi,
    liveFrame,
    calibration: detectEnabled ? calibration : null,
    isChordCheckpoint,
    expectedCount,
    chordMicMode: chordTargets.mode,
    feedbackOutcome: inputFeedback.outcome,
  }
}

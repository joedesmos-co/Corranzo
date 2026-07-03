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
  evaluateMicScoreInformedInput,
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
import { resolveMicDiagnostic, micDiagnosticLabel } from '../microphone-input/micDiagnosticState.js'
import {
  isMicEngineV2Enabled,
} from '../microphone-input/micEngineFlag.js'
import useMicEngineV2Detector from '../microphone-input/useMicEngineV2Detector.js'
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
  micEngineV2Override = null,
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
  const lastStableChordKeyRef = useRef('')
  const micEngineV2EnabledRef = useRef(false)
  const v2SessionFallbackRef = useRef(false)
  const [v2SessionFallback, setV2SessionFallback] = useState(false)

  const detectEnabled = Boolean(active && microphone?.isListening)
  const micCentsTolerance = matchSettings?.micCentsTolerance ?? 30
  const expectedMidis = getExpectedMidis(currentCheckpoint)
  const micEngineV2Enabled = isMicEngineV2Enabled(micEngineV2Override)
  const micEngineV2Active = micEngineV2Enabled && !v2SessionFallback
  const micEngineMode = micEngineV2Active ? 'v2-score-informed' : 'v1-monophonic'
  const chordTargets = getMicChordMatchTargets(currentCheckpoint, matchSettings)

  const isMicV2Polyphonic =
    micEngineV2Active &&
    expectedMidis.length > 1 &&
    chordTargets.mode === MIC_CHORD_MODES.ANY_TONE

  const isMicChordCollection =
    !isMicV2Polyphonic &&
    expectedMidis.length > 1 &&
    chordTargets.mode === MIC_CHORD_MODES.ANY_TONE

  const matchingEnabled =
    detectEnabled &&
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    currentCheckpoint?.kind === CHECKPOINT_KIND.NOTE

  const useV2Detector = matchingEnabled && micEngineV2Active
  const useV1Detector = detectEnabled && !useV2Detector

  const resetFeedback = useCallback(() => {
    setInputFeedback(idleFeedbackForCheckpoint(currentCheckpoint))
    setLastHeardMidi(null)
    setLiveFrame(null)
    resetMicChordCollectionState(collectionStateRef.current)
    lastStableChordKeyRef.current = ''
  }, [currentCheckpoint])

  useEffect(() => {
    resetFeedback()
  }, [currentCheckpoint?.id, matchSettings, resetFeedback, micEngineV2Enabled])

  useEffect(() => {
    if (!active) {
      resetFeedback()
      v2SessionFallbackRef.current = false
      setV2SessionFallback(false)
    }
  }, [active, resetFeedback])

  useEffect(() => {
    feedbackOutcomeRef.current = inputFeedback.outcome
  }, [inputFeedback.outcome])

  useEffect(() => {
    micEngineV2EnabledRef.current = micEngineV2Enabled
  }, [micEngineV2Enabled])

  useEffect(() => {
    v2SessionFallbackRef.current = v2SessionFallback
  }, [v2SessionFallback])

  useEffect(() => {
    if (import.meta.env?.DEV || micEngineV2Enabled) {
      globalThis.__SCOREFLOW_MIC_DEBUG__ = {
        ...(globalThis.__SCOREFLOW_MIC_DEBUG__ ?? {}),
        engineMode: micEngineMode,
        v2Enabled: micEngineV2Enabled,
        v2Active: micEngineV2Active,
        v2SessionFallback,
        isMicV2Polyphonic,
        expectedMidis: [...expectedMidis],
      }
    }
  }, [
    micEngineMode,
    micEngineV2Enabled,
    micEngineV2Active,
    v2SessionFallback,
    isMicV2Polyphonic,
    expectedMidis,
  ])

  const reportMicDebug = useCallback((patch) => {
    if (import.meta.env?.DEV || micEngineV2EnabledRef.current) {
      globalThis.__SCOREFLOW_MIC_DEBUG__ = {
        ...(globalThis.__SCOREFLOW_MIC_DEBUG__ ?? {}),
        ...patch,
      }
    }
  }, [])

  const handleV2RuntimeError = useCallback(
    (error) => {
      if (v2SessionFallbackRef.current) {
        return
      }
      const reason = error?.message ?? String(error)
      v2SessionFallbackRef.current = true
      setV2SessionFallback(true)
      if (import.meta.env?.DEV) {
        console.warn('[Mic Engine V2] Falling back to V1 for this session:', reason)
      }
      reportMicDebug({ v2SessionFallback: true, v2FallbackReason: reason, v2Active: false })
    },
    [reportMicDebug],
  )

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
    lastStableChordKeyRef.current = ''
  }, [])

  const evaluateMicMatch = useCallback(
    (playedMidi, detectedMidis = null) => {
      if (!currentCheckpoint || !matchSettings) {
        return null
      }
      if (detectedMidis?.length) {
        return evaluateMicScoreInformedInput(currentCheckpoint, detectedMidis, matchSettings)
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

  const applyMatchResult = useCallback(
    (result) => {
      if (!result) {
        return
      }

      const feedback = micFeedbackFromResult(result)

      if (feedback.outcome === WFY_INPUT_OUTCOME.CORRECT && result.isChord) {
        feedback.message = `Heard ${chordLabel(result.expected)} — all tones matched.`
      } else if (feedback.outcome === WFY_INPUT_OUTCOME.CORRECT) {
        feedback.message = `Heard ${feedback.playedLabel ?? 'note'} — correct`
      }

      setInputFeedback({
        ...feedback,
        micChordMode: isMicChordCollection || isMicV2Polyphonic,
        micEngineMode,
      })

      reportMicDebug({
        lastOutcome: result.outcome,
        lastMatchedCount: result.matchedIndices?.size ?? 0,
        lastMatchDetectedMidis: result.detectedMidis ? [...result.detectedMidis] : undefined,
      })

      if (result.outcome === MATCH_OUTCOME.WRONG) {
        onWrongNote?.()
      }

      if (result.outcome === MATCH_OUTCOME.COMPLETE) {
        onPlayerInputMatched()
      }
    },
    [
      isMicChordCollection,
      isMicV2Polyphonic,
      micEngineMode,
      onPlayerInputMatched,
      onWrongNote,
      reportMicDebug,
    ],
  )

  const handleFrame = useCallback(
    (frame) => {
      const wrongPitch =
        frame.midi != null &&
        frame.gateOpen &&
        matchingEnabled &&
        evaluateMicMatch(frame.midi)?.outcome === MATCH_OUTCOME.WRONG

      const diagnostic = resolveMicDiagnostic({
        calibrating: frame.calibrating,
        calibrationStatus: frame.calibrationStatus,
        signalQuality: frame.signalQuality,
        stabilizerPending: frame.stabilizerPending,
        wrongPitch,
        chordUnsupported:
          matchingEnabled &&
          isMicChordCollection &&
          expectedMidis.length > 1 &&
          !isMicV2Polyphonic,
      })
      const diagnosticLabel = micDiagnosticLabel(diagnostic)

      setLiveFrame({
        ...frame,
        diagnostic,
        diagnosticLabel,
        signalLabel: diagnosticLabel,
        micEngineMode: frame.micEngineMode ?? micEngineMode,
      })

      if (frame.v2DetectedMidis?.length) {
        reportMicDebug({
          lastDetectedMidis: [...frame.v2DetectedMidis],
          lastDetectedCount: frame.v2DetectedMidis.length,
          v2MeanConfidence: frame.v2MeanConfidence ?? null,
          lastV2Notes: (frame.v2Notes ?? []).map((note) => ({
            midi: note.midi,
            confidence: note.confidence ?? null,
            detected: Boolean(note.detected),
          })),
          v2Active: Boolean(frame.v2Active),
          usedV1Fallback: Boolean(frame.usedV1Fallback),
        })
      } else if (frame.midi != null && frame.gateOpen) {
        reportMicDebug({
          lastDetectedMidis: [frame.midi],
          lastDetectedCount: 1,
          v2MeanConfidence: frame.clarity ?? null,
          lastV2Notes: [{ midi: frame.midi, confidence: frame.clarity ?? null, detected: true }],
        })
      }

      if (!matchingEnabled || !currentCheckpoint || !matchSettings) {
        return
      }

      if (isMicV2Polyphonic && frame.v2DetectedMidis?.length) {
        const preview = evaluateMicMatch(null, frame.v2DetectedMidis)
        if (
          preview &&
          (preview.outcome === MATCH_OUTCOME.CHORD_PROGRESS ||
            preview.outcome === MATCH_OUTCOME.COMPLETE)
        ) {
          setInputFeedback({
            ...micFeedbackFromResult(preview),
            outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
            micEngineMode,
          })
        }
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
          micEngineMode,
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
          micEngineMode,
        })
      }
    },
    [
      matchingEnabled,
      currentCheckpoint,
      matchSettings,
      evaluateMicMatch,
      expectedMidis,
      isMicChordCollection,
      isMicV2Polyphonic,
      micEngineMode,
      reportMicDebug,
    ],
  )

  const handleStableMidi = useCallback(
    (midi) => {
      if (!currentCheckpoint || !matchSettings) {
        return
      }

      setLastHeardMidi(midi)

      const result = evaluateMicMatch(midi)
      applyMatchResult(result)
    },
    [currentCheckpoint, matchSettings, evaluateMicMatch, applyMatchResult],
  )

  const handleStableChord = useCallback(
    (detectedMidis) => {
      if (!currentCheckpoint || !matchSettings || !isMicV2Polyphonic) {
        return
      }

      const key = [...detectedMidis].sort((left, right) => left - right).join(',')
      if (key === lastStableChordKeyRef.current) {
        return
      }
      lastStableChordKeyRef.current = key

      setLastHeardMidi(detectedMidis[0] ?? null)
      const result = evaluateMicMatch(null, detectedMidis)
      applyMatchResult(result)
    },
    [currentCheckpoint, matchSettings, isMicV2Polyphonic, evaluateMicMatch, applyMatchResult],
  )

  usePitchDetector({
    enabled: useV1Detector,
    analyserRef: microphone?.analyser,
    getTimeDomainBuffer: microphone?.getTimeDomainBuffer,
    sampleRate: microphone?.sampleRate ?? 44100,
    centsTolerance: micCentsTolerance,
    onFrame: handleFrame,
    onStableMidi: matchingEnabled ? handleStableMidi : undefined,
    onCalibration: setCalibration,
    calibrationKey,
  })

  useMicEngineV2Detector({
    enabled: useV2Detector,
    expectedMidis,
    analyserRef: microphone?.analyser,
    getTimeDomainBuffer: microphone?.getTimeDomainBuffer,
    sampleRate: microphone?.sampleRate ?? 44100,
    centsTolerance: micCentsTolerance,
    onFrame: handleFrame,
    onStableMidi: matchingEnabled ? handleStableMidi : undefined,
    onStableChord: matchingEnabled && isMicV2Polyphonic ? handleStableChord : undefined,
    onCalibration: setCalibration,
    onV2RuntimeError: handleV2RuntimeError,
    calibrationKey,
    stableFrameThreshold: matchSettings?.micChordStableHitsRequired ?? 2,
  })

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
    isMicV2Polyphonic,
    expectedCount: expectedMidis.length,
    chordMicMode: chordTargets.mode,
    feedbackOutcome: inputFeedback.outcome,
    micEngineMode,
    micEngineV2Enabled,
    micEngineV2Active,
    v2SessionFallback,
  }
}

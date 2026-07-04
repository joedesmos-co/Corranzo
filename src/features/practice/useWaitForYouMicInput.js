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
  createMicDebugFrameRecord,
  pushMicDebugFrame,
  serializeMicDebugFrames,
} from '../microphone-input/micDebugExport.js'
import useMicEngineV2Detector from '../microphone-input/useMicEngineV2Detector.js'
import {
  confirmConfidentMatch as pushMatchConfirm,
  createMatchConfirmState,
  frameConfidentForMatch,
  resetMatchConfirmState,
} from './micMatchConfirm.js'

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

function summarizeV2Notes(notes = []) {
  return notes.map((note) => ({
    midi: note.midi,
    confidence: note.confidence ?? null,
    ratio: note.ratio ?? null,
    detected: Boolean(note.detected),
  }))
}

function micFrameRejectReason({
  frame,
  matchingEnabled,
  expectedMidis,
}) {
  if (frame.calibrating) {
    return 'calibrating'
  }
  if (!matchingEnabled) {
    return 'matching-disabled'
  }
  if (!expectedMidis?.length) {
    return 'no-expected-midi'
  }
  if (!frame.gateOpen) {
    return 'noise-gate-closed'
  }
  if (frame.v2Active && !frame.v2DetectedMidis?.length) {
    return 'v2-below-threshold'
  }
  if (frame.midi == null) {
    return 'no-midi-detected'
  }
  return null
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
  instrumentId = null,
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
  const matchConfirmRef = useRef(createMatchConfirmState())
  const debugFramesRef = useRef([])
  const [v2RuntimeError, setV2RuntimeError] = useState(null)

  const detectEnabled = Boolean(active && microphone?.isListening)
  const micCentsTolerance = matchSettings?.micCentsTolerance ?? 30
  const expectedMidis = getExpectedMidis(currentCheckpoint)
  const micEngineV2Enabled = true
  const micEngineV2Active = !v2RuntimeError
  const micEngineMode = 'v2-score-informed'
  const chordTargets = getMicChordMatchTargets(currentCheckpoint, matchSettings)

  const isMicV2Polyphonic =
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

  const resetMatchConfirm = useCallback(() => {
    resetMatchConfirmState(matchConfirmRef.current)
  }, [])

  const confirmConfidentMatch = useCallback(
    (key, confident) => pushMatchConfirm(matchConfirmRef.current, key, confident),
    [],
  )

  const exportDebugFrames = useCallback(
    () => serializeMicDebugFrames(debugFramesRef.current),
    [],
  )

  const resetFeedback = useCallback(() => {
    setInputFeedback(idleFeedbackForCheckpoint(currentCheckpoint))
    setLastHeardMidi(null)
    setLiveFrame(null)
    resetMicChordCollectionState(collectionStateRef.current)
    lastStableChordKeyRef.current = ''
    resetMatchConfirm()
  }, [currentCheckpoint, resetMatchConfirm])

  useEffect(() => {
    resetFeedback()
  }, [currentCheckpoint?.id, matchSettings, resetFeedback])

  useEffect(() => {
    if (!active) {
      resetFeedback()
      setV2RuntimeError(null)
    }
  }, [active, resetFeedback])

  useEffect(() => {
    feedbackOutcomeRef.current = inputFeedback.outcome
  }, [inputFeedback.outcome])

  useEffect(() => {
    // Always publish a stable diagnostics object so the real "too quiet" issue
    // can be inspected in any build via `window.SCOREFLOW_MIC_DEBUG.lastFrame`
    // (kept in sync with the legacy `__SCOREFLOW_MIC_DEBUG__` name).
    const next = {
      ...(globalThis.__SCOREFLOW_MIC_DEBUG__ ?? {}),
      engineMode: micEngineMode,
      v2Enabled: micEngineV2Enabled,
      v2Active: micEngineV2Active,
      v2RuntimeError,
      isMicV2Polyphonic,
      expectedMidis: [...expectedMidis],
      instrumentId: instrumentId ?? null,
      inputSource: 'microphone',
      captureSettings: microphone?.captureSettings ?? null,
      exportLastFrames: exportDebugFrames,
      copyLastFrames: () => [...debugFramesRef.current],
    }
    globalThis.__SCOREFLOW_MIC_DEBUG__ = next
    globalThis.SCOREFLOW_MIC_DEBUG = next
  }, [
    micEngineMode,
    micEngineV2Enabled,
    micEngineV2Active,
    v2RuntimeError,
    isMicV2Polyphonic,
    expectedMidis,
    instrumentId,
    microphone?.captureSettings,
    exportDebugFrames,
  ])

  const reportMicDebug = useCallback((patch) => {
    const next = {
      ...(globalThis.__SCOREFLOW_MIC_DEBUG__ ?? {}),
      ...patch,
    }
    globalThis.__SCOREFLOW_MIC_DEBUG__ = next
    globalThis.SCOREFLOW_MIC_DEBUG = next
  }, [])

  const handleV2RuntimeError = useCallback(
    (error) => {
      const reason = error?.message ?? String(error)
      if (v2RuntimeError === reason) {
        return
      }
      setV2RuntimeError(reason)
      if (import.meta.env?.DEV) {
        console.warn('[Mic Engine V2] Runtime error:', reason)
      }
      reportMicDebug({ v2RuntimeError: reason, v2Active: false })
    },
    [reportMicDebug, v2RuntimeError],
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

      feedbackOutcomeRef.current = feedback.outcome
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

      const frameDetectedMidis =
        frame.v2DetectedMidis?.length
          ? [...frame.v2DetectedMidis]
          : frame.midi != null && frame.gateOpen
            ? [frame.midi]
            : []
      const rejectReason = micFrameRejectReason({
        frame,
        matchingEnabled,
        expectedMidis,
      })
      const debugRejectReason = wrongPitch ? 'wrong-note' : rejectReason
      const debugFrame = createMicDebugFrameRecord({
        frame,
        expectedMidis,
        instrumentId,
        inputSource: 'microphone',
        captureSettings: microphone?.captureSettings ?? null,
        rejectReason: debugRejectReason,
        timestampMs:
          typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now(),
      })
      pushMicDebugFrame(debugFramesRef.current, debugFrame)

      reportMicDebug({
        lastFrame: {
          ...debugFrame,
          rms: frame.rms ?? null,
          filteredRms: frame.filteredRms ?? null,
          level: frame.level ?? null,
          noiseFloor: frame.noiseFloor ?? null,
          gateOpen: Boolean(frame.gateOpen),
          frequency: frame.frequency ?? null,
          midiFloat: frame.midiFloat ?? null,
          spectralEnergy: frame.spectralEnergy ?? null,
          crestFactor: frame.crestFactor ?? null,
          zeroCrossingRate: frame.zeroCrossingRate ?? null,
          signalShape: frame.signalShape ?? null,
          midi: frame.midi ?? null,
          clarity: frame.clarity ?? null,
          signalQuality: frame.signalQuality ?? null,
          diagnostic,
          calibrationStatus: frame.calibrationStatus ?? null,
          calibrationNoiseFloor: frame.calibration?.noiseFloor ?? null,
          calibrationGateThreshold: frame.calibration?.gateThreshold ?? null,
          calibrationRejectedOutliers: frame.calibration?.rejectedOutliers ?? null,
          expectedMidis: [...expectedMidis],
          instrumentId: instrumentId ?? null,
          inputSource: 'microphone',
          micEngineMode: frame.micEngineMode ?? micEngineMode,
          v2Active: Boolean(frame.v2Active),
          v2MeanConfidence: frame.v2MeanConfidence ?? null,
          v2DetectedMidis: frame.v2DetectedMidis ? [...frame.v2DetectedMidis] : [],
          v2Notes: summarizeV2Notes(frame.v2Notes ?? []),
          rejectReason: debugRejectReason,
        },
        lastFrames: [...debugFramesRef.current],
        exportLastFrames: exportDebugFrames,
        copyLastFrames: () => [...debugFramesRef.current],
        lastFrameDetectedMidis: frameDetectedMidis,
      })

      if (frame.v2DetectedMidis?.length) {
        reportMicDebug({
          lastDetectedMidis: [...frame.v2DetectedMidis],
          lastDetectedCount: frame.v2DetectedMidis.length,
          v2MeanConfidence: frame.v2MeanConfidence ?? null,
          lastV2Notes: summarizeV2Notes(frame.v2Notes ?? []),
          v2Active: Boolean(frame.v2Active),
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

      if (isMicV2Polyphonic && frame.gateOpen && frame.v2DetectedMidis?.length) {
        const preview = evaluateMicMatch(null, frame.v2DetectedMidis)
        if (!preview || feedbackOutcomeRef.current === WFY_INPUT_OUTCOME.CORRECT) {
          return
        }
        if (preview.outcome === MATCH_OUTCOME.COMPLETE) {
          // All expected tones heard together — confirm briefly, then advance.
          const key = `${currentCheckpoint.id}:chord:${[...frame.v2DetectedMidis]
            .sort((left, right) => left - right)
            .join(',')}`
          if (confirmConfidentMatch(key, true)) {
            resetMatchConfirm()
            applyMatchResult(preview)
            return
          }
        } else {
          resetMatchConfirm()
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

      const v2Preview = frame.v2DetectedMidis?.length
        ? evaluateMicMatch(null, frame.v2DetectedMidis)
        : null

      if (v2Preview?.outcome === MATCH_OUTCOME.COMPLETE && !isMicChordCollection) {
        const key = `${currentCheckpoint.id}:v2:${[...frame.v2DetectedMidis]
          .sort((left, right) => left - right)
          .join(',')}`
        if (confirmConfidentMatch(key, frameConfidentForMatch(frame))) {
          resetMatchConfirm()
          setLastHeardMidi(frame.v2DetectedMidis[0] ?? frame.midi)
          applyMatchResult(v2Preview)
          return
        }
      } else if (v2Preview) {
        resetMatchConfirm()
      }

      if (
        v2Preview?.outcome === MATCH_OUTCOME.CHORD_PROGRESS ||
        v2Preview?.outcome === MATCH_OUTCOME.COMPLETE
      ) {
        setInputFeedback({
          ...micFeedbackFromResult(v2Preview),
          outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
          micEngineMode,
        })
        return
      }

      const monophonicPreview = evaluateMicMatch(frame.midi)
      if (!monophonicPreview) {
        return
      }

      if (monophonicPreview.outcome === MATCH_OUTCOME.WRONG) {
        resetMatchConfirm()
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

      // Legacy chord-collection mode keeps its sequential flow when it is used
      // by non-simultaneous chord settings. Normal note advancement is V2-only.
      if (monophonicPreview.outcome === MATCH_OUTCOME.COMPLETE && isMicChordCollection) {
        const confident = frameConfidentForMatch(frame)
        if (confirmConfidentMatch(`${currentCheckpoint.id}:${frame.midi}`, confident)) {
          resetMatchConfirm()
          setLastHeardMidi(frame.midi)
          applyMatchResult(monophonicPreview)
          return
        }
      } else {
        resetMatchConfirm()
      }

      if (
        monophonicPreview.outcome === MATCH_OUTCOME.CHORD_PROGRESS ||
        monophonicPreview.outcome === MATCH_OUTCOME.COMPLETE
      ) {
        setInputFeedback({
          ...micFeedbackFromResult(monophonicPreview),
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
      applyMatchResult,
      confirmConfidentMatch,
      resetMatchConfirm,
      expectedMidis,
      isMicChordCollection,
      isMicV2Polyphonic,
      micEngineMode,
      reportMicDebug,
      instrumentId,
      microphone?.captureSettings,
      exportDebugFrames,
    ],
  )

  const handleStableMidi = useCallback(
    (midi) => {
      if (!currentCheckpoint || !matchSettings) {
        return
      }
      if (
        feedbackOutcomeRef.current === WFY_INPUT_OUTCOME.CORRECT ||
        feedbackOutcomeRef.current === WFY_INPUT_OUTCOME.WRONG
      ) {
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
    instrumentId,
    analysisKey: currentCheckpoint?.id ?? '',
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
    v2RuntimeError,
    exportDebugFrames,
  }
}

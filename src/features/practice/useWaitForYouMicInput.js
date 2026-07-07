import { useCallback, useEffect, useRef, useState } from 'react'
import { WFY_CHECKPOINT_MODE } from './waitForYouCheckpointMode.js'
import {
  buildInputFeedback,
  idleFeedbackForCheckpoint,
  WFY_INPUT_OUTCOME,
} from './waitForYouInputFeedback.js'
import { chordLabel } from './waitForYouLabels.js'
import {
  evaluateMicNoteInput,
  evaluateMicNoteInputWithBuffer,
  evaluateMicScoreInformedInput,
  evaluateGuitarChordShapeMicInput,
  createGuitarChordShapeBufferState,
  resetGuitarChordShapeBufferState,
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
import { isPlayableCheckpointKind } from './waitForYouCheckpoints.js'
import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import { resolveMicDiagnostic, micDiagnosticLabel } from '../microphone-input/micDiagnosticState.js'
import {
  createMicDebugFrameRecord,
  createMicTraceFrameRecord,
  pushMicDebugFrame,
  pushMicTraceFrame,
  serializeMicDebugFrames,
  serializeMicTraceFrames,
} from '../microphone-input/micDebugExport.js'
import useMicEngineV2Detector from '../microphone-input/useMicEngineV2Detector.js'
import {
  confirmConfidentMatch as pushMatchConfirm,
  createMatchConfirmState,
  frameConfidentForMatch,
  frameCorroboratesSingleNote,
  resetMatchConfirmState,
} from './micMatchConfirm.js'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  getMicAttackRearmReason,
  markMicAttackConsumed,
  rearmMicAttackLatch,
  resetMicAttackLatch,
  updateMicAttackRelease,
} from './micAttackLatch.js'
import { isMusicalMicFrame, micMusicalRejectReason } from './micMusicalAcceptance.js'
import { MIC_CALIBRATION_STATUS } from '../microphone-input/micCalibration.js'
import { MIC_CALIBRATION_STATUS_LABELS } from '../microphone-input/micCalibration.js'

function micUsesChordSequence(checkpoint) {
  return Boolean(checkpoint?.isChord) && !checkpoint?.isGuitarChordShape
}

function micFeedbackFromResult(result, checkpoint = null) {
  if (result?.isGuitarChordShape) {
    const matchedCount = result.matchedCount ?? result.matchedIndices?.size ?? 0
    const required = result.requiredTones ?? matchedCount
    const total = result.totalExpected ?? result.expected?.length ?? 0
    if (result.outcome === MATCH_OUTCOME.COMPLETE) {
      return {
        outcome: WFY_INPUT_OUTCOME.CORRECT,
        message: 'Chord shape matched',
        tone: 'success',
        playedMidi: result.playedMidi,
        matchedIndices: result.matchedIndices,
      }
    }
    if (result.outcome === MATCH_OUTCOME.CHORD_PROGRESS) {
      return {
        outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
        message: `Heard ${matchedCount} of ${required} chord tones — keep strumming the shape`,
        tone: 'partial',
        matchedCount,
        total,
        matchedIndices: result.matchedIndices,
      }
    }
    if (result.outcome === MATCH_OUTCOME.WRONG) {
      return {
        outcome: WFY_INPUT_OUTCOME.WRONG,
        message: 'Missed / late',
        tone: 'error',
        playedMidi: result.playedMidi,
      }
    }
  }
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
    chordAsSequence: micUsesChordSequence(checkpoint ?? { isChord: result.isChord }),
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

function hasStrongExpectedV2Evidence(frame, expectedMidi, {
  minConfidence = 0.48,
  minRatio = 2.2,
} = {}) {
  return (frame?.v2Notes ?? []).some(
    (note) =>
      note?.midi === expectedMidi &&
      note.detected &&
      (note.confidence ?? 0) >= minConfidence &&
      (note.ratio ?? 0) >= minRatio,
  )
}

function hasStrongMissingGuitarChordToneEvidence(frame, expectedMidis = [], heardMidis = new Set()) {
  if (!frame?.v2DetectedMidis?.length || !heardMidis?.size) {
    return false
  }
  const rms = frame.filteredRms ?? frame.rms ?? 0
  const noiseFloor = Math.max(0.001, frame.noiseFloor ?? 0.001)
  if (rms < Math.max(0.0012, noiseFloor * 0.35)) {
    return false
  }
  return expectedMidis.some(
    (midi) =>
      !heardMidis.has(midi) &&
      frame.v2DetectedMidis.includes(midi) &&
      hasStrongExpectedV2Evidence(frame, midi, {
        minConfidence: 0.58,
        minRatio: 2.6,
      }),
  )
}

function micFrameRejectReason({
  frame,
  matchingEnabled,
  expectedMidis,
}) {
  if (frame.calibrating || frame.calibrationStatus === MIC_CALIBRATION_STATUS.MEASURING) {
    return 'calibrating'
  }
  const musicalReject = micMusicalRejectReason(frame)
  if (musicalReject) {
    return musicalReject
  }
  if (!matchingEnabled) {
    return 'matching-disabled'
  }
  if (!expectedMidis?.length) {
    return 'no-expected-midi'
  }
  if (!frame.gateOpen) {
    if (frame.v2DetectedMidis?.length) {
      return 'soft-note-below-gate'
    }
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
  checkpointIndex = null,
  matchSettings,
  onPlayerInputMatched,
  onWrongNote = null,
  microphone,
  instrumentId = null,
}) {
  const [inputFeedback, setInputFeedback] = useState(() =>
    idleFeedbackForCheckpoint(currentCheckpoint, {
      chordAsSequence: micUsesChordSequence(currentCheckpoint),
    }),
  )
  const [lastHeardMidi, setLastHeardMidi] = useState(null)
  const [liveFrame, setLiveFrame] = useState(null)
  const [calibration, setCalibration] = useState(null)
  const [calibrationKey, setCalibrationKey] = useState(0)
  const feedbackOutcomeRef = useRef(inputFeedback.outcome)
  const collectionStateRef = useRef(createMicChordCollectionState())
  const guitarChordShapeBufferRef = useRef(createGuitarChordShapeBufferState())
  const lastStableChordKeyRef = useRef('')
  const matchConfirmRef = useRef(createMatchConfirmState())
  const attackLatchRef = useRef(createMicAttackLatchState())
  const debugFramesRef = useRef([])
  const micTraceFramesRef = useRef([])
  const liveFramePublishCounterRef = useRef(0)
  const quietRejectedFramesRef = useRef(0)
  const electricUnconfirmedFramesRef = useRef(0)
  const currentCheckpointRef = useRef(currentCheckpoint)
  currentCheckpointRef.current = currentCheckpoint
  const [v2RuntimeError, setV2RuntimeError] = useState(null)

  const detectEnabled = Boolean(active && microphone?.isListening)
  const micCentsTolerance = matchSettings?.micCentsTolerance ?? 30
  const expectedMidis = getExpectedMidis(currentCheckpoint)
  const expectedMidisKey =
    currentCheckpoint?.expectedMidis?.join(',') ??
    (currentCheckpoint?.expectedMidi != null ? String(currentCheckpoint.expectedMidi) : '')
  const micEngineV2Enabled = true
  const micEngineV2Active = !v2RuntimeError
  const micEngineMode = 'v2-score-informed'
  const chordTargets = getMicChordMatchTargets(currentCheckpoint, matchSettings)
  const isGuitarChordShape = Boolean(currentCheckpoint?.isGuitarChordShape)

  const isMicV2Polyphonic = false

  const isMicChordCollection =
    !isGuitarChordShape &&
    expectedMidis.length > 1 &&
    chordTargets.mode === MIC_CHORD_MODES.ANY_TONE

  const matchingEnabled =
    detectEnabled &&
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    isPlayableCheckpointKind(currentCheckpoint?.kind)

  const useV2Detector = detectEnabled && micEngineV2Active
  const micMatchingReady = matchingEnabled && micEngineV2Active && Boolean(calibration?.ready)

  const resetMatchConfirm = useCallback(() => {
    resetMatchConfirmState(matchConfirmRef.current)
  }, [])

  const confirmConfidentMatch = useCallback(
    (key, confident, options) =>
      pushMatchConfirm(matchConfirmRef.current, key, confident, options),
    [],
  )

  const exportDebugFrames = useCallback(
    () => serializeMicDebugFrames(debugFramesRef.current),
    [],
  )

  const exportMicTrace = useCallback(
    () => serializeMicTraceFrames(micTraceFramesRef.current),
    [],
  )

  const resetFeedback = useCallback(() => {
    setInputFeedback(
      idleFeedbackForCheckpoint(currentCheckpointRef.current, {
        chordAsSequence: micUsesChordSequence(currentCheckpointRef.current),
      }),
    )
    setLastHeardMidi(null)
    setLiveFrame(null)
    resetMicChordCollectionState(collectionStateRef.current)
    resetGuitarChordShapeBufferState(guitarChordShapeBufferRef.current)
    lastStableChordKeyRef.current = ''
    quietRejectedFramesRef.current = 0
    resetMatchConfirm()
  }, [resetMatchConfirm])

  useEffect(() => {
    resetMatchConfirm()
    lastStableChordKeyRef.current = ''
  }, [currentCheckpoint?.id, resetMatchConfirm])

  useEffect(() => {
    resetFeedback()
  }, [currentCheckpoint?.id, matchSettings, resetFeedback])

  useEffect(() => {
    if (!active) {
      resetFeedback()
      resetMicAttackLatch(attackLatchRef.current)
    }
  }, [active, resetFeedback])

  useEffect(() => {
    // A V2 runtime error describes the current detector run. Once detection
    // stops (WFY exited OR mic stopped), drop it so the next run starts fresh
    // instead of mic matching staying dead until WFY is fully re-entered.
    if (!detectEnabled) {
      setV2RuntimeError(null)
    }
  }, [detectEnabled])

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
      exportRecentMicTrace: exportMicTrace,
      copyLastFrames: () => [...debugFramesRef.current],
      copyRecentMicTrace: () => [...micTraceFramesRef.current],
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
    exportMicTrace,
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
  }, [matchingEnabled, isMicChordCollection, currentCheckpoint?.id, expectedMidisKey])

  const retryCalibration = useCallback(() => {
    setCalibration(null)
    setCalibrationKey((value) => value + 1)
    lastStableChordKeyRef.current = ''
    // A V2 runtime error otherwise pins micMatchingReady=false for the whole
    // session; retrying calibration is the user's recovery action, so give the
    // detector a fresh chance instead of staying dead until WFY is re-entered.
    setV2RuntimeError(null)
  }, [])

  const evaluateMicMatch = useCallback(
    (playedMidi, detectedMidis = null) => {
      if (!currentCheckpoint || !matchSettings) {
        return null
      }
      if (detectedMidis?.length) {
        if (currentCheckpoint?.isGuitarChordShape) {
          return evaluateGuitarChordShapeMicInput(
            currentCheckpoint,
            detectedMidis,
            guitarChordShapeBufferRef.current,
            matchSettings,
          )
        }
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

      const feedback = micFeedbackFromResult(result, currentCheckpoint)

      if (
        feedback.outcome === WFY_INPUT_OUTCOME.CORRECT &&
        result.isChord &&
        !result.isGuitarChordShape
      ) {
        feedback.message = `Heard ${chordLabel(result.expected)} — all tones matched.`
      } else if (feedback.outcome === WFY_INPUT_OUTCOME.CORRECT && !result.isGuitarChordShape) {
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
        markMicAttackConsumed(attackLatchRef.current, {
          consumedMidis: result.expected ?? [],
        })
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
      const timestampMs =
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now()
      let debugRejectReason = null
      let matchResultForTrace = null
      let advancedForTrace = false
      let attackRearmReason = null

      const pushTrace = () => {
        pushMicTraceFrame(
          micTraceFramesRef.current,
          createMicTraceFrameRecord({
            frame,
            checkpoint: currentCheckpoint,
            checkpointIndex,
            expectedMidis,
            micChordState: collectionStateRef.current,
            guitarChordShapeState: guitarChordShapeBufferRef.current,
            attackLatch: attackLatchRef.current,
            attackRearmReason,
            matchConfirm: matchConfirmRef.current,
            matchResult: matchResultForTrace,
            rejectReason: debugRejectReason,
            advanced: advancedForTrace,
            timestampMs,
          }),
        )
      }

      try {
      const wrongPitch =
        frame.midi != null &&
        frame.gateOpen &&
        matchingEnabled &&
        !isMicChordCollection &&
        !isGuitarChordShape &&
        evaluateMicMatch(frame.midi)?.outcome === MATCH_OUTCOME.WRONG
      const quietNoteRejected =
        matchingEnabled &&
        !frame.gateOpen &&
        expectedMidis.length > 0 &&
        frame.v2DetectedMidis?.some((midi) => expectedMidis.includes(midi)) &&
        (frame.filteredRms ?? 0) > (frame.noiseFloor ?? 0)

      if (quietNoteRejected) {
        quietRejectedFramesRef.current += 1
      } else if (frame.gateOpen || !frame.v2DetectedMidis?.length) {
        quietRejectedFramesRef.current = 0
      }

      const rejectReason = micFrameRejectReason({
        frame,
        matchingEnabled,
        expectedMidis,
      })
      debugRejectReason = wrongPitch ? 'wrong-note' : rejectReason
      const debugFrame = createMicDebugFrameRecord({
        frame,
        expectedMidis,
        instrumentId,
        inputSource: 'microphone',
        captureSettings: microphone?.captureSettings ?? null,
        rejectReason: debugRejectReason,
        timestampMs,
      })
      const electricSignal = debugFrame.electricGuitarSignal
      const hearsExpectedNote =
        matchingEnabled &&
        expectedMidis.length > 0 &&
        frame.v2DetectedMidis?.some((midi) => expectedMidis.includes(midi))
      const electricEvidence =
        instrumentId === 'guitar' &&
        (electricSignal?.cleanLikely ||
          electricSignal?.distortedLikely ||
          electricSignal?.ampColorationLikely) &&
        (hearsExpectedNote || (frame.gateOpen && electricSignal?.detectedMidis?.length))
      const electricBlocked =
        electricEvidence &&
        !wrongPitch &&
        (rejectReason === 'non-musical-formant-harmonics' ||
          rejectReason === 'soft-note-below-gate' ||
          rejectReason === 'v2-below-threshold' ||
          (frame.gateOpen &&
            hearsExpectedNote &&
            !isMusicalMicFrame(frame)))
      if (electricBlocked) {
        electricUnconfirmedFramesRef.current += 1
      } else if (frame.gateOpen || !electricEvidence) {
        electricUnconfirmedFramesRef.current = 0
      }

      const diagnostic = resolveMicDiagnostic({
        calibrating: frame.calibrating,
        calibrationStatus: frame.calibrationStatus,
        signalQuality: frame.signalQuality,
        stabilizerPending: frame.stabilizerPending,
        wrongPitch,
        quietNoteRejected: quietRejectedFramesRef.current >= 6,
        electricGuitarUnconfirmed: electricUnconfirmedFramesRef.current >= 6,
        chordUnsupported:
          matchingEnabled &&
          isMicChordCollection &&
          expectedMidis.length > 1 &&
          !isMicV2Polyphonic,
      })
      const diagnosticLabel = micDiagnosticLabel(diagnostic)

      liveFramePublishCounterRef.current += 1
      if (
        liveFramePublishCounterRef.current >= 3 ||
        frame.calibrating ||
        frame.calibrationStatus === MIC_CALIBRATION_STATUS.MEASURING
      ) {
        liveFramePublishCounterRef.current = 0
        setLiveFrame({
          ...frame,
          diagnostic,
          diagnosticLabel,
          signalLabel: diagnosticLabel,
          micEngineMode: frame.micEngineMode ?? micEngineMode,
        })
      }

      const frameDetectedMidis =
        frame.v2DetectedMidis?.length
          ? [...frame.v2DetectedMidis]
          : frame.midi != null && frame.gateOpen
            ? [frame.midi]
            : []
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
          gateThreshold: frame.gateThreshold ?? null,
          rawGateOpen: Boolean(frame.rawGateOpen ?? frame.gateOpen),
          softGateOpen: Boolean(frame.softGateOpen),
          softGateThreshold: frame.softGateThreshold ?? null,
          softGateEvidence: Boolean(frame.softGateEvidence),
          scoreInformedQuietGateOpen: Boolean(frame.scoreInformedQuietGateOpen),
          quietNoteRejected,
          quietRejectedFrames: quietRejectedFramesRef.current,
          harmonicProfile: debugFrame.harmonicProfile,
          electricGuitarSignal: debugFrame.electricGuitarSignal,
          rejectReason: debugRejectReason,
        },
        lastFrames: [...debugFramesRef.current],
        exportLastFrames: exportDebugFrames,
        exportRecentMicTrace: exportMicTrace,
        copyLastFrames: () => [...debugFramesRef.current],
        copyRecentMicTrace: () => [...micTraceFramesRef.current],
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

      if (!micMatchingReady || !currentCheckpoint || !matchSettings) {
        return
      }

      updateMicAttackRelease(attackLatchRef.current, Boolean(frame.gateOpen), {
        rms: frame.filteredRms ?? frame.rms ?? null,
      })
      if (
        frame.calibrating ||
        frame.calibrationStatus === MIC_CALIBRATION_STATUS.MEASURING
      ) {
        resetMatchConfirm()
        return
      }
      if (!canAcceptMicAttackMatch(attackLatchRef.current)) {
        // A ringing previous note (piano sustain, open guitar string) keeps the
        // gate open, so waiting for a full release would block the player's
        // next note. Rearm on clear new-attack evidence instead.
        attackRearmReason = getMicAttackRearmReason(attackLatchRef.current, frame, {
          expectedMidis,
        })
        if (attackRearmReason) {
          rearmMicAttackLatch(attackLatchRef.current)
        } else {
          resetMatchConfirm()
          return
        }
      }

      const scoreInformedSingleExpectedConfident =
        expectedMidis.length === 1 &&
        hasStrongExpectedV2Evidence(frame, expectedMidis[0]) &&
        (frame.scoreInformedQuietGateOpen ||
          attackRearmReason === 'score-informed-transition')
      const frameConfident =
        (frameConfidentForMatch(frame) || scoreInformedSingleExpectedConfident) &&
        isMusicalMicFrame(frame)
      const guitarShapeQuietCollect =
        isGuitarChordShape &&
        !frame.gateOpen &&
        hasStrongMissingGuitarChordToneEvidence(
          frame,
          expectedMidis,
          guitarChordShapeBufferRef.current?.heardMidis,
        )
      const guitarShapeFrameConfident = frameConfident || guitarShapeQuietCollect

      if (isMicV2Polyphonic && frame.gateOpen && frame.v2DetectedMidis?.length) {
        const preview = evaluateMicMatch(null, frame.v2DetectedMidis)
        matchResultForTrace = preview
        if (!preview || feedbackOutcomeRef.current === WFY_INPUT_OUTCOME.CORRECT) {
          return
        }
        if (preview.outcome === MATCH_OUTCOME.COMPLETE) {
          // All expected tones heard together — confirm briefly, then advance.
          const key = `${currentCheckpoint.id}:chord:${[...frame.v2DetectedMidis]
            .sort((left, right) => left - right)
            .join(',')}`
          if (confirmConfidentMatch(key, frameConfident)) {
            resetMatchConfirm()
            advancedForTrace = true
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
            ...micFeedbackFromResult(preview, currentCheckpoint),
            outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
            micEngineMode,
          })
        }
        return
      }

      if ((frame.midi == null || !frame.gateOpen) && !guitarShapeQuietCollect) {
        return
      }

      const outcome = feedbackOutcomeRef.current
      if (
        outcome === WFY_INPUT_OUTCOME.CORRECT ||
        outcome === WFY_INPUT_OUTCOME.WRONG
      ) {
        return
      }

      if (isMicChordCollection) {
        const sequencePreview = evaluateMicMatch(frame.midi)
        matchResultForTrace = sequencePreview
        if (!sequencePreview) {
          return
        }
        if (sequencePreview.outcome === MATCH_OUTCOME.WRONG) {
          resetMatchConfirm()
          setInputFeedback({
            ...micFeedbackFromResult(sequencePreview, currentCheckpoint),
            micChordMode: true,
            micEngineMode,
          })
          return
        }
        if (sequencePreview.outcome === MATCH_OUTCOME.COMPLETE) {
          const pitchCents = frame.midiFloat != null ? frame.midiFloat * 100 : null
          if (
            confirmConfidentMatch(
              `${currentCheckpoint.id}:sequence:${frame.midi}`,
              frameConfident,
              { pitchCents, threshold: 1 },
            )
          ) {
            resetMatchConfirm()
            setLastHeardMidi(frame.midi)
            advancedForTrace = true
            applyMatchResult(sequencePreview)
            return
          }
        } else {
          resetMatchConfirm()
        }
        if (
          sequencePreview.outcome === MATCH_OUTCOME.CHORD_PROGRESS ||
          sequencePreview.outcome === MATCH_OUTCOME.COMPLETE
        ) {
          setInputFeedback({
            ...micFeedbackFromResult(sequencePreview, currentCheckpoint),
            outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
            micChordMode: true,
            micEngineMode,
          })
        }
        return
      }

      const v2Preview = frame.v2DetectedMidis?.length
        ? evaluateMicMatch(null, frame.v2DetectedMidis)
        : null
      matchResultForTrace = v2Preview

      if (v2Preview?.outcome === MATCH_OUTCOME.COMPLETE && !isMicChordCollection) {
        const key = `${currentCheckpoint.id}:v2:${[...frame.v2DetectedMidis]
          .sort((left, right) => left - right)
          .join(',')}`
        const pitchCents = frame.midiFloat != null ? frame.midiFloat * 100 : null
        const corroborated =
          expectedMidis.length !== 1 ||
          frameCorroboratesSingleNote(frame, expectedMidis[0], {
            centsTolerance: micCentsTolerance,
          }) ||
          (attackRearmReason === 'score-informed-transition' &&
            hasStrongExpectedV2Evidence(frame, expectedMidis[0]))
        if (
          confirmConfidentMatch(key, guitarShapeFrameConfident && corroborated, {
            pitchCents,
            threshold: v2Preview.isGuitarChordShape ? 1 : undefined,
          })
        ) {
          resetMatchConfirm()
          setLastHeardMidi(frame.v2DetectedMidis[0] ?? frame.midi)
          advancedForTrace = true
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
          ...micFeedbackFromResult(v2Preview, currentCheckpoint),
          outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
          micEngineMode,
        })
        return
      }

      const monophonicPreview = evaluateMicMatch(frame.midi)
      matchResultForTrace = monophonicPreview
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

      resetMatchConfirm()

      if (
        monophonicPreview.outcome === MATCH_OUTCOME.CHORD_PROGRESS ||
        monophonicPreview.outcome === MATCH_OUTCOME.COMPLETE
      ) {
        matchResultForTrace = monophonicPreview
        setInputFeedback({
          ...micFeedbackFromResult(monophonicPreview, currentCheckpoint),
          outcome: WFY_INPUT_OUTCOME.CHORD_PARTIAL,
          micEngineMode,
        })
      }
      } finally {
        pushTrace()
      }
    },
    [
      micMatchingReady,
      currentCheckpoint,
      checkpointIndex,
      matchSettings,
      evaluateMicMatch,
      applyMatchResult,
      confirmConfidentMatch,
      resetMatchConfirm,
      expectedMidis,
      isMicChordCollection,
      isGuitarChordShape,
      isMicV2Polyphonic,
      micEngineMode,
      reportMicDebug,
      instrumentId,
      microphone?.captureSettings,
      exportDebugFrames,
      exportMicTrace,
    ],
  )

  useMicEngineV2Detector({
    enabled: useV2Detector,
    expectedMidis,
    analyserRef: microphone?.analyser,
    getTimeDomainBuffer: microphone?.getTimeDomainBuffer,
    sampleRate: microphone?.sampleRate ?? 44100,
    centsTolerance: micCentsTolerance,
    onAnalyzedFrame: handleFrame,
    onCalibration: setCalibration,
    onV2RuntimeError: handleV2RuntimeError,
    calibrationKey,
    stableFrameThreshold: matchSettings?.micChordStableHitsRequired ?? 2,
    instrumentId,
    analysisKey: currentCheckpoint?.id ?? '',
  })

  const micCalibrating = Boolean(
    detectEnabled &&
      (liveFrame?.calibrating ||
        liveFrame?.calibrationStatus === MIC_CALIBRATION_STATUS.MEASURING ||
        (!calibration && useV2Detector)),
  )
  const micStatusLabel = micCalibrating
    ? MIC_CALIBRATION_STATUS_LABELS[MIC_CALIBRATION_STATUS.MEASURING]
    : calibration?.status
      ? MIC_CALIBRATION_STATUS_LABELS[calibration.status] ?? null
      : detectEnabled
        ? MIC_CALIBRATION_STATUS_LABELS[MIC_CALIBRATION_STATUS.READY]
        : null

  return {
    matchingEnabled,
    inputFeedback,
    resetFeedback,
    lastHeardMidi,
    liveFrame,
    calibration: active && detectEnabled ? calibration : null,
    calibrationStatus: liveFrame?.calibrationStatus ?? calibration?.status ?? null,
    micCalibrating,
    micStatusLabel,
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
    exportMicTrace,
  }
}

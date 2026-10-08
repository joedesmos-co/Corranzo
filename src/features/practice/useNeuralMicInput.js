/**
 * Experimental neural microphone input (Stage 8, L1-L6) — DEV ONLY.
 *
 * Live path, behind the Neural Microphone (Experimental) flag (default
 * OFF; the session keeps this hook inactive unless the flag is on):
 *
 *   getUserMedia capture → ring buffer (capture timestamps)
 *     → 0.5 s windows / 0.25 s hop → Basic Pitch (TF.js, lazy)
 *     → micNeuralStream (dedup/grouping) → confirmNeuralNotes
 *     → canonicalInputEvent → bounded WFY / Play Along evaluation
 *
 * No pitch-only shortcuts: only independently confirmed tones reach the
 * evaluator, and every onset rides the capture clock (inference delay
 * can never shift timing). When the flag is off or the model is
 * unavailable, this hook idles and the session falls back to the
 * spectral detector without touching it.
 *
 * Render-cycle discipline: every value the interval loop reads goes
 * through a ref mirror (props/state go stale inside timers).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { idleFeedbackForCheckpoint } from './waitForYouInputFeedback.js'
import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import {
  createChordMatchState,
  getExpectedMidis,
  MATCH_OUTCOME,
} from './waitForYouNoteMatch.js'
import { evaluateCanonicalWaitForYouInput } from './canonicalInputEvent.js'
import { PERFORMANCE_MODE } from '../microphone-input/v3/performanceExpectation.js'
import { RECOGNITION_TIMING } from '../microphone-input/v3/micRecognitionIr.js'
import { VISUAL_EARLY_INPUT_SECONDS } from './visualLaneFeedback.js'
import { confirmNeuralNotes } from './micNeuralHybrid.js'
import { toCanonicalMicrophoneEvent } from './micCanonicalBridge.js'
import {
  createNeuralConfirmTracker,
  takeNewlyConfirmed,
} from './micNeuralConfirmTracker.js'
import {
  createNeuralStreamState,
  drainNeuralStreamEvents,
  emitNeuralStreamNotes,
  setNeuralStreamSampleRate,
} from '../microphone-input/micNeuralStream.js'
import {
  checkNeuralCapability,
  disposeNeuralRuntime,
  loadNeuralRuntime,
  NEURAL_MODEL_RATE,
  resampleToModelRate,
  runNeuralWindow,
  shouldSkipSilence,
} from '../microphone-input/micNeuralTfAdapter.js'

/** Play Along late edge (280 ms) — same rule as the spectral path. */
const PLAY_ALONG_LATE_INPUT_SECONDS = 0.28
const CAPTURE_POLL_MS = 100
const STREAM_HOP_MS = 250
const STREAM_WINDOW_SECONDS = 0.5
const CONFIRM_POOL_SECONDS = 1.5

/**
 * Map a capture-clock onset to score time (M5, pure + tested).
 * Finds the nearest clock sample (captureMs + practiceTimeMs pairs
 * recorded each poll) and extrapolates at playback rate ~1. Returns null
 * when no mapping exists — callers must treat that as untimed, never as
 * zero (which would manufacture an exactly-on-time grade).
 */
export function mapCaptureToScoreTime(clockMap, captureMs, fallbackPracticeMs = null) {
  if (!Array.isArray(clockMap) || !clockMap.length || !Number.isFinite(captureMs)) {
    return fallbackPracticeMs != null ? fallbackPracticeMs / 1000 : null
  }
  let best = clockMap[0]
  for (const entry of clockMap) {
    if (Math.abs(entry.captureMs - captureMs) < Math.abs(best.captureMs - captureMs)) {
      best = entry
    }
  }
  if (best.practiceTimeMs == null) {
    return null
  }
  return best.practiceTimeMs / 1000 + (captureMs - best.captureMs) / 1000
}

/**
 * Play Along timing under the unchanged 150 ms early / 280 ms late rules
 * (M5, pure + tested). Returns a RECOGNITION_TIMING label.
 */
export function classifyPlayAlongTiming(scoreTime, expectedTime) {
  if (!Number.isFinite(scoreTime) || !Number.isFinite(expectedTime)) {
    return RECOGNITION_TIMING.UNTIMED
  }
  const delta = scoreTime - expectedTime
  if (delta < -VISUAL_EARLY_INPUT_SECONDS) {
    return RECOGNITION_TIMING.EARLY
  }
  if (delta > PLAY_ALONG_LATE_INPUT_SECONDS) {
    return RECOGNITION_TIMING.LATE
  }
  return RECOGNITION_TIMING.TARGET
}

/**
 * Drift-free capture accounting (M4, pure + tested). Returns how many of
 * the analyser's newest samples to append so the ring tracks the wall
 * clock exactly: catch-up is capped at one analyser buffer (sustained
 * shortfall becomes a gap, never drift). Gaps lose milliseconds; drift
 * would lose whole beats — gaps are the right trade.
 */
export function computeAppendCount({ scratchLength, nowMs, ring, sampleRate, pollMs = CAPTURE_POLL_MS }) {
  if (ring.streamStartWallMs == null) {
    ring.streamStartWallMs = nowMs - pollMs
    ring.totalAppended = 0
  }
  const targetTotal = Math.floor(((nowMs - ring.streamStartWallMs) / 1000) * sampleRate)
  return Math.min(scratchLength, Math.max(1, targetTotal - (ring.totalAppended ?? 0)))
}

function describePhase(phase) {
  switch (phase) {
    case 'loading':
      return 'Loading neural model…'
    case 'warming':
      return 'Warming up neural inference…'
    case 'unavailable':
      return 'Neural mode unavailable — using spectral detection'
    case 'listening':
      return 'Neural listening (experimental)'
    default:
      return 'Neural idle'
  }
}

export default function useNeuralMicInput({
  active,
  checkpointMode,
  currentCheckpoint,
  checkpointIndex = null,
  checkpoints = [],
  performanceMode = PERFORMANCE_MODE.WAIT_FOR_YOU,
  performanceTimeMs = null,
  matchSettings,
  onPlayerInputMatched,
  onWrongNote = null,
  onRecognitionDecision = null,
  onPlayAlongNote = null,
  microphone,
  instrumentId = null,
}) {
  void checkpointMode
  void checkpointIndex
  void checkpoints
  void instrumentId
  const [inputFeedback, setInputFeedback] = useState(() =>
    idleFeedbackForCheckpoint(currentCheckpoint, { chordAsSequence: false }),
  )
  const [lastHeardMidi, setLastHeardMidi] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [backend, setBackend] = useState(null)
  const [warmedMs, setWarmedMs] = useState(null)
  const [phaseError, setPhaseError] = useState(null)
  const [inputLevel, setInputLevel] = useState(0)
  const [detectedNotes, setDetectedNotes] = useState([])
  const [rejected, setRejected] = useState({ count: 0, reason: null })
  const [silenceSkips, setSilenceSkips] = useState(0)

  // ---- ref mirrors (interval-loop discipline; never read stale props) ----
  const runtimeRef = useRef(null)
  const modelNamespaceRef = useRef(null)
  const streamRef = useRef(createNeuralStreamState({ windowSeconds: STREAM_WINDOW_SECONDS, hopSeconds: STREAM_HOP_MS / 1000 }))
  const ringRef = useRef({ samples: [], startCaptureMs: null, inputRate: 44100 })
  const trackerRef = useRef(createNeuralConfirmTracker())
  const chordStateRef = useRef(createChordMatchState())
  const poolRef = useRef([])
  const inferPendingRef = useRef(false)
  const rmsHistoryRef = useRef([])
  const lastHopRef = useRef(0)
  const lastLevelPublishRef = useRef(0)
  const lastPollMsRef = useRef(null)
  const clockMapRef = useRef([])
  const checkpointIdRef = useRef(null)
  const phaseRef = useRef(phase)
  const callbacksRef = useRef(null)
  const livePropsRef = useRef(null)
  // Ref mirrors for the interval loop (assigned post-render, never read
  // during render — the loop would otherwise close over stale props).
  const liveExpected = getExpectedMidis(currentCheckpoint)
  useEffect(() => {
    phaseRef.current = phase
    callbacksRef.current = { onPlayerInputMatched, onWrongNote, onRecognitionDecision, onPlayAlongNote }
    livePropsRef.current = {
      currentCheckpoint,
      expectedMidis: liveExpected,
      performanceMode,
      matchSettings,
      performanceTimeMs,
    }
  })
  const checkpointId = currentCheckpoint?.id ?? null
  const expectedMidis = getExpectedMidis(currentCheckpoint)
  const isChordCheckpoint = Boolean(currentCheckpoint?.isChord)

  const resetFeedback = useCallback(() => {
    setInputFeedback(idleFeedbackForCheckpoint(currentCheckpoint, { chordAsSequence: false }))
  }, [currentCheckpoint])

  // Reset per-checkpoint confirmation + chord state (seek / loop / restart).
  useEffect(() => {
    if (checkpointIdRef.current === checkpointId) {
      return
    }
    checkpointIdRef.current = checkpointId
    trackerRef.current = createNeuralConfirmTracker()
    chordStateRef.current = createChordMatchState()
    poolRef.current = []
    resetFeedback()
  }, [checkpointId, resetFeedback])

  // Lazy model load + hardware capability check (L3). Runs on every
  // activation (runtime cached, warmup re-measured); falls back (phase
  // 'unavailable') without touching audio.
  useEffect(() => {
    if (!active) {
      return undefined
    }
    let cancelled = false
    // setState only from async continuations (never synchronously).
    Promise.resolve()
      .then(() => {
        if (cancelled) {
          return null
        }
        setPhase('loading')
        setPhaseError(null)
        return Promise.all([
          import('@spotify/basic-pitch/model/model.json?url'),
          import('@spotify/basic-pitch/model/group1-shard1of1.bin?url'),
        ])
      })
      .then(([jsonModule, binModule]) => ({ json: jsonModule.default, bin: binModule.default }))
      .catch(() => ({ json: null, bin: null }))
      .then(async (urls) => {
        if (cancelled || !urls.json || !urls.bin) {
          if (!cancelled) {
            setPhaseError('model assets missing')
            setPhase('unavailable')
          }
          return
        }
        setPhase('warming')
        try {
          const capability = await checkNeuralCapability({ modelJsonUrl: urls.json, modelBinUrl: urls.bin })
          if (cancelled) {
            return
          }
          runtimeRef.current = { capability, urls }
          setBackend(capability.backend)
          setWarmedMs(capability.warmedMs)
          if (!capability.ok) {
            setPhaseError(`too slow on ${capability.backend} (${capability.warmedMs} ms)`)
            setPhase('unavailable')
            return
          }
          setPhase('listening')
        } catch (error) {
          if (!cancelled) {
            setPhaseError(error instanceof Error ? error.message : String(error))
            setPhase('unavailable')
          }
        }
      })
    return () => {
      cancelled = true
    }
  }, [active])

  // Capture poll + streaming hop loop.
  useEffect(() => {
    if (!active || !microphone?.isListening) {
      lastPollMsRef.current = null
      return undefined
    }
    const analyser = microphone.analyser?.current
    const getBuffer = microphone.getTimeDomainBuffer
    const sampleRate = microphone.sampleRate ?? 44100
    if (!analyser || !getBuffer) {
      return undefined
    }
    ringRef.current = { samples: [], startCaptureMs: null, inputRate: sampleRate }
    rmsHistoryRef.current = []
    const scratch = new Float32Array(analyser.fftSize)
    setNeuralStreamSampleRate(streamRef.current, NEURAL_MODEL_RATE)

    const scoreTimeAtCaptureMs = (captureMs) => mapCaptureToScoreTime(
      clockMapRef.current,
      captureMs,
      livePropsRef.current.performanceTimeMs,
    )

    const applyOutcome = (outcome, midi, expected) => {
      if (!outcome) {
        return
      }
      if (outcome.outcome === MATCH_OUTCOME.COMPLETE) {
        setInputFeedback({
          outcome: outcome.outcome,
          expected: outcome.expected ?? expected,
          matchedIndices: outcome.matchedIndices ?? new Set(),
          message: `Heard ${midiToNoteLabel(midi)} — correct (neural)`,
          playedLabel: midiToNoteLabel(midi),
          micEngineMode: 'neural-experimental',
        })
        callbacksRef.current.onPlayerInputMatched?.({ source: 'neural-microphone', midi })
      } else if (outcome.outcome === MATCH_OUTCOME.WRONG) {
        callbacksRef.current.onWrongNote?.()
      }
    }

    const emitPlayAlongTone = (event, expectedTime) => {
      const scoreTime = scoreTimeAtCaptureMs(event.rawTimestamp ?? event.wallTimestampMs)
      callbacksRef.current.onPlayAlongNote?.(event.midi, scoreTime)
      const timing = classifyPlayAlongTiming(scoreTime, expectedTime)
      callbacksRef.current.onRecognitionDecision?.({ timing, reason: 'neural-attack' })
    }

    const emitCanonicalTone = (midi, live) => {
      const attack = poolRef.current.find((entry) => entry.midi === midi)
      const onsetMs = attack?.onsetMs ?? lastHopRef.current
      try {
        const event = toCanonicalMicrophoneEvent(
          { midi, midiFloat: midi, v2DetectedMidis: [midi], clarity: attack?.confidence ?? 0.85 },
          {
            wallTimestampMs: onsetMs,
            rawTimestamp: onsetMs,
            attemptId: null,
            chordGroupId: null,
          },
        )
        if (live.performanceMode === PERFORMANCE_MODE.PLAY_ALONG) {
          emitPlayAlongTone(event, live.currentCheckpoint?.timeSeconds)
          return
        }
        const outcome = evaluateCanonicalWaitForYouInput(
          live.currentCheckpoint,
          event,
          chordStateRef.current,
          live.matchSettings,
        )
        applyOutcome(outcome, midi, live.expectedMidis)
      } catch {
        // One bad tone must not stall the stream.
      }
    }

    const confirmPool = () => {
      const live = livePropsRef.current
      if (!live.expectedMidis.length) {
        return
      }
      const pool = poolRef.current.map((entry) => ({
        midi: entry.midi,
        midiFloat: entry.midi,
        confidence: entry.confidence ?? 0.85,
        detected: true,
        neuralStart: entry.onsetMs / 1000,
        neuralEnd: null,
      }))
      // Anchor = start of the confirmation pool on the capture clock.
      const anchorSeconds = (lastHopRef.current - CONFIRM_POOL_SECONDS * 1000) / 1000
      let verdict = null
      try {
        verdict = confirmNeuralNotes(pool, live.expectedMidis, anchorSeconds)
      } catch {
        return
      }
      if (!verdict.complete && verdict.confirmedMidis.length === 0) {
        setRejected((previous) => ({
          count: previous.count + 1,
          reason: `heard ${verdict.unexpectedMidis.length} unexpected, missing ${verdict.missingMidis.length}`,
        }))
        return
      }
      const fresh = takeNewlyConfirmed(trackerRef.current, checkpointIdRef.current, verdict.confirmedMidis)
      for (const midi of fresh) {
        emitCanonicalTone(midi, live)
      }
    }

    const handleNeuralNotes = (notes, windowStartCaptureMs) => {
      // Drain (not the emit return): state.emitted would otherwise grow
      // without bound across a take. Draining returns the same events.
      emitNeuralStreamNotes(
        streamRef.current,
        (notes ?? []).map((note) => ({
          midi: note.midi,
          startOffsetSeconds: note.startOffsetSeconds,
          endOffsetSeconds: note.endOffsetSeconds,
        })),
        windowStartCaptureMs,
      )
      const emitted = drainNeuralStreamEvents(streamRef.current)
      if (!emitted.length) {
        return
      }
      for (const attack of emitted) {
        poolRef.current.push({ midi: attack.midi, onsetMs: attack.onsetCaptureMs, confidence: attack.confidence })
      }
      const cutoff = windowStartCaptureMs + STREAM_WINDOW_SECONDS * 1000 - CONFIRM_POOL_SECONDS * 1000
      poolRef.current = poolRef.current.filter((entry) => entry.onsetMs >= cutoff)
      setDetectedNotes(
        poolRef.current.slice(-6).map((entry) => ({
          midi: entry.midi,
          label: midiToNoteLabel(entry.midi),
          onsetCaptureMs: Math.round(entry.onsetMs),
        })),
      )
      setLastHeardMidi(poolRef.current[poolRef.current.length - 1]?.midi ?? null)
      confirmPool()
    }

    const pumpNeuralHop = async () => {
      const runtime = runtimeRef.current
      if (!runtime || phaseRef.current !== 'listening' || inferPendingRef.current) {
        return
      }
      // Silence skip (M3): no musical signal below the measured floor —
      // skip inference entirely (kills room-tone hallucinations at the
      // source and saves the GPU for real audio). Not a rejection;
      // silence simply produces no candidates.
      if (shouldSkipSilence(rmsHistoryRef.current)) {
        setSilenceSkips((count) => count + 1)
        return
      }
      const ring = ringRef.current
      const needSamples = Math.floor(STREAM_WINDOW_SECONDS * ring.inputRate)
      if (ring.samples.length < needSamples) {
        return
      }
      const windowSamples = Float32Array.from(ring.samples.slice(ring.samples.length - needSamples))
      const windowStartCaptureMs = ring.startCaptureMs + ((ring.samples.length - needSamples) / ring.inputRate) * 1000
      inferPendingRef.current = true
      try {
        if (!modelNamespaceRef.current) {
          modelNamespaceRef.current = await import('@spotify/basic-pitch')
        }
        const loaded = await loadNeuralRuntime({ modelJsonUrl: runtime.urls.json, modelBinUrl: runtime.urls.bin })
        const resampled = resampleToModelRate(windowSamples, ring.inputRate, NEURAL_MODEL_RATE)
        const notes = await runNeuralWindow(loaded, modelNamespaceRef.current, resampled)
        handleNeuralNotes(notes, windowStartCaptureMs)
      } catch {
        // Single-window failures must not stall the stream.
      } finally {
        inferPendingRef.current = false
      }
    }

    const poll = () => {
      try {
        const nowMs = performance.now()
        analyser.getFloatTimeDomainData(scratch)
        let sumSquares = 0
        for (const value of scratch) {
          sumSquares += value * value
        }
        const rms = Math.sqrt(sumSquares / scratch.length)
        rmsHistoryRef.current.push(rms)
        if (rmsHistoryRef.current.length > 8) {
          rmsHistoryRef.current.shift()
        }
        if (nowMs - lastLevelPublishRef.current > 300) {
          lastLevelPublishRef.current = nowMs
          setInputLevel(Math.min(1, rms * 4))
        }
        const ring = ringRef.current
        // Drift-free accounting (M4): append exactly what the wall clock
        // owes since stream start (catch-up capped at one analyser
        // buffer). The old 1.1x overlap factor dilated timestamps ~10%;
        // this bounds drift to ±1 poll with micro-gaps instead, which
        // dedup/grouping absorb. Gaps lose milliseconds; drift loses
        // whole beats — gaps are the right trade.
        const appendCount = computeAppendCount({ scratchLength: scratch.length, nowMs, ring, sampleRate })
        lastPollMsRef.current = nowMs
        const fresh = scratch.subarray(scratch.length - appendCount)
        if (ring.startCaptureMs == null) {
          ring.startCaptureMs = nowMs - (fresh.length / sampleRate) * 1000
        }
        for (const value of fresh) {
          ring.samples.push(value)
        }
        ring.totalAppended = (ring.totalAppended ?? 0) + fresh.length
        // Clock map for capture→score-time mapping (Play Along timing).
        clockMapRef.current.push({ captureMs: nowMs, practiceTimeMs: livePropsRef.current.performanceTimeMs })
        if (clockMapRef.current.length > 40) {
          clockMapRef.current.shift()
        }
        // Keep ~4 s of audio; drop older.
        const keepCount = sampleRate * 4
        if (ring.samples.length > keepCount) {
          const drop = ring.samples.length - keepCount
          ring.samples.splice(0, drop)
          ring.startCaptureMs += (drop / sampleRate) * 1000
        }
        if (nowMs - lastHopRef.current >= STREAM_HOP_MS) {
          lastHopRef.current = nowMs
          void pumpNeuralHop().catch(() => {})
        }
      } catch {
        // A diagnostics-grade loop must never break capture.
      }
    }

    const timer = setInterval(poll, CAPTURE_POLL_MS)
    return () => {
      clearInterval(timer)
      inferPendingRef.current = false
    }
  }, [active, microphone])

  // Model teardown on unmount only (M4): repeated toggle cycles reuse
  // the cached runtime (no recompile); unmount releases GPU memory and
  // the manifest Blob URL. Deactivation alone must NOT dispose.
  useEffect(() => () => {
    try {
      disposeNeuralRuntime()
    } catch {
      // Diagnostics only.
    }
  }, [])

  // Display phase derives from activation (no setState on toggle):
  // an inactive hook always reads idle even if it was listening.
  const displayPhase = active ? phase : 'idle'
  const micStatusLabel = !active
    ? 'Neural idle'
    : describePhase(phase)

  return {
    matchingEnabled: displayPhase === 'listening',
    inputFeedback,
    resetFeedback,
    lastHeardMidi,
    liveFrame: null,
    calibration: null,
    calibrationStatus: null,
    micCalibrating: false,
    micStatusLabel,
    retryCalibration: () => {},
    isChordCheckpoint,
    isMicChordCollection: false,
    isMicV2Polyphonic: false,
    expectedCount: expectedMidis.length,
    chordMicMode: 'neural-experimental',
    feedbackOutcome: inputFeedback.outcome,
    micEngineMode: 'neural-experimental',
    micEngineV2Enabled: false,
    micEngineV2Active: false,
    micEngineV3Enabled: false,
    performanceExpectation: null,
    v2RuntimeError: phaseError,
    exportDebugFrames: () => ({ phase, backend, warmedMs, error: phaseError }),
    exportMicTrace: () => [],
    neural: {
      phase: displayPhase,
      backend,
      warmedMs,
      error: phaseError,
      level: inputLevel,
      detectedNotes,
      rejected,
      silenceSkips,
    },
  }
}

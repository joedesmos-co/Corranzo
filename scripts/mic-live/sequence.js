/* eslint-disable react-hooks/exhaustive-deps, react-hooks/immutability */
/**
 * Production microphone SEQUENCE harness (test-only).
 *
 * The single-checkpoint live harness (scripts/mic-live/live.js) can only
 * prove that one expected event is accepted. Real Wait For You sessions are
 * a chain: repeated identical notes, repeated chords, sustained chords that
 * must not skip the next checkpoint, wrong notes followed by recovery, and
 * pauses. This page mounts the REAL production hook and walks a scheduled
 * list of checkpoints while a single continuous injected audio stream plays.
 *
 * It records, per scheduled step:
 *   - whether the checkpoint advanced, and its latency from the intended onset
 *   - whether a miss/negative step was (incorrectly) advanced
 *   - wrong-note reports, detected notes, feedback and the decision reason
 *
 * Nothing here is product code; it exists so sequence behaviour can be
 * measured in a real browser instead of inferred from unit fixtures.
 */
import { createElement, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useMicrophoneCapture from '/src/features/microphone-input/useMicrophoneCapture.js'
import useWaitForYouMicInput from '/src/features/practice/useWaitForYouMicInput.js'
import { normalizeMatchSettings } from '/src/features/practice/waitForYouMatchSettings.js'
import { PERFORMANCE_MODE } from '/src/features/microphone-input/v3/performanceExpectation.js'

const settings = normalizeMatchSettings({})
const DRIVER_INTERVAL_MS = 15
const FINAL_TAIL_MS = 600

function toCheckpoint(step) {
  if (!step) return null
  const midis = step.expectedMidis ?? []
  const isChord = midis.length > 1
  return {
    id: step.id,
    expectedMidis: midis,
    expectedMidi: midis[0],
    isChord,
    kind: isChord ? 'chord' : 'note',
    mode: 'note',
    rollingWindowMs: isChord ? (step.rollingWindowMs ?? (step.instrument === 'guitar' ? 900 : 720)) : undefined,
    timeSeconds: (step.onsetMs ?? 0) / 1000,
    measureNumber: step.measureNumber ?? 1,
    beat: step.beat ?? 1,
    expectedStringFrets: step.stringFrets ?? [],
    notes: midis.map((midi, index) => {
      const position = (step.stringFrets ?? []).find((entry) => entry.midi === midi)
      return {
        id: `${step.id}-n${index}`,
        midi,
        string: position?.string ?? null,
        fret: position?.fret ?? null,
      }
    }),
  }
}

function elapsedMusicalMs() {
  const sequence = window.__liveSeq
  if (!sequence?.startedAt) return null
  return performance.now() - sequence.startedAt
}

function LiveCapture({ onReady }) {
  const microphone = useMicrophoneCapture({ active: true })
  useEffect(() => {
    microphone.requestAccess?.().catch(() => {})
  }, [])
  const delivered = useRef(null)
  useEffect(() => {
    const signature = `${microphone?.isListening ? 1 : 0}:${microphone?.sampleRate ?? 0}:${microphone?.errorMessage ?? ''}`
    if (delivered.current === signature) return
    delivered.current = signature
    onReady?.(microphone)
  })
  return null
}

function SequenceMic({ microphone }) {
  const steps = window.__liveSeq?.steps ?? []
  const [stepIndex, setStepIndex] = useState(0)
  const stepIndexRef = useRef(0)
  const resultsRef = useRef([])
  const wrongRef = useRef(0)
  const feedbackRef = useRef(null)
  const detectedRef = useRef([])
  const lastDecisionRef = useRef(null)
  const decisionHistoryRef = useRef([])
  const historyStartedRef = useRef(false)
  const finishedRef = useRef(false)
  const micRef = useRef(null)
  const traceArchiveRef = useRef(new Map())

  const checkpoint = toCheckpoint(steps[stepIndex])
  const active = Boolean(checkpoint) && Boolean(microphone?.isListening)

  const publishResults = () => {
    window.__liveSequenceResults = {
      kind: 'corranzo-mic-sequence',
      steps,
      results: resultsRef.current,
      stepIndex: stepIndexRef.current,
      finished: finishedRef.current,
      calibration: microphone?.calibration ?? null,
      sampleRate: microphone?.sampleRate ?? null,
      deviceId: microphone?.captureSettings?.deviceId ?? null,
      micEngineMode: window.SCOREFLOW_MIC_DEBUG?.engineMode ?? null,
      v3Enabled: window.SCOREFLOW_MIC_DEBUG?.v3Enabled ?? null,
    }
  }

  const pushResult = (entry) => {
    resultsRef.current = [...resultsRef.current, entry]
    publishResults()
  }

  const finishIfDone = () => {
    if (finishedRef.current) return
    if (stepIndexRef.current < steps.length) return
    finishedRef.current = true
    publishResults()
    window.__liveSeqDone = true
  }

  const moveOn = (entry) => {
    entry.decisionHistory = [...decisionHistoryRef.current]
    entry.micStatus = micRef.current?.micStatusLabel ?? null
    entry.calibrationReady = micRef.current?.calibration?.ready ?? null
    pushResult(entry)
    decisionHistoryRef.current = []
    stepIndexRef.current += 1
    wrongRef.current = 0
    setStepIndex(stepIndexRef.current)
    finishIfDone()
  }

  function mergeTraceArchive() {
    try {
      const raw = micRef.current?.exportMicTrace?.()
      if (!raw) return
      const parsed = JSON.parse(raw)
      const now = performance.now()
      for (const frame of parsed.frames ?? []) {
        if (Number.isFinite(frame.timestampMs)) {
          traceArchiveRef.current.set(frame.timestampMs, frame)
        }
      }
      for (const timestamp of traceArchiveRef.current.keys()) {
        if (now - timestamp > 30_000) traceArchiveRef.current.delete(timestamp)
      }
    } catch {
      // trace is diagnostic only
    }
  }

  function recentTrace(centerTimestampMs = performance.now()) {
    mergeTraceArchive()
    const lo = centerTimestampMs - 350
    const hi = centerTimestampMs + 350
    const frames = [...traceArchiveRef.current.values()]
      .filter((frame) => frame.timestampMs >= lo && frame.timestampMs <= hi)
      .sort((left, right) => left.timestampMs - right.timestampMs)
    return frames.slice(-60)
  }

  const mic = useWaitForYouMicInput({
    active,
    checkpointMode: 'note',
    currentCheckpoint: checkpoint,
    checkpoints: steps.map(toCheckpoint),
    checkpointIndex: stepIndex,
    performanceMode: PERFORMANCE_MODE.WAIT_FOR_YOU,
    matchSettings: settings,
    microphone,
    instrumentId: window.__liveSeq?.instrumentId ?? 'piano',
    onPlayerInputMatched: (decision) => {
      const index = stepIndexRef.current
      const step = steps[index]
      if (!step) return
      if (resultsRef.current.some((entry) => entry.stepId === step.id)) return
      const elapsed = elapsedMusicalMs()
      const advancedAtTimestamp = performance.now()
      const entry = {
        stepId: step.id,
        index,
        expectAdvance: Boolean(step.expectAdvance),
        advanced: true,
        pass: Boolean(step.expectAdvance),
        onsetMs: step.onsetMs,
        advanceAtMs: elapsed != null ? Math.round(elapsed) : null,
        latencyMs: elapsed != null ? Math.round(elapsed - step.onsetMs) : null,
        wrongReports: wrongRef.current,
        detectedMidis: detectedRef.current,
        feedback: feedbackRef.current,
        trace: recentTrace(advancedAtTimestamp),
        expectation: window.SCOREFLOW_MIC_DEBUG?.performanceExpectation
          ? {
              id: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.id,
              kind: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.event?.kind,
              expectedMidis: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.event?.expectedMidis,
              timing: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.timing,
              sustain: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.sustain,
            }
          : null,
        decision: decision
          ? {
              outcome: decision.outcome,
              reason: decision.reason,
              matchedMidis: decision.matchedMidis,
              missingMidis: decision.missingMidis,
              unexpectedMidis: decision.unexpectedMidis,
              timing: decision.timing,
            }
          : null,
      }
      moveOn(entry)
      setTimeout(() => {
        entry.trace = recentTrace(advancedAtTimestamp)
        publishResults()
      }, 45)
    },
    onWrongNote: () => {
      wrongRef.current += 1
    },
    onRecognitionDecision: (decision) => {
      lastDecisionRef.current = decision
      decisionHistoryRef.current.push({
        atMs: decision.timeMs,
        outcome: decision.outcome,
        reason: decision.reason,
        matchedMidis: decision.matchedMidis,
        missingMidis: decision.missingMidis,
        unexpectedMidis: decision.unexpectedMidis,
        attackId: decision.attackId,
        timing: decision.timing,
        confidence: decision.confidence?.overall ?? null,
      })
      if (decisionHistoryRef.current.length > 180) decisionHistoryRef.current.shift()
    },
  })

  useEffect(() => {
    micRef.current = mic
  }, [mic])

  useEffect(() => {
    const interval = setInterval(mergeTraceArchive, 20)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    feedbackRef.current = mic?.inputFeedback ?? null
    const heard = mic?.lastHeardMidi
    const detected = mic?.liveFrame?.v2DetectedMidis
    detectedRef.current = Array.isArray(detected) && detected.length
      ? [...detected]
      : Number.isFinite(heard) ? [heard] : []
    publishResults()
  }, [mic?.inputFeedback, mic?.lastHeardMidi, mic?.liveFrame])

  useEffect(() => {
    const interval = setInterval(() => {
      const sequence = window.__liveSeq
      if (!sequence?.startedAt || finishedRef.current) return
      if (!historyStartedRef.current) {
        historyStartedRef.current = true
        decisionHistoryRef.current = []
      }
      const index = stepIndexRef.current
      const step = steps[index]
      if (!step) {
        finishIfDone()
        return
      }
      const elapsed = elapsedMusicalMs()
      if (elapsed == null) return
      const deadline = (step.onsetMs ?? 0) + (step.deadlineMs ?? 900)
      if (elapsed < deadline) return
      if (resultsRef.current.some((entry) => entry.stepId === step.id)) return
      const timedOutAtTimestamp = performance.now()
      const traceCenterTimestamp = (window.__liveSeq?.startedAt ?? timedOutAtTimestamp)
        + (step.onsetMs ?? 0)
        + Math.min(450, (step.deadlineMs ?? 900) * 0.5)
      moveOn({
        stepId: step.id,
        index,
        expectAdvance: Boolean(step.expectAdvance),
        advanced: false,
        pass: !step.expectAdvance,
        onsetMs: step.onsetMs,
        advanceAtMs: null,
        latencyMs: null,
        wrongReports: wrongRef.current,
        detectedMidis: detectedRef.current,
        feedback: feedbackRef.current,
        trace: recentTrace(traceCenterTimestamp),
        expectation: window.SCOREFLOW_MIC_DEBUG?.performanceExpectation
          ? {
              id: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.id,
              kind: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.event?.kind,
              expectedMidis: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.event?.expectedMidis,
              timing: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.timing,
              sustain: window.SCOREFLOW_MIC_DEBUG.performanceExpectation.sustain,
            }
          : null,
        decision: lastDecisionRef.current
          ? {
              outcome: lastDecisionRef.current.outcome,
              reason: lastDecisionRef.current.reason,
              matchedMidis: lastDecisionRef.current.matchedMidis,
              missingMidis: lastDecisionRef.current.missingMidis,
              unexpectedMidis: lastDecisionRef.current.unexpectedMidis,
              timing: lastDecisionRef.current.timing,
            }
          : null,
      })
    }, DRIVER_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [steps])

  return null
}

function App() {
  const [microphone, setMicrophone] = useState(null)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const handler = () => setArmed(true)
    window.addEventListener('live-inject', handler)
    return () => window.removeEventListener('live-inject', handler)
  }, [])
  if (!armed) return createElement('div', null, 'armed=false')
  return createElement(
    'div',
    null,
    createElement(LiveCapture, { onReady: setMicrophone }),
    createElement(SequenceMic, { microphone }),
  )
}

createRoot(document.getElementById('root') ?? document.body).render(createElement(App))

async function startInjectedSequence({ samples, sampleRate, steps, preludeSeconds, instrumentId, channels = 1 }) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const context = new AudioCtx({ sampleRate })
  const data = samples instanceof Float32Array ? samples : Float32Array.from(samples)
  const channelCount = Math.max(1, Math.floor(channels))
  const frames = Math.ceil(data.length / channelCount)
  const buffer = context.createBuffer(channelCount, frames, sampleRate)
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex)
    if (channelCount === 1) {
      channel.set(data.subarray(0, frames))
    } else {
      for (let i = 0; i < frames; i += 1) {
        channel[i] = data[i * channelCount + channelIndex] ?? 0
      }
    }
  }

  window.__liveSeq = {
    steps,
    instrumentId: instrumentId ?? 'piano',
    preludeSeconds,
    startedAt: null,
  }
  window.__liveSequenceResults = {
    kind: 'corranzo-mic-sequence',
    steps,
    results: [],
    stepIndex: 0,
    finished: false,
  }
  window.__liveSeqDone = false

  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = false
  const destination = context.createMediaStreamDestination()
  source.connect(destination)
  const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = async () => destination.stream
  }
  window.__liveTeardown = () => {
    try {
      source.stop()
    } catch {
      // already stopped
    }
    void context.close()
    if (original && navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = original
    }
  }
  window.__liveContext = context
  window.dispatchEvent(new Event('live-inject'))
  await new Promise((resolve) => setTimeout(resolve, 450))
  source.start(0)
  window.__liveInjectedAt = performance.now()
  window.__liveSeq.startedAt = performance.now() + preludeSeconds * 1000
}

window.__liveApi = {
  async injectSequence(payload) {
    await startInjectedSequence(payload)
  },
  async waitDone(timeoutMs = 60_000) {
    const start = performance.now()
    while (!window.__liveSeqDone && performance.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    // Give the final result/feedback effect a chance to flush.
    await new Promise((resolve) => setTimeout(resolve, FINAL_TAIL_MS))
    return window.__liveSequenceResults
  },
}

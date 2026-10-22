/**
 * Production microphone live harness (Step 5 launch sprint) — test-only.
 *
 * Injects REAL clip audio at the microphone/media boundary: the test
 * passes decoded PCM, this page plays it through a
 * MediaStreamAudioDestinationNode and stubs getUserMedia to return that
 * stream — the app's real capture code (useMicrophoneCapture) cannot
 * tell it apart from a microphone. It then mounts the REAL production
 * hook (useWaitForYouMicInput, v2 score-informed) against a real
 * checkpoint and records matched/wrong callbacks plus stage diagnostics.
 *
 * This is the production counterpart of scripts/neural-live/live.js: the
 * repository had MediaStream injection coverage for the experimental
 * neural path only, so the shipped recognizer could not be A/B'd in a
 * browser.
 *
 * The test drives everything through window.__liveApi.
 */
import { createElement, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useMicrophoneCapture from '/src/features/microphone-input/useMicrophoneCapture.js'
import useWaitForYouMicInput from '/src/features/practice/useWaitForYouMicInput.js'
import { normalizeMatchSettings } from '/src/features/practice/waitForYouMatchSettings.js'
import { PERFORMANCE_MODE } from '/src/features/microphone-input/v3/performanceExpectation.js'

const settings = normalizeMatchSettings({})

function LiveCapture({ onReady }) {
  const microphone = useMicrophoneCapture({ active: true })
  useEffect(() => {
    let cancelled = false
    microphone.requestAccess?.().catch(() => {})
    return () => {
      cancelled = true
      void cancelled
    }
  }, [])
  // Deliver the capture object only when something MEANINGFUL changes:
  // the hook returns a fresh object literal every render, so delivering
  // on every render would loop (setState -> render -> setState).
  window.__liveMicrophone = microphone
  const delivered = useRef(null)
  useEffect(() => {
    const signature = `${microphone?.isListening ? 1 : 0}:${microphone?.sampleRate ?? 0}:${microphone?.errorMessage ?? ''}`
    if (delivered.current === signature) {
      return
    }
    delivered.current = signature
    onReady?.(microphone)
  })
  return null
}

function LiveProductionMic({ microphone }) {
  const [outcome, setOutcome] = useState({ matched: [], wrong: 0 })
  const checkpoint = window.__liveInject?.checkpoint ?? null
  const mic = useWaitForYouMicInput({
    active: true,
    checkpointMode: 'note',
    currentCheckpoint: checkpoint,
    checkpoints: checkpoint ? [checkpoint] : [],
    checkpointIndex: 0,
    performanceMode: PERFORMANCE_MODE.WAIT_FOR_YOU,
    matchSettings: settings,
    microphone,
    instrumentId: window.__liveInject?.instrumentId ?? 'piano',
    onPlayerInputMatched: (decision) => {
      setOutcome((previous) => ({ ...previous, matched: [...previous.matched, { ...decision, atMs: Date.now() }] }))
    },
    onWrongNote: () => {
      setOutcome((previous) => ({ ...previous, wrong: previous.wrong + 1 }))
    },
  })
  useEffect(() => {
    window.__liveResults = {
      ...window.__liveResults,
      matched: outcome.matched,
      wrong: outcome.wrong,
      phase: mic?.micStatusLabel ?? 'unknown',
      feedbackOutcome: mic?.feedbackOutcome ?? null,
      lastHeardMidi: mic?.lastHeardMidi ?? null,
      micStatusLabel: mic?.micStatusLabel ?? null,
      v2Enabled: mic?.micEngineV2Enabled ?? null,
      v2Active: mic?.micEngineV2Active ?? null,
      v3Enabled: mic?.micEngineV3Enabled ?? null,
      micEngineMode: mic?.micEngineMode ?? null,
      calibration: mic?.calibration ?? null,
      debug: mic?.liveFrame ?? null,
      trace: typeof mic?.exportMicTrace === 'function' ? mic.exportMicTrace() : null,
    }
  })
  return null
}

function App() {
  // The production hook takes the capture object as a prop, so it must
  // arrive through React state (a module-level global would leave the
  // hook with `active && microphone?.isListening` false forever).
  //
  // The capture is armed only AFTER the test stubs getUserMedia:
  // mounting earlier would ask the real device API, fail, and leave the
  // analyser silent (the production hook then never listens).
  const [microphone, setMicrophone] = useState(null)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const handler = () => setArmed(true)
    window.addEventListener('live-inject', handler)
    return () => window.removeEventListener('live-inject', handler)
  }, [])
  if (!armed) {
    return createElement('div', null, 'armed=false')
  }
  return createElement('div', null, createElement(LiveCapture, { onReady: setMicrophone }), createElement(LiveProductionMic, { microphone }))
}

const root = createRoot(document.getElementById('root') ?? document.body)
root.render(createElement(App))

window.__liveApi = {
  async inject({ samples, sampleRate, expectedMidis, checkpointId, instrumentId = 'piano', loop = true, channels = 1, roomTone = true }) {
    window.__liveInject = {
      checkpoint: { id: checkpointId, expectedMidis, kind: 'note', mode: 'note' },
      instrumentId,
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    const context = new AudioCtx({ sampleRate })
    const data = samples instanceof Float32Array ? samples : Float32Array.from(samples)
    const channelCount = Math.max(1, Math.floor(channels))
    // A real room is never digitally silent: the production calibration
    // treats a below-0.0009-RMS room as "no input" and refuses to match.
    // Inject 4 s of quiet room tone ahead of the clip so calibration sees
    // a realistic floor (this mirrors the neural harness prelude).
    const toneFrames = roomTone ? Math.floor(sampleRate * 4) : 0
    const frames = toneFrames + Math.floor(data.length / channelCount)
    const buffer = context.createBuffer(channelCount, frames, sampleRate)
    for (let c = 0; c < channelCount; c += 1) {
      const channel = buffer.getChannelData(c)
      if (roomTone) {
        let seed = 12345
        for (let i = 0; i < toneFrames; i += 1) {
          seed = (seed * 1103515245 + 12345) >>> 0
          channel[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.0015
        }
      }
      const offset = toneFrames
      if (channelCount === 1) {
        channel.set(data.subarray(0, frames - offset), offset)
      } else {
        for (let i = 0; i < frames - offset; i += 1) {
          channel[offset + i] = data[i * channelCount + c] ?? 0
        }
      }
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = loop
    if (source.loop) {
      // Anti-phase-lock dither (same rationale as the neural harness):
      // clip durations that are exact multiples of the analysis hop would
      // otherwise re-present identical window alignment every repetition.
      source.playbackRate.value = 0.995
    }
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
    // Arm the capture (now that getUserMedia is stubbed) and start audio.
    window.__liveContext = context
    window.dispatchEvent(new Event('live-inject'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    source.start(0)
    window.__liveInjectedAt = Date.now()
  },
  unmount() {
    window.__liveApi.__root?.unmount()
  },
  mount() {
    // The production hook is mounted once at page load; re-mounting is a
    // no-op (the harness drives the checkpoint through __liveInject).
  },
}

/**
 * Neural live harness page (M2/M3) — test-only.
 *
 * Injects REAL clip audio at the microphone/media boundary: the test
 * passes decoded PCM samples, this page plays them through a
 * MediaStreamAudioDestinationNode and stubs getUserMedia to return that
 * stream — the app's real capture code (useMicrophoneCapture) cannot
 * tell it apart from a microphone. Then mounts the REAL useNeuralMicInput
 * hook (REAL TF.js model) against a REAL checkpoint and records
 * matched/wrong callbacks plus stage diagnostics.
 *
 * Query: expected=<midi,csv> (injected via window.__liveInject below).
 * The test drives everything through window.__liveApi.
 */
import { createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useMicrophoneCapture from '/src/features/microphone-input/useMicrophoneCapture.js'
import useNeuralMicInput from '/src/features/practice/useNeuralMicInput.js'
import { normalizeMatchSettings } from '/src/features/practice/waitForYouMatchSettings.js'
import { PERFORMANCE_MODE } from '/src/features/microphone-input/v3/performanceExpectation.js'

const settings = normalizeMatchSettings({})

// Session-level shared ring (mirrors usePracticeSession): both mode
// mounts adopt the same capture audio across a switch.
const sharedRingRef = { current: null }

function LiveCapture({ onReady }) {
  const microphone = useMicrophoneCapture({ active: true })
  // The capture hook requires an explicit access request (same as the
  // app's mic-enable flow); without it the stream never starts.
  useEffect(() => {
    let cancelled = false
    microphone.requestAccess?.().catch(() => {})
    return () => {
      cancelled = true
      void cancelled
    }
  }, [])
  useEffect(() => {
    onReady?.(microphone)
  })
  window.__liveMicrophone = microphone
  return null
}

function LiveNeural({ performanceMode, playAlongEvents }) {
  const [outcome, setOutcome] = useState({ matched: [], wrong: 0 })
  const microphone = window.__liveMicrophone
  const neural = useNeuralMicInput({
    active: true,
    currentCheckpoint: window.__liveInject.checkpoint,
    matchSettings: settings,
    performanceMode: performanceMode ?? PERFORMANCE_MODE.WAIT_FOR_YOU,
    onPlayerInputMatched: (decision) => {
      setOutcome((previous) => ({ ...previous, matched: [...previous.matched, { ...decision, atMs: Date.now() }] }))
    },
    onWrongNote: () => {
      setOutcome((previous) => ({ ...previous, wrong: previous.wrong + 1 }))
    },
    onPlayAlongNote: (midi) => {
      playAlongEvents?.push(midi)
    },
    microphone,
    sharedRingRef,
  })
  useEffect(() => {
    window.__liveResults = {
      matched: outcome.matched,
      wrong: outcome.wrong,
      injectedAt: window.__liveInjectedAt ?? null,
      phase: neural.neural.phase,
      backend: neural.neural.backend,
      warmedMs: neural.neural.warmedMs,
      error: neural.neural.error,
      matchingEnabled: neural.matchingEnabled,
      feedbackOutcome: neural.feedbackOutcome,
      detectedNotes: neural.neural.detectedNotes,
      rejected: neural.neural.rejected,
      debug: neural.neural.debug,
      micListening: window.__liveMicrophone?.isListening ?? microphone?.isListening,
      micError: window.__liveMicrophone?.errorMessage ?? microphone?.errorMessage,
    }
  })
  return null
}

window.__liveApi = {
  __neuralMount: null,
  __captureMount: null,
  __playAlongEvents: [],
  mountCapture() {
    if (window.__liveApi.__captureMount) {
      return
    }
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const root = createRoot(mount)
    root.render(createElement(LiveCapture))
    window.__liveApi.__captureMount = { mount, root }
  },
  mountNeural({ performanceMode = PERFORMANCE_MODE.WAIT_FOR_YOU } = {}) {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const root = createRoot(mount)
    window.__liveApi.__playAlongEvents = []
    root.render(createElement(LiveNeural, { performanceMode, playAlongEvents: window.__liveApi.__playAlongEvents }))
    window.__liveApi.__neuralMount = { mount, root }
  },
  // Legacy single-call mount (capture + WFY neural together).
  mount({ performanceMode = PERFORMANCE_MODE.WAIT_FOR_YOU } = {}) {
    window.__liveApi.mountCapture()
    window.__liveApi.mountNeural({ performanceMode })
  },
  unmount() {
    // Neural hook only — capture survives mode switches (production:
    // useMicrophoneCapture stays mounted; only hook `active` flips).
    try {
      window.__liveApi.__neuralMount?.root.unmount()
    } catch {
      // Diagnostics only.
    }
    try {
      window.__liveApi.__neuralMount?.mount.remove()
    } catch {
      // Diagnostics only.
    }
    window.__liveApi.__neuralMount = null
  },
  unmountAll() {
    window.__liveApi.unmount()
    try {
      window.__liveApi.__captureMount?.root.unmount()
    } catch {
      // Diagnostics only.
    }
    try {
      window.__liveApi.__captureMount?.mount.remove()
    } catch {
      // Diagnostics only.
    }
    window.__liveApi.__captureMount = null
  },
  async inject({ samples, sampleRate, expectedMidis, checkpointId, forceListen = false, performanceMode = PERFORMANCE_MODE.WAIT_FOR_YOU, keepAudio = false, loop = true, deferUntilListening = false }) {
    window.__liveInject = { checkpoint: { id: checkpointId, expectedMidis } }
    if (forceListen) {
      // Test-only hardware-gate bypass (see useNeuralMicInput): validates
      // everything downstream of the gate on CPU-only runners.
      window.__SCOREFLOW_NEURAL_FORCE_LISTEN = true
    }
    const startAudio = () => {
      window.__liveApi.__audio.source.start(0)
      // Attack-time anchor: set at actual audio start (not inject call),
      // so deferred starts still give exact sound-to-feedback latency.
      window.__liveInjectedAt = Date.now()
    }
    if (!keepAudio || !window.__liveApi.__audio) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const context = new AudioCtx({ sampleRate })
      const buffer = context.createBuffer(1, samples.length, sampleRate)
      buffer.getChannelData(0).set(samples)
      const source = context.createBufferSource()
      source.buffer = buffer
      // Loop the short clip by default: every repetition is a fresh attack
      // for the repeat-detection path (and keeps audio flowing for long
      // tests). loop:false plays once — for sound-to-feedback latency
      // probes where the attack time must be unambiguous.
      source.loop = loop !== false
      if (source.loop) {
        // Anti-phase-lock dither: clip durations are often exact
        // multiples of the 250 ms hop (e.g. 3.000 s = 12 hops), so a
        // verbatim loop re-presents identical window alignment every
        // iteration — an onset hidden by edge suppression once is hidden
        // forever (measured: F5@0.504 inaudible across 50 loops). A -8.7
        // cent drift (far below the 50-cent confirm tolerance) precesses
        // 15 ms per 3 s loop, covering the full hop grid over a run.
        // Harness-only; the benchmark scores clips straight, unlooped.
        source.playbackRate.value = 0.995
      }
      const destination = context.createMediaStreamDestination()
      source.connect(destination)
      const stream = destination.stream
      // Inject at the microphone/media boundary: from here on, every API
      // the app touches (getUserMedia, MediaStreamTrack, AnalyserNode) is
      // the real browser implementation carrying real clip audio.
      Object.defineProperty(window.navigator, 'mediaDevices', {
        value: {
          ...window.navigator.mediaDevices,
          getUserMedia: async () => stream,
          enumerateDevices: async () => [],
        },
        configurable: true,
      })
      const holdForListening = deferUntilListening && loop === false
      if (!holdForListening) {
        source.start(0)
        window.__liveInjectedAt = Date.now()
      }
      window.__liveApi.__audio = { context, source, stream, started: !holdForListening }
    }
    window.__liveApi.mount({ performanceMode })
    if (deferUntilListening && loop === false && window.__liveApi.__audio && !window.__liveApi.__audio.started) {
      // Single-shot latency probes: hold the one attack until the engine
      // reports listening (model fetch + SwiftShader compile on headless
      // runners is slower than the 80 ms attack offset). Poll here rather
      // than in the test so injectedAt still anchors the true start.
      const deadline = Date.now() + 120_000
      for (;;) {
        const phase = await new Promise((resolve) => {
          setTimeout(() => {
            try {
              resolve(window.__liveResults?.phase ?? null)
            } catch {
              resolve(null)
            }
          }, 250)
        })
        if (phase === 'listening' || Date.now() >= deadline) {
          break
        }
      }
    }
    if (!window.__liveApi.__audio.started) {
      window.__liveApi.__audio.started = true
      startAudio()
    }
    window.__liveTeardown = () => {
      window.__liveApi.unmountAll()
      const audio = window.__liveApi.__audio
      window.__liveApi.__audio = null
      if (!audio) {
        return
      }
      try {
        audio.source.stop()
      } catch {
        // Diagnostics only.
      }
      audio.stream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // Diagnostics only.
        }
      })
      try {
        audio.context.close()
      } catch {
        // Diagnostics only.
      }
    }
  },
  playAlongEvents() {
    return [...(window.__liveApi.__playAlongEvents ?? [])]
  },
}

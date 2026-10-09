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
      setOutcome((previous) => ({ ...previous, matched: [...previous.matched, decision] }))
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
  async inject({ samples, sampleRate, expectedMidis, checkpointId, forceListen = false, performanceMode = PERFORMANCE_MODE.WAIT_FOR_YOU, keepAudio = false }) {
    window.__liveInject = { checkpoint: { id: checkpointId, expectedMidis } }
    if (forceListen) {
      // Test-only hardware-gate bypass (see useNeuralMicInput): validates
      // everything downstream of the gate on CPU-only runners.
      window.__SCOREFLOW_NEURAL_FORCE_LISTEN = true
    }
    if (!keepAudio || !window.__liveApi.__audio) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const context = new AudioCtx({ sampleRate })
      const buffer = context.createBuffer(1, samples.length, sampleRate)
      buffer.getChannelData(0).set(samples)
      const source = context.createBufferSource()
      source.buffer = buffer
      // Loop the short clip: every repetition is a fresh attack for the
      // repeat-detection path (and keeps audio flowing for long tests).
      source.loop = true
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
      source.start(0)
      window.__liveApi.__audio = { context, source, stream }
    }
    window.__liveApi.mount({ performanceMode })
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

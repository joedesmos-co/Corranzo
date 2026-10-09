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

const settings = normalizeMatchSettings({})

function LiveHarness() {
  const [outcome, setOutcome] = useState({ matched: [], wrong: 0 })
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
  const neural = useNeuralMicInput({
    active: true,
    currentCheckpoint: window.__liveInject.checkpoint,
    matchSettings: settings,
    onPlayerInputMatched: (decision) => {
      setOutcome((previous) => ({ ...previous, matched: [...previous.matched, decision] }))
    },
    onWrongNote: () => {
      setOutcome((previous) => ({ ...previous, wrong: previous.wrong + 1 }))
    },
    microphone,
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
      micListening: microphone.isListening,
      micError: microphone.errorMessage,
    }
  })
  return null
}

window.__liveApi = {
  async inject({ samples, sampleRate, expectedMidis, checkpointId, forceListen = false }) {
    window.__liveInject = { checkpoint: { id: checkpointId, expectedMidis } }
    if (forceListen) {
      // Test-only hardware-gate bypass (see useNeuralMicInput): validates
      // everything downstream of the gate on CPU-only runners.
      window.__SCOREFLOW_NEURAL_FORCE_LISTEN = true
    }
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
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const root = createRoot(mount)
    root.render(createElement(LiveHarness))
    window.__liveTeardown = () => {
      try {
        root.unmount()
      } catch {
        // Diagnostics only.
      }
      try {
        source.stop()
      } catch {
        // Diagnostics only.
      }
      stream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // Diagnostics only.
        }
      })
      try {
        context.close()
      } catch {
        // Diagnostics only.
      }
    }
  },
}

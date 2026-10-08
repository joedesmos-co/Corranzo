/**
 * Mic recording harness (Stage 2, S1) — DEVELOPMENT ONLY.
 *
 * Lets the user record short audio examples through the EXACT microphone
 * capture path Corranzo uses during practice (useMicrophoneCapture +
 * analyzeMicFrame + blind prototype + failure classification), with:
 * device selection, live RMS/peak meter, noise floor, sample rate and
 * capture constraints, WAV + JSON sidecar export.
 *
 * - Rendered only in DEV builds, behind an explicit localStorage opt-in.
 * - Recordings are DOWNLOADED locally. This file contains zero network
 *   calls: nothing is ever uploaded automatically (or at all).
 * - Production UI is unchanged: the mount point is a DEV-only section of
 *   PracticeDiagnosticsPanel, stripped from production builds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useMicrophoneCapture from '../../features/microphone-input/useMicrophoneCapture.js'
import { analyzeMicFrame, createMicFrameAnalyzer } from '../../features/microphone-input/micFrameAnalysis.js'
import { createNoiseFloorTracker } from '../../features/microphone-input/micNoiseGate.js'
import { classifyMicInputFailure } from '../../features/microphone-input/micInputFailure.js'
import { detectBlindPolyphony } from '../../features/microphone-input/v2/blindPolyphonicDetector.js'
import { isMicBlindPolyEnabled } from '../../features/microphone-input/micEngineFlag.js'
import { toCanonicalMicrophoneEvent } from '../../features/practice/micCanonicalBridge.js'
import { encodeWav16PCM } from '../../features/microphone-input/micWavEncoder.js'
import {
  buildRecordingSidecar,
  getPacketItem,
  MIC_RECORDING_PACKET,
  validatePacketTruth,
} from '../../features/microphone-input/micRecordingPacket.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'

export const MIC_RECORDER_OPT_IN_KEY = 'scoreflow.dev.micRecorder'
export const MIC_RECORDER_STATE_KEY = 'scoreflow.dev.micPacket'
const MAX_TAKE_SECONDS = 12
const MAX_STORED_FRAMES = 900

function readOptIn() {
  try {
    return globalThis.localStorage?.getItem(MIC_RECORDER_OPT_IN_KEY) === '1'
  } catch {
    return false
  }
}

function parseTruthText(text) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) {
    return null
  }
  const midis = trimmed.split(/[\s,;]+/).map(Number)
  if (midis.some((value) => !Number.isFinite(value))) {
    throw new TypeError('Truth must be MIDI numbers separated by commas')
  }
  return midis
}

export default function MicRecordingHarness() {
  // Hard DEV gate: production builds render nothing (and Vite strips this).
  if (!import.meta.env.DEV) {
    return null
  }
  return <MicRecordingHarnessDev />
}

function MicRecordingHarnessDev() {
  const [optedIn, setOptedIn] = useState(readOptIn)
  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [packetItemId, setPacketItemId] = useState(MIC_RECORDING_PACKET[0].id)
  const [truthText, setTruthText] = useState('')
  const [take, setTake] = useState(null)
  const [error, setError] = useState(null)
  const [meter, setMeter] = useState({ rms: 0, peak: 0, noiseFloor: null })
  const [detector, setDetector] = useState(null)
  const [packetStatus, setPacketStatus] = useState(() => {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(MIC_RECORDER_STATE_KEY) ?? '{}')
    } catch {
      return {}
    }
  })

  const microphone = useMicrophoneCapture({ active: previewing || recording, deviceId: deviceId || null })
  const analyzerRef = useRef(createMicFrameAnalyzer())
  const meterNoiseRef = useRef(createNoiseFloorTracker())
  const rafRef = useRef(null)
  const chunksRef = useRef([])
  const framesRef = useRef([])
  const recordStartRef = useRef(0)
  const tickRef = useRef(0)
  const latencyRef = useRef([])
  const blindEnabled = isMicBlindPolyEnabled()

  const packetItem = getPacketItem(packetItemId) ?? MIC_RECORDING_PACKET[0]

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(MIC_RECORDER_STATE_KEY, JSON.stringify(packetStatus))
    } catch {
      // Diagnostics only — never break the harness on storage errors.
    }
  }, [packetStatus])

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((entry) => entry.kind === 'audioinput'))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError))
    }
  }, [])

  useEffect(() => {
    if (!optedIn) {
      return undefined
    }
    let cancelled = false
    navigator.mediaDevices?.enumerateDevices?.().then(
      (list) => {
        if (!cancelled) {
          setDevices(list.filter((entry) => entry.kind === 'audioinput'))
        }
      },
      (requestError) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : String(requestError))
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [optedIn])

  const startRecording = useCallback(() => {
    chunksRef.current = []
    framesRef.current = []
    latencyRef.current = []
    recordStartRef.current = performance.now()
    setTake(null)
    setRecording(true)
  }, [])

  const stopRecording = useCallback(() => {
    setRecording(false)
    const chunks = chunksRef.current
    chunksRef.current = []
    if (!chunks.length) {
      return
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const samples = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    const sampleRate = microphone.sampleRate ?? 44100
    const durationSeconds = Math.round((total / sampleRate) * 100) / 100
    let truth = null
    let truthError = null
    try {
      const parsed = parseTruthText(truthText)
      truth = parsed == null ? null : validatePacketTruth(packetItem, parsed)
    } catch (validationError) {
      truthError = validationError instanceof Error ? validationError.message : String(validationError)
    }
    const sidecar = buildRecordingSidecar({
      packetItemId: packetItem.id,
      truthMidis: truth,
      audio: {
        sampleRate,
        channels: 1,
        durationSeconds,
        deviceLabel: devices.find((entry) => entry.deviceId === deviceId)?.label ?? null,
        captureSettings: microphone.captureSettings ?? null,
        recordedAt: new Date().toISOString(),
      },
      detectorFrames: framesRef.current,
      notes: truthError ? `TRUTH PENDING: ${truthError}` : '',
    })
    const latencies = [...latencyRef.current].sort((a, b) => a - b)
    setTake({
      samples,
      sampleRate,
      durationSeconds,
      sidecar,
      truthError,
      latency: latencies.length
        ? {
          frames: latencies.length,
          meanMs: Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100,
          p95Ms: Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] * 100) / 100,
        }
        : null,
    })
    if (!truthError) {
      setPacketStatus((previous) => ({ ...previous, [packetItem.id]: 'recorded' }))
    }
  }, [microphone.sampleRate, microphone.captureSettings, truthText, packetItem, devices, deviceId])

  // Meter + detector loop on the live capture path.
  useEffect(() => {
    if (!optedIn || !microphone.isListening) {
      return undefined
    }
    const analyser = microphone.analyser?.current
    const getBuffer = microphone.getTimeDomainBuffer
    if (!analyser || !getBuffer) {
      return undefined
    }
    const tick = () => {
      try {
        const buffer = getBuffer()
        if (buffer?.length) {
          analyser.getFloatTimeDomainData(buffer)
          let sumSquares = 0
          let peak = 0
          for (let index = 0; index < buffer.length; index += 1) {
            const value = buffer[index]
            sumSquares += value * value
            const magnitude = value < 0 ? -value : value
            if (magnitude > peak) {
              peak = magnitude
            }
          }
          const rms = Math.sqrt(sumSquares / buffer.length)
          const tracker = meterNoiseRef.current
          const quiet = rms < (tracker.floor ?? 0.006) * 4
          if (quiet) {
            tracker.floor = Math.min(0.06, Math.max(0.004, tracker.floor * 0.965 + rms * 0.035))
          }
          setMeter({ rms, peak, noiseFloor: tracker.floor })

          tickRef.current += 1
          // Detector readout at ~20 Hz; full-rate autocorrelation would
          // waste main-thread time in a diagnostics panel.
          if (tickRef.current % 3 === 0) {
            const windowSize = Math.min(2048, buffer.length)
            const window = buffer.subarray(buffer.length - windowSize)
            const captureAt = performance.now()
            const frame = analyzeMicFrame(window, microphone.sampleRate, analyzerRef.current.noiseFloor, {})
            const blind = blindEnabled
              ? detectBlindPolyphony(window, microphone.sampleRate, {})
              : null
            const failure = classifyMicInputFailure({
              frame,
              rejectReason: frame?.gateOpen ? (frame?.midi != null ? null : 'no-midi-detected') : 'noise-gate-closed',
              matchingEnabled: true,
              expectedMidis: [],
            })
            const canonical = frame?.midi != null || (blind?.detectedMidis?.length ?? 0) > 0
              ? toCanonicalMicrophoneEvent(
                { ...frame, v2DetectedMidis: blind?.detectedMidis ?? frame?.v2DetectedMidis ?? [] },
                { wallTimestampMs: captureAt },
              )
              : null
            const analyzeMs = performance.now() - captureAt
            latencyRef.current.push(analyzeMs)
            if (latencyRef.current.length > 120) {
              latencyRef.current.shift()
            }
            setDetector({ frame, blind, failure, canonical, analyzeMs })

            if (recording && framesRef.current.length < MAX_STORED_FRAMES) {
              framesRef.current.push({
                t: Math.round((captureAt - recordStartRef.current) * 10) / 10,
                rms: Math.round(rms * 1e5) / 1e5,
                midi: frame?.midi ?? null,
                clarity: frame?.clarity != null ? Math.round(frame.clarity * 1000) / 1000 : null,
                blindMidis: blind?.detectedMidis ?? [],
                failure: failure.category,
                reason: failure.reason,
              })
            }
          }

          if (recording) {
            chunksRef.current.push(new Float32Array(buffer))
            if ((performance.now() - recordStartRef.current) / 1000 >= MAX_TAKE_SECONDS) {
              stopRecording()
            }
          }
        }
      } catch {
        // A diagnostics loop must never break practice capture.
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [optedIn, microphone.isListening, microphone.analyser, microphone.getTimeDomainBuffer,
    microphone.sampleRate, recording, blindEnabled, stopRecording])

  const startPreview = useCallback(async () => {
    setError(null)
    setPreviewing(true)
    const ok = await microphone.requestAccess()
    if (!ok) {
      setPreviewing(false)
    }
  }, [microphone])

  const stopPreview = useCallback(() => {
    microphone.disable()
    setPreviewing(false)
    setRecording(false)
  }, [microphone])

  const downloadTake = useCallback((kind) => {
    if (!take) {
      return
    }
    const blob = kind === 'wav'
      ? new Blob([encodeWav16PCM(take.samples, take.sampleRate)], { type: 'audio/wav' })
      : new Blob([JSON.stringify(take.sidecar, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = kind === 'wav'
      ? `${take.sidecar.packetItemId}.wav`
      : `${take.sidecar.packetItemId}.sidecar.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [take])

  const levelPercent = useMemo(
    () => Math.min(100, Math.round((meter.rms / 0.22) * 100)),
    [meter.rms],
  )

  if (!optedIn) {
    return (
      <details className="practice-diagnostics__group">
        <summary>Mic recording harness (dev)</summary>
        <div className="practice-diagnostics__group-body">
          <p>Development-only recorder. Nothing here uploads anywhere.</p>
          <button
            type="button"
            onClick={() => {
              try {
                globalThis.localStorage?.setItem(MIC_RECORDER_OPT_IN_KEY, '1')
              } catch {
                // ignore
              }
              setOptedIn(true)
            }}
          >
            Enable dev recorder
          </button>
        </div>
      </details>
    )
  }

  const detectedLabel = detector?.frame?.midi != null
    ? midiToNoteLabel(detector.frame.midi)
    : '—'

  return (
    <details className="practice-diagnostics__group" open>
      <summary>Mic recording harness (dev — local only, never uploads)</summary>
      <div className="practice-diagnostics__group-body">
        {error && <p className="practice-section__error">{error}</p>}

        <div>
          <label>
            Input device{' '}
            <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">System default</option>
              {devices.map((entry) => (
                <option key={entry.deviceId} value={entry.deviceId}>
                  {entry.label || `Device ${entry.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </label>{' '}
          <button type="button" onClick={refreshDevices}>Refresh devices</button>
        </div>

        <div>
          {!microphone.isListening ? (
            <button type="button" onClick={startPreview}>Start capture</button>
          ) : (
            <button type="button" onClick={stopPreview}>Stop capture</button>
          )}{' '}
          {microphone.isListening && !recording && (
            <button type="button" onClick={startRecording}>Record take (max {MAX_TAKE_SECONDS}s)</button>
          )}
          {recording && <button type="button" onClick={stopRecording}>Stop take</button>}
        </div>

        <dl className="practice-diagnostics__kv">
          <div><dt>Sample rate</dt><dd>{microphone.sampleRate} Hz</dd></div>
          <div>
            <dt>Capture constraints</dt>
            <dd>{microphone.captureSettings ? JSON.stringify(microphone.captureSettings) : '—'}</dd>
          </div>
          <div><dt>RMS</dt><dd>{meter.rms.toFixed(5)}</dd></div>
          <div><dt>Peak</dt><dd>{meter.peak.toFixed(4)}</dd></div>
          <div><dt>Noise floor</dt><dd>{meter.noiseFloor != null ? meter.noiseFloor.toFixed(5) : '—'}</dd></div>
          <div><dt>Input level</dt><dd>{levelPercent}%</dd></div>
          <div><dt>V1 pitch</dt><dd>{detectedLabel}</dd></div>
          <div>
            <dt>Blind prototype {blindEnabled ? '(on)' : '(flagged off)'}</dt>
            <dd>{detector?.blind ? detector.blind.detectedMidis.join(', ') || '—' : '—'}</dd>
          </div>
          <div><dt>Failure class</dt><dd>{detector?.failure ? `${detector.failure.category} / ${detector.failure.reason}` : '—'}</dd></div>
          <div><dt>Frame cost</dt><dd>{detector?.analyzeMs != null ? `${detector.analyzeMs.toFixed(2)} ms` : '—'}</dd></div>
        </dl>

        <div>
          <label>
            Packet item{' '}
            <select value={packetItemId} onChange={(event) => setPacketItemId(event.target.value)}>
              {MIC_RECORDING_PACKET.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {(packetStatus[entry.id] === 'recorded' ? '✓ ' : '') + entry.label}
                </option>
              ))}
            </select>
          </label>
          <p>{packetItem.prompt}</p>
          <label>
            Played-note truth (MIDI, comma-separated — YOU enter this){' '}
            <input
              value={truthText}
              onChange={(event) => setTruthText(event.target.value)}
              placeholder={packetItem.kind === 'silence' ? 'leave empty (silence)' : 'e.g. 60,64,67'}
            />
          </label>
        </div>

        {take && (
          <div>
            <p>
              Take: {take.durationSeconds}s @ {take.sampleRate} Hz
              {take.latency && ` · detector ${take.latency.meanMs} ms mean / ${take.latency.p95Ms} ms p95 over ${take.latency.frames} frames`}
            </p>
            {take.truthError && <p className="practice-section__error">{take.truthError}</p>}
            <button type="button" onClick={() => downloadTake('wav')}>Download WAV</button>{' '}
            <button type="button" onClick={() => downloadTake('json')}>Download sidecar JSON</button>
          </div>
        )}
      </div>
    </details>
  )
}

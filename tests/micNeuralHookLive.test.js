/**
 * Neural hook live-path test (M3 core) — happy-dom + fake timers.
 *
 * Renders the REAL useNeuralMicInput with a REAL capture-math path
 * (synthetic analyser frames through the ring/drift accounting) and a
 * stubbed neural inference backend. Proves the hook advances practice
 * automatically on a correct note — no Continue button — and refuses
 * wrong notes. The model itself is covered by browser/integration tests.
 */
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('@spotify/basic-pitch', () => ({ default: {} }))

const inferCalls = []
let scriptedNotes = []

vi.mock('../src/features/microphone-input/micNeuralTfAdapter.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    checkNeuralCapability: async () => ({ backend: 'mock', warmedMs: 5, startupMs: 12, ok: true }),
    loadNeuralRuntime: async () => ({ urls: { json: 'mock-json', bin: 'mock-bin' } }),
    runNeuralWindow: async () => {
      inferCalls.push(true)
      return scriptedNotes.map((note) => ({ ...note }))
    },
  }
})

import useNeuralMicInput from '../src/features/practice/useNeuralMicInput.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const settings = normalizeMatchSettings({})
const SAMPLE_RATE = 44100

function c4SineBuffer() {
  const buffer = new Float32Array(2048)
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = 0.4 * Math.sin((2 * Math.PI * 261.63 * index) / SAMPLE_RATE)
  }
  return buffer
}

function makeMicrophone(frames) {
  return {
    isListening: true,
    // NOTE: the hook reads time-domain data straight off the analyser
    // node (like production), so the stub implements it — an analyser
    // without getFloatTimeDomainData silently yields no audio.
    analyser: { current: { fftSize: 2048, getFloatTimeDomainData: (out) => out.set(frames.subarray(0, out.length)) } },
    getTimeDomainBuffer: () => frames,
    sampleRate: SAMPLE_RATE,
    captureSettings: { deviceId: 'fake' },
  }
}

function note(midi, startOffsetSeconds, endOffsetSeconds) {
  return { midi, startOffsetSeconds, endOffsetSeconds }
}

describe('useNeuralMicInput live path', () => {
  let container
  let root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    inferCalls.length = 0
    scriptedNotes = []
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  async function renderHookLive(props) {
    let latest = null
    function Probe() {
      latest = useNeuralMicInput(props)
      return null
    }
    await act(async () => {
      root.render(createElement(Probe))
    })
    return {
      get latest() {
        return latest
      },
    }
  }

  it('advances Wait For You automatically on a correct C4 (no Continue)', async () => {
    scriptedNotes = [note(60, 0.2, 0.45)]
    const matched = []
    const microphone = makeMicrophone(c4SineBuffer())
    const api = await renderHookLive({
      active: true,
      currentCheckpoint: { id: 'cp-c4', expectedMidis: [60] },
      matchSettings: settings,
      onPlayerInputMatched: (decision) => matched.push(decision),
      onWrongNote: () => {},
      microphone,
    })
    // Advance in increments: virtual timers + React batching progress
    // the async pipeline in fits, so a single long jump starves it.
    for (let step = 0; step < 8; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
    }
    expect(inferCalls.length).toBeGreaterThan(0)
    expect(matched.length).toBeGreaterThanOrEqual(1)
    expect(api.latest.matchingEnabled).toBe(true)
    expect(api.latest.neural.phase).toBe('listening')
  })

  it('refuses a wrong note without advancing', async () => {
    scriptedNotes = [note(57, 0.2, 0.45)]
    const matched = []
    const microphone = makeMicrophone(c4SineBuffer())
    await renderHookLive({
      active: true,
      currentCheckpoint: { id: 'cp-c4', expectedMidis: [60] },
      matchSettings: settings,
      onPlayerInputMatched: (decision) => matched.push(decision),
      onWrongNote: () => {},
      microphone,
    })
    for (let step = 0; step < 8; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
    }
    expect(matched).toHaveLength(0)
  })

  it('skips inference on silence (no wasted windows, no hallucination)', async () => {
    scriptedNotes = [note(60, 0.2, 0.45)]
    const microphone = makeMicrophone(new Float32Array(2048))
    const api = await renderHookLive({
      active: true,
      currentCheckpoint: { id: 'cp-c4', expectedMidis: [60] },
      matchSettings: settings,
      onPlayerInputMatched: () => {},
      microphone,
    })
    for (let step = 0; step < 8; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
    }
    expect(inferCalls).toHaveLength(0)
    expect(api.latest.neural.silenceSkips).toBeGreaterThan(0)
  })
})

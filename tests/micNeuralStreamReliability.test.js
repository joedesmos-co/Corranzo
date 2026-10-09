/**
 * Streaming reliability (Stage M4): fail-fast rate, poison-guard offsets,
 * drift-free capture accounting, safe teardown.
 */
import { describe, expect, it } from 'vitest'
import {
  emitNeuralStreamNotes,
  pushNeuralStreamAudio,
  createNeuralStreamState,
} from '../src/features/microphone-input/micNeuralStream.js'
import { computeAppendCount } from '../src/features/practice/useNeuralMicInput.js'
import {
  disposeNeuralRuntime,
  resetNeuralRuntimeForTests,
} from '../src/features/microphone-input/micNeuralTfAdapter.js'

describe('streaming reliability (M4)', () => {
  it('fails fast when the stream rate was never configured', () => {
    const state = createNeuralStreamState()
    expect(() => pushNeuralStreamAudio(state, {
      samples: new Float32Array(100),
      captureStartMs: 0,
      infer: () => [],
    })).toThrow(/setNeuralStreamSampleRate/)
  })

  it('drops NaN/Infinite offsets instead of poisoning tracks', () => {
    const state = createNeuralStreamState()
    const emitted = emitNeuralStreamNotes(state, [
      { midi: 60, startOffsetSeconds: NaN, endOffsetSeconds: 1 },
      { midi: 64, startOffsetSeconds: 0.5, endOffsetSeconds: Infinity },
      { midi: 67, startOffsetSeconds: 0.5, endOffsetSeconds: 1.5 },
    ], 10_000)
    expect(emitted.map((event) => event.midi)).toEqual([67])
  })

  it('appends exactly the wall-clock debt (zero long-term drift)', () => {
    const ring = { samples: [], startCaptureMs: null, inputRate: 1000 }
    let total = 0
    // Perfect 100 ms cadence for 10 s: exactly 100 samples per poll.
    for (let step = 0; step < 100; step += 1) {
      const { append, skip } = computeAppendCount({ scratchLength: 200, nowMs: step * 100, ring, sampleRate: 1000 })
      expect(append).toBe(100)
      expect(skip).toBe(0)
      total += append
      ring.totalAppended = total
    }
    expect(total).toBe(10_000)
  })

  it('marks stalls as skips so the clock never dilates or duplicates', () => {
    const ring = { samples: [], startCaptureMs: null, inputRate: 1000 }
    computeAppendCount({ scratchLength: 200, nowMs: 0, ring, sampleRate: 1000 })
    ring.totalAppended = 100
    // 5 s stall: debt is 5100 samples but the analyser only holds 200.
    const { append, skip } = computeAppendCount({ scratchLength: 200, nowMs: 5100, ring, sampleRate: 1000 })
    expect(append).toBe(200)
    expect(skip).toBe(4900)
    // Honest accounting: appended + skipped == wall debt, so sample<->
    // time mapping stays exact and audio is never duplicated.
    expect(append + skip).toBe(5100)
  })

  it('tears down safely with nothing loaded', () => {
    expect(() => disposeNeuralRuntime()).not.toThrow()
    expect(() => resetNeuralRuntimeForTests()).not.toThrow()
    expect(() => disposeNeuralRuntime()).not.toThrow()
  })
})

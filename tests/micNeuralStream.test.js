/**
 * Neural streaming pipeline (Stage 6, N2/N3) — chunking, dedup, filters,
 * grouping, capture-time preservation. Inference is injected (stubbed
 * here); the browser adapter supplies TF.js.
 */
import { describe, expect, it } from 'vitest'
import {
  createNeuralStreamState,
  drainNeuralStreamEvents,
  emitNeuralStreamNotes,
  pushNeuralStreamAudio,
  setNeuralStreamSampleRate,
} from '../src/features/microphone-input/micNeuralStream.js'

function note(midi, startOffsetSeconds, endOffsetSeconds) {
  return { midi, startOffsetSeconds, endOffsetSeconds }
}

describe('micNeuralStream', () => {
  it('emits one attack per tone with shared chord group and capture onsets', () => {
    const state = createNeuralStreamState()
    const emitted = emitNeuralStreamNotes(state, [
      note(60, 0.5, 1.2),
      note(64, 0.52, 1.2),
      note(67, 0.55, 1.2),
    ], 10_000)
    expect(emitted).toHaveLength(3)
    expect(emitted[0].midi).toBe(60)
    expect(emitted[0].onsetCaptureMs).toBe(10_500)
    expect(emitted[0].chordGroupId).toBe(emitted[1].chordGroupId)
    expect(emitted[0].chordGroupId).toBe(emitted[2].chordGroupId)
    expect(emitted[0].detectedMidis).toEqual([60])
  })

  it('suppresses window-edge chunk artifacts', () => {
    const state = createNeuralStreamState()
    const emitted = emitNeuralStreamNotes(state, [
      note(60, 0.01, 0.5),
      note(64, 1.95, 2.4),
      note(67, 0.5, 1.2),
    ], 10_000)
    expect(emitted.map((event) => event.midi)).toEqual([67])
    expect(state.stats.droppedEdge).toBe(2)
  })

  it('merges continuations across windows but keeps true repeats', () => {
    const state = createNeuralStreamState({ windowSeconds: 4.0 })
    const first = emitNeuralStreamNotes(state, [note(60, 0.5, 1.5)], 10_000)
    expect(first).toHaveLength(1)
    // Same pitch continuing 50 ms after the previous end: merge, no event.
    const continued = emitNeuralStreamNotes(state, [note(60, 0.55, 1.2)], 11_000)
    expect(continued).toHaveLength(0)
    expect(state.stats.merged).toBe(1)
    // Same pitch after a long gap: a true repeat attack.
    const repeated = emitNeuralStreamNotes(state, [note(60, 2.7, 3.2)], 12_000)
    expect(repeated).toHaveLength(1)
    expect(repeated[0].onsetCaptureMs).toBe(14_700)
  })

  it('drops lagging octave ghosts but keeps simultaneous doublings', () => {
    const state = createNeuralStreamState()
    // Lower octave starts first and fully covers the upper: ghost.
    const ghost = emitNeuralStreamNotes(state, [
      note(49, 0.5, 1.5),
      note(61, 0.7, 1.5),
    ], 10_000)
    expect(ghost.map((event) => event.midi)).toEqual([49])
    expect(state.stats.droppedOctave).toBe(1)

    const state2 = createNeuralStreamState()
    // True octave doubling: same attack time survives.
    const doublings = emitNeuralStreamNotes(state2, [
      note(48, 0.5, 1.5),
      note(60, 0.5, 1.5),
    ], 20_000)
    expect(doublings.map((event) => event.midi).sort()).toEqual([48, 60])
  })

  it('drops late octave ring long after the fundamental expired (ghost memory)', () => {
    const state = createNeuralStreamState({ windowSeconds: 0.5, hopSeconds: 0.25, edgeSuppressMs: 80 })
    // Fundamental C4 sounds and ends; its track expires once a full
    // window passes with no re-detection.
    expect(emitNeuralStreamNotes(state, [note(60, 0.2, 0.5)], 10_000).map((event) => event.midi)).toEqual([60])
    expect(emitNeuralStreamNotes(state, [], 10_250)).toEqual([])
    expect(emitNeuralStreamNotes(state, [], 10_500)).toEqual([])
    expect(emitNeuralStreamNotes(state, [], 10_750)).toEqual([])
    expect(state.activeNotes.has(60)).toBe(false)
    // C5 harmonic still ringing 900 ms later: ghost, not a new note.
    const late = emitNeuralStreamNotes(state, [note(72, 0.2, 0.4)], 10_900)
    expect(late).toEqual([])
    expect(state.stats.droppedOctave).toBe(1)
  })

  it('keeps strummed octave doublings inside the simultaneity gate', () => {
    const state = createNeuralStreamState({ windowSeconds: 0.5, hopSeconds: 0.25, edgeSuppressMs: 80 })
    // Low E2 then E3 30 ms later (strum): real doubling, must survive.
    const doubled = emitNeuralStreamNotes(state, [
      note(40, 0.2, 0.6),
      note(52, 0.23, 0.6),
    ], 10_000)
    expect(doubled.map((event) => event.midi).sort()).toEqual([40, 52])
  })

  it('live 0.5 s / 0.25 s / 80 ms config leaves no onset phase uncovered', () => {
    // Mutual edge exclusion would blind ~16% of onset phases with 150 ms
    // edges; 80 ms edges keep a 340 ms live band > 250 ms hop. Sweep every
    // 10 ms of onset phase and require survival in at least one window.
    const windowSeconds = 0.5
    const hopSeconds = 0.25
    const edgeMs = 80
    for (let phaseMs = 0; phaseMs < 250; phaseMs += 10) {
      const state = createNeuralStreamState({ windowSeconds, hopSeconds, edgeSuppressMs: edgeMs })
      const onsetSeconds = 2 + phaseMs / 1000
      let survived = false
      for (let start = 1.5; start <= onsetSeconds; start += hopSeconds) {
        const offset = onsetSeconds - start
        if (offset < 0 || offset > windowSeconds) {
          continue
        }
        const emitted = emitNeuralStreamNotes(
          state,
          [{ midi: 60, startOffsetSeconds: offset, endOffsetSeconds: offset + 0.3 }],
          Math.round(start * 1000),
        )
        drainNeuralStreamEvents(state)
        if (emitted.length === 1) {
          survived = true
        }
      }
      expect(survived).toBe(true)
    }
  })

  it('starts a new chord group after a strum gap', () => {
    const state = createNeuralStreamState()
    const first = emitNeuralStreamNotes(state, [note(60, 0.5, 0.9)], 10_000)
    const second = emitNeuralStreamNotes(state, [note(64, 1.0, 1.4)], 11_000)
    expect(first[0].chordGroupId).not.toBe(second[0].chordGroupId)
  })

  it('buffers audio and emits ready windows with capture timestamps', () => {
    const state = createNeuralStreamState({ windowSeconds: 2.0, hopSeconds: 1.0 })
    setNeuralStreamSampleRate(state, 1000)
    const calls = []
    const infer = ({ samples, sampleRate, windowStartCaptureMs }) => {
      calls.push({ length: samples.length, sampleRate, windowStartCaptureMs })
      return []
    }
    // 2.5 s of audio at 1 kHz: one 2 s window becomes ready.
    const ready = pushNeuralStreamAudio(state, {
      samples: new Float32Array(2500),
      captureStartMs: 5_000,
      infer,
    })
    expect(ready).toHaveLength(1)
    expect(calls[0].length).toBe(2000)
    expect(calls[0].windowStartCaptureMs).toBe(5_000)
    // Draining works and inference delay never shifts onsets (see above).
    expect(drainNeuralStreamEvents(state)).toEqual([])
  })
})

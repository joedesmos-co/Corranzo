/**
 * Piano instrument: the playback sound upgrade.
 *
 * These verify the guarantees that matter for shipping a sampled piano without
 * regressing playback:
 *   - the synth voice plays immediately (first note never blocks on samples),
 *   - note routing switches to the sampler once it loads,
 *   - a sample load failure/timeout falls back to the synth with an honest
 *     status (never throws, never goes silent),
 *   - status transitions + labels are correct,
 *   - the shared decoded buffers enable a synchronous "already cached" path,
 *   - release/dispose forward to the active source.
 *
 * Tone.js cannot be instantiated without an AudioContext, so a minimal fake
 * `tone` backend is injected — exactly how the real engines pass the real Tone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPianoInstrument,
  defaultLoadSampler,
  INSTRUMENT_STATUS,
  INSTRUMENT_STATUS_LABEL,
  PIANO_SAMPLE_URLS,
  DEFAULT_PIANO_SAMPLE_BASE_URL,
  __resetSharedPianoBuffers,
} from '../src/features/playback/pianoInstrument.js'
import { MidiPlaybackEngine } from '../src/features/playback/midiPlaybackEngine.js'
import { ScorePlaybackEngine } from '../src/features/playback/scorePlaybackEngine.js'

// ─── fake Tone backend ────────────────────────────────────────────────────────

function makeFakeTone() {
  const created = { synths: [], samplers: [], buffers: [] }

  class Node {
    constructor() {
      this.connectedTo = []
      this.disposed = false
    }
    connect(dest) {
      this.connectedTo.push(dest)
      return dest
    }
    dispose() {
      this.disposed = true
    }
  }
  class Gain extends Node {
    constructor() {
      super()
      this.gain = { value: 1 }
    }
  }
  class Reverb extends Node {
    generate() {
      return Promise.resolve(this)
    }
  }
  class Filter extends Node {}
  class Chorus extends Node {
    start() {
      this.started = true
      return this
    }
  }
  class PolySynth extends Node {
    constructor() {
      super()
      this.calls = []
      this.released = []
      created.synths.push(this)
    }
    set() {}
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
    releaseAll(time) {
      this.released.push(time)
    }
  }
  class Synth {}

  // A controllable ToneAudioBuffers + Sampler for the real defaultLoadSampler.
  class ToneAudioBuffers extends Node {
    constructor({ onload, onerror } = {}) {
      super()
      this.onload = onload
      this.onerror = onerror
      this._map = new Map()
      created.buffers.push(this)
    }
    get(note) {
      if (!this._map.has(note)) {
        this._map.set(note, { note, _isBuffer: true })
      }
      return this._map.get(note)
    }
    triggerLoad() {
      this.onload?.()
    }
    triggerError(err) {
      this.onerror?.(err)
    }
  }
  class Sampler extends Node {
    constructor(opts = {}) {
      super()
      this.opts = opts
      this.volume = { value: opts.volume ?? 0 }
      this.calls = []
      this.released = []
      created.samplers.push(this)
    }
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
    releaseAll(time) {
      this.released.push(time)
    }
  }

  const tone = { Gain, Reverb, Filter, Chorus, PolySynth, Synth, ToneAudioBuffers, Sampler }
  return { tone, created }
}

function makeFakeSampler() {
  return {
    calls: [],
    released: [],
    disposed: false,
    connectedTo: [],
    volume: { value: 0 },
    connect(dest) {
      this.connectedTo.push(dest)
    },
    triggerAttackRelease(...args) {
      this.calls.push(args)
    },
    releaseAll(time) {
      this.released.push(time)
    },
    dispose() {
      this.disposed = true
    },
  }
}

const neverResolves = () => new Promise(() => {})

afterEach(() => {
  __resetSharedPianoBuffers()
})

// ─── synth-first behaviour ─────────────────────────────────────────────────────

describe('piano instrument — synth-first playback', () => {
  it('requires a tone backend', () => {
    expect(() => createPianoInstrument({})).toThrow(/tone/)
  })

  it('plays the synth voice immediately, before samples finish loading', () => {
    const { tone, created } = makeFakeTone()
    const inst = createPianoInstrument({
      tone,
      loadSampler: neverResolves,
      createSamplerSync: () => null,
    })

    expect(inst.status).toBe(INSTRUMENT_STATUS.LOADING)
    expect(inst.isUsingSampler()).toBe(false)

    inst.triggerAttackRelease('C4', 0.5, 0, 0.8)

    // The single synth voice received the note; no sampler exists yet.
    expect(created.synths).toHaveLength(1)
    expect(created.synths[0].calls).toEqual([['C4', 0.5, 0, 0.8]])
    expect(created.samplers).toHaveLength(0)
  })

  it('exposes an output node the engine can route through', () => {
    const { tone } = makeFakeTone()
    const inst = createPianoInstrument({ tone, loadSampler: neverResolves, createSamplerSync: () => null })
    expect(inst.output).toBeTruthy()
    expect(typeof inst.output.connect).toBe('function')
  })
})

// ─── upgrade to sampler ────────────────────────────────────────────────────────

describe('piano instrument — sampled upgrade', () => {
  it('routes notes to the sampler once samples load', async () => {
    const { tone, created } = makeFakeTone()
    const sampler = makeFakeSampler()
    const inst = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
    })

    await inst.whenReady()

    expect(inst.status).toBe(INSTRUMENT_STATUS.SAMPLED)
    expect(inst.isUsingSampler()).toBe(true)

    inst.triggerAttackRelease('E4', 0.4, 1, 0.7)

    // Note went to the sampler, not the synth.
    expect(sampler.calls).toEqual([['E4', 0.4, 1, 0.7]])
    expect(created.synths[0].calls).toHaveLength(0)
    // Sampler is wired into the audio graph.
    expect(sampler.connectedTo.length).toBeGreaterThan(0)
  })

  it('reports loading → sampled via onStatus', async () => {
    const { tone } = makeFakeTone()
    const statuses = []
    const inst = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(makeFakeSampler()),
      createSamplerSync: () => null,
      onStatus: (s) => statuses.push(s),
    })

    await inst.whenReady()
    expect(statuses[0]).toBe(INSTRUMENT_STATUS.LOADING)
    expect(statuses.at(-1)).toBe(INSTRUMENT_STATUS.SAMPLED)
  })
})

// ─── fallback ──────────────────────────────────────────────────────────────────

describe('piano instrument — graceful fallback', () => {
  it('falls back to the synth when sample loading rejects', async () => {
    const { tone, created } = makeFakeTone()
    const statuses = []
    const inst = createPianoInstrument({
      tone,
      loadSampler: () => Promise.reject(new Error('network down')),
      createSamplerSync: () => null,
      onStatus: (s) => statuses.push(s),
    })

    await inst.whenReady()

    expect(inst.status).toBe(INSTRUMENT_STATUS.SYNTH)
    expect(inst.isUsingSampler()).toBe(false)
    expect(statuses).toEqual([INSTRUMENT_STATUS.LOADING, INSTRUMENT_STATUS.SYNTH])

    // Playback still works — on the synth.
    inst.triggerAttackRelease('G4', 0.3, 0, 0.6)
    expect(created.synths[0].calls).toEqual([['G4', 0.3, 0, 0.6]])
  })

  it('falls back to the synth when sample loading times out (real loader)', async () => {
    vi.useFakeTimers()
    try {
      const { tone, created } = makeFakeTone()
      const inst = createPianoInstrument({
        tone,
        // Real loader, but the fake buffers never fire onload → timeout path.
        loadSampler: defaultLoadSampler,
        createSamplerSync: () => null,
        sampleLoadTimeoutMs: 50,
      })

      expect(inst.status).toBe(INSTRUMENT_STATUS.LOADING)
      await vi.advanceTimersByTimeAsync(60)
      await inst.whenReady()

      expect(inst.status).toBe(INSTRUMENT_STATUS.SYNTH)
      // A buffers object was created (load was attempted) but never resolved.
      expect(created.buffers.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── shared decoded buffers + sync fast path ───────────────────────────────────

describe('piano instrument — shared buffers and sync fast path', () => {
  it('decodes shared buffers once, then builds further samplers synchronously', async () => {
    const { tone, created } = makeFakeTone()

    // First instrument: real loader; resolve the buffers.
    const first = createPianoInstrument({ tone, loadSampler: defaultLoadSampler })
    expect(created.buffers).toHaveLength(1)
    created.buffers[0].triggerLoad()
    await first.whenReady()
    expect(first.status).toBe(INSTRUMENT_STATUS.SAMPLED)
    const samplersAfterFirst = created.samplers.length

    // Second instrument (same base URL): the sync path builds a sampler from the
    // already-decoded buffers — sampled from construction, no new fetch.
    const second = createPianoInstrument({ tone, loadSampler: defaultLoadSampler })
    expect(second.status).toBe(INSTRUMENT_STATUS.SAMPLED)
    expect(second.isUsingSampler()).toBe(true)
    expect(created.buffers).toHaveLength(1) // no second buffer fetch
    expect(created.samplers.length).toBe(samplersAfterFirst + 1)

    second.triggerAttackRelease('C4', 0.5, 0, 0.8)
    expect(created.samplers.at(-1).calls).toHaveLength(1)
  })
})

// ─── release / dispose / status labels ─────────────────────────────────────────

describe('piano instrument — release, dispose, labels', () => {
  it('releaseAll forwards to the synth (and sampler when present)', async () => {
    const { tone, created } = makeFakeTone()
    const sampler = makeFakeSampler()
    const inst = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
    })
    await inst.whenReady()

    inst.releaseAll(2)
    expect(created.synths[0].released).toContain(2)
    expect(sampler.released).toContain(2)
  })

  it('dispose tears down synth, sampler, and output; trigger becomes a no-op', async () => {
    const { tone, created } = makeFakeTone()
    const sampler = makeFakeSampler()
    const inst = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
    })
    await inst.whenReady()

    inst.dispose()
    expect(created.synths[0].disposed).toBe(true)
    expect(sampler.disposed).toBe(true)
    expect(inst.output.disposed).toBe(true)

    sampler.calls.length = 0
    inst.triggerAttackRelease('C4', 0.5, 0, 0.8) // ignored after dispose
    expect(sampler.calls).toHaveLength(0)
  })

  it('does not attach a sampler that resolves after dispose', async () => {
    const { tone } = makeFakeTone()
    const sampler = makeFakeSampler()
    let resolveLoad
    const inst = createPianoInstrument({
      tone,
      loadSampler: () => new Promise((res) => { resolveLoad = res }),
      createSamplerSync: () => null,
    })

    inst.dispose()
    resolveLoad(sampler)
    await inst.whenReady()

    expect(inst.isUsingSampler()).toBe(false)
    expect(sampler.disposed).toBe(true) // late arrival is cleaned up
  })

  it('status labels are user-facing and correct', () => {
    expect(INSTRUMENT_STATUS_LABEL[INSTRUMENT_STATUS.SAMPLED]).toBe('Piano samples loaded')
    expect(INSTRUMENT_STATUS_LABEL[INSTRUMENT_STATUS.SYNTH]).toBe('Using basic synth fallback')
    expect(INSTRUMENT_STATUS_LABEL[INSTRUMENT_STATUS.LOADING]).toMatch(/loading/i)
  })

  it('ships a sensible default sample set (Salamander grand piano)', () => {
    expect(DEFAULT_PIANO_SAMPLE_BASE_URL).toMatch(/salamander/)
    // Covers the full piano range, lightly: extremes present, ~2 per octave.
    expect(PIANO_SAMPLE_URLS.A0).toBeTruthy()
    expect(PIANO_SAMPLE_URLS.C8).toBeTruthy()
    expect(PIANO_SAMPLE_URLS.C4).toBe('C4.mp3')
    expect(PIANO_SAMPLE_URLS['F#4']).toBe('Fs4.mp3')
    expect(Object.keys(PIANO_SAMPLE_URLS).length).toBeLessThanOrEqual(20)
  })
})

// ─── engine integration invariants ────────────────────────────────────────────

describe('sampled piano — playback engine integration', () => {
  it('keeps instrument code lazy until playback asks for it', () => {
    const scoreLoader = vi.fn()
    const midiLoader = vi.fn()

    new ScorePlaybackEngine({ loadPianoInstrument: scoreLoader })
    new MidiPlaybackEngine({ loadPianoInstrument: midiLoader })

    expect(scoreLoader).not.toHaveBeenCalled()
    expect(midiLoader).not.toHaveBeenCalled()
  })

  it('score playback sends the correct note and rate-adjusted duration', () => {
    const calls = []
    const engine = new ScorePlaybackEngine()
    engine.voice = {
      triggerAttackRelease: (...args) => calls.push(args),
    }
    engine.metronome = {
      volume: { value: 0 },
      triggerAttackRelease: vi.fn(),
    }
    engine.playbackRate = 0.5
    engine.playStartedAt = 0
    engine.noteEvents = [{
      type: 'note',
      scoreTimeSeconds: 0.1,
      midi: 60,
      baseDurationSeconds: 0.5,
      velocity: 0.8,
    }]

    engine.scheduleWindow(0, 1)

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('C4')
    expect(calls[0][1]).toBeCloseTo(1)
    expect(calls[0][3]).toBeGreaterThan(0)
  })

  it('score playback muting still follows the shared output gain', () => {
    const engine = new ScorePlaybackEngine()
    engine.output = { gain: { value: 1 } }
    engine.tracks = [
      { id: 1, muted: false },
      { id: 2, muted: false },
    ]

    engine.setTrackMuted(1, true)
    expect(engine.output.gain.value).toBe(1)

    engine.setTrackMuted(2, true)
    expect(engine.output.gain.value).toBe(0)

    engine.setTrackMuted(1, false)
    expect(engine.output.gain.value).toBe(1)
  })

  it('MIDI track muting still controls its per-track output gain', () => {
    const engine = new MidiPlaybackEngine()
    const output = { gain: { value: 1 } }
    engine.trackStates = [{ id: 7, muted: false, output }]

    engine.setTrackMuted(7, true)
    expect(engine.trackStates[0].muted).toBe(true)
    expect(output.gain.value).toBe(0)

    engine.setTrackMuted(7, false)
    expect(output.gain.value).toBe(1)
  })

  it('MIDI playback preserves note timing and trims a note when seeking into it', () => {
    const calls = []
    const engine = new MidiPlaybackEngine()
    engine.trackStates = [{
      notes: [{ time: 1, name: 'D4', duration: 1, velocity: 0.7 }],
      instrument: {
        triggerAttackRelease: (...args) => calls.push(args),
      },
    }]

    engine.scheduleNotesFrom(1.25)

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('D4')
    expect(calls[0][1]).toBeCloseTo(0.75)
    expect(calls[0][3]).toBe(0.7)
  })
})

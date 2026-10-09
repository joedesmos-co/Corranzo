/**
 * Expressive playback (Stage S4/S5): velocity→brightness steering,
 * corrected sample maps, and the new electric voice.
 *
 * Uses the repo's fake-Tone pattern (no AudioContext needed); the
 * Filter fake carries a frequency spy so brightness steering is
 * observable. Rendered-audio proof lives in the headless render
 * harness (scripts/audio-render), not here.
 */
import { describe, expect, it, vi } from 'vitest'
import { brightnessHzForVelocity } from '../src/features/playback/sampledInstrumentVoice.js'
import { createPianoInstrument, PIANO_SAMPLE_URLS } from '../src/features/playback/pianoInstrument.js'
import {
  createGuitarInstrument,
  GUITAR_SAMPLE_URLS,
} from '../src/features/playback/guitarInstrument.js'
import {
  createElectricGuitarInstrument,
  ELECTRIC_GUITAR_SAMPLE_URLS,
  VOICE_ID as ELECTRIC_VOICE_ID,
} from '../src/features/playback/electricGuitarInstrument.js'
import {
  isKnownVoiceId,
  loadInstrumentVoiceModule,
  voiceFactoryFromModule,
} from '../src/features/playback/instrumentVoices.js'
import {
  INSTRUMENT_IDS,
  listInstruments,
  normalizeInstrumentId,
} from '../src/features/instruments/instruments.js'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function makeFakeTone() {
  const createdFilters = []
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
  class Compressor extends Node {}
  class Limiter extends Node {}
  class Filter extends Node {
    constructor() {
      super()
      createdFilters.push(this)
      this.frequencyCalls = []
      this.frequency = {
        value: 7200,
        setTargetAtTime: (value, startTime, timeConstant) => {
          this.frequencyCalls.push({ value, startTime, timeConstant })
          this.frequency.value = value
        },
      }
    }
  }
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
    }
    set() {}
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
  }
  class Synth {}
  class AMSynth extends Synth {}
  class Sampler extends Node {
    constructor(opts = {}) {
      super()
      this.opts = opts
      this.volume = { value: opts.volume ?? 0 }
      this.calls = []
    }
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
  }
  class ToneAudioBuffers extends Node {
    constructor({ onload } = {}) {
      super()
      this._map = new Map()
      queueMicrotask(() => onload?.())
    }
    get(note) {
      if (!this._map.has(note)) {
        this._map.set(note, { note, _isBuffer: true })
      }
      return this._map.get(note)
    }
  }
  const tone = {
    Gain, Reverb, Compressor, Limiter, Filter, Chorus,
    PolySynth, Synth, AMSynth, Sampler, ToneAudioBuffers,
    now: () => 0,
  }
  tone.__createdFilters = createdFilters
  return tone
}

function makeSamplerVoice(createFactory, extra = {}) {
  const tone = makeFakeTone()
  const fakeSampler = {
    calls: [],
    volume: { value: 0 },
    connect() {},
    triggerAttackRelease(...args) {
      this.calls.push(args)
    },
    dispose() {},
  }
  const inst = createFactory({
    tone,
    loadSampler: async () => ({ sampler: fakeSampler, buffers: null, baseUrl: 'test://' }),
    createSamplerSync: () => null,
    ...extra,
  })
  return { tone, inst, fakeSampler }
}

describe('brightnessHzForVelocity', () => {
  it('is monotonic from dark to brilliant with sane bounds', () => {
    const opts = { minHz: 1200, maxHz: 6500 }
    const soft = brightnessHzForVelocity(0.1, opts)
    const mid = brightnessHzForVelocity(0.5, opts)
    const loud = brightnessHzForVelocity(0.95, opts)
    expect(soft).toBeGreaterThanOrEqual(1200)
    expect(soft).toBeLessThan(mid)
    expect(mid).toBeLessThan(loud)
    expect(loud).toBeLessThanOrEqual(6500)
  })

  it('clamps garbage to a musical default', () => {
    expect(brightnessHzForVelocity(NaN)).toBeGreaterThan(1000)
    expect(brightnessHzForVelocity(-3)).toBeCloseTo(1400, 6)
    expect(brightnessHzForVelocity(99)).toBeCloseTo(6800, 6)
  })
})

describe('velocity brightness steering', () => {
  it('steers the shared filter brighter for loud notes (piano)', async () => {
    const { tone, inst } = makeSamplerVoice(createPianoInstrument)
    await inst.whenReady?.().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(inst.isUsingSampler()).toBe(true)
    // Soft then loud triggers must steer the shared filter darker/brighter.
    // Different times: identical note+time would (correctly) dedup in mix.
    inst.triggerAttackRelease('C4', 0.5, 0, 0.2)
    inst.triggerAttackRelease('E4', 0.5, 0.5, 0.9)
    const filters = tone.__createdFilters.filter((filter) => filter.frequencyCalls.length)
    const calls = filters.flatMap((filter) => filter.frequencyCalls)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[calls.length - 1].value).toBeGreaterThan(calls[0].value)
    inst.dispose()
    void tone
  })
})

describe('corrected guitar sample map', () => {
  it('drops the four octave-mislabelled files and uses true sharp keys', () => {
    for (const bad of ['B4', 'F4', 'Fs4', 'G4']) {
      expect(GUITAR_SAMPLE_URLS).not.toHaveProperty(bad)
    }
    for (const good of ['G#4', 'C#4', 'F#2', 'A#4', 'D#2', 'D#4']) {
      expect(GUITAR_SAMPLE_URLS).toHaveProperty(good)
    }
  })

  it('every mapped file exists in the local mirror', () => {
    for (const file of Object.values(GUITAR_SAMPLE_URLS)) {
      expect(existsSync(join(projectRoot, 'public', 'audio', 'guitar-acoustic', file))).toBe(true)
    }
  })
})

describe('electric guitar voice', () => {
  it('registers under a distinct voice id with 17 verified keys', () => {
    expect(ELECTRIC_VOICE_ID).toBe('electric-guitar')
    expect(Object.keys(ELECTRIC_GUITAR_SAMPLE_URLS)).toHaveLength(17)
    expect(isKnownVoiceId('electric-guitar')).toBe(true)
  })

  it('every mapped file exists in the local mirror', () => {
    for (const file of Object.values(ELECTRIC_GUITAR_SAMPLE_URLS)) {
      expect(existsSync(join(projectRoot, 'public', 'audio', 'guitar-electric', file))).toBe(true)
    }
  })

  it('loads through the voice registry like piano and guitar', async () => {
    const module = await loadInstrumentVoiceModule('electric-guitar')
    expect(voiceFactoryFromModule(module)).toBe(module.createInstrumentVoice)
  })

  it('falls back to synth honestly when samples fail', async () => {
    const tone = makeFakeTone()
    const inst = createElectricGuitarInstrument({
      tone,
      loadSampler: () => Promise.reject(new Error('offline')),
      createSamplerSync: () => null,
    })
    await inst.whenReady?.().catch(() => {})
    expect(inst.isUsingSampler()).toBe(false)
    expect(() => inst.triggerAttackRelease('E3', 0.5, 0, 0.7)).not.toThrow()
    inst.dispose()
  })
})

describe('instrument selection metadata', () => {
  it('lists piano, acoustic, and clean electric guitars', () => {
    const ids = listInstruments().map((entry) => entry.id)
    expect(ids).toContain(INSTRUMENT_IDS.PIANO)
    expect(ids).toContain(INSTRUMENT_IDS.GUITAR)
    expect(ids).toContain(INSTRUMENT_IDS.ELECTRIC_GUITAR)
  })

  it('labels guitars unambiguously and keeps pitch/score contracts', () => {
    const acoustic = listInstruments().find((entry) => entry.id === 'guitar')
    const electric = listInstruments().find((entry) => entry.id === 'electric-guitar')
    expect(acoustic.label).toBe('Acoustic Guitar')
    expect(electric.label).toBe('Electric Guitar')
    expect(electric.voiceId).toBe('electric-guitar')
    // Same geometry and range: switching guitar type never moves pitches.
    expect(electric.strings.tuning).toEqual(acoustic.strings.tuning)
    expect(electric.midiRange).toEqual(acoustic.midiRange)
  })

  it('normalizes unknown ids to piano (existing behavior preserved)', () => {
    expect(normalizeInstrumentId('crunch')).toBe('piano')
    expect(normalizeInstrumentId(null)).toBe('piano')
  })

  it('piano map still resolves locally', () => {
    expect(Object.keys(PIANO_SAMPLE_URLS).length).toBeGreaterThan(20)
    expect(existsSync(join(projectRoot, 'public', 'audio', 'salamander', 'C4.mp3'))).toBe(true)
  })
})

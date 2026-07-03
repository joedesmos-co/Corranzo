/**
 * Guitar playback voice + instrument-aware engine routing.
 *
 * Mirrors the piano voice contract tests: synth-first fallback, sampler
 * switch-over, registry resolution, and engine instrument switching. Piano
 * remains the default everywhere — these tests opt in to guitar explicitly.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createGuitarInstrument,
  createInstrumentVoice,
  DEFAULT_GUITAR_SAMPLE_BASE_URL,
  GUITAR_SAMPLE_URLS,
  INSTRUMENT_STATUS,
  INSTRUMENT_STATUS_LABEL,
} from '../src/features/playback/guitarInstrument.js'
import {
  isKnownVoiceId,
  loadInstrumentVoiceModule,
  voiceFactoryFromModule,
  voicePreloadFromModule,
} from '../src/features/playback/instrumentVoices.js'
import { createInstrumentVoiceResolver } from '../src/features/playback/instrumentVoiceResolver.js'
import { ScorePlaybackEngine } from '../src/features/playback/scorePlaybackEngine.js'
import { INSTRUMENT_STATUS } from '../src/features/playback/guitarInstrument.js'

function makeFakeTone() {
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
      this.gain = {
        value: 1,
        cancelScheduledValues: () => {},
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
      }
    }
  }
  class Reverb extends Node {
    generate() {
      return Promise.resolve(this)
    }
  }
  class Compressor extends Node {}
  class Limiter extends Node {}
  class Filter extends Node {}
  class PolySynth extends Node {
    constructor() {
      super()
      this.calls = []
    }
    set() {}
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
    releaseAll() {}
  }
  class FMSynth {}
  class PluckSynth {}
  class AMSynth {}
  class Chorus extends Node {
    start() {}
  }

  return {
    now: () => 0,
    Gain,
    Reverb,
    Compressor,
    Limiter,
    Filter,
    Chorus,
    PolySynth,
    PluckSynth,
    AMSynth,
    FMSynth,
    created: {},
  }
}

function makeFakeSampler() {
  return {
    connected: [],
    calls: [],
    connect(dest) {
      this.connected.push(dest)
    },
    triggerAttackRelease(...args) {
      this.calls.push(args)
    },
    releaseAll() {},
    dispose() {},
  }
}

describe('guitar sample set', () => {
  it('uses the published acoustic-guitar CDN set with true-pitch keys', () => {
    expect(DEFAULT_GUITAR_SAMPLE_BASE_URL).toMatch(/guitar-acoustic\/$/)
    expect(GUITAR_SAMPLE_URLS.E2).toBe('E2.mp3')
    expect(GUITAR_SAMPLE_URLS.D5).toBe('D5.mp3')
    // Keys must equal the file's pitch — Sampler pitch-shifts from keys.
    for (const [key, file] of Object.entries(GUITAR_SAMPLE_URLS)) {
      expect(file).toBe(`${key.replace('#', 's')}.mp3`)
    }
  })

  it('covers the guitar sounding range with close spacing (≤ 3 semitones)', () => {
    const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
    const toMidi = (name) => {
      const letter = name[0]
      const octave = Number(name.slice(-1))
      return (octave + 1) * 12 + NOTE_OFFSETS[letter]
    }
    const midis = Object.keys(GUITAR_SAMPLE_URLS).map(toMidi).sort((a, b) => a - b)
    expect(midis[0]).toBe(40) // low E2
    for (let index = 1; index < midis.length; index += 1) {
      expect(midis[index] - midis[index - 1]).toBeLessThanOrEqual(3)
    }
  })
})

describe('guitar voice', () => {
  it('plays through the plucked synth fallback before samples load', () => {
    const tone = makeFakeTone()
    const pendingLoad = new Promise(() => {}) // never resolves
    const voice = createGuitarInstrument({
      tone,
      loadSampler: () => pendingLoad,
      createSamplerSync: () => null,
    })

    expect(voice.status).toBe(INSTRUMENT_STATUS.LOADING)
    voice.triggerAttackRelease('E2', 0.5, 0, 0.7)
    expect(voice.isUsingSampler()).toBe(false)
  })

  it('switches to the sampler once loading resolves', async () => {
    const tone = makeFakeTone()
    const sampler = makeFakeSampler()
    const statuses = []
    const voice = createGuitarInstrument({
      tone,
      onStatus: (status) => statuses.push(status),
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
    })

    await voice.whenReady()
    expect(voice.status).toBe(INSTRUMENT_STATUS.SAMPLED)
    expect(voice.isUsingSampler()).toBe(true)
    voice.triggerAttackRelease('A2', 0.4, 0, 0.7)
    expect(sampler.calls.length).toBe(1)
    expect(statuses).toContain(INSTRUMENT_STATUS.SAMPLED)
  })

  it('falls back to the synth with an honest status when samples fail', async () => {
    const tone = makeFakeTone()
    const voice = createGuitarInstrument({
      tone,
      loadSampler: () => Promise.reject(new Error('offline')),
      createSamplerSync: () => null,
    })

    await voice.whenReady()
    expect(voice.status).toBe(INSTRUMENT_STATUS.SYNTH)
    expect(voice.isUsingSampler()).toBe(false)
  })

  it('labels statuses with guitar wording', () => {
    expect(INSTRUMENT_STATUS_LABEL[INSTRUMENT_STATUS.SAMPLED]).toBe('Guitar ready')
    expect(INSTRUMENT_STATUS_LABEL[INSTRUMENT_STATUS.SYNTH]).toBe(
      'Using basic synth fallback',
    )
  })

  it('exposes the canonical factory name for the registry', () => {
    expect(createInstrumentVoice).toBe(createGuitarInstrument)
  })
})

describe('voice registry', () => {
  it('knows piano and guitar; unknown ids fall back to piano', async () => {
    expect(isKnownVoiceId('piano')).toBe(true)
    expect(isKnownVoiceId('guitar')).toBe(true)
    expect(isKnownVoiceId('kazoo')).toBe(false)

    const guitarModule = await loadInstrumentVoiceModule('guitar')
    expect(guitarModule.VOICE_ID).toBe('guitar')
    const fallbackModule = await loadInstrumentVoiceModule('kazoo')
    expect(fallbackModule.VOICE_ID).toBe('piano')
  })

  it('extracts canonical and legacy factory/preload exports', () => {
    const canonical = { createInstrumentVoice: () => 'a', preloadSampleBuffers: () => 'b' }
    const legacy = { createPianoInstrument: () => 'c', preloadPianoSampleBuffers: () => 'd' }
    expect(voiceFactoryFromModule(canonical)()).toBe('a')
    expect(voicePreloadFromModule(canonical)()).toBe('b')
    expect(voiceFactoryFromModule(legacy)()).toBe('c')
    expect(voicePreloadFromModule(legacy)()).toBe('d')
    expect(voiceFactoryFromModule(null)).toBeNull()
  })
})

describe('voice resolver', () => {
  it('defaults to piano and honours the legacy piano loader seam', async () => {
    const pianoFactory = vi.fn(() => 'piano-voice')
    const resolver = createInstrumentVoiceResolver({
      legacyPianoModuleLoader: () => ({ createPianoInstrument: pianoFactory }),
    })
    expect(resolver.instrumentId).toBe('piano')
    const factory = await resolver.ensureFactory()
    expect(factory).toBe(pianoFactory)
  })

  it('resolves the guitar factory through the registry', async () => {
    const resolver = createInstrumentVoiceResolver()
    resolver.setInstrumentId('guitar')
    const factory = await resolver.ensureFactory()
    expect(factory).toBe(createGuitarInstrument)
  })

  it('normalizes unknown instrument ids to piano', () => {
    const resolver = createInstrumentVoiceResolver()
    expect(resolver.setInstrumentId('theremin')).toBe(false)
    expect(resolver.instrumentId).toBe('piano')
  })
})

describe('engine instrument switching', () => {
  it('keeps piano as the default instrument', () => {
    const engine = new ScorePlaybackEngine()
    expect(engine.instrumentId).toBe('piano')
    engine.dispose()
  })

  it('marks the instrument loading after an instrument switch', () => {
    const engine = new ScorePlaybackEngine()
    const statuses = []
    engine.onInstrumentStatus = (status) => statuses.push(status)

    engine.handleInstrumentStatus(INSTRUMENT_STATUS.SAMPLED)
    engine.setInstrumentId('guitar')

    expect(statuses).toContain(INSTRUMENT_STATUS.LOADING)
    engine.dispose()
  })

  it('rebuilds the playback voice from the selected instrument factory', () => {
    // Voice/output injected directly (the pattern the existing engine tests
    // use) — ensureVoices needs a live AudioContext, rebuild does not.
    const engine = new ScorePlaybackEngine()
    engine.setInstrumentId('guitar')
    engine.voiceInstrumentId = 'guitar'

    const rebuiltVoice = {
      output: { connect: vi.fn() },
      triggerAttackRelease: vi.fn(),
      releaseAll: vi.fn(),
      dispose: vi.fn(),
    }
    const guitarFactory = vi.fn(() => rebuiltVoice)
    engine.voiceResolver.setFactory('guitar', guitarFactory)

    engine.voice = {
      output: { connect: vi.fn() },
      releaseAll: vi.fn(),
      dispose: vi.fn(),
    }
    engine.output = { gain: { value: 1 } }

    engine.rebuildPlaybackVoice()
    expect(guitarFactory).toHaveBeenCalled()
    expect(engine.voice).toBe(rebuiltVoice)
  })

  it('disposes the old voice when the instrument changes', () => {
    const engine = new ScorePlaybackEngine()
    const pianoVoice = {
      output: { connect: vi.fn() },
      releaseAll: vi.fn(),
      dispose: vi.fn(),
    }
    engine.voice = pianoVoice
    engine.output = { gain: { value: 1 }, dispose: vi.fn() }
    engine.voiceInstrumentId = 'piano'

    const changed = engine.setInstrumentId('guitar')
    expect(changed).toBe(true)
    expect(pianoVoice.dispose).toHaveBeenCalled()
    expect(engine.voice).toBeNull()
    expect(engine.voiceInstrumentId).toBeNull()
  })

  it('legacy createPianoInstrument property still injects the piano factory', () => {
    const engine = new ScorePlaybackEngine()
    const factory = () => {}
    engine.createPianoInstrument = factory
    expect(engine.createPianoInstrument).toBe(factory)
    expect(engine.voiceResolver.getFactory('piano')).toBe(factory)
    engine.dispose()
  })
})

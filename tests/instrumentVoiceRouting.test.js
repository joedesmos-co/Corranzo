/**
 * Instrument voice routing — piano and guitar must stay on separate voices
 * through playback engines, the voice registry, and Hear It reference playback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getInstrument } from '../src/features/instruments/instruments.js'
import { loadInstrumentVoiceModule } from '../src/features/playback/instrumentVoices.js'
import { createInstrumentVoiceResolver } from '../src/features/playback/instrumentVoiceResolver.js'
import {
  createGuitarInstrument,
  DEFAULT_GUITAR_SAMPLE_BASE_URL,
  GUITAR_SAMPLE_URLS,
  VOICE_ID as GUITAR_VOICE_ID,
} from '../src/features/playback/guitarInstrument.js'
import {
  createPianoInstrument,
  DEFAULT_PIANO_SAMPLE_BASE_URL,
  PIANO_SAMPLE_URLS,
  VOICE_ID as PIANO_VOICE_ID,
} from '../src/features/playback/pianoInstrument.js'
import { ScorePlaybackEngine } from '../src/features/playback/scorePlaybackEngine.js'
import { MidiPlaybackEngine } from '../src/features/playback/midiPlaybackEngine.js'
import {
  __resetReferenceVoiceCacheForTests,
} from '../src/features/practice/referenceNotePlayer.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

afterEach(() => {
  __resetReferenceVoiceCacheForTests()
})

describe('voice registry', () => {
  it('loads distinct piano and guitar modules with separate sample sets', async () => {
    const pianoModule = await loadInstrumentVoiceModule('piano')
    const guitarModule = await loadInstrumentVoiceModule('guitar')

    expect(pianoModule.VOICE_ID).toBe('piano')
    expect(guitarModule.VOICE_ID).toBe('guitar')
    expect(pianoModule.DEFAULT_PIANO_SAMPLE_BASE_URL).toMatch(/salamander/)
    expect(guitarModule.DEFAULT_GUITAR_SAMPLE_BASE_URL).toMatch(/guitar-acoustic/)
    expect(pianoModule.PIANO_SAMPLE_URLS).toBeDefined()
    expect(guitarModule.GUITAR_SAMPLE_URLS).toBeDefined()
    expect(Object.keys(pianoModule.PIANO_SAMPLE_URLS).length).toBeGreaterThan(10)
    expect(Object.keys(guitarModule.GUITAR_SAMPLE_URLS).length).toBeGreaterThan(10)
  })

  it('maps instrument ids to matching voice ids in the registry', () => {
    expect(getInstrument('piano').voiceId).toBe('piano')
    expect(getInstrument('guitar').voiceId).toBe('guitar')
  })

  it('resolves different factories for piano and guitar', async () => {
    const resolver = createInstrumentVoiceResolver()
    const pianoFactory = await resolver.ensureFactory('piano')
    resolver.setInstrumentId('guitar')
    const guitarFactory = await resolver.ensureFactory('guitar')

    expect(pianoFactory).toBe(createPianoInstrument)
    expect(guitarFactory).toBe(createGuitarInstrument)
    expect(pianoFactory).not.toBe(guitarFactory)
  })
})

describe('sampled voice configuration', () => {
  it('wires piano to Salamander samples, not guitar samples', () => {
    expect(DEFAULT_PIANO_SAMPLE_BASE_URL).toMatch(/salamander/)
    expect(DEFAULT_PIANO_SAMPLE_BASE_URL).not.toMatch(/guitar/)
    expect(PIANO_VOICE_ID).toBe('piano')
    expect(PIANO_SAMPLE_URLS.C4).toBe('C4.mp3')
  })

  it('wires guitar to acoustic guitar samples, not piano samples', () => {
    expect(DEFAULT_GUITAR_SAMPLE_BASE_URL).toMatch(/guitar-acoustic/)
    expect(DEFAULT_GUITAR_SAMPLE_BASE_URL).not.toMatch(/salamander/)
    expect(GUITAR_VOICE_ID).toBe('guitar')
    expect(GUITAR_SAMPLE_URLS.E2).toBe('E2.mp3')
    expect(GUITAR_SAMPLE_URLS.A4).toBe('A4.mp3')
  })

  it('uses plucked-string synth fallback for guitar, not piano AMSynth-only path', () => {
    const guitarSrc = readFileSync(
      join(root, 'src/features/playback/guitarInstrument.js'),
      'utf8',
    )
    const pianoSrc = readFileSync(
      join(root, 'src/features/playback/pianoInstrument.js'),
      'utf8',
    )
    expect(guitarSrc).toMatch(/PluckSynth|AMSynth/)
    expect(guitarSrc).not.toMatch(/FMSynth/)
    expect(guitarSrc).toMatch(/GUITAR_SAMPLE_URLS/)
    expect(pianoSrc).toMatch(/PIANO_SAMPLE_URLS/)
    expect(pianoSrc).toMatch(/AMSynth/)
  })
})

describe('ScorePlaybackEngine routing', () => {
  it('defaults to piano and switches factories when instrument changes', async () => {
    const engine = new ScorePlaybackEngine()
    expect(engine.instrumentId).toBe('piano')

    engine.setInstrumentId('guitar')
    expect(engine.instrumentId).toBe('guitar')

    const pianoFactory = await engine.voiceResolver.ensureFactory('piano')
    const guitarFactory = await engine.voiceResolver.ensureFactory('guitar')
    expect(pianoFactory).toBe(createPianoInstrument)
    expect(guitarFactory).toBe(createGuitarInstrument)
    engine.dispose()
  })

  it('guards ensureVoices against a stale instrument voice', () => {
    const src = readFileSync(
      join(root, 'src/features/playback/scorePlaybackEngine.js'),
      'utf8',
    )
    expect(src).toContain('this.voiceInstrumentId !== this.voiceResolver.instrumentId')
    expect(src).toMatch(/disposeVoices\(\)/)
  })
})

describe('MidiPlaybackEngine routing', () => {
  it('tracks instrument id per track voice and rebuilds on switch', async () => {
    const engine = new MidiPlaybackEngine()
    const pianoFactory = vi.fn(() => ({
      output: { connect: vi.fn() },
      status: 'sampled',
      releaseAll: vi.fn(),
      dispose: vi.fn(),
    }))
    const guitarFactory = vi.fn(() => ({
      output: { connect: vi.fn() },
      status: 'sampled',
      releaseAll: vi.fn(),
      dispose: vi.fn(),
    }))

    engine.voiceResolver.setFactory('piano', pianoFactory)
    engine.voiceResolver.setFactory('guitar', guitarFactory)
    engine.trackStates = [
      {
        id: 't1',
        output: { toDestination: vi.fn(), gain: { value: 1 }, dispose: vi.fn() },
        instrument: null,
      },
    ]

    await engine.ensureTrackInstruments()
    expect(pianoFactory).toHaveBeenCalledTimes(1)
    expect(engine.trackStates[0].instrumentVoiceId).toBe('piano')

    engine.setInstrumentId('guitar')
    await engine.ensureTrackInstruments()
    expect(guitarFactory).toHaveBeenCalledTimes(1)
    expect(engine.trackStates[0].instrumentVoiceId).toBe('guitar')
  })
})

describe('Hear It reference playback routing', () => {
  it('resolves voice modules through instrument voiceId, not a hardcoded piano path', () => {
    const src = readFileSync(
      join(root, 'src/features/practice/referenceNotePlayer.js'),
      'utf8',
    )
    expect(src).toContain('getInstrument(instrumentKey)')
    expect(src).toContain('loadInstrumentVoiceModule(voiceId)')
    expect(src).toContain('voiceFactoryFromModule(module)')
    expect(src).not.toContain('new Tone.PolySynth')
    expect(src).toContain('triggerAttack')
    expect(src).toContain('triggerRelease')
  })

  it('caches separate voice ids for piano and guitar reference voices', async () => {
    const pianoVoice = {
      output: { toDestination: vi.fn() },
      whenReady: vi.fn(),
      releaseAll: vi.fn(),
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      dispose: vi.fn(),
    }
    const guitarVoice = {
      output: { toDestination: vi.fn() },
      whenReady: vi.fn(),
      releaseAll: vi.fn(),
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      dispose: vi.fn(),
    }

    vi.resetModules()
    vi.doMock('tone', () => ({
      now: () => 0,
      Destination: {},
      Frequency: (midi, unit) => ({
        toNote: () => (unit === 'midi' ? `N${midi}` : ''),
      }),
    }))
    vi.doMock('../src/features/audio/toneAudioUnlock.js', () => ({
      startToneFromUserGesture: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock('../src/features/playback/instrumentVoices.js', async (importOriginal) => {
      const actual = await importOriginal()
      return {
        ...actual,
        loadInstrumentVoiceModule: vi.fn(async (voiceId) => {
          if (voiceId === 'guitar') {
            return {
              VOICE_ID: 'guitar',
              createInstrumentVoice: () => guitarVoice,
            }
          }
          return {
            VOICE_ID: 'piano',
            createInstrumentVoice: () => pianoVoice,
          }
        }),
      }
    })

    const refModule = await import('../src/features/practice/referenceNotePlayer.js')

    await refModule.playReferenceMidis([60], 0.55, { instrumentId: 'piano' })
    await refModule.playReferenceMidis([64], 0.55, { instrumentId: 'guitar' })

    expect(refModule.__getReferenceVoiceRoutingForTests('piano')).toEqual({
      instrumentKey: 'piano',
      voiceId: 'piano',
    })
    expect(refModule.__getReferenceVoiceRoutingForTests('guitar')).toEqual({
      instrumentKey: 'guitar',
      voiceId: 'guitar',
    })
    expect(pianoVoice.triggerAttack).toHaveBeenCalled()
    expect(guitarVoice.triggerAttack).toHaveBeenCalled()

    vi.resetModules()
  })
})

describe('practice session wiring', () => {
  it('passes instrumentId into score playback and Hear It hooks', () => {
    const sessionSrc = readFileSync(
      join(root, 'src/features/practice/usePracticeSession.js'),
      'utf8',
    )
    expect(sessionSrc).toMatch(/useScorePlayback\([\s\S]*instrumentId/m)
    expect(sessionSrc).toMatch(/useWaitForYouReferencePlayback\([\s\S]*instrumentId/m)
  })

  it('passes instrumentId into score engine load', () => {
    const hookSrc = readFileSync(
      join(root, 'src/features/playback/useScorePlayback.js'),
      'utf8',
    )
    expect(hookSrc).toContain('instrumentId,')
  })
})

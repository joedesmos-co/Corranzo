/**
 * Playback audio graph — gain staging, envelopes, reverb warmup, latency config.
 * Scheduling/timing constants are intentionally untouched.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  configurePlaybackAudioContext,
  MAX_SAFE_TRIGGER_VELOCITY,
  PLAYBACK_MASTER_FX,
  REFERENCE_PLAYBACK_READINESS_MS,
  __resetPlaybackAudioConfigForTests,
} from '../src/features/playback/playbackAudioConfig.js'
import { mapPlaybackVelocity } from '../src/features/playback/pianoVelocity.js'
import { planNoteTrigger, createVoiceMixState, releaseVoiceFromMix } from '../src/features/playback/pianoVoiceMix.js'
import { createPianoInstrument, __resetSharedPianoBuffers } from '../src/features/playback/pianoInstrument.js'
import { createGuitarInstrument } from '../src/features/playback/guitarInstrument.js'
import { __resetToneAudioUnlockForTests } from '../src/features/audio/toneAudioUnlock.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const scoreEngineSrc = readFileSync(
  join(root, 'src', 'features', 'playback', 'scorePlaybackEngine.js'),
  'utf8',
)

afterEach(() => {
  __resetPlaybackAudioConfigForTests()
  __resetToneAudioUnlockForTests()
  __resetSharedPianoBuffers()
})

describe('playback master FX defaults', () => {
  it('reserves headroom before the limiter', () => {
    expect(PLAYBACK_MASTER_FX.trimGain).toBeLessThanOrEqual(0.84)
    expect(PLAYBACK_MASTER_FX.limiterDb).toBeLessThanOrEqual(-3)
    expect(PLAYBACK_MASTER_FX.reverbWet).toBeLessThanOrEqual(0.12)
  })

  it('softens sampler highs to reduce pitch-shift harshness', () => {
    expect(PLAYBACK_MASTER_FX.samplerWarmthHz).toBeGreaterThanOrEqual(6000)
    expect(PLAYBACK_MASTER_FX.samplerWarmthHz).toBeLessThanOrEqual(7000)
  })

  it('wires the shared FX defaults into the sampled voice chain', () => {
    const voiceSrc = readFileSync(
      join(root, 'src', 'features', 'playback', 'sampledInstrumentVoice.js'),
      'utf8',
    )
    expect(voiceSrc).toMatch(/PLAYBACK_MASTER_FX/)
    expect(voiceSrc).toMatch(/reverb\.dispose/)
    expect(voiceSrc).toMatch(/await reverbReady/)
  })
})

describe('velocity and voice-mix staging', () => {
  it('softens peak velocity without crushing quiet notes', () => {
    expect(mapPlaybackVelocity(1)).toBeLessThanOrEqual(MAX_SAFE_TRIGGER_VELOCITY)
    expect(mapPlaybackVelocity(0)).toBeGreaterThan(0.2)
    expect(mapPlaybackVelocity(0.9)).toBeGreaterThan(mapPlaybackVelocity(0.3))
  })

  it('caps dense chord velocity below the global peak', () => {
    const state = createVoiceMixState()
    const results = []
    for (let index = 0; index < 8; index += 1) {
      results.push(
        planNoteTrigger(state, {
          time: 1,
          velocity: 0.9,
          duration: 0.5,
          note: `N${index}`,
        }),
      )
    }
    expect(Math.max(...results.map((result) => result.velocity))).toBeLessThanOrEqual(0.86)
  })
})

describe('instrument envelopes', () => {
  it('uses a longer piano sample release for natural sustain tails', () => {
    const pianoSrc = readFileSync(join(root, 'src', 'features', 'playback', 'pianoInstrument.js'), 'utf8')
    expect(pianoSrc).toMatch(/SAMPLED_RELEASE = 1\.68/)
    expect(pianoSrc).toMatch(/SAMPLED_VOLUME_DB = -11/)
  })

  it('uses a drier guitar room and quicker pluck release', () => {
    const guitarSrc = readFileSync(join(root, 'src', 'features', 'playback', 'guitarInstrument.js'), 'utf8')
    expect(guitarSrc).toMatch(/SAMPLED_RELEASE = 1\.08/)
    expect(guitarSrc).toMatch(/reverbWet: 0\.085/)
    expect(guitarSrc).not.toMatch(/FMSynth/)
  })
})

describe('latency configuration', () => {
  it('tightens Tone lookahead once on unlock without touching schedule constants', () => {
    const context = {
      lookAhead: 0.1,
      updateInterval: 0.025,
    }
    const tone = {
      getContext: () => context,
    }
    configurePlaybackAudioContext(tone)
    expect(context.lookAhead).toBe(0.05)
    expect(context.updateInterval).toBe(0.03)
    configurePlaybackAudioContext(tone)
    expect(context.lookAhead).toBe(0.05)
  })

  it('does not change score scheduling lookahead constants', () => {
    expect(scoreEngineSrc).toMatch(/LOOKAHEAD_SECONDS = 2\.5/)
    expect(scoreEngineSrc).toMatch(/SCHEDULE_TICK_MS = 200/)
  })
})

describe('reverb readiness', () => {
  it('awaits reverb impulse generation in whenReady', async () => {
    let resolveReverb
    const tone = {
      now: () => 0,
      Gain: class {
        constructor() {
          this.gain = {
            value: 1,
            cancelScheduledValues: () => {},
            setValueAtTime: () => {},
            linearRampToValueAtTime: () => {},
          }
        }
        connect() {}
        dispose() {}
      },
      Reverb: class {
        constructor() {}
        generate() {
          return new Promise((resolve) => {
            resolveReverb = resolve
          })
        }
        connect() {}
        dispose() {}
      },
      Compressor: class {
        connect() {}
        dispose() {}
      },
      Limiter: class {
        connect() {}
        dispose() {}
      },
      Filter: class {
        connect() {}
        dispose() {}
      },
      Chorus: class {
        start() {}
        connect() {}
        dispose() {}
      },
      PolySynth: class {
        set() {}
        triggerAttackRelease() {}
        releaseAll() {}
        connect() {}
        dispose() {}
      },
      AMSynth: class {},
    }

    const sampler = {
      connect: () => {},
      triggerAttackRelease: () => {},
      releaseAll: () => {},
      dispose: () => {},
    }

    const voice = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
    })

    const readyPromise = voice.whenReady()
    resolveReverb?.()
    await expect(readyPromise).resolves.toBe('sampled')
  })
})

function makeVoiceTestTone() {
  class Node {
    constructor() {
      this.connectedTo = []
    }
    connect(dest) {
      this.connectedTo.push(dest)
      return dest
    }
    dispose() {}
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
  class Chorus extends Node {
    start() {}
  }
  class PolySynth extends Node {
    constructor() {
      super()
      this.attacks = []
      this.releases = []
      this.calls = []
    }
    set() {}
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
    triggerAttack(...args) {
      this.attacks.push(args)
    }
    triggerRelease(...args) {
      this.releases.push(args)
    }
    releaseAll() {}
  }
  class Sampler extends Node {
    constructor() {
      super()
      this.attacks = []
      this.releases = []
      this.calls = []
    }
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
    triggerAttack(...args) {
      this.attacks.push(args)
    }
    triggerRelease(...args) {
      this.releases.push(args)
    }
    releaseAll() {}
    dispose() {}
  }

  return {
    now: () => 1,
    Gain,
    Reverb,
    Compressor,
    Limiter,
    Filter,
    Chorus,
    PolySynth,
    Sampler,
    AMSynth: class {},
    PluckSynth: class {},
    created: { synths: [], samplers: [] },
  }
}

describe('voice attack and release', () => {
  it('starts and stops notes cleanly through triggerAttack/triggerRelease', async () => {
    const tone = makeVoiceTestTone()
    const sampler = new tone.Sampler()
    const voice = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
    })
    await voice.whenReady()

    voice.triggerAttack('C4', 1, 0.7)
    voice.triggerRelease('C4', 1.55)

    expect(sampler.attacks).toEqual([['C4', 1, 0.7]])
    expect(sampler.releases).toEqual([['C4', 1.55]])
  })

  it('releaseAll schedules a master trim fade without hanging notes', () => {
    const tone = makeVoiceTestTone()
    let fadeSteps = 0
    const BaseGain = tone.Gain
    tone.Gain = class extends BaseGain {
      constructor(...args) {
        super(...args)
        const ramp = this.gain.linearRampToValueAtTime.bind(this.gain)
        this.gain.linearRampToValueAtTime = (...args) => {
          fadeSteps += 1
          return ramp(...args)
        }
      }
    }

    const voice = createGuitarInstrument({
      tone,
      loadSampler: () => new Promise(() => {}),
      createSamplerSync: () => null,
    })

    voice.triggerAttack('E2', 0, 0.6)
    voice.releaseAll(2)

    expect(fadeSteps).toBeGreaterThan(0)
    expect(voice.getVoiceDiagnostics().activeVoices).toBe(0)
  })

  it('triggerRelease clears mix tracking so voices do not stack', async () => {
    const tone = makeVoiceTestTone()
    const sampler = new tone.Sampler()
    const voice = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
    })
    await voice.whenReady()

    voice.triggerAttack('C4', 1, 0.7)
    expect(voice.getVoiceDiagnostics().activeVoices).toBe(1)
    voice.triggerRelease('C4', 1.2)
    expect(voice.getVoiceDiagnostics().activeVoices).toBe(0)
    expect(sampler.releases).toEqual([['C4', 1.2]])
  })

  it('routes synth fallback through the shared warmth filter', () => {
    const tone = makeVoiceTestTone()
    const voice = createPianoInstrument({
      tone,
      loadSampler: () => new Promise(() => {}),
      createSamplerSync: () => null,
    })
    const voiceSrc = readFileSync(
      join(root, 'src', 'features', 'playback', 'sampledInstrumentVoice.js'),
      'utf8',
    )
    expect(voiceSrc).toMatch(/synthVoice\.connect\(samplerToneFilter\)/)
    expect(voice.output).toBeDefined()
    voice.dispose?.()
  })

  it('never schedules trigger velocity above the safe peak', async () => {
    const tone = makeVoiceTestTone()
    const sampler = new tone.Sampler()
    const voice = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
    })
    await voice.whenReady()
    voice.triggerAttackRelease('G4', 0.5, 0, 1)
    expect(sampler.calls[0][3]).toBeLessThanOrEqual(MAX_SAFE_TRIGGER_VELOCITY)
  })
})

describe('voice mix release tracking', () => {
  it('releaseVoiceFromMix drops only the matching active note', () => {
    const state = createVoiceMixState()
    planNoteTrigger(state, { time: 0, velocity: 0.7, duration: 1, note: 'C4' })
    planNoteTrigger(state, { time: 0, velocity: 0.7, duration: 1, note: 'E4' })
    releaseVoiceFromMix(state, 'C4', 0.5)
    expect(state.active.map((voice) => voice.note)).toEqual(['E4'])
  })
})

describe('Hear It reference playback', () => {
  it('uses attack+release with softened velocity and a longer readiness window', async () => {
    const referenceSrc = readFileSync(
      join(root, 'src', 'features', 'practice', 'referenceNotePlayer.js'),
      'utf8',
    )
    expect(referenceSrc).toContain('triggerAttack')
    expect(referenceSrc).toContain('triggerRelease')
    expect(referenceSrc).toContain('mapPlaybackVelocity')
    expect(referenceSrc).toContain('REFERENCE_PLAYBACK_READINESS_MS')
    expect(referenceSrc).toContain('releaseAll')
    expect(REFERENCE_PLAYBACK_READINESS_MS).toBeGreaterThanOrEqual(5000)
  })
})

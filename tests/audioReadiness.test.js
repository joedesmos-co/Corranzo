/**
 * Audio readiness, warmup, and stuck-note guards.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLAY_READY_TIMEOUT_MS,
  REFERENCE_PLAYBACK_READINESS_MS,
} from '../src/features/playback/playbackAudioConfig.js'
import {
  warmupAllInstrumentSamplesOnIdle,
  warmupInstrumentSamplesOnIdle,
  __resetInstrumentSampleWarmupForTests,
} from '../src/features/playback/instrumentSampleWarmup.js'
import {
  releaseReferenceVoices,
  __resetReferenceVoiceCacheForTests,
} from '../src/features/practice/referenceNotePlayer.js'
import { INSTRUMENT_STATUS } from '../src/features/playback/instrumentVoiceStatus.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

afterEach(() => {
  __resetInstrumentSampleWarmupForTests()
  __resetReferenceVoiceCacheForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('playback readiness timeouts', () => {
  it('aligns Hear It and main playback sample wait windows', () => {
    expect(REFERENCE_PLAYBACK_READINESS_MS).toBe(PLAY_READY_TIMEOUT_MS)
    expect(PLAY_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(5000)
  })
})

describe('instrument sample warmup', () => {
  it('warms each supported instrument only once', () => {
    const idle = vi.fn((callback) => {
      callback()
      return 1
    })
    vi.stubGlobal('window', {})
    vi.stubGlobal('requestIdleCallback', idle)

    warmupAllInstrumentSamplesOnIdle()
    warmupAllInstrumentSamplesOnIdle()

    expect(idle).toHaveBeenCalledTimes(2)
  })

  it('still warms a single instrument on demand', () => {
    const idle = vi.fn((callback) => {
      callback()
      return 1
    })
    vi.stubGlobal('window', {})
    vi.stubGlobal('requestIdleCallback', idle)

    warmupInstrumentSamplesOnIdle('guitar')
    warmupInstrumentSamplesOnIdle('guitar')

    expect(idle).toHaveBeenCalledTimes(1)
  })
})

describe('reference voice release', () => {
  it('releaseReferenceVoices is safe when no cache exists', () => {
    expect(() => releaseReferenceVoices(0)).not.toThrow()
  })
})

describe('score load voice priming', () => {
  it('preloads buffers and ensures voices after a score loads', () => {
    const hookSrc = readFileSync(
      join(root, 'src/features/playback/useScorePlayback.js'),
      'utf8',
    )
    expect(hookSrc).toContain('await engine.preload?.()')
    expect(hookSrc).toContain('await engine.ensureVoices?.()')
  })
})

describe('practice status labels', () => {
  it('surfaces loading, ready, and synth-fallback states distinctly', () => {
    const stripSrc = readFileSync(
      join(root, 'src/components/practice/PracticeStatusStrip.jsx'),
      'utf8',
    )
    expect(stripSrc).toContain('buildInstrumentStatusLabels')
    expect(stripSrc).toContain(`INSTRUMENT_STATUS.SAMPLED`)
    expect(stripSrc).toContain(`INSTRUMENT_STATUS.LOADING`)
    expect(stripSrc).toContain(`INSTRUMENT_STATUS.SYNTH`)
    expect(stripSrc).toContain("tone: 'warning'")
  })
})

describe('balanced instrument levels', () => {
  it('matches piano and guitar sampled headroom', () => {
    const pianoSrc = readFileSync(
      join(root, 'src/features/playback/pianoInstrument.js'),
      'utf8',
    )
    const guitarSrc = readFileSync(
      join(root, 'src/features/playback/guitarInstrument.js'),
      'utf8',
    )
    expect(pianoSrc).toMatch(/SAMPLED_VOLUME_DB = -10/)
    expect(guitarSrc).toMatch(/SAMPLED_VOLUME_DB = -11/)
    expect(pianoSrc).toMatch(/SYNTH_VOLUME_DB = -17/)
    expect(guitarSrc).toMatch(/SYNTH_VOLUME_DB = -17/)
  })
})

describe('practice session hear-it warmup', () => {
  it('warms reference buffers without instantiating the voice graph early', () => {
    const refSrc = readFileSync(
      join(root, 'src/features/practice/referenceNotePlayer.js'),
      'utf8',
    )
    const warmupBlock = refSrc.slice(
      refSrc.indexOf('export async function warmupReferenceVoice'),
      refSrc.indexOf('/** Release any sounding reference notes'),
    )
    expect(warmupBlock).toContain('voicePreloadFromModule(voiceModule)')
    expect(warmupBlock).not.toContain('getReferenceVoice')
  })

  it('releases reference voices on instrument switch', () => {
    const ctxSrc = readFileSync(
      join(root, 'src/context/PracticeSessionContext.jsx'),
      'utf8',
    )
    expect(ctxSrc).toContain('warmupReferenceVoice(instrumentId)')
    expect(ctxSrc).toContain('releaseReferenceVoices()')
  })
})

describe('instrument status constants', () => {
  it('keeps separate loading and sampled states for readiness UI', () => {
    expect(INSTRUMENT_STATUS.LOADING).toBe('loading')
    expect(INSTRUMENT_STATUS.SAMPLED).toBe('sampled')
    expect(INSTRUMENT_STATUS.SYNTH).toBe('synth')
  })
})

/**
 * Electric guitar playback voice (clean tone) — configuration over the
 * shared sampled-voice engine.
 *
 * Same architecture as the acoustic voice: a plucked synth fallback
 * sounds immediately; sampled clean electric guitar loads lazily from
 * the same-origin mirror (CDN fallback) and takes over when decoded.
 *
 * Samples: nbrosowsky/tonejs-instruments guitar-electric, CC-BY-3.0
 * (see app credits). Only a CLEAN tone is provided — crunch and
 * distortion are documented as unsupported (no honest sample source).
 */

import {
  createCachedSamplerSync,
  createPolyphonicFallbackVoice,
  createSampledInstrumentVoice,
  defaultLoadSampler,
  preloadInstrumentSampleBuffers,
} from './sampledInstrumentVoice.js'
import { buildInstrumentStatusLabels, INSTRUMENT_STATUS } from './instrumentVoiceStatus.js'

export { INSTRUMENT_STATUS, defaultLoadSampler, createCachedSamplerSync }

export const INSTRUMENT_STATUS_LABEL = buildInstrumentStatusLabels('Electric Guitar')

/** Registry id (playback/instrumentVoices.js). */
export const VOICE_ID = 'electric-guitar'

/** Same-origin mirror under `public/audio/guitar-electric/` (preferred when present). */
export const LOCAL_ELECTRIC_GUITAR_SAMPLE_BASE_URL = '/audio/guitar-electric/'

/**
 * Public, CORS-enabled clean electric guitar samples
 * (nbrosowsky/tonejs-instruments, CC-BY-3.0 — see app credits).
 *
 * Verified 2026-10-09 by spectral analysis of every file: all 17 keys
 * below are true pitches (±6¢, Fs5 +17¢). Missing E3/E4/E5/G/B notes
 * pitch-shift from neighbors (≤2 semitones below E5; E5+ shifts from
 * the top keys — disclosed high-register degradation).
 */
export const DEFAULT_ELECTRIC_GUITAR_SAMPLE_BASE_URL =
  'https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-electric/'

export const ELECTRIC_GUITAR_SAMPLE_URLS = {
  E2: 'E2.mp3',
  'C#2': 'Cs2.mp3',
  'F#2': 'Fs2.mp3',
  A2: 'A2.mp3',
  C3: 'C3.mp3',
  'D#3': 'Ds3.mp3',
  'F#3': 'Fs3.mp3',
  A3: 'A3.mp3',
  C4: 'C4.mp3',
  'D#4': 'Ds4.mp3',
  'F#4': 'Fs4.mp3',
  A4: 'A4.mp3',
  A5: 'A5.mp3',
  C5: 'C5.mp3',
  'D#5': 'Ds5.mp3',
  'F#5': 'Fs5.mp3',
  C6: 'C6.mp3',
}

const SAMPLED_VOLUME_DB = -11
const SYNTH_VOLUME_DB = -17
/** Clean electric sustains like an acoustic; amp compression evens decay. */
const SAMPLED_RELEASE = 1.25
const SAMPLE_ATTACK = 0.002

function resolveSampleBaseUrl(explicit) {
  if (explicit) {
    return explicit
  }
  try {
    const fromEnv = import.meta?.env?.VITE_ELECTRIC_GUITAR_SAMPLE_BASE_URL
    if (fromEnv) {
      return fromEnv
    }
  } catch {
    // import.meta.env is unavailable outside a bundler context; ignore.
  }
  return LOCAL_ELECTRIC_GUITAR_SAMPLE_BASE_URL
}

export function resolveElectricGuitarSampleBaseUrl(explicit) {
  return resolveSampleBaseUrl(explicit)
}

export function getElectricGuitarSampleFallbackBaseUrl() {
  return DEFAULT_ELECTRIC_GUITAR_SAMPLE_BASE_URL
}

/**
 * Fallback voice: brighter pluck than the acoustic (clean bridge-pickup
 * character), same honest synth-before-samples contract.
 */
function createCleanElectricSynthVoice(tone, { volume = SYNTH_VOLUME_DB } = {}) {
  const filter = new tone.Filter({ type: 'lowpass', frequency: 5200, rolloff: -12 })
  const chorus = new tone.Chorus({ frequency: 0.42, delayTime: 2.2, depth: 0.08, wet: 0.05 })
  let chorusStarted = false
  const ensureChorusRunning = () => {
    if (!chorusStarted) {
      chorus.start?.()
      chorusStarted = true
    }
  }

  const SynthVoice = tone.PluckSynth ?? tone.AMSynth ?? tone.Synth
  const usingPluck = Boolean(tone.PluckSynth)
  const synth = createPolyphonicFallbackVoice(tone, {
    voice: SynthVoice,
    maxPolyphony: 24,
    voiceOptions: usingPluck
      ? {
          volume,
          attackNoise: 1.1,
          dampening: 3400,
          resonance: 0.8,
        }
      : { volume },
  })

  synth.connect(filter)
  filter.connect(chorus)

  return {
    triggerAttackRelease: (note, duration, time, velocity) => {
      ensureChorusRunning()
      synth.triggerAttackRelease(note, duration, time, velocity)
    },
    triggerAttack: (note, time, velocity) => {
      ensureChorusRunning()
      synth.triggerAttack?.(note, time, velocity)
    },
    triggerRelease: (note, time) => synth.triggerRelease?.(note, time),
    releaseAll: (time) => synth.releaseAll?.(time),
    connect: (destination) => chorus.connect(destination),
    dispose: () => {
      synth.dispose?.()
      filter.dispose?.()
      chorus.dispose?.()
    },
  }
}

/**
 * Fetch/decode electric guitar samples without touching audio output.
 * Safe before the user gesture.
 */
export async function preloadElectricGuitarSampleBuffers({
  tone,
  sampleBaseUrl,
  sampleUrls = ELECTRIC_GUITAR_SAMPLE_URLS,
  timeoutMs,
} = {}) {
  await preloadInstrumentSampleBuffers({
    tone,
    baseUrl: resolveSampleBaseUrl(sampleBaseUrl),
    urls: sampleUrls,
    timeoutMs,
  })
}

/** Canonical (instrument-agnostic) preload name used by the voice registry. */
export const preloadSampleBuffers = preloadElectricGuitarSampleBuffers

/**
 * Create an electric guitar voice. Options mirror
 * createSampledInstrumentVoice; the sample set, clean fallback, and
 * volumes default to the electric values.
 */
export function createElectricGuitarInstrument(options = {}) {
  const {
    sampleBaseUrl,
    sampleFallbackBaseUrl = getElectricGuitarSampleFallbackBaseUrl(),
    sampleUrls = ELECTRIC_GUITAR_SAMPLE_URLS,
    sampledVolume = SAMPLED_VOLUME_DB,
    synthVolume = SYNTH_VOLUME_DB,
    ...rest
  } = options

  return createSampledInstrumentVoice({
    ...rest,
    sampleBaseUrl: resolveSampleBaseUrl(sampleBaseUrl),
    sampleFallbackBaseUrl,
    sampleUrls,
    sampleSetName: 'guitar-electric-clean-verified',
    voiceId: VOICE_ID,
    sampledVolume,
    synthVolume,
    sampledRelease: SAMPLED_RELEASE,
    sampleAttack: SAMPLE_ATTACK,
    velocityLayers: 2,
    brightnessMinHz: 1800,
    brightnessMaxHz: 7500,
    effects: {
      reverbDecay: 1.2,
      reverbWet: 0.06,
    },
    createFallbackVoice: createCleanElectricSynthVoice,
  })
}

/** Canonical (instrument-agnostic) factory name used by the voice registry. */
export const createInstrumentVoice = createElectricGuitarInstrument

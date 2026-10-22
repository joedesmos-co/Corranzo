/**
 * Guitar playback voice — configuration over the shared sampled-voice engine.
 *
 * Same architecture as the piano voice: a plucked synth fallback sounds
 * immediately; sampled acoustic guitar loads lazily from a CORS-enabled CDN
 * and takes over when decoded; failures stay on the synth with an honest
 * status. All timing/scheduling behavior is identical by construction — the
 * engine talks to the same voice interface.
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

export const INSTRUMENT_STATUS_LABEL = buildInstrumentStatusLabels('Guitar')

/** Registry id (playback/instrumentVoices.js). */
export const VOICE_ID = 'guitar'

/**
 * Public, CORS-enabled acoustic guitar samples (nbrosowsky/tonejs-instruments,
 * GitHub Pages, CC-BY-3.0 — see app credits). Keys are the samples' TRUE
 * pitches — Tone.Sampler pitch-shifts every played note from its nearest
 * key, exactly like the piano set.
 *
 * Verified 2026-10-09 by spectral analysis of every file: B4/F4/Fs4/G4
 * filenames contain 3rd-octave audio (an octave below their names) and
 * are EXCLUDED — callers must never key them. E5+ shifts from D5.
 */
export const DEFAULT_GUITAR_SAMPLE_BASE_URL =
  'https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-acoustic/'

/** Same-origin mirror under `public/audio/guitar-acoustic/` (preferred when present). */
export const LOCAL_GUITAR_SAMPLE_BASE_URL = '/audio/guitar-acoustic/'

/** @deprecated Prefer LOCAL then CDN — kept for existing imports/tests. */
export const DEFAULT_GUITAR_SAMPLE_FALLBACK_URL = DEFAULT_GUITAR_SAMPLE_BASE_URL

/**
 * Verified true-pitch keys across the guitar's sounding range. Sharps use
 * their own recordings (≤1 semitone shift anywhere below D5).
 */
export const GUITAR_SAMPLE_URLS = {
  E2: 'E2.mp3',
  F2: 'F2.mp3',
  'F#2': 'Fs2.mp3',
  G2: 'G2.mp3',
  'G#2': 'Gs2.mp3',
  A2: 'A2.mp3',
  'A#2': 'As2.mp3',
  B2: 'B2.mp3',
  C3: 'C3.mp3',
  'C#3': 'Cs3.mp3',
  D2: 'D2.mp3',
  'D#2': 'Ds2.mp3',
  D3: 'D3.mp3',
  E3: 'E3.mp3',
  F3: 'F3.mp3',
  G3: 'G3.mp3',
  'G#3': 'Gs3.mp3',
  A3: 'A3.mp3',
  'A#3': 'As3.mp3',
  B3: 'B3.mp3',
  C4: 'C4.mp3',
  'C#4': 'Cs4.mp3',
  D4: 'D4.mp3',
  'D#4': 'Ds4.mp3',
  E4: 'E4.mp3',
  'G#4': 'Gs4.mp3',
  A4: 'A4.mp3',
  'A#4': 'As4.mp3',
  C5: 'C5.mp3',
  'C#5': 'Cs5.mp3',
  D5: 'D5.mp3',
}

const SAMPLED_VOLUME_DB = -11
const SYNTH_VOLUME_DB = -17
/** Plucked strings ring shorter than piano strings. */
const SAMPLED_RELEASE = 1.08
const SAMPLE_ATTACK = 0.002

/**
 * Optional self-hosting override, mirroring the piano voice.
 */
function resolveSampleBaseUrl(explicit) {
  if (explicit) {
    return explicit
  }
  try {
    const fromEnv = import.meta?.env?.VITE_GUITAR_SAMPLE_BASE_URL
    if (fromEnv) {
      return fromEnv
    }
  } catch {
    // import.meta.env is unavailable outside a bundler context; ignore.
  }
  return LOCAL_GUITAR_SAMPLE_BASE_URL
}

export function resolveGuitarSampleBaseUrl(explicit) {
  return resolveSampleBaseUrl(explicit)
}

export function getGuitarSampleFallbackBaseUrl() {
  return DEFAULT_GUITAR_SAMPLE_BASE_URL
}

/**
 * Fallback voice: plucked-string timbre without the buzzy FM square modulator.
 * PluckSynth when available; otherwise a warm AMSynth body.
 */
function createPluckedSynthVoice(tone, { volume = SYNTH_VOLUME_DB } = {}) {
  const filter = new tone.Filter({ type: 'lowpass', frequency: 3600, rolloff: -12 })
  const chorus = new tone.Chorus({ frequency: 0.32, delayTime: 2.6, depth: 0.1, wet: 0.06 })
  let chorusStarted = false
  const ensureChorusRunning = () => {
    if (!chorusStarted) {
      chorus.start?.()
      chorusStarted = true
    }
  }

  const SynthVoice = tone.PluckSynth ?? tone.AMSynth ?? tone.Synth
  const usingPluck = Boolean(tone.PluckSynth)
  const usingAm = !usingPluck && Boolean(tone.AMSynth)
  const synth = createPolyphonicFallbackVoice(tone, {
    voice: SynthVoice,
    maxPolyphony: 24,
    voiceOptions: usingPluck
      ? {
          volume,
          attackNoise: 1.35,
          dampening: 2600,
          resonance: 0.85,
        }
      : {
          volume,
          harmonicity: usingAm ? 2.1 : undefined,
          oscillator: { type: usingAm ? 'sine' : 'triangle' },
          envelope: { attack: 0.006, decay: 1.2, sustain: 0.06, release: 0.82 },
          modulation: usingAm ? { type: 'triangle' } : undefined,
          modulationEnvelope: usingAm
            ? { attack: 0.003, decay: 0.2, sustain: 0, release: 0.08 }
            : undefined,
        },
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
 * Fetch/decode guitar samples without touching audio output. Safe before the
 * user gesture.
 */
export async function preloadGuitarSampleBuffers({
  tone,
  sampleBaseUrl,
  sampleUrls = GUITAR_SAMPLE_URLS,
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
export const preloadSampleBuffers = preloadGuitarSampleBuffers

/**
 * Create a guitar voice. Options mirror createSampledInstrumentVoice; the
 * sample set, plucked fallback, and volumes default to the guitar values.
 */
export function createGuitarInstrument(options = {}) {
  const {
    sampleBaseUrl,
    sampleFallbackBaseUrl = getGuitarSampleFallbackBaseUrl(),
    sampleUrls = GUITAR_SAMPLE_URLS,
    sampledVolume = SAMPLED_VOLUME_DB,
    synthVolume = SYNTH_VOLUME_DB,
    ...rest
  } = options

  return createSampledInstrumentVoice({
    ...rest,
    sampleBaseUrl: resolveSampleBaseUrl(sampleBaseUrl),
    sampleFallbackBaseUrl,
    sampleUrls,
    sampleSetName: 'guitar-acoustic-verified',
    voiceId: VOICE_ID,
    sampledVolume,
    synthVolume,
    sampledRelease: SAMPLED_RELEASE,
    sampleAttack: SAMPLE_ATTACK,
    velocityLayers: 2,
    // Same calibration reasoning as piano (see pianoInstrument.js):
    // soft velocities must reach ~1 kHz to darken audibly, ff stays open.
    brightnessMinHz: 500,
    brightnessMaxHz: 9500,
    effects: {
      reverbDecay: 1.55,
      reverbWet: 0.085,
    },
    createFallbackVoice: createPluckedSynthVoice,
  })
}

/** Canonical (instrument-agnostic) factory name used by the voice registry. */
export const createInstrumentVoice = createGuitarInstrument

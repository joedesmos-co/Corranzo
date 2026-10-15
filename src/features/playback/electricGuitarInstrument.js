/**
 * Electric guitar playback voice (clean tone) — configuration over the
 * shared sampled-voice engine.
 *
/**
 * Same architecture as the acoustic voice: a plucked synth fallback
 * sounds immediately; sampled clean electric guitar loads lazily from the
 * same-origin mirror (CDN fallback) and takes over when decoded.
 *
 * Samples: "Emilyguitar" by Karoryfer Lecolds (D. Smolken, 2014),
 * published under the CC0-1.0 public domain dedication at
 * github.com/sfzinstruments/karoryfer.emilyguitar. CC0 needs no
 * attribution and permits commercial redistribution; it is credited in the
 * Terms page anyway, as courtesy.
 *
 * License history: these files previously came from nbrosowsky/
 * tonejs-instruments, whose repository labels its samples CC-BY-3.0 but
 * whose own sample-source-info.txt credits the electric guitar set to
 * Karoryfer — a commercial sample vendor whose terms for that specific set
 * could not be confirmed. A wrapper's blanket license claim does not
 * override the originating owner's terms, so the set was replaced with one
 * whose licence is verifiable directly from the owner. Docs in
 * docs/SOUND_ENGINE_RESEARCH.md record the evidence chain.
 *
 * All 17 keys below are Emilyguitar pitches used unshifted — verified by
 * tests/samplePitchCoverage.test.js, which measures every mapped file
 * through the app's own decode path and fails on an octave-style
 * mislabel (the defect class an earlier guitar-acoustic audit found).
 * Only a CLEAN tone is provided — crunch and distortion are documented as
 * unsupported (no honest sample source).
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
 * CC0-1.0 source of the bundled files, for provenance only.
 *
 * The upstream WAVs are NOT a drop-in replacement for the bundled mp3s:
 * they are named by pitch AND velocity layer (`a3_mf_rr1.wav`) and hold
 * every round robin, so they cannot be addressed by our note-keyed map.
 * No cross-origin fallback is therefore configured.
 *
 * That is deliberate and load-bearing: the previous fallback pointed at
 * nbrosowsky/tonejs-instruments, the set whose Karoryfer provenance could
 * not be verified, so a same-origin load failure would have silently
 * re-introduced the unverified samples. Without a fallback the voice stays
 * on the synthesised plucked tone and reports SYNTH status honestly, which
 * is the correct trade for an uncertain licence.
 */
export const ELECTRIC_GUITAR_SAMPLE_SOURCE_URL =
  'https://github.com/sfzinstruments/karoryfer.emilyguitar'

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

/**
 * Intentionally null — see ELECTRIC_GUITAR_SAMPLE_SOURCE_URL. There is no
 * cross-origin fallback for this set by design.
 */
export function getElectricGuitarSampleFallbackBaseUrl() {
  return null
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
    sampleFallbackBaseUrl,
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
    sampleSetName: 'emilyguitar-cc0',
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
      reverbDecay: 1.2,
      reverbWet: 0.06,
    },
    createFallbackVoice: createCleanElectricSynthVoice,
  })
}

/** Canonical (instrument-agnostic) factory name used by the voice registry. */
export const createInstrumentVoice = createElectricGuitarInstrument

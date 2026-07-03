/**
 * Piano playback voice — configuration over the shared sampled-voice engine.
 *
 * All voice mechanics (synth-first fallback, lazy sampler, shared buffer
 * cache, voice-mix ducking, FX chain) live in sampledInstrumentVoice.js and
 * are shared by every instrument. This module contributes only what makes the
 * voice a *piano*: the Salamander sample set, the familiar synth fallback
 * timbre, and the piano volume/FX values. Public API is unchanged.
 */

import {
  createCachedSamplerSync,
  createSampledInstrumentVoice,
  defaultLoadSampler,
  preloadInstrumentSampleBuffers,
  __resetSharedInstrumentBuffers,
} from './sampledInstrumentVoice.js'

export { INSTRUMENT_STATUS, INSTRUMENT_STATUS_LABEL } from './pianoInstrumentStatus.js'
export { defaultLoadSampler, createCachedSamplerSync }

/** Registry id (playback/instrumentVoices.js). */
export const VOICE_ID = 'piano'

/** Public, CORS-enabled Salamander Grand Piano samples (no server required). */
export const DEFAULT_PIANO_SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'

/**
 * Salamander "lite" map: minor-third spacing (A, C, D#, F# per octave).
 *
 * The recorded sample pitches in the Salamander set are A, C, D# (`Ds`) and F#
 * (`Fs`). The KEY of each entry must be the sample's TRUE pitch, because
 * Tone.Sampler pitch-shifts every played note from its nearest key. A previous
 * map mislabeled the D# recordings (`Ds*.mp3`) as `C#`, so a quarter of the
 * keyboard was resampled up to ~2 semitones off-pitch — the piano sounded
 * detuned. Keys now match the filenames (`D#n` → `Dsn.mp3`), so playback is in
 * tune again. Every played note is still within ~1.5 semitones of a recording,
 * and the set stays lazy-loaded (not in the JS bundle).
 */
export const PIANO_SAMPLE_URLS = {
  A0: 'A0.mp3',
  C1: 'C1.mp3',
  'D#1': 'Ds1.mp3',
  'F#1': 'Fs1.mp3',
  A1: 'A1.mp3',
  C2: 'C2.mp3',
  'D#2': 'Ds2.mp3',
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
  C5: 'C5.mp3',
  'D#5': 'Ds5.mp3',
  'F#5': 'Fs5.mp3',
  A5: 'A5.mp3',
  C6: 'C6.mp3',
  'D#6': 'Ds6.mp3',
  'F#6': 'Fs6.mp3',
  A6: 'A6.mp3',
  C7: 'C7.mp3',
  'D#7': 'Ds7.mp3',
  'F#7': 'Fs7.mp3',
  A7: 'A7.mp3',
  C8: 'C8.mp3',
}

const SAMPLED_VOLUME_DB = -11
const SYNTH_VOLUME_DB = -17
const SAMPLED_RELEASE = 1.68
const SAMPLE_ATTACK = 0.003
const PIANO_EFFECTS = {
  reverbDecay: 1.95,
  reverbWet: 0.1,
}

/**
 * Optional self-hosting override. Set VITE_PIANO_SAMPLE_BASE_URL to serve the
 * Salamander samples from your own origin; otherwise the public CDN is used.
 */
function resolveSampleBaseUrl(explicit) {
  if (explicit) {
    return explicit
  }
  try {
    const fromEnv = import.meta?.env?.VITE_PIANO_SAMPLE_BASE_URL
    if (fromEnv) {
      return fromEnv
    }
  } catch {
    // import.meta.env is unavailable outside a bundler context; ignore.
  }
  return DEFAULT_PIANO_SAMPLE_BASE_URL
}

/**
 * The fallback voice: the existing oscillator "piano". Kept deliberately
 * identical to the previous timbre so the fallback sounds exactly like today's
 * playback — no regression when samples are unavailable.
 */
function createSynthVoice(tone, { volume = SYNTH_VOLUME_DB } = {}) {
  const filter = new tone.Filter({ type: 'lowpass', frequency: 2400, rolloff: -24 })
  const chorus = new tone.Chorus({ frequency: 0.38, delayTime: 3.6, depth: 0.14, wet: 0.1 })
  let chorusStarted = false
  const ensureChorusRunning = () => {
    if (!chorusStarted) {
      chorus.start?.()
      chorusStarted = true
    }
  }

  // AMSynth-style envelope: warmer body, softer attack than a bare oscillator.
  const SynthVoice = tone.AMSynth ?? tone.Synth
  const synth = new tone.PolySynth({ voice: SynthVoice, maxPolyphony: 72 })
  synth.set?.({
    volume,
    harmonicity: tone.AMSynth ? 2.4 : undefined,
    oscillator: { type: tone.AMSynth ? 'sine' : 'triangle8' },
    envelope: { attack: 0.018, decay: 1.85, sustain: 0.14, release: 1.1 },
    modulation: tone.AMSynth ? { type: 'triangle' } : undefined,
    modulationEnvelope: tone.AMSynth
      ? { attack: 0.004, decay: 0.28, sustain: 0, release: 0.12 }
      : undefined,
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
 * Fetch/decode piano samples without creating synth nodes or connecting audio output.
 * Safe before user gesture — buffers decode while the context is suspended.
 */
export async function preloadPianoSampleBuffers({
  tone,
  sampleBaseUrl,
  sampleUrls = PIANO_SAMPLE_URLS,
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
export const preloadSampleBuffers = preloadPianoSampleBuffers

/**
 * Create a piano voice. Options mirror createSampledInstrumentVoice; the
 * sample set, fallback synth, and volumes default to the piano values.
 */
export function createPianoInstrument(options = {}) {
  const {
    sampleBaseUrl,
    sampleUrls = PIANO_SAMPLE_URLS,
    sampledVolume = SAMPLED_VOLUME_DB,
    synthVolume = SYNTH_VOLUME_DB,
    effects = {},
    ...rest
  } = options

  return createSampledInstrumentVoice({
    ...rest,
    sampleBaseUrl: resolveSampleBaseUrl(sampleBaseUrl),
    sampleUrls,
    sampledVolume,
    synthVolume,
    sampledRelease: SAMPLED_RELEASE,
    sampleAttack: SAMPLE_ATTACK,
    effects: { ...PIANO_EFFECTS, ...effects },
    createFallbackVoice: createSynthVoice,
  })
}

/** Canonical (instrument-agnostic) factory name used by the voice registry. */
export const createInstrumentVoice = createPianoInstrument

/** Test/inspection helper: clear the shared decoded-buffer cache. */
export function __resetSharedPianoBuffers() {
  __resetSharedInstrumentBuffers()
}

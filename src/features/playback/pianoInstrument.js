/**
 * Piano instrument abstraction.
 *
 * The whole point of this module is to give playback a *real* piano timbre
 * (sampled grand piano) while never blocking or breaking if the samples can't
 * be fetched. It exposes a tiny interface — `triggerAttackRelease`,
 * `releaseAll`, an `output` node, a `status`, and `dispose` — so the playback
 * engines can swap their oscillator voice for it without changing any timing,
 * tempo, loop, mute, or audio-unlock logic.
 *
 * Behaviour:
 *   - A lightweight synth voice (the previous oscillator timbre) is wired up
 *     immediately, so the very first note always sounds — even before samples
 *     load and even if they never do. This is what keeps the Safari/iPad
 *     "unlock on first Play tap" path working unchanged.
 *   - A sampled grand piano (Tone.Sampler) is loaded lazily, only when an
 *     instrument is created (i.e. on first playback), never at app start.
 *   - Once samples finish decoding, note routing switches to the sampler.
 *   - If loading fails or times out, it stays on the synth and reports an
 *     honest fallback status.
 *
 * `tone` is injected (the engines pass the real Tone module). This module never
 * imports Tone itself, which keeps it pure and unit-testable without an
 * AudioContext.
 */

export const INSTRUMENT_STATUS = {
  LOADING: 'loading',
  SAMPLED: 'sampled',
  SYNTH: 'synth',
}

export const INSTRUMENT_STATUS_LABEL = {
  [INSTRUMENT_STATUS.LOADING]: 'Loading piano samples…',
  [INSTRUMENT_STATUS.SAMPLED]: 'Piano samples loaded',
  [INSTRUMENT_STATUS.SYNTH]: 'Using basic synth fallback',
}

/** Public, CORS-enabled Salamander Grand Piano samples (no server required). */
export const DEFAULT_PIANO_SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'

/**
 * A balanced subset of the Salamander grand piano: two samples per octave
 * (C and F#, a tritone apart) plus the extreme A0/C8. Tone.Sampler pitch-shifts
 * between samples, so every played note is at most ~3 semitones (a minor third)
 * from a real recording — the fidelity sweet spot — while fetching roughly half
 * the files of the full set. Samples are lazy, so this never affects the JS
 * bundle, only a one-time fetch on first playback.
 */
export const PIANO_SAMPLE_URLS = {
  A0: 'A0.mp3',
  C1: 'C1.mp3',
  'F#1': 'Fs1.mp3',
  C2: 'C2.mp3',
  'F#2': 'Fs2.mp3',
  C3: 'C3.mp3',
  'F#3': 'Fs3.mp3',
  C4: 'C4.mp3',
  'F#4': 'Fs4.mp3',
  C5: 'C5.mp3',
  'F#5': 'Fs5.mp3',
  C6: 'C6.mp3',
  'F#6': 'Fs6.mp3',
  C7: 'C7.mp3',
  'F#7': 'Fs7.mp3',
  C8: 'C8.mp3',
}

const DEFAULT_SAMPLE_LOAD_TIMEOUT_MS = 12000
const SAMPLED_VOLUME_DB = -8
const SYNTH_VOLUME_DB = -14

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

// Decoded sample buffers are shared across every instrument (e.g. each MIDI
// track) and across re-creations, keyed by base URL. They are fetched and
// decoded exactly once; subsequent Samplers are built from memory.
const sharedBufferPromises = new Map()
const sharedBuffersResolved = new Map()

function loadSharedBuffers({ tone, baseUrl, urls, timeoutMs }) {
  if (sharedBufferPromises.has(baseUrl)) {
    return sharedBufferPromises.get(baseUrl)
  }

  const promise = new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(
      () => finish(reject, new Error('piano sample load timed out')),
      timeoutMs ?? DEFAULT_SAMPLE_LOAD_TIMEOUT_MS,
    )

    try {
      const buffers = new tone.ToneAudioBuffers({
        urls,
        baseUrl,
        onload: () => finish(resolve, buffers),
        onerror: (err) => finish(reject, err ?? new Error('piano sample load failed')),
      })
    } catch (err) {
      finish(reject, err)
    }
  }).then((buffers) => {
    sharedBuffersResolved.set(baseUrl, buffers)
    return buffers
  })

  // Do not cache a rejected load — allow a later attempt to retry the fetch.
  promise.catch(() => {
    if (sharedBufferPromises.get(baseUrl) === promise) {
      sharedBufferPromises.delete(baseUrl)
    }
  })

  sharedBufferPromises.set(baseUrl, promise)
  return promise
}

function buildSamplerFromBuffers({ tone, buffers, urls, volume, release }) {
  const bufferUrls = {}
  for (const note of Object.keys(urls)) {
    bufferUrls[note] = buffers.get(note)
  }
  return new tone.Sampler({
    urls: bufferUrls,
    release: release ?? 0.9,
    volume: volume ?? SAMPLED_VOLUME_DB,
  })
}

/**
 * Default sampler loader: resolves the shared decoded buffers, then builds a
 * Tone.Sampler from them (instant, no extra network). Returns a promise so the
 * instrument can fall back to the synth on rejection.
 */
export async function defaultLoadSampler({ tone, baseUrl, urls, volume, release, timeoutMs }) {
  const buffers = await loadSharedBuffers({ tone, baseUrl, urls, timeoutMs })
  return buildSamplerFromBuffers({ tone, buffers, urls, volume, release })
}

/**
 * Synchronous fast path: if the samples for this base URL are already decoded
 * (a previous instrument loaded them), build a Sampler immediately so playback
 * is sampled from the very first scheduled note — no synth-first window and no
 * status flash. Returns null when nothing is cached yet.
 */
export function createCachedSamplerSync({ tone, baseUrl, urls, volume, release }) {
  const buffers = sharedBuffersResolved.get(baseUrl)
  if (!buffers) {
    return null
  }
  return buildSamplerFromBuffers({ tone, buffers, urls, volume, release })
}

/**
 * The fallback voice: the existing oscillator "piano". Kept deliberately
 * identical to the previous timbre so the fallback sounds exactly like today's
 * playback — no regression when samples are unavailable.
 */
function createSynthVoice(tone, { volume = SYNTH_VOLUME_DB } = {}) {
  const filter = new tone.Filter({ type: 'lowpass', frequency: 3800, rolloff: -12 })
  const chorus = new tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.12, wet: 0.08 })
  chorus.start?.()

  const synth = new tone.PolySynth({ voice: tone.Synth, maxPolyphony: 24 })
  synth.set?.({
    volume,
    oscillator: { type: 'triangle8' },
    envelope: { attack: 0.006, decay: 2.2, sustain: 0.0, release: 0.35 },
  })

  synth.connect(filter)
  filter.connect(chorus)

  return {
    triggerAttackRelease: (note, duration, time, velocity) =>
      synth.triggerAttackRelease(note, duration, time, velocity),
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
 * Create a piano instrument.
 *
 * @param {object} options
 * @param {object} options.tone           Tone module (injected by the engine).
 * @param {function} [options.onStatus]   Called with INSTRUMENT_STATUS on change.
 * @param {string} [options.sampleBaseUrl] Override the sample base URL.
 * @param {object} [options.sampleUrls]   Override the note→file map.
 * @param {function} [options.loadSampler] Override the sampler loader (tests).
 * @param {boolean} [options.autoload]    Start loading samples immediately.
 * @param {number} [options.sampledVolume] dB for the sampled piano.
 * @param {number} [options.synthVolume]  dB for the synth fallback.
 */
export function createPianoInstrument(options = {}) {
  const {
    tone,
    onStatus = null,
    sampleBaseUrl,
    sampleUrls = PIANO_SAMPLE_URLS,
    loadSampler = defaultLoadSampler,
    createSamplerSync = createCachedSamplerSync,
    autoload = true,
    sampledVolume = SAMPLED_VOLUME_DB,
    synthVolume = SYNTH_VOLUME_DB,
    sampleLoadTimeoutMs,
  } = options

  if (!tone) {
    throw new Error('createPianoInstrument requires a `tone` backend')
  }

  // Everything routes into this single output node. The engines connect it to
  // their existing per-voice / per-track gain, so all mute / volume / routing
  // behaviour is unchanged by construction.
  const output = new tone.Gain(1)

  // Gentle shared ambience for both the synth and the sampler. Low wet so it
  // never smears the note attack.
  const reverb = new tone.Reverb({ decay: 2.2, wet: 0.18 })
  reverb.generate?.()
  reverb.connect(output)

  const synthVoice = createSynthVoice(tone, { volume: synthVolume })
  synthVoice.connect(reverb)

  let sampler = null
  let usingSampler = false
  let disposed = false
  let status = INSTRUMENT_STATUS.LOADING
  let readyPromise = null

  const setStatus = (next) => {
    if (status === next) {
      return
    }
    status = next
    if (onStatus) {
      try {
        onStatus(next)
      } catch {
        // A listener error must never break audio.
      }
    }
  }

  // Synchronous fast path: if samples are already decoded from a prior
  // instrument, attach the sampler now so the very first note is sampled.
  if (createSamplerSync) {
    try {
      const cached = createSamplerSync({
        tone,
        baseUrl: resolveSampleBaseUrl(sampleBaseUrl),
        urls: sampleUrls,
        volume: sampledVolume,
      })
      if (cached) {
        sampler = cached
        sampler.connect(reverb)
        usingSampler = true
        status = INSTRUMENT_STATUS.SAMPLED
        readyPromise = Promise.resolve(INSTRUMENT_STATUS.SAMPLED)
      }
    } catch {
      // Fall through to the async load below.
    }
  }

  // Emit the initial status so a listener can show it right away.
  if (onStatus) {
    try {
      onStatus(status)
    } catch {
      // ignore
    }
  }

  function load() {
    if (readyPromise) {
      return readyPromise
    }
    setStatus(INSTRUMENT_STATUS.LOADING)

    readyPromise = Promise.resolve()
      .then(() =>
        loadSampler({
          tone,
          baseUrl: resolveSampleBaseUrl(sampleBaseUrl),
          urls: sampleUrls,
          volume: sampledVolume,
          timeoutMs: sampleLoadTimeoutMs,
        }),
      )
      .then((loaded) => {
        if (disposed) {
          loaded?.dispose?.()
          return INSTRUMENT_STATUS.SYNTH
        }
        sampler = loaded
        sampler.connect(reverb)
        usingSampler = true
        setStatus(INSTRUMENT_STATUS.SAMPLED)
        return INSTRUMENT_STATUS.SAMPLED
      })
      .catch(() => {
        if (!disposed) {
          setStatus(INSTRUMENT_STATUS.SYNTH)
        }
        return INSTRUMENT_STATUS.SYNTH
      })

    return readyPromise
  }

  if (autoload && !usingSampler) {
    // Kick off the lazy sample load now (no-op if the sync fast path already
    // attached a cached sampler). load() is fully error-guarded, so this never
    // throws into the caller; the synth voice covers playback meanwhile.
    load()
  }

  return {
    output,
    get status() {
      return status
    },
    isUsingSampler: () => usingSampler,
    load,
    whenReady: () => readyPromise ?? Promise.resolve(status),
    triggerAttackRelease(note, duration, time, velocity) {
      if (disposed) {
        return
      }
      const target = usingSampler && sampler ? sampler : synthVoice
      target.triggerAttackRelease(note, duration, time, velocity)
    },
    releaseAll(time) {
      synthVoice.releaseAll(time)
      sampler?.releaseAll?.(time)
    },
    setSampledVolume(db) {
      if (sampler?.volume) {
        sampler.volume.value = db
      }
    },
    dispose() {
      disposed = true
      synthVoice.dispose()
      sampler?.dispose?.()
      reverb.dispose?.()
      output.dispose?.()
    },
  }
}

/** Test/inspection helper: clear the shared decoded-buffer cache. */
export function __resetSharedPianoBuffers() {
  sharedBufferPromises.clear()
}

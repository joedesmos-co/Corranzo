/**
 * Generic sampled instrument voice — the engine-facing playback voice shared
 * by every instrument (piano, guitar, and any future addition).
 *
 * Behavior (unchanged from the original piano implementation, now config-driven):
 *   - A lightweight synth fallback voice is wired immediately so the very
 *     first note always sounds — even before samples load, even if they never
 *     do (keeps the Safari/iPad "unlock on first Play tap" path working).
 *   - A Tone.Sampler is loaded lazily from a CORS-enabled sample set; once
 *     decoded, note routing switches to it. Failures/timeouts stay on the
 *     synth with an honest status.
 *   - Decoded buffers are shared process-wide per base URL, so re-created
 *     voices (seek/loop flushes) and multiple tracks never re-fetch.
 *
 * The exposed interface is the engine contract: `triggerAttackRelease`,
 * `triggerRelease` (via plan releases), `releaseAll`, `output`, `status`,
 * `load`/`whenReady`, `dispose`. Engines never see instrument specifics.
 *
 * `tone` is injected so the module stays lazy and unit-testable without an
 * AudioContext.
 */

import { INSTRUMENT_STATUS } from './instrumentVoiceStatus.js'
import { PLAYBACK_MASTER_FX, SAMPLER_WARMTH_FILTER_HZ } from './playbackAudioConfig.js'
import {
  createVoiceMixState,
  getVoiceMixDiagnostics,
  planNoteTrigger,
  pruneVoices,
  releaseVoiceFromMix,
  resetVoiceMix,
} from './pianoVoiceMix.js'
import {
  logPianoDiagnostics,
  warnDensePlayback,
  logPianoAudioEngine,
  logPianoTrigger,
  logPianoSampleFallback,
} from './pianoPlaybackDiagnostics.js'

const DEFAULT_SAMPLE_LOAD_TIMEOUT_MS = 15000
const DEFAULT_SAMPLED_RELEASE = 1.55
const DEFAULT_SAMPLE_ATTACK = 0.004
const RELEASE_FADE_SECONDS = 0.055

/** Master FX defaults — see playbackAudioConfig.js for the canonical values. */
const DEFAULT_EFFECTS = { ...PLAYBACK_MASTER_FX }

// Decoded sample buffers are shared across every voice instance and across
// re-creations, keyed by base URL (one entry per instrument sample set).
const sharedBufferPromises = new Map()
const sharedBuffersResolved = new Map()

export function loadSharedBuffers({ tone, baseUrl, urls, timeoutMs }) {
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
      () => finish(reject, new Error('instrument sample load timed out')),
      timeoutMs ?? DEFAULT_SAMPLE_LOAD_TIMEOUT_MS,
    )

    try {
      const buffers = new tone.ToneAudioBuffers({
        urls,
        baseUrl,
        onload: () => finish(resolve, buffers),
        onerror: (err) => finish(reject, err ?? new Error('instrument sample load failed')),
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

function buildSamplerFromBuffers({ tone, buffers, urls, volume, release, attack }) {
  const bufferUrls = {}
  for (const note of Object.keys(urls)) {
    bufferUrls[note] = buffers.get(note)
  }
  return new tone.Sampler({
    urls: bufferUrls,
    release: release ?? DEFAULT_SAMPLED_RELEASE,
    attack: attack ?? DEFAULT_SAMPLE_ATTACK,
    curve: 'exponential',
    volume,
  })
}

function compactOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const out = {}
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined) {
      continue
    }
    out[key] = compactOptions(nested)
  }
  return out
}

/**
 * Polyphonic wrapper for synth fallbacks. Tone.PolySynth only accepts voices
 * that extend Tone.Monophonic; PluckSynth intentionally does not. Try the
 * native route first, then fall back to a tiny voice pool for non-Monophonic
 * triggerAttack/triggerAttackRelease instruments.
 */
export function createPolyphonicFallbackVoice(
  tone,
  { voice, maxPolyphony = 16, voiceOptions = {} } = {},
) {
  if (!tone || typeof voice !== 'function') {
    throw new Error('createPolyphonicFallbackVoice requires a Tone voice constructor')
  }

  const options = compactOptions(voiceOptions) ?? {}
  if (typeof tone.PolySynth === 'function') {
    try {
      const poly = new tone.PolySynth({ voice, maxPolyphony })
      poly.set?.(options)
      return poly
    } catch (error) {
      const message = error?.message ?? ''
      if (!/Monophonic/i.test(message)) {
        throw error
      }
    }
  }

  let destination = null
  let nextIndex = 0
  const slots = []

  function createSlot() {
    const instance = new voice()
    instance.set?.(options)
    if (destination) {
      instance.connect?.(destination)
    }
    const slot = { instance, note: null, busyUntil: 0 }
    slots.push(slot)
    return slot
  }

  function selectSlot(time = 0) {
    const at = Number.isFinite(Number(time)) ? Number(time) : 0
    const free = slots.find((slot) => slot.busyUntil <= at)
    if (free) {
      return free
    }
    if (slots.length < maxPolyphony) {
      return createSlot()
    }
    const slot = slots[nextIndex % slots.length]
    nextIndex += 1
    return slot
  }

  function releaseSlot(slot, time) {
    slot.instance.triggerRelease?.(slot.note, time)
    slot.note = null
    slot.busyUntil = 0
  }

  return {
    set(nextOptions) {
      Object.assign(options, compactOptions(nextOptions) ?? {})
      for (const slot of slots) {
        slot.instance.set?.(options)
      }
    },
    connect(nextDestination) {
      destination = nextDestination
      for (const slot of slots) {
        slot.instance.connect?.(nextDestination)
      }
      return nextDestination
    },
    triggerAttackRelease(note, duration, time, velocity) {
      const slot = selectSlot(time)
      const safeDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : 0
      if (slot.note != null && slot.instance.triggerRelease) {
        releaseSlot(slot, time)
      }
      slot.note = note
      slot.busyUntil = (Number.isFinite(Number(time)) ? Number(time) : 0) + safeDuration
      if (slot.instance.triggerAttackRelease) {
        slot.instance.triggerAttackRelease(note, duration, time, velocity)
      } else {
        slot.instance.triggerAttack?.(note, time, velocity)
      }
    },
    triggerAttack(note, time, velocity) {
      const slot = selectSlot(time)
      if (slot.note != null && slot.instance.triggerRelease) {
        releaseSlot(slot, time)
      }
      slot.note = note
      slot.busyUntil = Infinity
      slot.instance.triggerAttack?.(note, time, velocity)
    },
    triggerRelease(note, time) {
      for (const slot of slots) {
        if (slot.note === note) {
          releaseSlot(slot, time)
        }
      }
    },
    releaseAll(time) {
      for (const slot of slots) {
        if (slot.note != null || slot.busyUntil > 0) {
          releaseSlot(slot, time)
        }
        slot.instance.releaseAll?.(time)
      }
    },
    dispose() {
      for (const slot of slots) {
        slot.instance.dispose?.()
      }
      slots.length = 0
    },
  }
}

function countLoadedBuffers(buffers, urls) {
  let loaded = 0
  let missing = 0
  for (const note of Object.keys(urls ?? {})) {
    try {
      const buffer = buffers?.get?.(note)
      if (buffer) {
        loaded += 1
      } else {
        missing += 1
      }
    } catch {
      missing += 1
    }
  }
  return { loaded, missing }
}

/**
 * Default sampler loader: resolves the shared decoded buffers, then builds a
 * Tone.Sampler from them (instant, no extra network). Returns a promise so the
 * voice can fall back to the synth on rejection.
 * Retries `fallbackBaseUrl` once when the primary base URL fails.
 */
export async function defaultLoadSampler({
  tone,
  baseUrl,
  urls,
  volume,
  release,
  attack,
  timeoutMs,
  fallbackBaseUrl = null,
}) {
  try {
    const buffers = await loadSharedBuffers({ tone, baseUrl, urls, timeoutMs })
    return {
      sampler: buildSamplerFromBuffers({ tone, buffers, urls, volume, release, attack }),
      baseUrl,
      buffers,
    }
  } catch (primaryError) {
    if (!fallbackBaseUrl || fallbackBaseUrl === baseUrl) {
      throw primaryError
    }
    const buffers = await loadSharedBuffers({
      tone,
      baseUrl: fallbackBaseUrl,
      urls,
      timeoutMs,
    })
    return {
      sampler: buildSamplerFromBuffers({ tone, buffers, urls, volume, release, attack }),
      baseUrl: fallbackBaseUrl,
      buffers,
      primaryError,
    }
  }
}

/**
 * Fetch/decode an instrument's samples without creating synth nodes or
 * touching audio output. Safe before user gesture — buffers decode while the
 * context is suspended.
 */
export async function preloadInstrumentSampleBuffers({ tone, baseUrl, urls, timeoutMs } = {}) {
  if (!tone || !baseUrl || !urls) {
    return
  }
  try {
    await loadSharedBuffers({ tone, baseUrl, urls, timeoutMs })
  } catch {
    // Non-fatal — playback falls back to the synth voice.
  }
}

/**
 * Synchronous fast path: if the samples for this base URL are already decoded,
 * build a Sampler immediately so playback is sampled from the very first
 * scheduled note. Returns null when nothing is cached yet.
 */
export function createCachedSamplerSync({ tone, baseUrl, urls, volume, release, attack }) {
  const buffers = sharedBuffersResolved.get(baseUrl)
  if (!buffers) {
    return null
  }
  return buildSamplerFromBuffers({ tone, buffers, urls, volume, release, attack })
}

/**
 * Create a sampled instrument voice.
 *
 * @param {object} options
 * @param {object} options.tone            Tone module (injected by the engine).
 * @param {function} options.createFallbackVoice  (tone, { volume }) → synth voice.
 * @param {string} options.sampleBaseUrl   Resolved sample base URL.
 * @param {object} options.sampleUrls      Note → file map (keys = true pitches).
 * @param {function} [options.onStatus]    Called with INSTRUMENT_STATUS on change.
 * @param {function} [options.loadSampler] Override the sampler loader (tests).
 * @param {function} [options.createSamplerSync] Override the sync fast path.
 * @param {boolean} [options.autoload]     Start loading samples immediately.
 * @param {number} [options.sampledVolume] dB for the sampled voice.
 * @param {number} [options.synthVolume]   dB for the synth fallback.
 * @param {number} [options.sampledRelease] Sampler release seconds.
 * @param {number} [options.sampleAttack]  Sampler attack seconds.
 * @param {object} [options.effects]       FX-chain overrides (see DEFAULT_EFFECTS).
 * @param {function} [options.logDiagnostics] Dev diagnostics logger.
 * @param {function} [options.warnDense]   Dev dense-passage warner.
 */
export function createSampledInstrumentVoice(options = {}) {
  const {
    tone,
    onStatus = null,
    createFallbackVoice,
    sampleBaseUrl,
    sampleFallbackBaseUrl = null,
    sampleUrls,
    sampleSetName = 'samples',
    voiceId = 'instrument',
    velocityLayers = 1,
    loadSampler = defaultLoadSampler,
    createSamplerSync = createCachedSamplerSync,
    autoload = true,
    sampledVolume,
    synthVolume,
    sampledRelease,
    sampleAttack,
    sampleLoadTimeoutMs,
    effects: effectsOverride = {},
    logDiagnostics = logPianoDiagnostics,
    warnDense = warnDensePlayback,
  } = options

  if (!tone) {
    throw new Error('createSampledInstrumentVoice requires a `tone` backend')
  }
  if (typeof createFallbackVoice !== 'function') {
    throw new Error('createSampledInstrumentVoice requires a `createFallbackVoice` factory')
  }

  const effects = { ...DEFAULT_EFFECTS, ...effectsOverride }

  // Everything routes into this single output node. The engines connect it to
  // their existing per-voice / per-track gain, so all mute / volume / routing
  // behaviour is unchanged by construction.
  const output = new tone.Gain(1)
  const voiceMix = createVoiceMixState()

  const compressor = new tone.Compressor({
    threshold: effects.compressorThreshold,
    ratio: effects.compressorRatio,
    attack: effects.compressorAttack,
    release: effects.compressorRelease,
    knee: effects.compressorKnee,
  })
  const limiter = new tone.Limiter(effects.limiterDb)

  // Gentle shared ambience. Low wet so dense chords stay clear.
  const reverb = new tone.Reverb({ decay: effects.reverbDecay, wet: effects.reverbWet })
  const masterTrim = new tone.Gain(effects.trimGain)
  let reverbReady = Promise.resolve()
  try {
    const generated = reverb.generate?.()
    if (generated && typeof generated.then === 'function') {
      reverbReady = generated
    }
  } catch {
    // Impulse generation is optional; dry path still works.
  }
  const samplerToneFilter = new tone.Filter({
    type: 'lowpass',
    frequency: effects.samplerWarmthHz ?? SAMPLER_WARMTH_FILTER_HZ,
    rolloff: -12,
  })
  samplerToneFilter.connect(reverb)
  reverb.connect(masterTrim)
  masterTrim.connect(compressor)
  compressor.connect(limiter)
  limiter.connect(output)

  const synthVoice = createFallbackVoice(tone, { volume: synthVolume })
  // Share the warmth filter with the sampler so the fallback is less beep-like.
  synthVoice.connect(samplerToneFilter)

  function connectSamplerToChain(nextSampler) {
    nextSampler.connect(samplerToneFilter)
  }

  let sampler = null
  let usingSampler = false
  let disposed = false
  let status = INSTRUMENT_STATUS.LOADING
  let readyPromise = null
  let activeSampleBaseUrl = sampleBaseUrl
  let lastLoadError = null
  let loadedSampleCount = 0
  let missingSampleCount = Object.keys(sampleUrls ?? {}).length
  let nextVoiceSerial = 0

  function audioContextState() {
    try {
      return tone.getContext?.()?.rawContext?.state ?? tone.context?.state ?? null
    } catch {
      return null
    }
  }

  function reportEngine(extra = {}) {
    logPianoAudioEngine({
      engineType: usingSampler ? 'sampler' : status === INSTRUMENT_STATUS.LOADING ? 'loading' : 'synth',
      sampleSet: sampleSetName,
      sampleLoadState: status,
      loadedSampleCount,
      missingSampleCount,
      velocityLayers,
      audioContextState: audioContextState(),
      sampleBaseUrl: activeSampleBaseUrl,
      loadError: lastLoadError,
      ...extra,
    })
  }

  const setStatus = (next) => {
    if (status === next) {
      return
    }
    status = next
    reportEngine()
    if (onStatus) {
      try {
        onStatus(next)
      } catch {
        // A listener error must never break audio.
      }
    }
  }

  // Synchronous fast path: if samples are already decoded from a prior voice,
  // attach the sampler now so the very first note is sampled.
  if (createSamplerSync) {
    try {
      const cached = createSamplerSync({
        tone,
        baseUrl: sampleBaseUrl,
        urls: sampleUrls,
        volume: sampledVolume,
        release: sampledRelease,
        attack: sampleAttack,
      })
      if (cached) {
        sampler = cached
        connectSamplerToChain(sampler)
        usingSampler = true
        const buffers = sharedBuffersResolved.get(sampleBaseUrl)
        const counts = countLoadedBuffers(buffers, sampleUrls)
        loadedSampleCount = counts.loaded
        missingSampleCount = counts.missing
        status = INSTRUMENT_STATUS.SAMPLED
        readyPromise = Promise.resolve(INSTRUMENT_STATUS.SAMPLED)
      }
    } catch {
      // Fall through to the async load below.
    }
  }

  // Emit the initial status so a listener can show it right away.
  reportEngine()
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

    let samplerLoad
    try {
      // Invoke the loader now, rather than in a later microtask. This starts the
      // sample request as soon as playback creates the voice while still routing
      // the first notes through the already-connected synth fallback.
      samplerLoad = loadSampler({
        tone,
        baseUrl: sampleBaseUrl,
        fallbackBaseUrl: sampleFallbackBaseUrl,
        urls: sampleUrls,
        volume: sampledVolume,
        release: sampledRelease,
        attack: sampleAttack,
        timeoutMs: sampleLoadTimeoutMs,
      })
    } catch (error) {
      samplerLoad = Promise.reject(error)
    }

    readyPromise = Promise.resolve(samplerLoad)
      .then(async (loaded) => {
        if (disposed) {
          const disposable = loaded?.sampler ?? loaded
          disposable?.dispose?.()
          return INSTRUMENT_STATUS.SYNTH
        }
        // Support both legacy (Sampler) and new ({ sampler, buffers, baseUrl }) loaders.
        if (loaded?.sampler) {
          sampler = loaded.sampler
          activeSampleBaseUrl = loaded.baseUrl ?? sampleBaseUrl
          const counts = countLoadedBuffers(loaded.buffers, sampleUrls)
          loadedSampleCount = counts.loaded
          missingSampleCount = counts.missing
          if (loaded.primaryError) {
            lastLoadError = String(loaded.primaryError?.message ?? loaded.primaryError)
            logPianoSampleFallback('primary sample base failed; using fallback URL', {
              primaryBaseUrl: sampleBaseUrl,
              fallbackBaseUrl: activeSampleBaseUrl,
              reason: lastLoadError,
            })
          }
        } else {
          sampler = loaded
          activeSampleBaseUrl = sampleBaseUrl
          const buffers = sharedBuffersResolved.get(sampleBaseUrl)
          const counts = countLoadedBuffers(buffers, sampleUrls)
          loadedSampleCount = counts.loaded
          missingSampleCount = counts.missing
        }
        connectSamplerToChain(sampler)
        usingSampler = true
        await reverbReady
        setStatus(INSTRUMENT_STATUS.SAMPLED)
        return INSTRUMENT_STATUS.SAMPLED
      })
      .catch((error) => {
        lastLoadError = String(error?.message ?? error ?? 'sample load failed')
        logPianoSampleFallback(lastLoadError, {
          sampleBaseUrl,
          sampleFallbackBaseUrl,
        })
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
    getLastLoadError: () => lastLoadError,
    getSampleCoverage: () => ({
      loadedSampleCount,
      missingSampleCount,
      sampleBaseUrl: activeSampleBaseUrl,
      sampleSet: sampleSetName,
      velocityLayers,
    }),
    load,
    whenReady: async () => {
      const base = await (readyPromise ?? Promise.resolve(status))
      await reverbReady
      return base
    },
    triggerAttackRelease(note, duration, time, velocity, meta = {}) {
      if (disposed) {
        return
      }
      const safeDuration = Math.max(duration, 0.03)
      pruneVoices(voiceMix, time)
      const plan = planNoteTrigger(voiceMix, {
        time,
        velocity,
        duration: safeDuration,
        note,
      })
      if (plan.skipped) {
        return
      }
      const target = usingSampler && sampler ? sampler : synthVoice
      for (const release of plan.release ?? []) {
        target.triggerRelease?.(release.note, release.time)
      }
      nextVoiceSerial += 1
      const assignedVoiceId = `${voiceId}-${nextVoiceSerial}`
      target.triggerAttackRelease(note, safeDuration, time, plan.velocity)
      logPianoTrigger({
        midi: meta.midi ?? null,
        velocity: plan.velocity,
        performedOnset: time,
        performedDuration: safeDuration,
        sampleSelected: usingSampler ? note : 'synth',
        velocityLayer: 0,
        gain: plan.velocity,
        attack: sampleAttack,
        release: sampledRelease,
        tieChainId: meta.tieChainId ?? null,
        voiceId: assignedVoiceId,
        engineType: usingSampler ? 'sampler' : 'synth',
      })
      const diagnostics = getVoiceMixDiagnostics(voiceMix)
      if (plan.density >= 6) {
        logDiagnostics('dense trigger', {
          note,
          density: plan.density,
          velocity: plan.velocity,
          ...diagnostics,
        })
      }
      if (diagnostics.maxSimultaneous >= 8 || diagnostics.voicesStolen > 0) {
        warnDense(diagnostics)
      }
    },
    triggerAttack(note, time, velocity) {
      if (disposed) {
        return
      }
      pruneVoices(voiceMix, time)
      const plan = planNoteTrigger(voiceMix, {
        time,
        velocity,
        duration: 2,
        note,
      })
      if (plan.skipped) {
        return
      }
      const target = usingSampler && sampler ? sampler : synthVoice
      for (const release of plan.release ?? []) {
        target.triggerRelease?.(release.note, release.time)
      }
      target.triggerAttack?.(note, time, plan.velocity)
    },
    triggerRelease(note, time) {
      if (disposed) {
        return
      }
      releaseVoiceFromMix(voiceMix, note, time)
      const target = usingSampler && sampler ? sampler : synthVoice
      target.triggerRelease?.(note, time)
    },
    releaseAll(time) {
      resetVoiceMix(voiceMix)
      const now = typeof time === 'number' ? time : tone.now()
      try {
        masterTrim.gain.cancelScheduledValues(now)
        masterTrim.gain.setValueAtTime(masterTrim.gain.value, now)
        masterTrim.gain.linearRampToValueAtTime(0.001, now + RELEASE_FADE_SECONDS)
        masterTrim.gain.linearRampToValueAtTime(effects.trimGain, now + RELEASE_FADE_SECONDS + 0.06)
      } catch {
        // Non-fatal — release the voices even if the fade cannot be scheduled.
      }
      synthVoice.releaseAll(now)
      sampler?.releaseAll?.(now)
    },
    getVoiceDiagnostics() {
      return {
        ...getVoiceMixDiagnostics(voiceMix),
        engineType: usingSampler ? 'sampler' : 'synth',
        sampleLoadState: status,
        loadedSampleCount,
        missingSampleCount,
        loadError: lastLoadError,
        sampleBaseUrl: activeSampleBaseUrl,
      }
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
      samplerToneFilter.dispose?.()
      reverb.dispose?.()
      masterTrim.dispose?.()
      compressor.dispose?.()
      limiter.dispose?.()
      output.dispose?.()
    },
  }
}

/** Test/inspection helper: clear the shared decoded-buffer cache (all sets). */
export function __resetSharedInstrumentBuffers() {
  sharedBufferPromises.clear()
  sharedBuffersResolved.clear()
}

/**
 * Neural TF.js adapter (Stage 8, L1/L3) — browser only.
 *
 * Lazy-loads @spotify/basic-pitch + TensorFlow.js on first use so the
 * production bundle never pays for them (dynamic import = separate
 * chunk; verified in build output). Model weights ship inside the npm
 * package; their URL is rewritten at runtime to the bundled asset so the
 * graph + shard stay co-located after Vite hashing.
 *
 * Pure helpers (resample, window slicing) are exported for unit tests.
 * Anything touching TF.js or the DOM lives behind the async loader.
 */

export const NEURAL_MODEL_RATE = 22050
export const NEURAL_UNAVAILABLE_MS = 750
export const NEURAL_WARMUP_SECONDS = 0.5
/**
 * Silence-skip floor (measured 2026-10-08 on real clips): true DAT
 * silence sits at rms 0.00014 while the softest verified real note
 * (pp piano) is 0.00445 and quiet electric 0.01276. Below 0.001 there
 * is no musical signal — skipping inference kills room-tone
 * hallucinations at the source and saves the GPU for real audio.
 */
export const NEURAL_SILENCE_SKIP_RMS = 0.001
export const NEURAL_SILENCE_SKIP_FRAMES = 5

/**
 * Silence-skip decision (pure + tested): skip inference only when the
 * last NEURAL_SILENCE_SKIP_FRAMES polls ALL sit below the floor. A
 * single louder poll re-arms immediately (attacks are never skipped).
 */
export function shouldSkipSilence(
  recentRms = [],
  floor = NEURAL_SILENCE_SKIP_RMS,
  frames = NEURAL_SILENCE_SKIP_FRAMES,
) {
  if (!Array.isArray(recentRms) || recentRms.length < frames) {
    return false
  }
  const tail = recentRms.slice(-frames)
  return tail.every((rms) => Number.isFinite(rms) && rms < floor)
}

/**
 * Linear-interpolation downsampler to the model rate. Transparent for
 * already-correct input. Pure + tested.
 */
export function resampleToModelRate(samples, inputSampleRate, targetRate = NEURAL_MODEL_RATE) {
  if (!samples?.length) {
    return new Float32Array(0)
  }
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new TypeError('resampleToModelRate requires a positive input sample rate')
  }
  if (inputSampleRate === targetRate) {
    return Float32Array.from(samples)
  }
  const ratio = inputSampleRate / targetRate
  const outLength = Math.max(1, Math.floor(samples.length / ratio))
  const out = new Float32Array(outLength)
  for (let index = 0; index < outLength; index += 1) {
    const position = index * ratio
    const lower = Math.floor(position)
    const upper = Math.min(samples.length - 1, lower + 1)
    const fraction = position - lower
    out[index] = samples[lower] * (1 - fraction) + samples[upper] * fraction
  }
  return out
}

/**
 * Slice the trailing windowSeconds of audio (zero-padded if short).
 * Pure + tested. Times stay in stream seconds; the caller maps to the
 * capture clock.
 */
export function sliceTrailingWindow(samples, sampleRate, windowSeconds) {
  const windowLength = Math.max(1, Math.floor(windowSeconds * sampleRate))
  const out = new Float32Array(windowLength)
  const available = Math.min(samples.length, windowLength)
  out.set(samples.subarray(samples.length - available), windowLength - available)
  return out
}

let cachedRuntime = null
let cachedModel = null

/**
 * Load TF.js + Basic Pitch lazily. Returns { BasicPitch, tf, modelUrl,
 * model } where model is a ready BasicPitch instance (constructed once
 * and shared — graph compile happens a single time per page load).
 * modelUrl is a Blob URL whose weights resolve to the bundled shard.
 * Never called unless the dev flag enables neural listening.
 */
export async function loadNeuralRuntime({ modelJsonUrl, modelBinUrl, onProgress = null } = {}) {
  if (cachedRuntime) {
    return cachedRuntime
  }
  if (typeof window === 'undefined') {
    throw new Error('loadNeuralRuntime requires a browser environment')
  }
  const [{ BasicPitch }, tfModule] = await Promise.all([
    import('@spotify/basic-pitch'),
    import('@tensorflow/tfjs'),
  ])
  const tf = tfModule?.default ?? tfModule
  if (onProgress) {
    onProgress({ stage: 'framework', done: false })
  }
  await tf.ready()
  const response = await fetch(modelJsonUrl)
  if (!response.ok) {
    throw new Error(`neural model manifest fetch failed (${response.status})`)
  }
  const manifest = await response.json()
  const manifests = Array.isArray(manifest?.weightsManifest) ? manifest.weightsManifest : []
  for (const entry of manifests) {
    entry.paths = (entry.paths ?? []).map(() => modelBinUrl)
  }
  const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }))
  cachedModel = new BasicPitch(blobUrl)
  cachedRuntime = { BasicPitch, tf, modelUrl: blobUrl, model: cachedModel }
  if (onProgress) {
    onProgress({ stage: 'framework', done: true })
  }
  return cachedRuntime
}

/** Test seam: reset the cached runtime between tests. */
export function resetNeuralRuntimeForTests() {
  cachedRuntime = null
  cachedModel = null
}

/**
 * Release model GPU/CPU memory and the manifest Blob URL (M4: the hook
 * calls this on unmount so repeated toggle cycles cannot leak tensors).
 * Safe to call when nothing is loaded.
 */
export function disposeNeuralRuntime() {
  try {
    cachedModel?.dispose?.()
  } catch {
    // Diagnostics only.
  }
  try {
    if (cachedRuntime?.modelUrl != null && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(cachedRuntime.modelUrl)
    }
  } catch {
    // Diagnostics only.
  }
  cachedRuntime = null
  cachedModel = null
}

/**
 * Hardware capability check (L3): warm up on silence, time it, report
 * the executing backend. Returns { backend, warmedMs, ok } — ok means a
 * 0.5 s streaming window infers inside NEURAL_UNAVAILABLE_MS. Callers
 * must fall back to spectral detection when ok is false.
 */
export async function checkNeuralCapability({ modelJsonUrl, modelBinUrl, onProgress = null } = {}) {
  const started = performance.now()
  const { tf, model } = await loadNeuralRuntime({ modelJsonUrl, modelBinUrl, onProgress })
  const silent = new Float32Array(Math.floor(NEURAL_WARMUP_SECONDS * NEURAL_MODEL_RATE))
  const audioBuffer = await renderMonoBuffer(silent, NEURAL_MODEL_RATE)
  const frames = []
  const onsets = []
  const contours = []
  const inferStart = performance.now()
  await model.evaluateModel(audioBuffer, (f, o, c) => {
    frames.push(...f)
    onsets.push(...o)
    contours.push(...c)
  }, () => {})
  const warmedMs = performance.now() - inferStart
  return {
    backend: tf.getBackend(),
    warmedMs: Math.round(warmedMs * 10) / 10,
    startupMs: Math.round((performance.now() - started) * 10) / 10,
    ok: warmedMs <= NEURAL_UNAVAILABLE_MS,
  }
}

async function renderMonoBuffer(samples, sampleRate) {
  const context = new OfflineAudioContext(1, Math.max(1, samples.length), sampleRate)
  const buffer = context.createBuffer(1, Math.max(1, samples.length), sampleRate)
  buffer.getChannelData(0).set(samples.subarray(0, buffer.length))
  return buffer
}

/**
 * Run one streaming window through the model. Returns note events with
 * model-relative offsets: [{ midi, startOffsetSeconds, endOffsetSeconds }].
 * The first argument accepts the loaded runtime ({ model }) or a model
 * instance directly. Threshold parity with the Python benchmark
 * (onset 0.5, frame 0.3).
 */
export async function runNeuralWindow(modelOrRuntime, modelModule, samples22050) {
  const model = modelOrRuntime?.model ?? modelOrRuntime
  if (!model || typeof model.evaluateModel !== 'function') {
    throw new TypeError('runNeuralWindow requires a loaded Basic Pitch model (see loadNeuralRuntime)')
  }
  const audioBuffer = await renderMonoBuffer(samples22050, NEURAL_MODEL_RATE)
  const frames = []
  const onsets = []
  const contours = []
  await model.evaluateModel(audioBuffer, (f, o, c) => {
    frames.push(...f)
    onsets.push(...o)
    contours.push(...c)
  }, () => {})
  const { noteFramesToTime, outputToNotesPoly } = modelModule
  return noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)).map((note) => ({
    midi: Math.round(note.pitchMidi),
    startOffsetSeconds: note.startTimeSeconds,
    endOffsetSeconds: note.startTimeSeconds + note.durationSeconds,
  }))
}

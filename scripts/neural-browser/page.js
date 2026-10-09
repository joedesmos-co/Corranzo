/**
 * Neural browser harness page (Stage 6, N1/N6) — test-only.
 *
 * Query params:
 *   clip=<file.wav>   audio clip to evaluate (required)
 *   chunked=1         also run 2 s / 1 s-hop chunked inference
 *   idbcache=1        also verify IndexedDB model round-trip
 *
 * Writes window.__neuralResults when done { status: 'done' | 'error' }.
 */
import { BasicPitch } from '/tmpvendor/inference.js'
import { noteFramesToTime, outputToNotesPoly } from '/tmpvendor/toMidi.js'

// TensorFlow.js arrives via the classic UMD bundle (window.tf); the vendor
// ESM copies in /tmpvendor/ are rewritten at test setup to default-import
// this same global, so every consumer shares one runtime.
const tf = globalThis.tf

const MODEL_URL = '/vendor/bp/model/model.json'
const MODEL_RATE = 22050

async function decodeToMono(url, rate) {
  const response = await fetch(url)
  const raw = await response.arrayBuffer()
  const decodeCtx = new OfflineAudioContext(1, 1, 44100)
  const decoded = await decodeCtx.decodeAudioData(raw)
  const channel = decoded.getChannelData(0)
  const targetLength = Math.ceil((channel.length / decoded.sampleRate) * rate)
  const renderCtx = new OfflineAudioContext(1, targetLength, rate)
  const source = renderCtx.createBufferSource()
  const mono = renderCtx.createBuffer(1, channel.length, decoded.sampleRate)
  mono.getChannelData(0).set(channel)
  source.buffer = mono
  source.connect(renderCtx.destination)
  source.start(0)
  return renderCtx.startRendering()
}

function notesFromOutputs(frames, onsets) {
  // Threshold parity with the Python benchmark (Stage 5):
  // onset 0.5, frame 0.3, min-note-len 5 frames.
  return noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)).map((note) => ({
    start: note.startTimeSeconds,
    end: note.startTimeSeconds + note.durationSeconds,
    midi: note.pitchMidi,
    amplitude: note.amplitude ?? null,
  }))
}

async function evaluateBuffer(basicPitch, audioBuffer) {
  const frames = []
  const onsets = []
  const contours = []
  const started = performance.now()
  await basicPitch.evaluateModel(
    audioBuffer,
    (f, o, c) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    () => {},
  )
  return { frames, onsets, contours, inferMs: performance.now() - started }
}

async function sliceBuffer(audioBuffer, startSeconds, lengthSeconds) {
  const rate = audioBuffer.sampleRate
  const start = Math.floor(startSeconds * rate)
  const length = Math.min(Math.floor(lengthSeconds * rate), audioBuffer.length - start)
  const ctx = new OfflineAudioContext(1, Math.max(1, length), rate)
  const out = ctx.createBuffer(1, Math.max(1, length), rate)
  out.getChannelData(0).set(audioBuffer.getChannelData(0).subarray(start, start + Math.max(1, length)))
  return out
}

/** Zero-pad a short window up to the model's fixed native input length. */
async function padBuffer(audioBuffer, targetLength) {
  if (audioBuffer.length >= targetLength) {
    return audioBuffer
  }
  const ctx = new OfflineAudioContext(1, targetLength, audioBuffer.sampleRate)
  const out = ctx.createBuffer(1, targetLength, audioBuffer.sampleRate)
  out.getChannelData(0).set(audioBuffer.getChannelData(0), 0)
  return out
}

async function main() {
  const params = new URLSearchParams(location.search)
  const clip = params.get('clip')
  const heap0 = performance.memory?.usedJSHeapSize ?? null
  try {
    await tf.ready()
    // Optional ?backend=webgl|cpu|wasm override for measurement; default
    // lets TF.js choose (and records what actually executed — never assume).
    // WASM loads its backend bundle on demand, then points at the SIMD
    // binaries served alongside it.
    const wantBackend = params.get('backend')
    if (wantBackend === 'wasm') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = '/vendor/wasm/dist/tf-backend-wasm.es2017.js'
        script.onload = resolve
        script.onerror = () => reject(new Error('wasm backend bundle failed'))
        document.head.appendChild(script)
      })
      globalThis.tf.wasm.setWasmPaths('/vendor/wasm/dist/')
      await tf.setBackend('wasm')
    } else if (wantBackend) {
      await tf.setBackend(wantBackend)
    }
    const backend = tf.getBackend()
    const loadStart = performance.now()
    const basicPitch = new BasicPitch(MODEL_URL)
    // First inference includes fetch + graph compile (cold start).
    const pool = params.get('pool') === 'control' ? 'control' : 'clip'
    const audioBuffer = await decodeToMono(`/${pool}/${clip}`, MODEL_RATE)
    const full = await evaluateBuffer(basicPitch, audioBuffer)
    const initMs = performance.now() - loadStart
    const fullNotes = notesFromOutputs(full.frames, full.onsets)

    let chunked = null
    if (params.get('chunked') === '1') {
      // Window experiment (Stage 7, M3): ?window=0.5|1|2 seconds, hop =
      // half the window. Shorter-than-native windows are zero-padded to
      // the model's fixed 43844-sample input — padding is part of what is
      // being measured (edge artifacts included, honestly).
      const windowSeconds = Math.min(2.0, Math.max(0.25, Number(params.get('window') ?? 2.0) || 2.0))
      const hopSeconds = windowSeconds / 2
      const padLength = 43844
      const duration = audioBuffer.duration
      const windows = []
      for (let start = 0; start + 0.25 <= duration + 0.001; start += hopSeconds) {
        const sliced = await sliceBuffer(audioBuffer, start, Math.min(windowSeconds, duration - start))
        const padded = await padBuffer(sliced, padLength)
        const result = await evaluateBuffer(basicPitch, padded)
        windows.push({
          windowStartSeconds: Math.round(start * 1000) / 1000,
          windowSeconds,
          inferMs: result.inferMs,
          notes: notesFromOutputs(result.frames, result.onsets),
        })
      }
      chunked = { windowSeconds, hopSeconds, windows }
    }

    let idbCache = null
    if (params.get('idbcache') === '1') {
      const graphModel = await tf.loadGraphModel(MODEL_URL)
      const saveStart = performance.now()
      await graphModel.save('indexeddb://bp-stage6-probe')
      idbCache = {
        saveMs: Math.round((performance.now() - saveStart) * 10) / 10,
        listed: Object.keys(await tf.io.listModels()).filter((key) => key.includes('bp-stage6-probe')),
      }
      // Reload purely from IndexedDB (caller blocks /vendor/* to prove it).
      const reloadStart = performance.now()
      const reloaded = await tf.loadGraphModel('indexeddb://bp-stage6-probe')
      // Model input geometry: one 2 s window at 22050 Hz minus FFT hop.
      const warmup = tf.zeros([1, 43844, 1])
      const output = reloaded.predict(warmup)
      const tensors = Array.isArray(output)
        ? output
        : (output?.data ? [output] : Object.values(output ?? {}))
      for (const tensor of tensors) {
        await tensor.data()
        tensor.dispose()
      }
      warmup.dispose()
      idbCache.reloadMs = performance.now() - reloadStart
      idbCache.reloadOk = true
    }

    const heap1 = performance.memory?.usedJSHeapSize ?? null
    const tfMemory = tf.memory()
    window.__neuralResults = {
      status: 'done',
      backend,
      initMs: Math.round(initMs * 10) / 10,
      fullInferMs: Math.round(full.inferMs * 10) / 10,
      audioSeconds: Math.round(audioBuffer.duration * 100) / 100,
      fullNotes,
      chunked,
      idbCache,
      heapDeltaBytes: heap0 != null && heap1 != null ? heap1 - heap0 : null,
      tfNumBytes: tfMemory.numBytes,
      tfNumTensors: tfMemory.numTensors,
    }
  } catch (error) {
    window.__neuralResults = { status: 'error', message: String(error?.message ?? error) }
  }
  document.title = 'DONE'
}

/**
 * Offline-only probe (?idbonly=1): loads the model purely from IndexedDB
 * (caller blocks all /vendor/* traffic) and runs one inference. Proves
 * the cached model works with zero network.
 */
async function idbOnlyMain(clip) {
  try {
    await tf.ready()
    const loadStart = performance.now()
    const graphModel = await tf.loadGraphModel('indexeddb://bp-stage6-probe')
    const loadMs = performance.now() - loadStart
    const audioBuffer = await decodeToMono(`/clip/${clip}`, MODEL_RATE)
    const basicPitch = new BasicPitch(graphModel)
    const full = await evaluateBuffer(basicPitch, audioBuffer)
    window.__neuralResults = {
      status: 'done',
      mode: 'idbonly',
      backend: tf.getBackend(),
      loadMs: Math.round(loadMs * 10) / 10,
      fullInferMs: Math.round(full.inferMs * 10) / 10,
      fullNotes: notesFromOutputs(full.frames, full.onsets),
    }
  } catch (error) {
    window.__neuralResults = { status: 'error', message: String(error?.message ?? error) }
  }
  document.title = 'DONE'
}

const bootParams = new URLSearchParams(location.search)
if (bootParams.get('idbonly') === '1') {
  idbOnlyMain(bootParams.get('clip'))
} else {
  main()
}

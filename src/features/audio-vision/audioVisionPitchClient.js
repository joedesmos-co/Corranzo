/**
 * Main-thread client for the Audio Vision pitch worker.
 *
 * The worker exists so Basic Pitch inference cannot freeze the interface.
 * If the worker cannot start (no module workers, blocked script, a build
 * without worker support) the caller falls back to the inline path so the
 * feature still works — the interface may be less responsive, but the
 * arrangement is still produced.
 *
 * Every job MUST reach a terminal state. A pending job that is never settled
 * leaves the generation stuck at its last reported percentage forever, with no
 * error and no way to retry, so the client settles every job it starts:
 *   - the worker's success/failure message settles it,
 *   - a worker error / message error settles every job in flight,
 *   - a worker that failed to start before the job was registered settles it
 *     immediately,
 *   - a hard timeout settles a job the worker simply stopped answering.
 */

let worker = null
let workerFailed = false
let jobCounter = 0
const pending = new Map()

/** A job that the worker simply stops answering is settled after this long. */
const MIN_JOB_TIMEOUT_MS = 180_000
/** Extra budget per second of audio, for slow devices and long recordings. */
const JOB_TIMEOUT_PER_AUDIO_SECOND_MS = 20_000
/** Basic Pitch works on 22 050 Hz mono input. */
const MODEL_SAMPLE_RATE = 22050

function modelUrl() {
  if (typeof document === 'undefined') return null
  try {
    return new URL('neural-model/model.json', document.baseURI).href
  } catch {
    return null
  }
}

function rejectAll(error) {
  for (const entry of [...pending.values()]) {
    entry.settleError(error)
  }
  pending.clear()
}

function ensureWorker() {
  if (worker || workerFailed) return worker
  if (typeof Worker === 'undefined') {
    workerFailed = true
    return null
  }
  try {
    worker = new Worker(new URL('./audioVisionPitchWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const { jobId, ok, notes, error, progress } = event.data ?? {}
      const entry = pending.get(jobId)
      if (typeof progress === 'number' && !ok && notes === undefined) {
        if (entry?.onProgress) {
          try { entry.onProgress(progress) } catch { /* noop */ }
        }
        return
      }
      if (!entry) return
      if (ok) entry.settleOk(notes ?? [])
      else entry.settleError(new Error(error ?? 'pitch worker failed'))
    }
    worker.onerror = (event) => {
      workerFailed = true
      rejectAll(new Error(event?.message ?? 'pitch worker crashed'))
      try { worker?.terminate() } catch { /* noop */ }
      worker = null
    }
    // A message that could not be cloned (or a worker that died mid-message)
    // must not leave its job pending.
    worker.onmessageerror = () => {
      workerFailed = true
      rejectAll(new Error('pitch worker message error'))
      try { worker?.terminate() } catch { /* noop */ }
      worker = null
    }
  } catch {
    workerFailed = true
    worker = null
  }
  return worker
}

/**
 * Transcribe a mono 22 050 Hz buffer. Resolves with note events
 * [{ midi, startOffsetSeconds, endOffsetSeconds }] or rejects so the caller
 * can fall back to the inline path.
 */
export function inferNotesInWorker(samples, { onProgress = null, timeoutMs = null } = {}) {
  const activeWorker = ensureWorker()
  if (!activeWorker) return Promise.reject(new Error('pitch worker unavailable'))
  const url = modelUrl()
  if (!url) return Promise.reject(new Error('pitch worker model url unavailable'))
  const jobId = ++jobCounter
  // Copy so the caller keeps its buffer (the worker takes ownership of its copy).
  const copy = samples instanceof Float32Array ? new Float32Array(samples) : Float32Array.from(samples ?? [])
  const audioSeconds = copy.length / MODEL_SAMPLE_RATE
  const limit = timeoutMs ?? Math.max(MIN_JOB_TIMEOUT_MS, Math.round(audioSeconds * JOB_TIMEOUT_PER_AUDIO_SECOND_MS))
  return new Promise((resolve, reject) => {
    const entry = {
      onProgress,
      settled: false,
      timer: null,
      settleOk(value) {
        if (this.settled) return
        this.settled = true
        if (this.timer != null) clearTimeout(this.timer)
        pending.delete(jobId)
        resolve(value)
      },
      settleError(error) {
        if (this.settled) return
        this.settled = true
        if (this.timer != null) clearTimeout(this.timer)
        pending.delete(jobId)
        reject(error)
      },
    }
    pending.set(jobId, entry)
    // Safety net: a job the worker stops answering is settled, so the caller
    // falls back to the inline path instead of hanging.
    entry.timer = setTimeout(() => {
      entry.settleError(new Error('pitch worker timed out'))
      workerFailed = true
      try { activeWorker.terminate() } catch { /* noop */ }
      if (worker === activeWorker) worker = null
    }, limit)
    // The worker may have failed to start between ensureWorker() and here.
    if (workerFailed || worker !== activeWorker) {
      entry.settleError(new Error('pitch worker failed to start'))
      return
    }
    try {
      activeWorker.postMessage({ jobId, modelUrl: url, samples: copy }, [copy.buffer])
    } catch (error) {
      entry.settleError(error)
    }
  })
}

/** Release the worker (page teardown / test cleanup). */
export function disposePitchWorker() {
  try { worker?.terminate() } catch { /* noop */ }
  worker = null
  workerFailed = false
  pending.clear()
}

/** Test seam: has the worker path been disabled by a failure? */
export function isPitchWorkerFailed() {
  return workerFailed
}

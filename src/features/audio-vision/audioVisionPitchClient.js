/**
 * Main-thread client for the Audio Vision pitch worker.
 *
 * The worker exists so Basic Pitch inference cannot freeze the interface.
 * If the worker cannot start (no module workers, blocked script, a build
 * without worker support) the caller falls back to the inline path so the
 * feature still works — the interface may be less responsive, but the
 * arrangement is still produced.
 */

let worker = null
let workerFailed = false
let jobCounter = 0
const pending = new Map()

function modelUrl() {
  if (typeof document === 'undefined') return null
  try {
    return new URL('neural-model/model.json', document.baseURI).href
  } catch {
    return null
  }
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
      if (typeof progress === 'number' && !ok && notes === undefined) {
        const entry = pending.get(jobId)
        if (entry?.onProgress) {
          try { entry.onProgress(progress) } catch { /* noop */ }
        }
        return
      }
      const entry = pending.get(jobId)
      if (!entry) return
      pending.delete(jobId)
      if (ok) entry.resolve(notes ?? [])
      else entry.reject(new Error(error ?? 'pitch worker failed'))
    }
    worker.onerror = () => {
      workerFailed = true
      for (const entry of pending.values()) entry.reject(new Error('pitch worker crashed'))
      pending.clear()
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
export function inferNotesInWorker(samples, { onProgress = null } = {}) {
  const activeWorker = ensureWorker()
  if (!activeWorker) return Promise.reject(new Error('pitch worker unavailable'))
  const url = modelUrl()
  if (!url) return Promise.reject(new Error('pitch worker model url unavailable'))
  const jobId = ++jobCounter
  // Copy so the caller keeps its buffer (the worker takes ownership of its copy).
  const copy = samples instanceof Float32Array ? new Float32Array(samples) : Float32Array.from(samples ?? [])
  return new Promise((resolve, reject) => {
    pending.set(jobId, { resolve, reject, onProgress })
    try {
      activeWorker.postMessage({ jobId, modelUrl: url, samples: copy }, [copy.buffer])
    } catch (error) {
      pending.delete(jobId)
      reject(error)
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

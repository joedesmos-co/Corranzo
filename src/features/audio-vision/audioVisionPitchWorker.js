/**
 * Audio Vision pitch inference worker.
 *
 * Basic Pitch (TF.js) evaluates the graph model one 2 s window at a time. On
 * the main thread each window is a hard 1-3 s block: a 3-minute recording is
 * roughly 60 windows, so the whole transcription froze the interface and the
 * progress bar could not paint. The inference is pure computation over a
 * Float32Array with no DOM access, so it runs unchanged here: the main thread
 * keeps painting progress and stays interactive while the notes are computed.
 *
 * The notes that come back are the same notes the inline path produced — the
 * same model, the same thresholds (onset 0.5, frame 0.3) and the same
 * 22 050 Hz mono input. The only difference is which thread did the work.
 */
// MUST come first: it declares the worker `window` shim TF.js's browser
// platform probes for (see audioVisionWorkerEnv.js). ESM evaluates imported
// modules in order, so this runs before TF.js is evaluated.
import './audioVisionWorkerEnv.js'
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import * as tf from '@tensorflow/tfjs'

let modelPromise = null
/** The job currently in flight, so an uncaught async failure can still answer it. */
let activeJobId = null

function post(message) {
  try {
    self.postMessage(message)
  } catch (error) {
    console.error('[audio-vision] pitch worker could not post its result:', String(error?.message ?? error))
  }
}

/**
 * Any error that escapes the message handler (a rejected promise from a
 * library callback, for example) must still answer the job it belongs to.
 * Without this the main thread waits forever and the generation stalls at the
 * last reported percentage with no way out.
 */
function reportUncaught(jobId, error) {
  const message = String(error?.message ?? error ?? 'unknown worker error')
  console.error('[audio-vision] pitch worker failure:', message, error?.stack ?? '')
  if (jobId != null) {
    post({ jobId, ok: false, error: message })
  }
}

self.addEventListener('error', (event) => {
  reportUncaught(activeJobId, event.error ?? event.message)
})
self.addEventListener('unhandledrejection', (event) => {
  reportUncaught(activeJobId, event.reason)
})

function loadModel(modelUrl) {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.ready()
      return new BasicPitch(modelUrl)
    })()
  }
  return modelPromise
}

/** Concatenate without spreading: a long recording's frame array is huge. */
function appendAll(target, chunk) {
  if (!chunk || !chunk.length) return
  for (let i = 0; i < chunk.length; i += 1) target.push(chunk[i])
}

self.onmessage = async (event) => {
  const { jobId, modelUrl, samples } = event.data ?? {}
  activeJobId = jobId ?? null
  try {
    const model = await loadModel(modelUrl)
    const frames = []
    const onsets = []
    const contours = []
    await model.evaluateModel(
      samples,
      (f, o, c) => {
        appendAll(frames, f)
        appendAll(onsets, o)
        appendAll(contours, c)
      },
      // The model reports its real window progress (0..1). Passing it on lets
      // the progress bar show measured progress instead of a frozen bar.
      (fraction) => {
        post({ jobId, progress: fraction })
      },
    )
    const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)).map((note) => ({
      midi: Math.round(note.pitchMidi),
      startOffsetSeconds: note.startTimeSeconds,
      endOffsetSeconds: note.startTimeSeconds + note.durationSeconds,
      // The model's own note strength. Without it the arrangement cannot tell
      // a real octave from a harmonic artifact, because the suppression rules
      // need the amplitude to decide which of the two is the real note.
      amplitude: Number.isFinite(note.amplitude) ? note.amplitude : null,
    }))
    post({ jobId, ok: true, notes })
  } catch (error) {
    post({ jobId, ok: false, error: String(error?.message ?? error) })
  } finally {
    activeJobId = null
  }
}

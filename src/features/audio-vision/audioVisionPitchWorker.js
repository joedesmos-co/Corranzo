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
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import * as tf from '@tensorflow/tfjs'

let modelPromise = null

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
        try { self.postMessage({ jobId, progress: fraction }) } catch { /* noop */ }
      },
    )
    const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)).map((note) => ({
      midi: Math.round(note.pitchMidi),
      startOffsetSeconds: note.startTimeSeconds,
      endOffsetSeconds: note.startTimeSeconds + note.durationSeconds,
    }))
    self.postMessage({ jobId, ok: true, notes })
  } catch (error) {
    self.postMessage({ jobId, ok: false, error: String(error?.message ?? error) })
  }
}

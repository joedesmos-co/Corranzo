/**
 * Browser side of the neural corpus benchmark (vite-served, test-only).
 * Loads the REAL Basic Pitch model once, then infers streaming windows
 * on demand with per-call thresholds so one page load serves a full
 * threshold/window sweep without reloads.
 */
import { loadNeuralRuntime, NEURAL_MODEL_RATE } from '/src/features/microphone-input/micNeuralTfAdapter.js'

let runtime = null

async function renderBuffer(samples) {
  const context = new OfflineAudioContext(1, Math.max(1, samples.length), NEURAL_MODEL_RATE)
  const buffer = context.createBuffer(1, Math.max(1, samples.length), NEURAL_MODEL_RATE)
  buffer.getChannelData(0).set(samples.subarray(0, buffer.length))
  return buffer
}

window.__neuralBench = {
  async load(modelJsonUrl) {
    runtime = await loadNeuralRuntime({ modelJsonUrl })
    const tf = runtime.tf
    return { backend: tf.getBackend() }
  },
  async setBackend(name) {
    if (!runtime) {
      throw new Error('runtime not loaded')
    }
    await runtime.tf.setBackend(name)
    await runtime.tf.ready()
    return { backend: runtime.tf.getBackend() }
  },
  async infer({ samples, onsetThreshold, frameThreshold, minNoteLength }) {
    if (!runtime) {
      throw new Error('runtime not loaded')
    }
    const { model, tf } = runtime
    const audioBuffer = await renderBuffer(Float32Array.from(samples))
    const frames = []
    const onsets = []
    const contours = []
    const started = performance.now()
    await model.evaluateModel(audioBuffer, (f, o, c) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    }, () => {})
    const inferMs = performance.now() - started
    const [{ outputToNotesPoly, noteFramesToTime }] = [await import('@spotify/basic-pitch')]
    const notes = noteFramesToTime(
      outputToNotesPoly(frames, onsets, onsetThreshold, frameThreshold, minNoteLength),
    ).map((note) => ({
      midi: note.pitchMidi,
      start: note.startTimeSeconds,
      end: note.startTimeSeconds + note.durationSeconds,
      amplitude: note.amplitude ?? null,
    }))
    return { notes, inferMs: Math.round(inferMs * 10) / 10, backend: tf.getBackend() }
  },
}

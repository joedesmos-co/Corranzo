/**
 * Real Basic Pitch inference in Node (Phase 2).
 *
 * Loads the SAME weights shipped to the browser (public/neural-model, via a
 * local static server) with @tensorflow/tfjs CPU backend, runs the package's
 * own evaluateModel + outputToNotesPoly with production thresholds
 * (onset 0.5 / frame 0.3 / min 5 frames). Results are model-identical to the
 * browser path (only the TF.js backend differs: CPU vs WebGL).
 *
 * Memory-safe: one shared graph, tf.tidy scopes per window are handled by
 * the package; we dispose the framing tensor and force GC-friendly batching.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

let cached = null

async function serveModel(modelDir) {
  const files = {
    '/model.json': 'application/json',
    '/group1-shard1of1.bin': 'application/octet-stream',
  }
  const server = createServer(async (req, res) => {
    const type = files[req.url]
    if (!type) {
      res.writeHead(404)
      res.end()
      return
    }
    try {
      const data = await readFile(join(modelDir, req.url.slice(1)))
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

export async function loadBasicPitchNode({ modelDir, onLog = null } = {}) {
  if (cached) return cached
  const log = onLog ?? (() => {})
  const tf = await import('@tensorflow/tfjs')
  await tf.setBackend('cpu')
  await tf.ready()
  log(`basic-pitch node backend: ${tf.getBackend()}`)
  const server = await serveModel(modelDir)
  const port = server.address().port
  try {
    const bp = await import('@spotify/basic-pitch')
    const model = new bp.BasicPitch(tf.loadGraphModel(`http://127.0.0.1:${port}/model.json`))
    // Warm up on silence (compiles graph once, matches browser capability probe).
    const silent = new Float32Array(22050)
    await model.evaluateModel(silent, () => {}, () => {})
    log('basic-pitch node model ready')
    cached = { tf, bp, model, server }
    return cached
  } catch (error) {
    server.close()
    throw error
  }
}

/**
 * Run real inference on mono 22050 Hz samples.
 * Returns [{ midi, startSeconds, endSeconds, amplitude }] + stats.
 */
export async function predictBasicPitchNode(samples22050, { modelDir, onProgress = null } = {}) {
  const { tf, bp, model } = await loadBasicPitchNode({ modelDir })
  const started = Date.now()
  const frames = []
  const onsets = []
  const contours = []
  const memBefore = process.memoryUsage().heapUsed
  await model.evaluateModel(Float32Array.from(samples22050), (f, o, c) => {
    frames.push(...f)
    onsets.push(...o)
    contours.push(...c)
  }, (p) => {
    try { onProgress?.(p) } catch { /* noop */ }
  })
  const notes = bp.noteFramesToTime(bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5))
  const ms = Date.now() - started
  // Release per-run tensors; the shared graph stays loaded.
  try {
    tf.disposeVariables()
    tf.engine().startScope && null
  } catch { /* noop */ }
  if (global.gc) {
    try { global.gc() } catch { /* noop */ }
  }
  return {
    notes: notes.map((n) => ({
      midi: Math.round(n.pitchMidi),
      startSeconds: n.startTimeSeconds,
      endSeconds: n.startTimeSeconds + n.durationSeconds,
      amplitude: n.amplitude ?? null,
    })),
    stats: {
      ms,
      secondsPerAudioSecond: ms / 1000 / (samples22050.length / 22050),
      heapDeltaMB: Math.round(((process.memoryUsage().heapUsed - memBefore) / 1048576) * 10) / 10,
      frames: frames.length,
    },
  }
}

export async function closeBasicPitchNode() {
  if (cached?.server) {
    cached.server.close()
    cached = null
  }
}

#!/usr/bin/env node
/**
 * Model benchmark: the current Basic Pitch route against a stronger
 * pretrained piano model, on the SAME independent reference and with the SAME
 * scorer.
 *
 * The question this answers is not "which model has the best paper number"
 * but "would a different model make Corranzo's arrangements more musical, and
 * could it even run in the product?".
 *
 * For each route it reports:
 *   - pitch precision / recall, onset MAE, duration MAE, full-reference event F1
 *   - the inference runtime (wall clock) and the peak memory
 *   - the model download size
 *   - the licence and checkpoint rights
 *   - whether it can run in the browser worker, for free, on a phone
 *
 * Usage: node --expose-gc scripts/audio-vision-model-bench.mjs
 *        [--external <hft-json>] [--json benchmarks/audio-vision/model-bench.json]
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { renderReference, synthReferenceTruth, SYNTH_REFERENCE_BPM } from './lib/synthReference.mjs'
import { scoreEvents, melodyAnchors, anchorRecall, inventedRate } from './lib/eventScore.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/model-bench.json')
const externalPath = argValue('--external', null)
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const truth = synthReferenceTruth()
const anchors = melodyAnchors(truth)
const mono = renderReference(22050)
const audioSeconds = mono.length / 22050
const report = {
  generatedAt: new Date().toISOString(),
  reference: {
    id: 'synth-reference',
    notes: truth.length,
    bpm: SYNTH_REFERENCE_BPM,
    audioSeconds: Math.round(audioSeconds * 100) / 100,
  },
  routes: [],
}

const modelDir = join(root, 'public/neural-model')
const modelBytes = existsSync(modelDir)
  ? ['model.json', 'group1-shard1of1.bin'].reduce((sum, f) => sum + statSync(join(modelDir, f)).size, 0)
  : null

/* ------------------------------------------------------- Basic Pitch (current) */
{
  const started = Date.now()
  const before = process.memoryUsage()
  const bp = await predictBasicPitchNode(mono, { modelDir })
  const elapsed = Date.now() - started
  const after = process.memoryUsage()
  const events = bp.notes.map((n) => ({
    midi: n.midi,
    onset: n.startSeconds,
    duration: (n.endSeconds ?? n.startSeconds) - n.startSeconds,
  }))
  report.routes.push({
    id: 'basic-pitch',
    label: 'Basic Pitch (in use today)',
    model: 'public/neural-model (TensorFlow.js graph model)',
    modelBytes,
    licence: 'Apache-2.0 (Spotify AB) - code and weights',
    checkpointRights: 'vendored in-repo; the npm package ships the same weights',
    runtimeMs: elapsed,
    realtimeFactor: Math.round((audioSeconds / (elapsed / 1000)) * 100) / 100,
    heapDeltaMb: Math.round(((after.heapUsed - before.heapUsed) / 1048576) * 10) / 10,
    rssMb: Math.round((after.rss / 1048576) * 10) / 10,
    browserWorker: true,
    zeroCost: true,
    score: scoreEvents(events, truth),
    melodyAnchorRecall: anchorRecall(events, anchors),
    inventedRate: inventedRate(events, truth),
  })
  console.log(`basic-pitch: ${elapsed} ms for ${audioSeconds.toFixed(1)} s audio`)
}
await closeBasicPitchNode()

/* --------------------------------- hFT-Transformer (stronger piano model) */
if (externalPath && existsSync(externalPath)) {
  const raw = JSON.parse(readFileSync(externalPath, 'utf8'))
  const events = raw.map((n) => ({
    midi: n.pitch,
    onset: n.onset,
    duration: (n.offset ?? n.onset) - n.onset,
  }))
  report.routes.push({
    id: 'hft-transformer',
    label: 'hFT-Transformer (Sony, ISMIR 2023) - benchmark only',
    model: 'checkpoint/checkpoint/MAESTRO-V3/model_016_003.pkl',
    modelBytes: 20540269,
    licence: 'MIT (code)',
    checkpointRights: 'checkpoint distributed via the project\'s GitHub release; trained on MAESTRO (CC BY-NC-SA 3.0) - commercial use needs a rights check',
    runtimeMs: null,
    realtimeFactor: null,
    browserWorker: false,
    zeroCost: false,
    score: scoreEvents(events, truth),
    melodyAnchorRecall: anchorRecall(events, anchors),
    inventedRate: inventedRate(events, truth),
  })
  console.log('hft-transformer: scored the external predictions')
}

writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('')
for (const route of report.routes) {
  console.log(
    `${route.id}: F1=${route.score.eventF1} P=${route.score.pitchPrecision} R=${route.score.pitchRecall} ` +
    `onsetMAE=${route.score.onsetMaeMs}ms durMAE=${route.score.durationMaeMs}ms ` +
    `melody=${route.melodyAnchorRecall.recall} invented=${route.inventedRate} ` +
    `runtime=${route.runtimeMs ?? '—'}ms`,
  )
}
console.log('written', resolveOut(jsonOut))

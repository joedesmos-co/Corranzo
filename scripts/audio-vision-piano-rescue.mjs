/**
 * A1 — Piano rescue rescoring (no model tuning).
 *
 * Uses energy-derived per-clip shifts δ (align-probe.json; DSP-only, fixed
 * BEFORE any model scoring, committed as auditable constants) and
 * cluster-aware window scoring to separate three error sources:
 *  1. truth origin shift (raw vs δ-aligned strict scoring),
 *  2. sub-75 ms onset clustering (strict vs windowed pitch-set F1),
 *  3. residual model error (what remains).
 *
 * δ is applied IDENTICALLY to Basic Pitch and spectral outputs. Nothing here
 * tunes the model or the arranger; eval recordings are never fit.
 *
 * Usage: node --expose-gc scripts/audio-vision-piano-rescue.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/piano-rescue.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/piano-rescue.md')

const manifest = JSON.parse(readFileSync(join(root, 'benchmarks/mic-real/manifest.json'), 'utf8'))
const probe = JSON.parse(readFileSync(join(root, 'benchmarks/audio-vision/align-probe.json'), 'utf8'))
const deltaById = Object.fromEntries(probe.rows.map((r) => [r.id, r.bestDelta]))
const excluded = new Set((manifest.excluded ?? []).map((e) => e.id))
const pianoClips = manifest.clips.filter((c) => c.instrument === 'piano' && !excluded.has(c.id) && c.truth?.notes?.length)

function strictScore(predicted, truth, tol = 0.1) {
  const used = new Set()
  let matched = 0
  for (const t of truth) {
    for (let i = 0; i < predicted.length; i += 1) {
      if (used.has(i) || predicted[i].midi !== t.midi) continue
      if (Math.abs(predicted[i].startSeconds - t.onset) <= tol) {
        used.add(i)
        matched += 1
        break
      }
    }
  }
  const p = predicted.length ? matched / predicted.length : 0
  const r = truth.length ? matched / truth.length : 1
  return { precision: r3(p), recall: r3(r), f1: r3(p + r > 0 ? (2 * p * r) / (p + r) : 0), matched }
}

function windowedF1(predicted, truth, window = 0.15) {
  const end = Math.max(
    ...truth.map((t) => t.onset),
    ...predicted.map((p) => p.startSeconds),
    0,
  )
  let f1sum = 0
  let n = 0
  for (let ws = 0; ws < end; ws += window) {
    const tSet = new Set(truth.filter((t) => t.onset >= ws && t.onset < ws + window).map((t) => t.midi))
    const pSet = new Set(predicted.filter((p) => p.startSeconds >= ws - 0.02 && p.startSeconds < ws + window).map((p) => p.midi))
    if (!tSet.size && !pSet.size) continue
    const inter = [...tSet].filter((m) => pSet.has(m)).length
    const prec = pSet.size ? inter / pSet.size : 1
    const rec = tSet.size ? inter / tSet.size : 1
    f1sum += prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0
    n += 1
  }
  return { f1: r3(n ? f1sum / n : 0), windows: n }
}

function r3(v) {
  return Math.round(v * 1000) / 1000
}

const rows = []
for (const clip of pianoClips) {
  const delta = deltaById[clip.id] ?? 0
  const wav = readWavPcm(join(root, 'benchmarks/mic-real', clip.audio.file))
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const truth = clip.truth.notes.map((n) => ({ midi: n.midi, onset: n.onset }))
  const truthAligned = truth.map((t) => ({ ...t, onset: t.onset + delta })).filter((t) => t.onset >= 0.01)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const bpNotes = bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds }))
  const analysis = await analyzeMusic(mono, 22050, { predictNotes: null })
  const specNotes = analysis.predictedNotes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds }))
  const row = {
    id: clip.id,
    performance: clip.performance,
    delta,
    nTruth: truth.length,
    bp: {
      raw: strictScore(bpNotes, truth),
      aligned: strictScore(bpNotes, truthAligned),
      windowed: windowedF1(bpNotes, truthAligned),
    },
    spectral: {
      raw: strictScore(specNotes, truth),
      aligned: strictScore(specNotes, truthAligned),
      windowed: windowedF1(specNotes, truthAligned),
    },
  }
  rows.push(row)
  console.log(`${clip.id} δ=${delta}: BP raw F1=${row.bp.raw.f1} → aligned=${row.bp.aligned.f1} windowed=${row.bp.windowed.f1} | SPEC raw=${row.spectral.raw.f1} aligned=${row.spectral.aligned.f1} windowed=${row.spectral.windowed.f1}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

writeFileSync(join(root, jsonOut), JSON.stringify({ rows }, null, 2))
const lines = ['# Piano rescue rescoring (δ from DSP-only probe, applied equally to both methods)', '',
  '| clip | δ | BP raw | BP aligned | BP windowed | SPEC raw | SPEC aligned | SPEC windowed |', '|---|---|---|---|---|---|---|---|']
for (const r of rows) {
  lines.push(`| ${r.id} | ${r.delta} | ${r.bp.raw.f1} | ${r.bp.aligned.f1} | ${r.bp.windowed.f1} | ${r.spectral.raw.f1} | ${r.spectral.aligned.f1} | ${r.spectral.windowed.f1} |`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')

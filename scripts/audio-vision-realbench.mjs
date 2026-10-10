/**
 * Phase 2 — Real recorded-audio transcription benchmark.
 *
 * Uses in-repo truth-labeled natural recordings (benchmarks/mic-real, all
 * CC-BY-4.0 with dataset attribution) — Vienna piano, GuitarSet acoustic,
 * EGSet12 / guitar-techs electric. Compares REAL Basic Pitch inference
 * (same weights as the browser path, CPU backend) against the Node spectral
 * baseline. No ground-truth injection: both paths see audio only.
 *
 * Metrics per clip: pitch precision/recall (±100 ms onset match), onset MAE,
 * missed phrases, invented notes, tempo error, arrangement confidence.
 * Reported split by instrument/dataset AND by dev/eval split (no tuning on
 * eval — eval numbers are read-only).
 *
 * Usage: node --expose-gc scripts/audio-vision-realbench.mjs [--clips N] [--json p] [--md p]
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
const clipLimit = Number(argValue('--clips', 0)) || 0
const jsonOut = argValue('--json', 'benchmarks/audio-vision/realbench.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/realbench.md')

const manifest = JSON.parse(readFileSync(join(root, 'benchmarks/mic-real/manifest.json'), 'utf8'))
const excluded = new Set((manifest.excluded ?? []).map((e) => e.id))
let clips = manifest.clips.filter((c) => !excluded.has(c.id) && Array.isArray(c.truth?.notes) && c.truth.notes.length)
if (clipLimit > 0) clips = clips.slice(0, clipLimit)
console.log(`clips: ${clips.length} (excluded ${excluded.size} known-bad)`)

const ONSET_TOL = 0.1

function scoreNotes(predicted, truth) {
  const used = new Set()
  let onsetErr = 0
  let matched = 0
  const sorted = [...predicted].sort((a, b) => a.startSeconds - b.startSeconds)
  for (const t of truth) {
    let best = -1
    let bestErr = Infinity
    for (let i = 0; i < sorted.length; i += 1) {
      if (used.has(i) || sorted[i].midi !== t.midi) continue
      const err = Math.abs(sorted[i].startSeconds - t.onset)
      if (err <= ONSET_TOL && err < bestErr) {
        bestErr = err
        best = i
      }
    }
    if (best >= 0) {
      used.add(best)
      matched += 1
      onsetErr += bestErr
    }
  }
  const precision = sorted.length ? matched / sorted.length : (matched === 0 && truth.length === 0 ? 1 : 0)
  const recall = truth.length ? matched / truth.length : 1
  return {
    matched,
    predicted: sorted.length,
    truth: truth.length,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: precision + recall > 0 ? Math.round((2 * precision * recall) / (precision + recall) * 1000) / 1000 : 0,
    onsetMaeMs: matched ? Math.round((onsetErr / matched) * 1000) : null,
    invented: sorted.length - matched,
    missed: truth.length - matched,
  }
}

const rows = []
for (const clip of clips) {
  const wavPath = join(root, 'benchmarks/mic-real', clip.audio.file)
  const wav = readWavPcm(wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const truth = clip.truth.notes.map((n) => ({ midi: n.midi, onset: n.onset }))
  // Real Basic Pitch.
  const bpStarted = Date.now()
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const bpMs = Date.now() - bpStarted
  const bpScore = scoreNotes(bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds })), truth)
  // Spectral baseline (same audio, no model).
  const analysis = await analyzeMusic(mono, 22050, { predictNotes: null })
  const specScore = scoreNotes(
    analysis.predictedNotes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds })),
    truth,
  )
  rows.push({
    id: clip.id,
    instrument: clip.instrument,
    dataset: clip.dataset,
    split: clip.split,
    seconds: Math.round((mono.length / 22050) * 10) / 10,
    basicPitch: { ...bpScore, ms: bpMs, rtf: Math.round((bpMs / 1000 / (mono.length / 22050)) * 100) / 100, heapMB: bp.stats.heapDeltaMB },
    spectral: specScore,
    tempoBpm: analysis.tempo.bpm,
    onsets: analysis.onsets.length,
  })
  console.log(`${clip.id} [${clip.instrument}/${clip.split}]: BP P=${bpScore.precision} R=${bpScore.recall} mae=${bpScore.onsetMaeMs}ms | SPEC P=${specScore.precision} R=${specScore.recall} | ${bpMs}ms`)
}

await closeBasicPitchNode()

function agg(list, pick) {
  if (!list.length) return null
  const ps = list.map(pick)
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  return {
    n: list.length,
    precision: Math.round(mean(ps.map((p) => p.precision)) * 1000) / 1000,
    recall: Math.round(mean(ps.map((p) => p.recall)) * 1000) / 1000,
    f1: Math.round(mean(ps.map((p) => p.f1)) * 1000) / 1000,
  }
}

const summary = {
  clips: rows.length,
  byInstrument: {},
  bySplit: {},
  overall: { basicPitch: agg(rows, (r) => r.basicPitch), spectral: agg(rows, (r) => r.spectral) },
  rows,
}
for (const key of ['instrument', 'split', 'dataset']) {
  summary[`by${key[0].toUpperCase()}${key.slice(1)}`] = {}
  for (const r of rows) {
    const k = r[key] ?? 'unknown'
    summary[`by${key[0].toUpperCase()}${key.slice(1)}`][k] ??= []
    summary[`by${key[0].toUpperCase()}${key.slice(1)}`][k].push(r)
  }
  for (const k of Object.keys(summary[`by${key[0].toUpperCase()}${key.slice(1)}`])) {
    const list = summary[`by${key[0].toUpperCase()}${key.slice(1)}`][k]
    summary[`by${key[0].toUpperCase()}${key.slice(1)}`][k] = {
      basicPitch: agg(list, (r) => r.basicPitch),
      spectral: agg(list, (r) => r.spectral),
    }
  }
}

writeFileSync(join(root, jsonOut), JSON.stringify(summary, null, 2))
const lines = ['# Audio Vision real-audio benchmark (natural recordings, truth-labeled)', '',
  `clips=${rows.length} · onset tolerance ±${ONSET_TOL * 1000}ms · Basic Pitch = real weights (CPU backend), spectral = model-free baseline`, '',
  `overall Basic Pitch: P=${summary.overall.basicPitch.precision} R=${summary.overall.basicPitch.recall} F1=${summary.overall.basicPitch.f1}`,
  `overall spectral: P=${summary.overall.spectral.precision} R=${summary.overall.spectral.recall} F1=${summary.overall.spectral.f1}`, '',
  '| instrument | n | BP P/R/F1 | SPEC P/R/F1 |', '|---|---|---|---|']
for (const [k, v] of Object.entries(summary.byInstrument)) {
  lines.push(`| ${k} | ${v.basicPitch.n} | ${v.basicPitch.precision}/${v.basicPitch.recall}/${v.basicPitch.f1} | ${v.spectral.precision}/${v.spectral.recall}/${v.spectral.f1} |`)
}
lines.push('', '| split | n | BP P/R/F1 | SPEC P/R/F1 |', '|---|---|---|---|')
for (const [k, v] of Object.entries(summary.bySplit)) {
  lines.push(`| ${k} | ${v.basicPitch.n} | ${v.basicPitch.precision}/${v.basicPitch.recall}/${v.basicPitch.f1} | ${v.spectral.precision}/${v.spectral.recall}/${v.spectral.f1} |`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log(`\nBP overall P=${summary.overall.basicPitch.precision} R=${summary.overall.basicPitch.recall} | SPEC P=${summary.overall.spectral.precision} R=${summary.overall.spectral.recall}`)

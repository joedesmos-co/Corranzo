#!/usr/bin/env node
/**
 * Build the rights-clean synthetic corpus: plan, demo render, ground-truth
 * verification, and a Basic Pitch error-variation check.
 *
 * The plan is a manifest of compositions (id, instrument, texture, split).
 * Only a bounded demo subset is rendered to disk; the rest can be regenerated
 * on demand from the same seeds, so the pipeline never needs tens of hours of
 * audio materialised.
 *
 * Verification (the point of the round):
 *   1. every rendered note's AUDIBLE onset is measured in the waveform and
 *      compared with its symbolic onset - a renderer that lies about timing
 *      would poison any training set built on it;
 *   2. the released Basic Pitch model is run on the same audio and scored
 *      against the exact event list, per instrument and per texture, so we can
 *      see whether the synthetic data produces the error variation real music
 *      produces (it must not be a trivially perfect corpus).
 *
 * Usage:
 *   node --expose-gc scripts/audio-vision-synth-corpus.mjs [--clips 36]
 *     [--compositions 150] [--out /tmp/synth-corpus] [--no-wav] [--json p]
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SAMPLE_RATE, INSTRUMENTS, TEXTURES,
  compositionSpec, renderComposition, measureAudibleOnset, hasIsolatedOnset, splitForComposition,
} from './lib/synthCorpus.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const clipTarget = Number(argValue('--clips', 36))
const planSize = Number(argValue('--compositions', 150))
const outDir = argValue('--out', '/tmp/synth-corpus')
const writeWav = !args.includes('--no-wav')
const jsonOut = argValue('--json', 'benchmarks/audio-vision/synth-corpus.json')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

/** 16-bit PCM mono WAV writer (the demo only; the plan itself stores no audio). */
function writeWavFile(path, samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples.length * 2, 4); buffer.write('WAVE', 8)
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }
  writeFileSync(path, buffer)
}

/* ------------------------------------------------------------------- plan */

const plan = []
let n = 0
for (const instrument of INSTRUMENTS) {
  for (const texture of TEXTURES) {
    const count = Math.max(1, Math.round(planSize / (INSTRUMENTS.length * TEXTURES.length)))
    for (let i = 0; i < count; i += 1) {
      const id = `${instrument}-${texture}-${String(i).padStart(3, '0')}`
      plan.push({ id, instrument, texture, split: splitForComposition(id), bars: 4, bpm: 92 + ((n * 7) % 40) })
      n += 1
    }
  }
}
const planSummary = plan.reduce((acc, spec) => {
  acc[spec.split] = (acc[spec.split] ?? 0) + 1
  return acc
}, {})

/* ------------------------------------------------------------- demo subset */

// Stratified: two compositions per instrument x texture, preferring test/val so
// the demo exercises the splits the way training will.
const demo = []
for (const instrument of INSTRUMENTS) {
  for (const texture of TEXTURES) {
    const candidates = plan.filter((s) => s.instrument === instrument && s.texture === texture)
    const order = ['test', 'val', 'train']
    const picked = []
    for (const split of order) {
      for (const spec of candidates) {
        if (picked.length >= 2) break
        if (spec.split === split) picked.push(spec)
      }
    }
    demo.push(...picked.slice(0, 2))
  }
}
const chosen = demo.slice(0, clipTarget)
mkdirSync(outDir, { recursive: true })

/* --------------------------------------------------------------- render + check */

const rows = []
const onsetDeltas = []
let totalNotes = 0
for (const [index, spec] of chosen.entries()) {
  const full = compositionSpec(spec)
  const rendered = renderComposition(full)
  totalNotes += rendered.notes.length
  // 1. audible-onset check on every isolated attack
  for (let i = 0; i < rendered.notes.length; i += 1) {
    if (!hasIsolatedOnset(full, i)) continue
    const note = rendered.notes[i]
    // Energy isolation: a note whose 30 ms pre-roll is already loud is being
    // measured over the previous note's tail, and the "onset" found would be
    // that tail. Such notes are skipped rather than reported as -N ms errors.
    const s0 = Math.floor(note.onsetSeconds * rendered.sampleRate)
    const pre = rendered.samples.subarray(Math.max(0, s0 - Math.floor(0.03 * rendered.sampleRate)), s0)
    let preSum = 0
    for (const v of pre) preSum += v * v
    const preRms = pre.length ? Math.sqrt(preSum / pre.length) : 0
    const after = rendered.samples.subarray(s0, Math.min(rendered.samples.length, s0 + Math.floor(0.12 * rendered.sampleRate)))
    let peak = 0
    for (const v of after) peak = Math.max(peak, Math.abs(v))
    if (peak > 0 && preRms > peak * 0.2) continue
    const measured = measureAudibleOnset(rendered.samples, rendered.sampleRate, note)
    if (measured == null) continue
    onsetDeltas.push((measured - note.onsetSeconds) * 1000)
  }
  // 2. the released model on the same audio
  const bp = await predictBasicPitchNode(rendered.samples, { modelDir: join(root, 'public/neural-model') })
  const notes = bp.notes.map((n) => ({ midi: n.midi, onset: n.startSeconds, duration: (n.endSeconds ?? n.startSeconds) - n.startSeconds }))
  const truth = rendered.notes.map((n) => ({ midi: n.midi, onset: n.onsetSeconds, offset: n.offsetSeconds }))
  const strict = scoreEvents(notes, truth, { tolerance: 0.06 })
  const loose = scoreEvents(notes, truth, { tolerance: 0.12 })
  rows.push({
    id: spec.id, instrument: spec.instrument, texture: spec.texture, split: spec.split,
    durationSeconds: full.durationSeconds, notes: truth.length, predicted: notes.length,
    f1At60ms: strict.eventF1, precisionAt60ms: strict.pitchPrecision, recallAt60ms: strict.pitchRecall,
    f1At120ms: loose.eventF1, onsetMaeMs: strict.onsetMaeMs,
    mismatch: truth.length && strict.pitchRecall < 0.5,
  })
  if (writeWav) writeWavFile(join(outDir, `${spec.id}.wav`), rendered.samples, SAMPLE_RATE)
  writeFileSync(join(outDir, `${spec.id}.truth.json`), JSON.stringify({ spec: full, sampleRate: SAMPLE_RATE, notes: rendered.notes }, null, 1))
  console.log(`${String(index + 1).padStart(2)}/${chosen.length} ${spec.id.padEnd(24)} ${String(truth.length).padStart(3)} notes  F1@60ms ${strict.eventF1}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const mean = (values) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000 : null)
const sorted = [...onsetDeltas].sort((a, b) => a - b)
const onsetStats = {
  measured: onsetDeltas.length,
  meanMs: mean(onsetDeltas),
  medianMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 1000) / 1000 : null,
  p95Ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)] * 1000) / 1000 : null,
  worstMs: sorted.length ? Math.round(sorted[sorted.length - 1] * 1000) / 1000 : null,
}
const byGroup = (key) => {
  const groups = {}
  for (const row of rows) {
    const k = row[key]
    if (!groups[k]) groups[k] = []
    groups[k].push(row)
  }
  return Object.fromEntries(Object.entries(groups).map(([k, list]) => [k, {
    clips: list.length,
    notes: list.reduce((a, r) => a + r.notes, 0),
    f1At60ms: mean(list.map((r) => r.f1At60ms)),
    f1At120ms: mean(list.map((r) => r.f1At120ms)),
    precision: mean(list.map((r) => r.precisionAt60ms)),
    recall: mean(list.map((r) => r.recallAt60ms)),
    lowRecallClips: list.filter((r) => r.mismatch).length,
  }]))
}

const report = {
  generatedAt: new Date().toISOString(),
  renderer: 'in-house additive synthesis (no samples, no external assets)',
  sampleRate: SAMPLE_RATE,
  plan: {
    compositions: plan.length,
    bySplit: planSummary,
    byInstrument: Object.fromEntries(INSTRUMENTS.map((i) => [i, plan.filter((p) => p.instrument === i).length])),
    byTexture: Object.fromEntries(TEXTURES.map((t) => [t, plan.filter((p) => p.texture === t).length])),
  },
  demo: {
    clips: rows.length,
    totalNotes,
    audioSeconds: Math.round(rows.reduce((a, r) => a + r.durationSeconds, 0) * 10) / 10,
    bySplit: rows.reduce((acc, r) => { acc[r.split] = (acc[r.split] ?? 0) + 1; return acc }, {}),
    wavWritten: writeWav,
    outDir,
  },
  groundTruth: { onsetAlignment: onsetStats },
  basicPitchOnSynth: {
    note: 'error variation on synthetic audio is not evidence about real instruments',
    overall: byGroup('texture').mixed ? null : null,
    byTexture: byGroup('texture'),
    byInstrument: byGroup('instrument'),
    bySplit: byGroup('split'),
  },
  clips: rows,
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 1))
console.log('\nplan:', JSON.stringify(report.plan.bySplit), '| demo clips', rows.length, '| notes', totalNotes)
console.log('onset alignment:', JSON.stringify(onsetStats))
console.log('BP by instrument:', JSON.stringify(report.basicPitchOnSynth.byInstrument))
console.log('BP by texture:', JSON.stringify(Object.fromEntries(Object.entries(report.basicPitchOnSynth.byTexture).map(([k, v]) => [k, v.f1At60ms]))))
console.log('written', resolveOut(jsonOut))

#!/usr/bin/env node
/**
 * FRESH SEALED BASELINE (split integrity).
 *
 * Every recording used in earlier studies was either development (00, 04) or
 * an inspected holdout (01). Those numbers can no longer be called unseen:
 * model and extractor decisions were informed by them. This script measures
 * production Basic Pitch on takes 02 and 03, which have never been used for
 * any decision, so the number here is a clean reference for future work.
 *
 * Reports note-level micro precision/recall/F1, onset and duration error,
 * octave errors, and the error split by register (bass / mid / high), plus
 * the dense-versus-sparse split.
 *
 * Usage: node --expose-gc scripts/audio-vision-fresh-baseline.mjs [--json out]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { scoreEvents, inventedRate } from './lib/eventScore.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/fresh-sealed-baseline.json')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

// Sealed: takes 02 and 03, never used for tuning, development or inspection.
const SEALED = [
  { id: 'sealed-02-bn1-comp', base: '02_BN1-129-Eb_comp', density: 'dense' },
  { id: 'sealed-02-bn2-comp', base: '02_BN2-166-Ab_comp', density: 'dense' },
  { id: 'sealed-02-bn3-comp', base: '02_BN3-119-G_comp', density: 'dense' },
  { id: 'sealed-03-bn1-solo', base: '03_BN1-147-Gb_solo', density: 'sparse' },
  { id: 'sealed-03-bn2-solo', base: '03_BN2-131-B_solo', density: 'sparse' },
]

function truthFromJams(path) {
  const jams = JSON.parse(readFileSync(path, 'utf8'))
  const notes = []
  for (const annotation of jams.annotations ?? []) {
    if (annotation.namespace !== 'note_midi' || !Array.isArray(annotation.data)) continue
    for (const o of annotation.data) {
      const midi = Math.round(Number(o.value))
      const onset = Number(o.time)
      const duration = Number(o.duration ?? 0)
      if (!Number.isFinite(midi) || !Number.isFinite(onset)) continue
      notes.push({ midi, onset, offset: onset + (Number.isFinite(duration) ? duration : 0.1) })
    }
  }
  return notes.sort((a, b) => a.onset - b.onset)
}

const registerOf = (midi) => (midi < 48 ? 'bass' : midi < 72 ? 'mid' : 'high')
const report = { generatedAt: new Date().toISOString(), split: 'sealed (takes 02/03, never used)', rows: [], pool: {} }

for (const recording of SEALED) {
  const wavPath = `/tmp/guitarset/${recording.base}_mic.wav`
  const jamsPath = `/tmp/guitarset/jams/${recording.base}.jams`
  if (!existsSync(wavPath) || !existsSync(jamsPath)) { console.warn(`skip ${recording.id}`); continue }
  const truth = truthFromJams(jamsPath)
  const wav = readWavPcm(wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const notes = bp.notes.map((n) => ({ midi: n.midi, onset: n.startSeconds, duration: (n.endSeconds ?? n.startSeconds) - n.startSeconds }))
  const score = scoreEvents(notes, truth)

  // Register split of the errors.
  const byRegister = {}
  for (const reg of ['bass', 'mid', 'high']) {
    const truthReg = truth.filter((t) => registerOf(t.midi) === reg)
    const predReg = notes.filter((n) => registerOf(n.midi) === reg)
    const s = scoreEvents(predReg, truthReg)
    byRegister[reg] = {
      referenceNotes: truthReg.length,
      predicted: predReg.length,
      matched: s.matched,
      missed: s.missed,
      falsePositives: s.falsePositives,
      precision: s.pitchPrecision,
      recall: s.pitchRecall,
    }
  }
  // Octave errors: a predicted note one/two octaves from a reference at that time.
  let octave = 0
  for (const n of notes) {
    const sameTime = truth.filter((t) => Math.abs(t.onset - n.onset) <= 0.12)
    if (sameTime.length && !sameTime.some((t) => t.midi === n.midi) && sameTime.some((t) => Math.abs(t.midi - n.midi) % 12 === 0)) octave += 1
  }
  report.rows.push({
    id: recording.id,
    density: recording.density,
    audioSeconds: Math.round((mono.length / 22050) * 10) / 10,
    referenceNotes: truth.length,
    predicted: notes.length,
    precision: score.pitchPrecision,
    recall: score.pitchRecall,
    eventF1: score.eventF1,
    matched: score.matched,
    missed: score.missed,
    falsePositives: score.falsePositives,
    onsetMaeMs: score.onsetMaeMs,
    durationMaeMs: score.durationMaeMs,
    octaveErrors: octave,
    inventedRate: inventedRate(notes, truth),
    byRegister,
    runtimeMs: bp.stats.ms,
  })
  console.log(`${recording.id} (${recording.density}): F1 ${score.eventF1} (P ${score.pitchPrecision} R ${score.pitchRecall}) ` +
    `| bass ${byRegister.bass.recall}/${byRegister.bass.precision} mid ${byRegister.mid.recall}/${byRegister.mid.precision} high ${byRegister.high.recall}/${byRegister.high.precision}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const pool = (rows) => {
  const sum = (pick) => rows.reduce((a, r) => a + (pick(r) ?? 0), 0)
  const matched = sum((r) => r.matched)
  const predicted = sum((r) => r.predicted)
  const reference = sum((r) => r.referenceNotes)
  const precision = predicted ? matched / predicted : 0
  const recall = reference ? matched / reference : 0
  const mean = (pick) => {
    const v = rows.map(pick).filter((x) => Number.isFinite(x))
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null
  }
  const reg = {}
  for (const k of ['bass', 'mid', 'high']) {
    const ref = sum((r) => r.byRegister[k].referenceNotes)
    const mat = sum((r) => r.byRegister[k].matched)
    reg[k] = { referenceNotes: ref, matched: mat, recall: ref ? Math.round((mat / ref) * 1000) / 1000 : null }
  }
  return {
    recordings: rows.length,
    referenceNotes: reference,
    predicted,
    matched,
    microPrecision: Math.round(precision * 1000) / 1000,
    microRecall: Math.round(recall * 1000) / 1000,
    microF1: Math.round((precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0) * 1000) / 1000,
    missed: sum((r) => r.missed),
    falsePositives: sum((r) => r.falsePositives),
    octaveErrors: sum((r) => r.octaveErrors),
    onsetMaeMs: mean((r) => r.onsetMaeMs),
    durationMaeMs: mean((r) => r.durationMaeMs),
    inventedRate: mean((r) => r.inventedRate),
    runtimeMs: sum((r) => r.runtimeMs),
    registers: reg,
  }
}
report.pool.all = pool(report.rows)
report.pool.dense = pool(report.rows.filter((r) => r.density === 'dense'))
report.pool.sparse = pool(report.rows.filter((r) => r.density === 'sparse'))
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nSEALED POOL', JSON.stringify(report.pool, null, 2))
console.log('written', resolveOut(jsonOut))

#!/usr/bin/env node
/**
 * Reproducible real-audio benchmark over the mic-real corpus (CC-BY-4.0).
 * Runs the UNCHANGED production Basic Pitch model + extractor on every clip,
 * scores against the manifest truth notes, reports per-clip and aggregate
 * metrics by instrument / category / split. This is the reconciled benchmark
 * manifest referenced by the real-audio ground-truth mission.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json')+1] : 'benchmarks/audio-vision/real-bench.json'
const splitFilter = args.includes('--split') ? args[args.indexOf('--split')+1] : null
const instFilter = args.includes('--instrument') ? args[args.indexOf('--instrument')+1] : null
const resolveOut = (v) => v.startsWith('/') ? v : join(root, v)
const SR = 22050
const regOf = (m) => m < 48 ? 'bass' : m < 72 ? 'mid' : 'high'

const manifest = JSON.parse(readFileSync(join(root, 'benchmarks/mic-real/manifest.json'), 'utf8'))
const alignProbe = JSON.parse(readFileSync(join(root, 'benchmarks/audio-vision/align-probe.json'), 'utf8'))
const deltaById = Object.fromEntries((alignProbe.rows || []).map((r) => [r.id, r.bestDelta ?? 0]))
let clips = manifest.clips
if (splitFilter) clips = clips.filter(c => c.split === splitFilter)
if (instFilter) clips = clips.filter(c => c.instrument === instFilter)

const rows = []
for (const c of clips) {
  const wav = readWavPcm(join(root, 'benchmarks/mic-real', c.audio.file))
  const samples = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, SR)
  const bp = await predictBasicPitchNode(samples, { modelDir: join(root, 'public/neural-model') })
  const pred = bp.notes.map(n => ({ midi: n.midi, onset: n.startSeconds, duration: (n.endSeconds ?? n.startSeconds) - n.startSeconds }))
  const delta = deltaById[c.id] ?? 0
  const allTruth = (c.truth.notes || []).map(n => ({ midi: n.midi, onset: n.onset, offset: n.offset ?? n.onset + 0.3 }))
  const allTruthAligned = allTruth.map(n => ({ midi: n.midi, onset: n.onset + delta, offset: (n.offset ?? n.onset + 0.3) + delta }))
  const truth = allTruth.filter(n => n.onset >= 0)
  const truthAligned = allTruthAligned.filter(n => n.onset >= 0)
  const excluded = allTruth.length - truth.length
  const score = scoreEvents(pred, truth, { tolerance: 0.12 })
  const scoreAligned = scoreEvents(pred, truthAligned, { tolerance: 0.12 })
  const octave = (() => { let k = 0; for (const p of pred) { const same = truth.filter(t => Math.abs(t.onset - p.onset) <= 0.12); if (same.length && !same.some(t => t.midi === p.midi) && same.some(t => Math.abs(t.midi - p.midi) % 12 === 0)) k += 1 } return k })()
  const octaveAligned = (() => { let k = 0; for (const p of pred) { const same = truthAligned.filter(t => Math.abs(t.onset - p.onset) <= 0.12); if (same.length && !same.some(t => t.midi === p.midi) && same.some(t => Math.abs(t.midi - p.midi) % 12 === 0)) k += 1 } return k })()
  const reg = {}
  for (const r of ['bass', 'mid', 'high']) {
    const t = truth.filter(n => regOf(n.midi) === r); const p = pred.filter(n => regOf(n.midi) === r)
    const s = scoreEvents(p, t, { tolerance: 0.12 })
    reg[r] = { notes: t.length, pred: p.length, precision: s.pitchPrecision, recall: s.pitchRecall, f1: s.eventF1 }
  }
  const shortTruth = truth.filter(n => (n.offset - n.onset) < 0.2)
  const shortScore = shortTruth.length ? scoreEvents(pred, shortTruth, { tolerance: 0.12 }) : null
  const denseTruth = truth.filter(n => truth.filter(m => Math.abs(m.onset - n.onset) <= 0.08).length >= 3)
  const denseScore = denseTruth.length ? scoreEvents(pred, denseTruth, { tolerance: 0.12 }) : null
  const shortTruthAligned = truthAligned.filter(n => (n.offset - n.onset) < 0.2)
  const denseTruthAligned = truthAligned.filter(n => truthAligned.filter(m => Math.abs(m.onset - n.onset) <= 0.08).length >= 3)
  rows.push({
    id: c.id, instrument: c.instrument, category: c.category, split: c.split, dataset: c.dataset,
    truthTotal: allTruth.length, truthInClip: truth.length, truthExcludedNegative: excluded,
    predCount: pred.length, precision: score.pitchPrecision, recall: score.pitchRecall, f1: score.eventF1,
    precisionAligned: scoreAligned.pitchPrecision, recallAligned: scoreAligned.pitchRecall, f1Aligned: scoreAligned.eventF1,
    matched: score.matched, missed: score.missed, falsePositives: score.falsePositives,
    matchedAligned: scoreAligned.matched, missedAligned: scoreAligned.missed,
    delta: delta,
    bass: reg.bass, mid: reg.mid, high: reg.high,
    shortNotes: shortTruth.length, shortRecall: shortTruth.length ? shortScore.pitchRecall : null,
    denseNotes: denseTruth.length, denseRecall: denseTruth.length ? denseScore.pitchRecall : null, denseF1: denseTruth.length ? denseScore.eventF1 : null,
    octaveErrors: octave, octaveErrorsAligned: octaveAligned,
    onsetMaeMs: score.onsetMaeMs, durationMaeMs: score.durationMaeMs,
    onsetMaeMsAligned: scoreAligned.onsetMaeMs,
    truthInClipAligned: truthAligned.length,
    shortRecallAligned: shortTruthAligned.length ? scoreEvents(pred, shortTruthAligned, {tolerance:0.12}).pitchRecall : null,
    denseRecallAligned: denseTruthAligned.length ? scoreEvents(pred, denseTruthAligned, {tolerance:0.12}).pitchRecall : null,
  })
  console.log(`${c.id.padEnd(32)} ${c.instrument.padEnd(16)} ${c.split.padEnd(9)} notes ${String(truth.length).padStart(2)} pred ${String(pred.length).padStart(2)} F1 ${score.eventF1} R ${score.pitchRecall} P ${score.pitchPrecision} oct ${octave} false ${score.falsePositives}`)
}
await closeBasicPitchNode()

const mean = (v) => { const x = v.filter(n => Number.isFinite(n)); return x.length ? Math.round(x.reduce((a, b) => a + b, 0) / x.length * 1000) / 1000 : null }
const agg = (list) => ({
  clips: list.length, truthNotes: list.reduce((a, r) => a + r.truthInClip, 0), predNotes: list.reduce((a, r) => a + r.predCount, 0),
  precision: mean(list.map(r => r.precision)), recall: mean(list.map(r => r.recall)), f1: mean(list.map(r => r.f1)),
  bassRecall: mean(list.filter(r => r.bass.notes > 0).map(r => r.bass.recall)),
  midRecall: mean(list.filter(r => r.mid.notes > 0).map(r => r.mid.recall)),
  highRecall: mean(list.filter(r => r.high.notes > 0).map(r => r.high.recall)),
  shortRecall: mean(list.filter(r => r.shortNotes > 0).map(r => r.shortRecall)),
  denseRecall: mean(list.filter(r => r.denseNotes > 0).map(r => r.denseRecall)),
  denseF1: mean(list.filter(r => r.denseNotes > 0).map(r => r.denseF1)),
  octaveErrors: list.reduce((a, r) => a + r.octaveErrors, 0),
  falseNotes: list.reduce((a, r) => a + r.falsePositives, 0),
  onsetMaeMs: mean(list.map(r => r.onsetMaeMs)), durationMaeMs: mean(list.map(r => r.durationMaeMs)),
  negativeOnsetExcluded: list.reduce((a, r) => a + r.truthExcludedNegative, 0),
  precisionAligned: mean(list.map(r => r.precisionAligned)),
  recallAligned: mean(list.map(r => r.recallAligned)),
  f1Aligned: mean(list.map(r => r.f1Aligned)),
  octaveErrorsAligned: list.reduce((a, r) => a + (r.octaveErrorsAligned || 0), 0),
  onsetMaeMsAligned: mean(list.map(r => r.onsetMaeMsAligned)),
})
const byInstrument = {}, byCategory = {}, bySplit = {}
for (const inst of [...new Set(clips.map(c => c.instrument))]) byInstrument[inst] = agg(rows.filter(r => r.instrument === inst))
for (const cat of [...new Set(clips.map(c => c.category))]) byCategory[cat] = agg(rows.filter(r => r.category === cat))
for (const sp of [...new Set(clips.map(c => c.split))]) bySplit[sp] = agg(rows.filter(r => r.split === sp))
const report = {
  generatedAt: new Date().toISOString(),
  description: 'Reconciled real-audio benchmark: unchanged production Basic Pitch model + extractor on mic-real corpus (CC-BY-4.0). Onset tolerance 0.12s, exact pitch match. Truth filtered to onset>=0 (clip-aligned); negative-onset notes reported separately.',
  model: 'public/neural-model (released Basic Pitch, TF.js)',
  alignment: 'raw = manifest truth as-is; aligned = align-probe bestDelta applied to truth onsets (documented, per-clip measured).',
  extractor: 'production (0.65/0.50/3)',
  clips: clips.length, rows, aggregate: agg(rows),
  byInstrument, byCategory, bySplit,
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 1))
console.log('\nAGGREGATE', JSON.stringify(report.aggregate, null, 1))
console.log('\nBY INSTRUMENT')
for (const [k, v] of Object.entries(byInstrument)) console.log(k, JSON.stringify(v))
console.log('\nBY SPLIT')
for (const [k, v] of Object.entries(bySplit)) console.log(k, JSON.stringify(v))
console.log('written', resolveOut(jsonOut))

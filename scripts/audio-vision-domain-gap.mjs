#!/usr/bin/env node
/**
 * Domain gap: what actually differs between real recordings and the synthetic
 * corpus, measured per note, and how the released Basic Pitch model behaves on
 * each. The point is to find the gaps that explain the model's real errors
 * (missed bass, dense polyphony, quiet inner voices) - not to chase numbers.
 *
 * Features per isolated note (waveform analysis, no deps):
 *   attackMs     10% -> 90% of the note's own envelope
 *   decayTauMs   exponential fit over 40..350 ms after the peak
 *   centroidHz   energy centroid over the first 200 ms
 *   h1Share      energy in f0 +-3 % over total band energy
 *   evenOdd      energy at 2f0/4f0 over energy at 3f0/5f0
 *   noiseFloorDb RMS in the 40 ms before onset, relative to the note peak
 *
 * Plus Basic Pitch results by register on the same material.
 *
 * Usage: node --expose-gc scripts/audio-vision-domain-gap.mjs [--json out]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { compositionSpec, renderComposition } from './lib/synthCorpus.mjs'
import { scoreEvents } from './lib/eventScore.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : 'benchmarks/audio-vision/domain-gap.json'
const resolveOut = (v) => (v.startsWith('/') ? v : join(root, v))
const SR = 22050

/* ------------------------------------------------------------ DSP helpers */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k)
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
      }
    }
  }
}
const NFFT = 2048
function spectrum(samples, startSample) {
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT)
  for (let i = 0; i < NFFT; i += 1) {
    const s = samples[startSample + i] ?? 0
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NFFT - 1))) // Hann
  }
  fft(re, im)
  const mag = new Float64Array(NFFT / 2)
  for (let i = 0; i < NFFT / 2; i += 1) mag[i] = Math.hypot(re[i], im[i])
  return mag
}
function bandEnergy(mag, f0, harmonic, width = 0.04) {
  const binHz = SR / NFFT
  const centre = f0 * harmonic
  let sum = 0
  for (let i = 1; i < mag.length; i += 1) if (Math.abs(i * binHz - centre) <= centre * width) sum += mag[i] * mag[i]
  return sum
}
function envFrames(samples, start, frames, size = 64) {
  const out = []
  for (let f = 0; f < frames; f += 1) {
    let sum = 0
    for (let i = 0; i < size; i += 1) { const v = samples[start + f * size + i] ?? 0; sum += v * v }
    out.push(Math.sqrt(sum / size))
  }
  return out
}
function noteFeatures(samples, note) {
  const s0 = Math.floor(note.onsetSeconds * SR)
  const f0 = 440 * 2 ** ((note.midi - 69) / 12)
  const env = envFrames(samples, s0, 60) // ~174 ms
  const peak = Math.max(...env)
  if (peak < 1e-4) return null
  const i10 = env.findIndex((v) => v >= peak * 0.1)
  const i90 = env.findIndex((v) => v >= peak * 0.9)
  const attackMs = i10 >= 0 && i90 >= i10 ? ((i90 - i10) * 64 / SR) * 1000 : null
  // decay: log-linear fit on the envelope after the peak
  const from = Math.max(i90 + 2, 4), to = Math.min(env.length - 1, 34)
  let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0
  for (let i = from; i <= to; i += 1) { if (env[i] <= 0) continue; const y = Math.log(env[i]); sx += i; sy += y; sxx += i * i; sxy += i * y; k += 1 }
  const slope = k > 2 ? (k * sxy - sx * sy) / (k * sxx - sx * sx) : 0
  const decayTauMs = slope < 0 ? Math.round((-1 / slope) * (64 / SR) * 1000) : null
  const mag = spectrum(samples, s0 + Math.floor(0.01 * SR))
  const binHz = SR / NFFT
  let total = 0, centroidNum = 0
  for (let i = 1; i < mag.length; i += 1) { const e = mag[i] * mag[i]; total += e; centroidNum += e * i * binHz }
  const centroidHz = total > 0 ? Math.round(centroidNum / total) : null
  const h1 = bandEnergy(mag, f0, 1)
  const h2 = bandEnergy(mag, f0, 2) + bandEnergy(mag, f0, 4)
  const h3 = bandEnergy(mag, f0, 3) + bandEnergy(mag, f0, 5)
  const preStart = Math.max(0, s0 - Math.floor(0.04 * SR))
  let pre = 0
  for (let i = preStart; i < s0; i += 1) { const v = samples[i] ?? 0; pre += v * v }
  const preRms = Math.sqrt(pre / Math.max(1, s0 - preStart))
  return {
    attackMs, decayTauMs, centroidHz,
    h1Share: total > 0 ? Math.round((h1 / total) * 1000) / 1000 : null,
    evenOdd: h3 > 0 ? Math.round((h2 / h3) * 100) / 100 : null,
    noiseFloorDb: Math.round(20 * Math.log10(Math.max(1e-9, preRms) / Math.max(1e-9, peak)) * 10) / 10,
  }
}
const median = (v) => { const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const summarise = (rows) => ({
  notes: rows.length,
  attackMs: median(rows.map((r) => r.attackMs)),
  decayTauMs: median(rows.map((r) => r.decayTauMs)),
  centroidHz: median(rows.map((r) => r.centroidHz)),
  h1Share: median(rows.map((r) => r.h1Share)),
  evenOdd: median(rows.map((r) => r.evenOdd)),
  noiseFloorDb: median(rows.map((r) => r.noiseFloorDb)),
})

/* ---------------------------------------------------------------- sources */
function jamsNotes(base) {
  const p = `/tmp/guitarset/jams/${base}.jams`
  if (!existsSync(p)) return []
  const d = JSON.parse(readFileSync(p, 'utf8')); const out = []
  for (const a of d['annotations']) {
    if (a.namespace !== 'note_midi' || !a.data) continue
    for (const o of a.data) { const m = Math.round(Number(o.value)); const t = Number(o.time); if (m >= 21 && m <= 108) out.push({ midi: m, onsetSeconds: t, offsetSeconds: t + Math.max(0.05, Number(o.duration ?? 0.1)) }) }
  }
  return out.sort((a, b) => a.onsetSeconds - b.onsetSeconds)
}
function loadMono(path) {
  const wav = readWavPcm(path)
  return resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, SR)
}
const isolated = (notes, i, tol = 0.05) => !notes.some((n, j) => j !== i && Math.abs(n.onsetSeconds - notes[i].onsetSeconds) < tol)

const guitarTakes = readdirSync('/tmp/guitarset').filter((f) => /^02_.*_mic\.wav$/.test(f)).slice(0, 4)
const pianoClips = JSON.parse(readFileSync(join(root, 'benchmarks/mic-real/manifest.json'), 'utf8')).clips
  .filter((c) => c.instrument === 'piano' && (c.truth?.notes?.length ?? 0) > 0).slice(0, 4)

const sources = []
for (const f of guitarTakes) {
  const base = f.replace('_mic.wav', '')
  sources.push({ id: `real:${base}`, kind: 'real-guitar', instrument: 'guitar', samples: loadMono(`/tmp/guitarset/${f}`), notes: jamsNotes(base) })
}
// The Vienna piano clips carry a documented truth-origin offset; δ comes from
// the audio-only align probe (fixed before any model scoring) and is applied
// here to both the features and the model comparison.
const probe = JSON.parse(readFileSync(join(root, 'benchmarks/audio-vision/align-probe.json'), 'utf8'))
const deltaById = Object.fromEntries((probe.rows ?? []).map((r) => [r.id, r.bestDelta ?? 0]))
for (const c of pianoClips) {
  const delta = deltaById[c.id] ?? 0
  sources.push({
    id: `real:${c.id}`, kind: 'real-piano', instrument: 'piano',
    samples: loadMono(join(root, 'benchmarks/mic-real', c.audio.file)),
    notes: c.truth.notes.map((n) => ({ midi: n.midi, onsetSeconds: n.onset + delta, offsetSeconds: (n.offset ?? n.onset + 0.3) + delta })).filter((n) => n.onsetSeconds >= 0.01),
  })
}
for (const instrument of ['piano', 'guitar']) {
  for (const texture of ['single', 'chords']) {
    const spec = compositionSpec({ id: `gap-${instrument}-${texture}`, instrument, texture, bars: 2, bpm: 96 })
    const r = renderComposition(spec)
    sources.push({ id: `synth:${instrument}-${texture}`, kind: `synth-${instrument}`, instrument, samples: r.samples, notes: spec.notes })
  }
}

/* ------------------------------------------------------- measure + model */
const report = { generatedAt: new Date().toISOString(), features: {}, model: {}, perSource: [] }
const featByKind = {}
for (const source of sources) {
  const rows = []
  for (let i = 0; i < source.notes.length; i += 1) {
    if (!isolated(source.notes, i)) continue
    const f = noteFeatures(source.samples, source.notes[i])
    if (f) rows.push({ ...f, midi: source.notes[i].midi })
  }
  featByKind[source.kind] = (featByKind[source.kind] ?? []).concat(rows)
  const bp = await predictBasicPitchNode(source.samples, { modelDir: join(root, 'public/neural-model') })
  const pred = bp.notes.map((n) => ({ midi: n.midi, onset: n.startSeconds, duration: (n.endSeconds ?? n.startSeconds) - n.startSeconds }))
  const truth = source.notes.map((n) => ({ midi: n.midi, onset: n.onsetSeconds, offset: n.offsetSeconds }))
  const score = scoreEvents(pred, truth, { tolerance: 0.12 })
  const reg = {}
  for (const [name, lo, hi] of [['bass', 0, 48], ['mid', 48, 72], ['high', 72, 200]]) {
    const t = truth.filter((n) => n.midi >= lo && n.midi < hi)
    const p = pred.filter((n) => n.midi >= lo && n.midi < hi)
    const s = scoreEvents(p, t)
    reg[name] = { notes: t.length, recall: s.pitchRecall, precision: s.pitchPrecision }
  }
  report.perSource.push({ id: source.id, kind: source.kind, notes: truth.length, predicted: pred.length, f1: score.eventF1, precision: score.pitchPrecision, recall: score.pitchRecall, onsetMaeMs: score.onsetMaeMs, register: reg })
  console.log(`${source.id.padEnd(34)} F1 ${score.eventF1}  P ${score.pitchPrecision}  R ${score.pitchRecall}  bassRecall ${reg.bass.recall}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()
for (const [kind, rows] of Object.entries(featByKind)) report.features[kind] = summarise(rows)
const byKind = (kind) => report.perSource.filter((r) => r.kind === kind)
const agg = (list) => ({
  recordings: list.length,
  f1: Math.round((list.reduce((a, r) => a + r.f1, 0) / Math.max(1, list.length)) * 1000) / 1000,
  precision: Math.round((list.reduce((a, r) => a + r.precision, 0) / Math.max(1, list.length)) * 1000) / 1000,
  recall: Math.round((list.reduce((a, r) => a + r.recall, 0) / Math.max(1, list.length)) * 1000) / 1000,
  bassRecall: Math.round((list.reduce((a, r) => a + (r.register.bass.recall ?? 0), 0) / Math.max(1, list.length)) * 1000) / 1000,
})
for (const kind of ['real-guitar', 'real-piano', 'synth-guitar', 'synth-piano']) report.model[kind] = agg(byKind(kind))
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 1))
console.log('\nFEATURES', JSON.stringify(report.features, null, 1))
console.log('\nMODEL', JSON.stringify(report.model, null, 1))
console.log('written', resolveOut(jsonOut))

#!/usr/bin/env node
/**
 * A/B: harmonic-double suppression, amplitude only vs amplitude + listening.
 *
 * Both variants take the same extracted notes and the same arrangement path.
 * The only difference is whether the audio's harmonic salience can save a
 * quiet octave that the amplitude rule would delete.
 *
 * Reported per recording and pooled (micro):
 *   note level   precision / recall / F1 against the reference
 *   damage       notes removed that the reference DOES contain (real music
 *                deleted) vs removed notes the reference does not contain
 *   arrangement  the final score's event F1 against the reference
 *
 * Usage:
 *   node --expose-gc scripts/audio-vision-spectral-suppression.mjs --set dev|holdout|micreal|all
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import {
  quantizeToBeats,
  suppressHarmonicDoubles,
  buildMelodyContour,
} from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { scoreEvents, melodyAnchors, anchorRecall, inventedRate } from './lib/eventScore.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const which = argValue('--set', 'all')
const jsonOut = argValue('--json', `benchmarks/audio-vision/spectral-suppression-${which}.json`)
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const DEV = [
  { id: 'guitarset-ss3-comp', base: '00_SS3-84-Bb_comp', density: 'dense' },
  { id: 'guitarset-bn2-comp', base: '00_BN2-131-B_comp', density: 'dense' },
  { id: 'guitarset-funk3-comp', base: '00_Funk3-112-C#_comp', density: 'dense' },
  { id: 'guitarset-jazz2-solo', base: '04_Jazz2-110-Bb_solo', density: 'sparse' },
  { id: 'guitarset-jazz1-solo', base: '04_Jazz1-200-B_solo', density: 'sparse' },
]
const HOLDOUT = [
  { id: 'holdout-bn1-comp', base: '01_BN1-129-Eb_comp', density: 'dense' },
  { id: 'holdout-bn2-comp', base: '01_BN2-166-Ab_comp', density: 'dense' },
  { id: 'holdout-funk1-comp', base: '01_Funk1-114-Ab_comp', density: 'dense' },
  { id: 'holdout-bn1-solo', base: '01_BN1-129-Eb_solo', density: 'sparse' },
  { id: 'holdout-bn2-solo', base: '01_BN2-166-Ab_solo', density: 'sparse' },
]

function truthFromJams(path) {
  const jams = JSON.parse(readFileSync(path, 'utf8'))
  const notes = []
  for (const annotation of jams.annotations ?? []) {
    if (annotation.namespace !== 'note_midi' || !Array.isArray(annotation.data)) continue
    for (const observation of annotation.data) {
      const midi = Math.round(Number(observation.value))
      const onset = Number(observation.time)
      if (!Number.isFinite(midi) || !Number.isFinite(onset)) continue
      notes.push({ midi, onset })
    }
  }
  return notes.sort((a, b) => a.onset - b.onset)
}

function micReal() {
  const manifestPath = join(root, 'benchmarks/mic-real/manifest.json')
  if (!existsSync(manifestPath)) return []
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return (manifest.clips ?? []).map((clip) => ({
    id: clip.id,
    instrument: clip.instrument ?? 'unknown',
    path: join(root, 'benchmarks/mic-real', clip.audio.file),
    truth: (clip.truth?.notes ?? []).map((n) => ({ midi: n.midi, onset: n.onset })),
  })).filter((c) => c.truth.length && existsSync(c.path))
}

const jobs = []
if (which === 'dev' || which === 'all') {
  for (const r of DEV) {
    const wavPath = `/tmp/guitarset/${r.base}_mic.wav`
    const jamsPath = `/tmp/guitarset/jams/${r.base}.jams`
    if (existsSync(wavPath) && existsSync(jamsPath)) jobs.push({ ...r, wavPath, truth: truthFromJams(jamsPath) })
  }
}
if (which === 'holdout' || which === 'all') {
  for (const r of HOLDOUT) {
    const wavPath = `/tmp/guitarset/${r.base}_mic.wav`
    const jamsPath = `/tmp/guitarset/jams/${r.base}.jams`
    if (existsSync(wavPath) && existsSync(jamsPath)) jobs.push({ ...r, wavPath, truth: truthFromJams(jamsPath) })
  }
}
if (which === 'micreal' || which === 'all') {
  for (const c of micReal()) jobs.push({ ...c, density: 'n/a', wavPath: c.path })
}

const noteScore = (notes, truth) => {
  const used = new Set()
  let matched = 0
  for (const note of notes) {
    for (let i = 0; i < truth.length; i += 1) {
      if (used.has(i)) continue
      const t = truth[i]
      if (t.midi === Math.round(note.midi) && Math.abs(t.onset - note.startSeconds) <= 0.12) { used.add(i); matched += 1; break }
    }
  }
  const precision = notes.length ? matched / notes.length : 0
  const recall = truth.length ? matched / truth.length : 0
  return {
    matched,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: precision + recall > 0 ? Math.round((2 * precision * recall) / (precision + recall) * 1000) / 1000 : 0,
  }
}

const report = { generatedAt: new Date().toISOString(), set: which, rows: [], summary: {} }

for (const job of jobs) {
  const wav = readWavPcm(job.wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const raw = bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude ?? null }))
  const ampOnly = suppressHarmonicDoubles(raw)
  const spectral = suppressHarmonicDoubles(raw, { samples: mono, sampleRate: 22050 })
  // Damage: removed notes that the reference contains.
  const damageOf = (before, after) => {
    const kept = new Set(after.notes.map((n) => `${Math.round(n.midi)}@${n.startSeconds.toFixed(3)}`))
    const dropped = before.filter((n) => !kept.has(`${Math.round(n.midi)}@${n.startSeconds.toFixed(3)}`))
    return {
      dropped: dropped.length,
      genuine: dropped.filter((n) => job.truth.some((t) => t.midi === Math.round(n.midi) && Math.abs(t.onset - n.startSeconds) <= 0.12)).length,
    }
  }
  const damageAmp = damageOf(raw, ampOnly)
  const damageSpectral = damageOf(raw, spectral)

  const chain = async (notes) => {
    const views = await buildAnalysisViews(mono, 22050)
    const analysis = await analyzeMusic(mono, 22050, {
      views,
      corroborateNotes: false,
      predictNotes: async () => notes.map((n) => ({ ...n })),
    })
    const beat0 = analysis.beats.beats[0] ?? 0
    const period = analysis.beats.beatPeriodSeconds
    const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
    const contour = buildMelodyContour(analysis.melody, { beat0, beatPeriod: period })
    const arranged = arrangeSoloPiano({
      quantizedNotes: quantized,
      chords: analysis.chords,
      melodyByBeat: (analysis.melody ?? []).map((m) => ({ beat: (m.seconds - beat0) / period, midi: m.midi })),
      difficulty: 'intermediate',
      melodyContour: contour,
      beat0,
      beatPeriod: period,
    })
    const simplified = simplifyForDifficulty(
      arranged.events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
      'intermediate',
    ).map((e) => ({ ...e, startBeat: e.quantizedStartBeat ?? e.startBeat, durBeats: e.quantizedDurBeats ?? e.durBeats }))
    const events = simplified.map((e) => ({ midi: e.midi, onset: beat0 + (e.startBeat ?? 0) * period, duration: (e.durBeats ?? 0) * period }))
    return { events, analysis, score: scoreEvents(events, job.truth) }
  }
  const ampChain = await chain(ampOnly.notes)
  const specChain = await chain(spectral.notes)
  const anchors = melodyAnchors(job.truth)
  const row = {
    id: job.id,
    density: job.density,
    instrument: job.instrument ?? 'guitar',
    referenceNotes: job.truth.length,
    modelNotes: raw.length,
    amplitudeOnly: {
      notes: ampOnly.notes.length,
      suppressed: ampOnly.suppressed,
      damage: damageAmp,
      noteLevel: noteScore(ampOnly.notes, job.truth),
      arrangement: ampChain.score,
      melodyRecall: anchorRecall(ampChain.events, anchors).recall,
      invented: inventedRate(ampChain.events, job.truth),
    },
    spectral: {
      notes: spectral.notes.length,
      suppressed: spectral.suppressed,
      damage: damageSpectral,
      noteLevel: noteScore(spectral.notes, job.truth),
      arrangement: specChain.score,
      melodyRecall: anchorRecall(specChain.events, anchors).recall,
      invented: inventedRate(specChain.events, job.truth),
    },
  }
  report.rows.push(row)
  console.log(`${job.id}: notes ${raw.length} -> amp ${ampOnly.notes.length} / spec ${spectral.notes.length} ` +
    `| noteF1 ${row.amplitudeOnly.noteLevel.f1} -> ${row.spectral.noteLevel.f1} ` +
    `| arrF1 ${row.amplitudeOnly.arrangement.eventF1} -> ${row.spectral.arrangement.eventF1} ` +
    `| damage ${damageAmp.genuine} -> ${damageSpectral.genuine} genuine`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const pool = (rows) => {
  const ref = rows.reduce((a, r) => a + r.referenceNotes, 0)
  const mat = (k) => rows.reduce((a, r) => a + r[k].noteLevel.matched, 0)
  const prec = (k) => rows.reduce((a, r) => a + r[k].noteLevel.precision * (r[k].notes || 0), 0) / Math.max(1, rows.reduce((a, r) => a + r[k].notes, 0))
  const recall = (k) => mat(k) / Math.max(1, ref)
  const f1 = (k) => {
    const p = prec(k)
    const rc = recall(k)
    return Math.round((p + rc > 0 ? (2 * p * rc) / (p + rc) : 0) * 1000) / 1000
  }
  const mean = (pick) => {
    const v = rows.map(pick).filter((x) => Number.isFinite(x))
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null
  }
  return {
    recordings: rows.length,
    referenceNotes: ref,
    amplitudeOnly: {
      notePrecision: Math.round(prec('amplitudeOnly') * 1000) / 1000,
      noteRecall: Math.round(recall('amplitudeOnly') * 1000) / 1000,
      noteF1: f1('amplitudeOnly'),
      genuineDropped: rows.reduce((a, r) => a + r.amplitudeOnly.damage.genuine, 0),
      arrangementF1: mean((r) => r.amplitudeOnly.arrangement.eventF1),
      melodyRecall: mean((r) => r.amplitudeOnly.melodyRecall),
      invented: mean((r) => r.amplitudeOnly.invented),
    },
    spectral: {
      notePrecision: Math.round(prec('spectral') * 1000) / 1000,
      noteRecall: Math.round(recall('spectral') * 1000) / 1000,
      noteF1: f1('spectral'),
      genuineDropped: rows.reduce((a, r) => a + r.spectral.damage.genuine, 0),
      arrangementF1: mean((r) => r.spectral.arrangement.eventF1),
      melodyRecall: mean((r) => r.spectral.melodyRecall),
      invented: mean((r) => r.spectral.invented),
    },
  }
}
report.summary.all = pool(report.rows)
report.summary.byDensity = {}
for (const density of [...new Set(report.rows.map((r) => r.density))]) {
  report.summary.byDensity[density] = pool(report.rows.filter((r) => r.density === density))
}
report.summary.byInstrument = {}
for (const instrument of [...new Set(report.rows.map((r) => r.instrument ?? 'unknown'))]) {
  report.summary.byInstrument[instrument] = pool(report.rows.filter((r) => (r.instrument ?? 'unknown') === instrument))
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nALL', JSON.stringify(report.summary.all, null, 2))
console.log('written', resolveOut(jsonOut))

#!/usr/bin/env node
/**
 * CONTROLLED MODEL COMPARISON — Basic Pitch (production) vs hFT-Transformer.
 *
 * Research only. Both models are scored on the SAME recordings with the SAME
 * matcher and the SAME truth:
 *   - five UNSEEN GuitarSet takes (held out from every calibration sweep)
 *   - the seven usable Vienna piano clips, with the documented per-clip truth
 *     origin shift (align-probe δ, derived from audio alone) applied
 *
 * Reported per recording and pooled by instrument: note precision, recall,
 * event F1, onset MAE, duration MAE, octave errors, false-note rate, the
 * missed-note count, inference time and the model size.
 *
 * The hFT notes come from a separate Python run (scripts/audio-vision-hft-run.md
 * documents the exact commands); this script never runs the candidate itself.
 *
 * Usage: node --expose-gc scripts/audio-vision-model-comparison.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { scoreEvents, melodyAnchors, anchorRecall, inventedRate } from './lib/eventScore.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/model-comparison.json')
const hftDir = argValue('--hft-notes', '/tmp/hFT/corpus/note')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const TOL = 0.12
const GUITARSET_HOLDOUT = ['01_BN1-129-Eb_comp', '01_BN2-166-Ab_comp', '01_Funk1-114-Ab_comp', '01_BN1-129-Eb_solo', '01_BN2-166-Ab_solo']

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

function pianoClips() {
  const manifest = JSON.parse(readFileSync(join(root, 'benchmarks/mic-real/manifest.json'), 'utf8'))
  const probe = JSON.parse(readFileSync(join(root, 'benchmarks/audio-vision/align-probe.json'), 'utf8'))
  const deltaById = Object.fromEntries((probe.rows ?? []).map((r) => [r.id, r.bestDelta ?? 0]))
  const excluded = new Set((manifest.excluded ?? []).map((e) => e.id))
  return (manifest.clips ?? [])
    .filter((c) => c.instrument === 'piano' && !excluded.has(c.id) && c.truth?.notes?.length)
    .map((c) => {
      const delta = deltaById[c.id] ?? 0
      return {
        id: c.id,
        instrument: 'piano',
        wavPath: join(root, 'benchmarks/mic-real', c.audio.file),
        truth: c.truth.notes
          .map((n) => ({ midi: n.midi, onset: n.onset + delta, offset: (n.offset ?? n.onset + 0.1) + delta }))
          .filter((n) => n.onset >= 0.01),
        delta,
      }
    })
    .filter((c) => existsSync(c.wavPath) && c.truth.length)
}

const recordings = []
for (const base of GUITARSET_HOLDOUT) {
  const wavPath = `/tmp/guitarset/${base}_mic.wav`
  const jamsPath = `/tmp/guitarset/jams/${base}.jams`
  if (existsSync(wavPath) && existsSync(jamsPath)) {
    recordings.push({ id: base, instrument: 'guitar', wavPath, truth: truthFromJams(jamsPath) })
  }
}
for (const clip of pianoClips()) recordings.push(clip)

const hftNotesFor = (id) => {
  const path = join(hftDir, `${id}_2nd.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')).map((n) => ({
    midi: Math.round(n.pitch),
    onset: n.onset,
    duration: (n.offset ?? n.onset) - n.onset,
  }))
}

/** Octave mistakes: a predicted note one/two octaves from a reference note at that time. */
function octaveErrors(predicted, truth) {
  let exact = 0
  let octave = 0
  for (const p of predicted) {
    const sameTime = truth.filter((t) => Math.abs(t.onset - p.onset) <= TOL)
    if (!sameTime.length) continue
    if (sameTime.some((t) => t.midi === p.midi)) { exact += 1; continue }
    if (sameTime.some((t) => Math.abs(t.midi - p.midi) % 12 === 0)) octave += 1
  }
  return { exact, octave }
}

const report = { generatedAt: new Date().toISOString(), tolerance: TOL, recordings: [], pool: {} }

for (const recording of recordings) {
  const wav = readWavPcm(recording.wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const audioSeconds = mono.length / 22050
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const bpNotes = bp.notes.map((n) => ({ midi: n.midi, onset: n.startSeconds, duration: (n.endSeconds ?? n.startSeconds) - n.startSeconds }))
  const hftNotes = hftNotesFor(recording.id)
  const scoreFor = (notes) => {
    const score = scoreEvents(notes, recording.truth)
    const oct = octaveErrors(notes, recording.truth)
    return {
      notes: notes.length,
      precision: score.pitchPrecision,
      recall: score.pitchRecall,
      eventF1: score.eventF1,
      matched: score.matched,
      missed: score.missed,
      falsePositives: score.falsePositives,
      onsetMaeMs: score.onsetMaeMs,
      durationMaeMs: score.durationMaeMs,
      octaveErrors: oct.octave,
      inventedRate: inventedRate(notes, recording.truth),
      melodyRecall: anchorRecall(notes, melodyAnchors(recording.truth)).recall,
    }
  }
  // Complementarity: reference notes BP misses that the candidate finds, and
  // how many false notes the candidate would add if it were used as a second
  // detector (the honest cost of a cascade).
  const complementarity = (() => {
    if (!hftNotes) return null
    const matchedBy = (notes, t) => notes.some((n) => n.midi === t.midi && Math.abs(n.onset - t.onset) <= TOL)
    const bpMissed = recording.truth.filter((t) => !matchedBy(bpNotes, t))
    const recoveredByHft = bpMissed.filter((t) => matchedBy(hftNotes, t))
    // Union: BP's notes plus the candidate's notes that are real and not
    // already covered. Measure what that union would score.
    const kept = [...hftNotes]
    const union = [...bpNotes, ...kept].filter((n, i, all) => all.findIndex((m) => m.midi === n.midi && Math.abs(m.onset - n.onset) <= 0.05) === i)
    const unionScore = scoreEvents(union, recording.truth)
    return {
      bpMissed: bpMissed.length,
      recoveredByCandidate: recoveredByHft.length,
      candidateFalseNotes: hftNotes.filter((n) => !recording.truth.some((t) => t.midi === n.midi && Math.abs(t.onset - n.onset) <= TOL)).length,
      union: { precision: unionScore.pitchPrecision, recall: unionScore.pitchRecall, eventF1: unionScore.eventF1 },
    }
  })()
  report.recordings.push({
    id: recording.id,
    complementarity,
    instrument: recording.instrument,
    audioSeconds: Math.round(audioSeconds * 10) / 10,
    referenceNotes: recording.truth.length,
    basicPitch: { ...scoreFor(bpNotes), runtimeMs: bp.stats.ms, modelBytes: 916929 },
    hft: hftNotes ? { ...scoreFor(hftNotes), runtimeMs: null, modelBytes: 22136000 } : null,
  })
  const row = report.recordings[report.recordings.length - 1]
  console.log(`${recording.id} (${recording.instrument}): BP F1 ${row.basicPitch.eventF1} (P ${row.basicPitch.precision} R ${row.basicPitch.recall})` +
    (row.hft ? ` | hFT F1 ${row.hft.eventF1} (P ${row.hft.precision} R ${row.hft.recall})` : ' | hFT missing'))
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const pool = (rows) => {
  const mean = (pick) => {
    const v = rows.map(pick).filter((x) => Number.isFinite(x))
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null
  }
  const sum = (pick) => rows.reduce((a, r) => a + (pick(r) ?? 0), 0)
  const pooled = (model) => {
    const ref = sum((r) => r.referenceNotes)
    const matched = sum((r) => r[model]?.matched ?? 0)
    const predicted = sum((r) => r[model]?.notes ?? 0)
    const precision = predicted ? matched / predicted : 0
    const recall = ref ? matched / ref : 0
    return {
      recordings: rows.filter((r) => r[model]).length,
      referenceNotes: ref,
      predicted: predicted,
      matched,
      microPrecision: Math.round(precision * 1000) / 1000,
      microRecall: Math.round(recall * 1000) / 1000,
      microF1: Math.round((precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0) * 1000) / 1000,
      missed: sum((r) => r[model]?.missed ?? 0),
      falsePositives: sum((r) => r[model]?.falsePositives ?? 0),
      octaveErrors: sum((r) => r[model]?.octaveErrors ?? 0),
      onsetMaeMs: mean((r) => r[model]?.onsetMaeMs),
      durationMaeMs: mean((r) => r[model]?.durationMaeMs),
      inventedRate: mean((r) => r[model]?.inventedRate),
      melodyRecall: mean((r) => r[model]?.melodyRecall),
      runtimeMsTotal: sum((r) => r[model]?.runtimeMs ?? 0),
    }
  }
  const complement = {
    recordings: rows.filter((r) => r.complementarity).length,
    bpMissed: sum((r) => r.complementarity?.bpMissed ?? 0),
    recoveredByCandidate: sum((r) => r.complementarity?.recoveredByCandidate ?? 0),
    candidateFalseNotes: sum((r) => r.complementarity?.candidateFalseNotes ?? 0),
  }
  return { basicPitch: pooled('basicPitch'), hft: pooled('hft'), complementarity: complement }
}

report.pool.all = pool(report.recordings)
for (const instrument of ['guitar', 'piano']) {
  report.pool[instrument] = pool(report.recordings.filter((r) => r.instrument === instrument))
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nPOOLED', JSON.stringify(report.pool, null, 2))
console.log('written', resolveOut(jsonOut))

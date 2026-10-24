#!/usr/bin/env node
/**
 * CALIBRATION SWEEP: the note-extraction thresholds.
 *
 * Basic Pitch reports notes by thresholding its own frame and onset
 * probabilities. The shipped values (onset 0.5, frame 0.3, minimum 5 frames)
 * were chosen for general material; on a guitar the model's probability
 * distribution is different, and the dense errors we measured are exactly the
 * kind a threshold moves: a weak harmonic sibling or a late echo crosses the
 * threshold and becomes a note.
 *
 * This sweep runs the model ONCE per recording, keeps its probability
 * matrices, and then re-extracts notes for every threshold triple - the same
 * model, the same audio, only the evidence interpretation changes. Each
 * candidate goes through the real arrangement and is scored against the JAMS
 * truth, so the choice is made on the score, not on the note list.
 *
 * Usage: node --expose-gc scripts/audio-vision-threshold-sweep.mjs [--json out]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { loadBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
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
const jsonOut = argValue('--json', 'benchmarks/audio-vision/threshold-sweep.json')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const envJson = (name, fallback) => {
  const raw = process.env[name]
  if (!raw) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}
// Dev takes (used to choose) and unseen holdout takes (used to check) are the
// same shape; the caller passes which set through SWEEP_TAKES.
const RECORDINGS = envJson('SWEEP_TAKES', [
  { id: 'guitarset-ss3-comp', base: '00_SS3-84-Bb_comp', density: 'dense' },
  { id: 'guitarset-bn2-comp', base: '00_BN2-131-B_comp', density: 'dense' },
  { id: 'guitarset-funk3-comp', base: '00_Funk3-112-C#_comp', density: 'dense' },
  { id: 'guitarset-jazz2-solo', base: '04_Jazz2-110-Bb_solo', density: 'sparse' },
  { id: 'guitarset-jazz1-solo', base: '04_Jazz1-200-B_solo', density: 'sparse' },
])
// Explicit triples win over the grid (used for the holdout run).
const TRIPLES = envJson('SWEEP_THRESHOLDS', null)
const ONSET_THRESHOLDS = TRIPLES ? [...new Set(TRIPLES.map((t) => t[0]))] : [0.3, 0.5, 0.65, 0.8]
const FRAME_THRESHOLDS = TRIPLES ? [...new Set(TRIPLES.map((t) => t[1]))] : [0.2, 0.3, 0.4, 0.5]
const MIN_FRAMES = TRIPLES ? [...new Set(TRIPLES.map((t) => t[2]))] : [3, 5, 8]
const WANTED = TRIPLES ? new Set(TRIPLES.map((t) => t.join('/'))) : null

function truthNotesFromJams(path) {
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

const report = { generatedAt: new Date().toISOString(), rows: [], summary: {} }

for (const recording of RECORDINGS) {
  const wavPath = `/tmp/guitarset/${recording.base}_mic.wav`
  const jamsPath = `/tmp/guitarset/jams/${recording.base}.jams`
  if (!existsSync(wavPath) || !existsSync(jamsPath)) { console.warn(`skip ${recording.id}`); continue }
  const truth = truthNotesFromJams(jamsPath)
  const anchors = melodyAnchors(truth)
  const bassAnchors = truth.slice().sort((a, b) => a.onset - b.onset).reduce((acc, n) => {
    const last = acc[acc.length - 1]
    if (last && Math.abs(n.onset - last.onset) < 0.06) { if (n.midi < last.midi) last.midi = n.midi } else acc.push({ onset: n.onset, midi: n.midi })
    return acc
  }, [])

  const wav = readWavPcm(wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const { bp, model } = await loadBasicPitchNode({ modelDir: join(root, 'public/neural-model') })
  const frames = []
  const onsets = []
  const contours = []
  await model.evaluateModel(Float32Array.from(mono), (f, o, c) => {
    frames.push(...f)
    onsets.push(...o)
    contours.push(...c)
  }, () => {})
  // The spectral views do not depend on the thresholds - compute them once.
  const views = await buildAnalysisViews(mono, 22050)

  const row = { id: recording.id, density: recording.density, referenceNotes: truth.length, variants: {} }
  for (const onsetThreshold of ONSET_THRESHOLDS) {
    for (const frameThreshold of FRAME_THRESHOLDS) {
      for (const minFrames of MIN_FRAMES) {
        if (WANTED && !WANTED.has(`${onsetThreshold}/${frameThreshold}/${minFrames}`)) continue
        const notes = bp.noteFramesToTime(bp.outputToNotesPoly(frames, onsets, onsetThreshold, frameThreshold, minFrames))
          .map((n) => ({ midi: Math.round(n.pitchMidi), startSeconds: n.startTimeSeconds, endSeconds: n.startTimeSeconds + n.durationSeconds, amplitude: n.amplitude ?? null }))
        const suppressed = suppressHarmonicDoubles(notes)
        const analysis = await analyzeMusic(mono, 22050, {
          views,
          corroborateNotes: false,
          predictNotes: async () => suppressed.notes.map((n) => ({ ...n })),
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
        const score = scoreEvents(events, truth)
        row.variants[`${onsetThreshold}/${frameThreshold}/${minFrames}`] = {
          modelNotes: notes.length,
          notes: events.length,
          eventF1: score.eventF1,
          pitchPrecision: score.pitchPrecision,
          pitchRecall: score.pitchRecall,
          missed: score.missed,
          falsePositives: score.falsePositives,
          melodyRecall: anchorRecall(events, anchors).recall,
          bassRecall: anchorRecall(events, bassAnchors).recall,
          invented: inventedRate(events, truth),
          density: Math.round((events.length / Math.max(0.001, mono.length / 22050)) * 100) / 100,
        }
      }
    }
  }
  report.rows.push(row)
  const baselineKey = process.env.SWEEP_BASELINE ?? '0.5/0.3/5'
  const shipped = row.variants[baselineKey] ?? Object.values(row.variants)[0]
  const best = Object.entries(row.variants).sort((a, b) => b[1].eventF1 - a[1].eventF1)[0]
  console.log(`${row.id} (${recording.density}) shipped F1=${shipped.eventF1} notes=${shipped.modelNotes} -> best ${best[0]} F1=${best[1].eventF1} notes=${best[1].modelNotes}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

// Aggregate each threshold triple across the takes.
const keys = Object.keys(report.rows[0]?.variants ?? {})
const mean = (rows, key, field) => {
  const v = rows.map((r) => r.variants[key]?.[field]).filter((x) => Number.isFinite(x))
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null
}
for (const density of ['dense', 'sparse', 'all']) {
  const rows = density === 'all' ? report.rows : report.rows.filter((r) => r.density === density)
  if (!rows.length) continue
  report.summary[density] = {}
  for (const key of keys) {
    report.summary[density][key] = {
      eventF1: mean(rows, key, 'eventF1'),
      pitchPrecision: mean(rows, key, 'pitchPrecision'),
      pitchRecall: mean(rows, key, 'pitchRecall'),
      notes: mean(rows, key, 'notes'),
      modelNotes: mean(rows, key, 'modelNotes'),
      melodyRecall: mean(rows, key, 'melodyRecall'),
      bassRecall: mean(rows, key, 'bassRecall'),
      invented: mean(rows, key, 'invented'),
    }
  }
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))

const shippedKey = process.env.SWEEP_BASELINE ?? '0.5/0.3/5'
for (const density of ['dense', 'sparse', 'all']) {
  const table = report.summary[density]
  if (!table) continue
  const ranked = Object.entries(table).sort((a, b) => b[1].eventF1 - a[1].eventF1)
  console.log(`\n${density.toUpperCase()} - top 6 of ${ranked.length} (shipped ${shippedKey} = ${table[shippedKey].eventF1})`)
  for (const [key, v] of ranked.slice(0, 6)) {
    console.log(`  ${key.padEnd(12)} F1 ${v.eventF1} (${v.eventF1 - table[shippedKey].eventF1 >= 0 ? '+' : ''}${Math.round((v.eventF1 - table[shippedKey].eventF1) * 1000) / 1000}) P ${v.pitchPrecision} R ${v.pitchRecall} notes ${v.notes} melody ${v.melodyRecall} bass ${v.bassRecall} invented ${v.invented}`)
  }
}
console.log('\nwritten', resolveOut(jsonOut))

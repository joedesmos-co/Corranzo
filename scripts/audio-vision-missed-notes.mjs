#!/usr/bin/env node
/**
 * WHY ARE NOTES MISSED, AND WHICH ONES CAN BE RECOVERED HONESTLY?
 *
 * For every reference note the calibrated extractor does not report, this
 * asks which stage lost it and what kind of note it was:
 *
 *   inference-weak        the model's own probability never reached 0.3 -
 *                         the model did not hear it, and no extractor can
 *                         recover it
 *   extraction-borderline the model's probability was between 0.3 and the
 *                         0.5 frame threshold - a lower threshold would take
 *                         it, which is exactly what a verified second pass is
 *                         for
 *   extraction-strong     the frame evidence was at or above 0.5 but the note
 *                         was still not written - the onset threshold or the
 *                         minimum-frames rule rejected it
 *   harmonic-sibling      the reference note is an octave/twelfth from a note
 *                         that WAS written at the same moment: a real doubling
 *                         lost to harmonic suppression, not an extraction miss
 *
 * and what the note looks like musically: quiet, short, a soft attack, a
 * piano sustain, an overlapping voice, a weak bass note, in a dense chord.
 *
 * It also counts how many of the missed notes a LOWER threshold would recover
 * (the candidate set), split into "safe" (no harmonic sibling of a written
 * note, independent evidence present) and "risky" - the upper bound of what a
 * verified second pass could honestly add.
 *
 * Usage: node --expose-gc scripts/audio-vision-missed-notes.mjs [--json out]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { loadBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { harmonicSalience } from '../src/features/audio-vision/harmonicEvidence.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/missed-notes.json')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const SR = 22050
const FFT_HOP = 256
const FPS = Math.floor(SR / FFT_HOP)
const MIDI_MIN = 21
const ONSET_TOL = 0.12
const BASE = { onset: 0.65, frame: 0.5, minFrames: 3 }
const LOW = { onset: 0.5, frame: 0.3, minFrames: 5 }

const GUITARSET = [
  { id: 'guitarset-ss3-comp', base: '00_SS3-84-Bb_comp', density: 'dense', instrument: 'guitar' },
  { id: 'guitarset-bn2-comp', base: '00_BN2-131-B_comp', density: 'dense', instrument: 'guitar' },
  { id: 'guitarset-funk3-comp', base: '00_Funk3-112-C#_comp', density: 'dense', instrument: 'guitar' },
  { id: 'guitarset-jazz2-solo', base: '04_Jazz2-110-Bb_solo', density: 'sparse', instrument: 'guitar' },
  { id: 'guitarset-jazz1-solo', base: '04_Jazz1-200-B_solo', density: 'sparse', instrument: 'guitar' },
]

function truthFromJams(path) {
  const jams = JSON.parse(readFileSync(path, 'utf8'))
  const notes = []
  for (const annotation of jams.annotations ?? []) {
    if (annotation.namespace !== 'note_midi' || !Array.isArray(annotation.data)) continue
    for (const observation of annotation.data) {
      const midi = Math.round(Number(observation.value))
      const onset = Number(observation.time)
      const duration = Number(observation.duration ?? 0)
      if (!Number.isFinite(midi) || !Number.isFinite(onset)) continue
      notes.push({ midi, onset, offset: onset + (Number.isFinite(duration) ? duration : 0.1) })
    }
  }
  return notes.sort((a, b) => a.onset - b.onset)
}

function micRealClips() {
  const manifestPath = join(root, 'benchmarks/mic-real/manifest.json')
  if (!existsSync(manifestPath)) return []
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // The Vienna piano clips carry a documented truth-origin offset. δ is
  // derived from the audio alone (align-probe.json, fixed before any model
  // scoring) and applied identically here; the four clips the corpus itself
  // excludes are not evaluated.
  const probePath = join(root, 'benchmarks/audio-vision/align-probe.json')
  const deltaById = existsSync(probePath)
    ? Object.fromEntries((JSON.parse(readFileSync(probePath, 'utf8')).rows ?? []).map((r) => [r.id, r.bestDelta ?? 0]))
    : {}
  const excluded = new Set((manifest.excluded ?? []).map((e) => e.id))
  return (manifest.clips ?? [])
    .filter((clip) => !excluded.has(clip.id))
    .map((clip) => {
      const delta = deltaById[clip.id] ?? 0
      return {
        id: clip.id,
        instrument: clip.instrument ?? 'unknown',
        delta,
        path: join(root, 'benchmarks/mic-real', clip.audio.file),
        truth: (clip.truth?.notes ?? []).map((n) => ({
          midi: n.midi,
          onset: n.onset + delta,
          offset: (Number.isFinite(n.offset) ? n.offset : n.onset + 0.1) + delta,
        })).filter((n) => n.onset >= 0.01),
      }
    })
    .filter((clip) => clip.truth.length)
}

const report = {
  generatedAt: new Date().toISOString(),
  baseThresholds: BASE,
  lowThresholds: LOW,
  rows: [],
  summary: {},
}

async function analyseRecording({ id, instrument, density, samples, truth }) {
  const { bp, model } = await loadBasicPitchNode({ modelDir: join(root, 'public/neural-model') })
  const frames = []
  const onsets = []
  const contours = []
  await model.evaluateModel(Float32Array.from(samples), (f, o, c) => {
    frames.push(...f)
    onsets.push(...o)
    contours.push(...c)
  }, () => {})
  const extract = ({ onset, frame, minFrames }) =>
    bp.noteFramesToTime(bp.outputToNotesPoly(frames, onsets, onset, frame, minFrames))
      .map((n) => ({
        midi: Math.round(n.pitchMidi),
        onset: n.startTimeSeconds,
        offset: n.startTimeSeconds + n.durationSeconds,
        duration: n.durationSeconds,
        amplitude: n.amplitude ?? null,
      }))
  const baseNotes = extract(BASE)
  const lowNotes = extract(LOW)
  const peak = (matrix, frame, midi, radius = 2) => {
    let best = 0
    for (let d = -radius; d <= radius; d += 1) {
      const row = matrix[Math.max(0, Math.min(matrix.length - 1, frame + d))]
      const value = row?.[midi - MIDI_MIN] ?? 0
      if (Number.isFinite(value)) best = Math.max(best, value)
    }
    return best
  }
  const matches = (note, truthNote) =>
    Math.round(note.midi) === truthNote.midi && Math.abs(note.onset - truthNote.onset) <= ONSET_TOL
  // Harmonic sibling of a note that WAS written at the same moment.
  const isSiblingOfWritten = (truthNote) => baseNotes.some((n) => {
    const interval = Math.abs(Math.round(n.midi) - truthNote.midi)
    return Math.abs(n.onset - truthNote.onset) <= 0.05 && (interval === 12 || interval === 19 || interval === 24 || interval === 7 || interval === 5)
  })
  const categories = {
    missed: 0,
    inferenceWeak: 0,
    extractionBorderline: 0,
    extractionStrong: 0,
    harmonicSibling: 0,
    quiet: 0,
    short: 0,
    softAttack: 0,
    pianoSustain: 0,
    overlapping: 0,
    weakBass: 0,
    octaveAmbiguous: 0,
    denseChord: 0,
    recoverableSafe: 0,
    recoverableRisky: 0,
  }
  const examples = []
  for (const truthNote of truth) {
    if (baseNotes.some((n) => matches(n, truthNote))) continue
    categories.missed += 1
    const frame = Math.round(truthNote.onset * FPS)
    const p = peak(frames, frame, truthNote.midi)
    const o = peak(onsets, frame, truthNote.midi)
    const sibling = isSiblingOfWritten(truthNote)
    if (sibling) categories.harmonicSibling += 1
    if (p < 0.3) categories.inferenceWeak += 1
    else if (p < 0.5) categories.extractionBorderline += 1
    else categories.extractionStrong += 1
    const atOnset = truth.filter((t) => Math.abs(t.onset - truthNote.onset) <= 0.05).length
    const duration = Math.max(0, truthNote.offset - truthNote.onset)
    if (p < 0.35) categories.quiet += 1
    if (duration < 0.15) categories.short += 1
    if (o < 0.5) categories.softAttack += 1
    if (instrument === 'piano' && duration >= 0.3) categories.pianoSustain += 1
    if (atOnset > 1) categories.overlapping += 1
    if (truthNote.midi < 48) categories.weakBass += 1
    if (atOnset >= 3) categories.denseChord += 1
    // Is the same pitch class written an octave away at that moment?
    if (baseNotes.some((n) => Math.abs(n.onset - truthNote.onset) <= 0.06 && Math.abs(n.midi - truthNote.midi) % 12 === 0 && Math.abs(n.midi - truthNote.midi) !== 0)) {
      categories.octaveAmbiguous += 1
    }
    // Would the low thresholds recover it, and is that safe?
    const recovered = lowNotes.some((n) => matches(n, truthNote))
    if (recovered) {
      if (sibling) categories.recoverableRisky += 1
      else categories.recoverableSafe += 1
    }
    if (examples.length < 10) {
      examples.push({
        at: Math.round(truthNote.onset * 100) / 100,
        midi: truthNote.midi,
        duration: Math.round(duration * 100) / 100,
        p: Math.round(p * 1000) / 1000,
        onsetP: Math.round(o * 1000) / 1000,
        polyphony: atOnset,
        sibling,
        recoveredByLow: recovered,
      })
    }
  }
  // Recall on the note level, base vs low (micro counts are pooled later).
  const matchedBase = truth.filter((t) => baseNotes.some((n) => matches(n, t))).length
  const matchedLow = truth.filter((t) => lowNotes.some((n) => matches(n, t))).length
  return {
    id,
    instrument,
    density: density ?? 'n/a',
    referenceNotes: truth.length,
    baseNotes: baseNotes.length,
    lowNotes: lowNotes.length,
    matchedBase,
    matchedLow,
    categories,
    examples,
  }
}

const jobs = []
for (const recording of GUITARSET) {
  const wavPath = `/tmp/guitarset/${recording.base}_mic.wav`
  const jamsPath = `/tmp/guitarset/jams/${recording.base}.jams`
  if (!existsSync(wavPath) || !existsSync(jamsPath)) continue
  const wav = readWavPcm(wavPath)
  jobs.push({
    meta: { id: recording.id, instrument: recording.instrument, density: recording.density },
    truth: truthFromJams(jamsPath),
    samples: resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, SR),
  })
}
for (const clip of micRealClips()) {
  if (!existsSync(clip.path)) continue
  const wav = readWavPcm(clip.path)
  jobs.push({
    meta: { id: clip.id, instrument: clip.instrument, density: 'n/a' },
    truth: clip.truth,
    samples: resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, SR),
  })
}

for (const job of jobs) {
  const truth = job.truth
  const row = await analyseRecording({ ...job.meta, samples: job.samples, truth: job.truth })
  report.rows.push(row)
  console.log(`${row.id} (${row.instrument}): ref ${row.referenceNotes}, matched ${row.matchedBase} (low ${row.matchedLow}) ` +
    `| missed ${row.categories.missed}: inference ${row.categories.inferenceWeak}, borderline ${row.categories.extractionBorderline}, ` +
    `strong-but-rejected ${row.categories.extractionStrong}, sibling ${row.categories.harmonicSibling} ` +
    `| recoverable safe ${row.categories.recoverableSafe}, risky ${row.categories.recoverableRisky}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

// Pool the counts (micro) and split by instrument and density.
const pool = (rows) => {
  const total = (key) => rows.reduce((a, r) => a + (r.categories[key] ?? 0), 0)
  const ref = rows.reduce((a, r) => a + r.referenceNotes, 0)
  const matchedBase = rows.reduce((a, r) => a + r.matchedBase, 0)
  const matchedLow = rows.reduce((a, r) => a + r.matchedLow, 0)
  return {
    recordings: rows.length,
    referenceNotes: ref,
    baseRecall: ref ? Math.round((matchedBase / ref) * 1000) / 1000 : null,
    lowRecall: ref ? Math.round((matchedLow / ref) * 1000) / 1000 : null,
    missed: total('missed'),
    inferenceWeak: total('inferenceWeak'),
    extractionBorderline: total('extractionBorderline'),
    extractionStrong: total('extractionStrong'),
    harmonicSibling: total('harmonicSibling'),
    quiet: total('quiet'),
    short: total('short'),
    softAttack: total('softAttack'),
    pianoSustain: total('pianoSustain'),
    overlapping: total('overlapping'),
    weakBass: total('weakBass'),
    octaveAmbiguous: total('octaveAmbiguous'),
    denseChord: total('denseChord'),
    recoverableSafe: total('recoverableSafe'),
    recoverableRisky: total('recoverableRisky'),
  }
}
report.summary.all = pool(report.rows)
report.summary.byInstrument = {}
for (const instrument of [...new Set(report.rows.map((r) => r.instrument))]) {
  report.summary.byInstrument[instrument] = pool(report.rows.filter((r) => r.instrument === instrument))
}
report.summary.byDensity = {}
for (const density of [...new Set(report.rows.map((r) => r.density))]) {
  report.summary.byDensity[density] = pool(report.rows.filter((r) => r.density === density))
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nALL', JSON.stringify(report.summary.all, null, 1))
console.log('\nBY INSTRUMENT', JSON.stringify(report.summary.byInstrument, null, 1))
console.log('\nBY DENSITY', JSON.stringify(report.summary.byDensity, null, 1))
console.log('written', resolveOut(jsonOut))

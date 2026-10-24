#!/usr/bin/env node
/**
 * WHY DOES THE MODEL PICK THE WRONG PITCH?
 *
 * For every note the model reports, this asks two independent questions at
 * the note's own onset frame:
 *
 *   model evidence     does the model's own 88-pitch probability matrix give
 *                      a HIGHER probability to the reference pitch than to the
 *                      pitch it reported?
 *   spectral evidence  does the audio's harmonic structure favour the
 *                      reference pitch over the reported one? (a windowed
 *                      harmonic sum with the odd harmonics weighted in, which
 *                      is what separates a note from its octave)
 *
 * The answers decide what can be done:
 *
 *   model favours truth, or the spectrum favours truth
 *        -> the evidence is there; a re-scoring step can recover it
 *   neither
 *        -> the model's evidence itself is wrong for this note; no amount of
 *           post-processing can recover it, and the model would have to be
 *           replaced
 *
 * Usage: node --expose-gc scripts/audio-vision-pitch-evidence.mjs [--json out]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { loadBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/pitch-evidence.json')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const SR = 22050
const FFT_HOP = 256
const ANNOTATIONS_FPS = Math.floor(SR / FFT_HOP) // 86
const MIDI_MIN = 21
const ONSET_TOL = 0.12

const RECORDINGS = [
  { id: 'guitarset-ss3-comp', base: '00_SS3-84-Bb_comp', density: 'dense' },
  { id: 'guitarset-funk3-comp', base: '00_Funk3-112-C#_comp', density: 'dense' },
  { id: 'guitarset-jazz1-solo', base: '04_Jazz1-200-B_solo', density: 'sparse' },
]

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

/**
 * Harmonic salience of a candidate pitch in a short window: the Hann-windowed
 * magnitude at f0 and its harmonics, weighted 1/h. The 3rd and 5th harmonics
 * carry real weight, which is what tells a fundamental from its octave.
 */
function harmonicSalience(samples, startSample, midi, { harmonics = 6, windowSeconds = 0.09 } = {}) {
  const f0 = 440 * 2 ** ((midi - 69) / 12)
  const length = Math.min(Math.floor(windowSeconds * SR), samples.length - startSample)
  if (length < 256 || f0 <= 0) return 0
  // A little pre-roll so the attack transient is inside the window.
  const from = Math.max(0, startSample - Math.floor(0.01 * SR))
  const n = Math.min(length, samples.length - from)
  let total = 0
  for (let h = 1; h <= harmonics; h += 1) {
    const freq = f0 * h
    if (freq >= SR / 2) break
    let real = 0
    let imag = 0
    const omega = (2 * Math.PI * freq) / SR
    for (let i = 0; i < n; i += 1) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
      const value = samples[from + i] * w
      real += value * Math.cos(omega * i)
      imag -= value * Math.sin(omega * i)
    }
    const magnitude = Math.sqrt(real * real + imag * imag) / Math.max(1, n / 2)
    // 1/h keeps the fundamental and the third harmonic in play but stops the
    // very high partials from dominating a bright guitar string.
    total += magnitude / (h === 1 ? 0.6 : h)
  }
  return total
}

const report = {
  generatedAt: new Date().toISOString(),
  frameSeconds: 1 / ANNOTATIONS_FPS,
  onsetTolerance: ONSET_TOL,
  rows: [],
  summary: {},
}

for (const recording of RECORDINGS) {
  const wavPath = `/tmp/guitarset/${recording.base}_mic.wav`
  const jamsPath = `/tmp/guitarset/jams/${recording.base}.jams`
  if (!existsSync(wavPath) || !existsSync(jamsPath)) { console.warn(`skip ${recording.id}`); continue }
  const truth = truthNotesFromJams(jamsPath)
  const wav = readWavPcm(wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, SR)

  const { bp, model } = await loadBasicPitchNode({ modelDir: join(root, 'public/neural-model') })
  const frames = []
  const onsets = []
  const contours = []
  await model.evaluateModel(Float32Array.from(mono), (f, o, c) => {
    frames.push(...f)
    onsets.push(...o)
    contours.push(...c)
  }, () => {})
  // Keep the model's OWN frames: a note's pitch was decided at startFrame, so
  // the evidence must be read there, not at a re-derived time.
  const rawNotes = bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)
  const notes = bp.noteFramesToTime(rawNotes)

  const at = (matrix, frame, midi) => {
    const row = matrix[Math.max(0, Math.min(matrix.length - 1, frame))]
    if (!row) return 0
    const value = row[midi - MIDI_MIN]
    return Number.isFinite(value) ? value : 0
  }
  const peakNear = (matrix, frame, midi, radius = 2) => {
    let best = 0
    for (let d = -radius; d <= radius; d += 1) best = Math.max(best, at(matrix, frame + d, midi))
    return best
  }

  const buckets = {
    truePositive: 0,
    wrongPitch: 0,
    modelFavoursTruth: 0,
    spectrumFavoursTruth: 0,
    bothFavourTruth: 0,
    neither: 0,
    noReferenceAtTime: 0,
    // A wrong pitch that ALSO has the reference pitch reported at the same
    // time is an extra harmonic note (removable). Without it the model
    // substituted one pitch for another (correctable only by re-scoring).
    extraHarmonic: 0,
    substitution: 0,
  }
  const samplesOut = []
  for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
    const note = notes[noteIndex]
    const raw = rawNotes[noteIndex]
    const onset = note.startTimeSeconds
    const midi = Math.round(note.pitchMidi)
    const exact = truth.some((t) => t.midi === midi && Math.abs(t.onset - onset) <= ONSET_TOL)
    if (exact) { buckets.truePositive += 1; continue }
    const near = truth.filter((t) => Math.abs(t.onset - onset) <= ONSET_TOL)
    if (!near.length) { buckets.noReferenceAtTime += 1; continue }
    buckets.wrongPitch += 1
    const frame = Number.isFinite(raw?.startFrame) ? raw.startFrame : Math.round(onset * ANNOTATIONS_FPS)
    // The reference pitch this note should have been: the closest one.
    const best = near.reduce((a, b) => (Math.abs(b.midi - midi) < Math.abs(a.midi - midi) ? b : a), near[0])
    const pDetected = peakNear(frames, frame, midi)
    const pTruth = peakNear(frames, frame, best.midi)
    const modelFavoursTruth = pTruth > pDetected + 0.02
    const startSample = Math.round(onset * SR)
    const sDetected = harmonicSalience(mono, startSample, midi)
    const sTruth = harmonicSalience(mono, startSample, best.midi)
    const spectrumFavoursTruth = sTruth > sDetected * 1.15
    // Is the reference pitch reported as its own note at the same moment?
    const alsoReported = notes.some((other, otherIndex) => otherIndex !== noteIndex &&
      Math.round(other.pitchMidi) === best.midi &&
      Math.abs(other.startTimeSeconds - onset) <= ONSET_TOL)
    if (alsoReported) buckets.extraHarmonic += 1
    else buckets.substitution += 1
    if (modelFavoursTruth) buckets.modelFavoursTruth += 1
    if (spectrumFavoursTruth) buckets.spectrumFavoursTruth += 1
    if (modelFavoursTruth && spectrumFavoursTruth) buckets.bothFavourTruth += 1
    if (!modelFavoursTruth && !spectrumFavoursTruth) buckets.neither += 1
    if (samplesOut.length < 14) {
      samplesOut.push({
        at: Math.round(onset * 100) / 100,
        reported: midi,
        reference: best.midi,
        interval: midi - best.midi,
        pReported: Math.round(pDetected * 1000) / 1000,
        pReference: Math.round(pTruth * 1000) / 1000,
        sReported: Math.round(sDetected * 1000) / 1000,
        sReference: Math.round(sTruth * 1000) / 1000,
        modelFavoursTruth,
        spectrumFavoursTruth,
        alsoReported,
      })
    }
  }
  report.rows.push({
    id: recording.id,
    density: recording.density,
    referenceNotes: truth.length,
    modelNotes: notes.length,
    buckets,
    samples: samplesOut,
  })
  console.log(`${recording.id} (${recording.density}): TP ${buckets.truePositive}, wrong-pitch ${buckets.wrongPitch} ` +
    `[model favours truth ${buckets.modelFavoursTruth}, spectrum favours truth ${buckets.spectrumFavoursTruth}, ` +
    `both ${buckets.bothFavourTruth}, neither ${buckets.neither}] ` +
    `| extra-harmonic ${buckets.extraHarmonic}, substitution ${buckets.substitution} | no reference ${buckets.noReferenceAtTime}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

for (const density of ['dense', 'sparse']) {
  const rows = report.rows.filter((r) => r.density === density)
  if (!rows.length) continue
  const sum = (k) => rows.reduce((a, r) => a + r.buckets[k], 0)
  report.summary[density] = {
    recordings: rows.length,
    truePositive: sum('truePositive'),
    wrongPitch: sum('wrongPitch'),
    modelFavoursTruth: sum('modelFavoursTruth'),
    spectrumFavoursTruth: sum('spectrumFavoursTruth'),
    both: sum('bothFavourTruth'),
    neither: sum('neither'),
    noReferenceAtTime: sum('noReferenceAtTime'),
    extraHarmonic: sum('extraHarmonic'),
    substitution: sum('substitution'),
  }
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nsummary', JSON.stringify(report.summary, null, 2))
console.log('written', resolveOut(jsonOut))

#!/usr/bin/env node
/**
 * VERIFIED SECOND PASS: can the notes the onset threshold rejects be recovered
 * on evidence, instead of by lowering the threshold for everything?
 *
 * The diagnosis (scripts/audio-vision-missed-notes.mjs) found that a large
 * share of the misses on acoustic guitar and piano are "extraction-strong":
 * the model's FRAME probability for the reference pitch reached 0.5 or more,
 * yet no note was written, because the onset evidence was weak (a soft pick,
 * a piano sustain) and the extractor needs an onset to start a note.
 *
 * So: extract a candidate set with the onset threshold relaxed (0.5) but the
 * SAME frame threshold (0.5) and the same minimum length. Every candidate is
 * then either accepted or rejected on evidence the extractor did not use:
 *
 *   salience        the audio's harmonic series at the candidate's pitch,
 *                   relative to the other notes sounding at that moment
 *   harmonic test   a candidate that is an octave/fifth from a note already
 *                   written at the same moment is only kept if the audio
 *                   supports its own fundamental
 *
 * The harness reports candidate precision/recall against the reference at
 * several salience thresholds, and then the full arrangement F1 for the best
 * ones - so the choice is made on notes AND on the score.
 *
 * Usage: node --expose-gc scripts/audio-vision-second-pass.mjs --set dev|holdout|micreal|all
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { loadBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { harmonicSalience } from '../src/features/audio-vision/harmonicEvidence.js'
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
const jsonOut = argValue('--json', `benchmarks/audio-vision/second-pass-${which}.json`)
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const SR = 22050
const ONSET_TOL = 0.12
const BASE = { onset: 0.65, frame: 0.5, minFrames: 3 }
const CANDIDATE = { onset: 0.5, frame: 0.5, minFrames: 3 }
const SALIENCE_FLOORS = [0, 0.15, 0.25, 0.4, 0.55]

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
  const probePath = join(root, 'benchmarks/audio-vision/align-probe.json')
  const deltaById = existsSync(probePath)
    ? Object.fromEntries((JSON.parse(readFileSync(probePath, 'utf8')).rows ?? []).map((r) => [r.id, r.bestDelta ?? 0]))
    : {}
  const excluded = new Set((manifest.excluded ?? []).map((e) => e.id))
  return (manifest.clips ?? [])
    .filter((c) => !excluded.has(c.id))
    .map((c) => ({
      id: c.id,
      instrument: c.instrument ?? 'unknown',
      path: join(root, 'benchmarks/mic-real', c.audio.file),
      delta: deltaById[c.id] ?? 0,
      truth: (c.truth?.notes ?? []).map((n) => ({ midi: n.midi, onset: n.onset + (deltaById[c.id] ?? 0) })).filter((n) => n.onset >= 0.01),
    }))
    .filter((c) => c.truth.length && existsSync(c.path))
}

const jobs = []
if (which === 'dev' || which === 'all') {
  for (const r of DEV) {
    const wavPath = `/tmp/guitarset/${r.base}_mic.wav`
    const jamsPath = `/tmp/guitarset/jams/${r.base}.jams`
    if (existsSync(wavPath) && existsSync(jamsPath)) jobs.push({ id: r.id, density: r.density, instrument: 'guitar', wavPath, truth: truthFromJams(jamsPath) })
  }
}
if (which === 'holdout' || which === 'all') {
  for (const r of HOLDOUT) {
    const wavPath = `/tmp/guitarset/${r.base}_mic.wav`
    const jamsPath = `/tmp/guitarset/jams/${r.base}.jams`
    if (existsSync(wavPath) && existsSync(jamsPath)) jobs.push({ id: r.id, density: r.density, instrument: 'guitar', wavPath, truth: truthFromJams(jamsPath) })
  }
}
if (which === 'micreal' || which === 'all') {
  for (const c of micReal()) jobs.push({ id: c.id, density: 'n/a', instrument: c.instrument, wavPath: c.path, truth: c.truth })
}

const isTruth = (note, truth) => truth.some((t) => t.midi === Math.round(note.midi) && Math.abs(t.onset - note.startSeconds) <= ONSET_TOL)
const sameNote = (a, b) => Math.round(a.midi) === Math.round(b.midi) && Math.abs(a.startSeconds - b.startSeconds) <= 0.05

const report = { generatedAt: new Date().toISOString(), set: which, base: BASE, candidate: CANDIDATE, rows: [], summary: {} }

for (const job of jobs) {
  const wav = readWavPcm(job.wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, SR)
  const { bp, model } = await loadBasicPitchNode({ modelDir: join(root, 'public/neural-model') })
  const frames = []
  const onsets = []
  const contours = []
  await model.evaluateModel(Float32Array.from(mono), (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c) }, () => {})
  const extract = ({ onset, frame, minFrames }) =>
    bp.noteFramesToTime(bp.outputToNotesPoly(frames, onsets, onset, frame, minFrames)).map((n) => ({
      midi: Math.round(n.pitchMidi),
      startSeconds: n.startTimeSeconds,
      endSeconds: n.startTimeSeconds + n.durationSeconds,
      amplitude: n.amplitude ?? null,
    }))
  const baseNotes = extract(BASE)
  const candidates = extract(CANDIDATE).filter((c) => !baseNotes.some((b) => sameNote(b, c)))

  // Per-candidate evidence.
  const peak = (matrix, seconds, midi, radius = 2) => {
    const frame = Math.round(seconds * (SR / 256))
    let best = 0
    for (let d = -radius; d <= radius; d += 1) {
      const row = matrix[Math.max(0, Math.min(matrix.length - 1, frame + d))]
      const value = row?.[Math.round(midi) - 21] ?? 0
      if (Number.isFinite(value)) best = Math.max(best, value)
    }
    return best
  }
  const enriched = candidates.map((c) => {
    const salience = harmonicSalience(mono, SR, c.startSeconds, c.midi)
    // The model's own confidence at the note's start, independent of the
    // extractor's onset rule: how strongly did it believe this pitch there?
    const framePeak = peak(frames, c.startSeconds, c.midi)
    const onsetPeak = peak(onsets, c.startSeconds, c.midi)
    // Local level: the salience of the notes already written at this moment,
    // so "quiet" is judged against the passage, not a fixed number.
    const neighbours = baseNotes.filter((b) => Math.abs(b.startSeconds - c.startSeconds) <= 0.35)
    const levels = neighbours.map((b) => harmonicSalience(mono, SR, b.startSeconds, b.midi)).filter((v) => v > 0).sort((a, b) => a - b)
    const localMedian = levels.length ? levels[Math.floor(levels.length / 2)] : 0
    const relative = localMedian > 0 ? salience / localMedian : 1
    const sibling = baseNotes.find((b) => {
      const interval = Math.abs(Math.round(b.midi) - Math.round(c.midi))
      const harmonic = interval === 12 || interval === 19 || interval === 24 || interval === 7 || interval === 5
      return harmonic && Math.abs(b.startSeconds - c.startSeconds) <= 0.05
    })
    const siblingSalience = sibling ? harmonicSalience(mono, SR, sibling.startSeconds, sibling.midi) : 0
    const siblingSupported = sibling ? salience >= siblingSalience * 0.75 : true
    return { ...c, salience, relative, framePeak, onsetPeak, isReal: isTruth(c, job.truth), sibling: Boolean(sibling), siblingSupported }
  })

  // Which candidates would be accepted? Two rules are compared:
  //   salience floor  the audio's harmonic support, relative to the passage
  //   frame confidence  the model's own frame probability at the candidate,
  //                     which the onset rule never looks at
  const FLOORS = SALIENCE_FLOORS
  const FRAME_FLOORS = [0.6, 0.7, 0.75, 0.8, 0.85]
  const acceptedBy = (floor) => enriched.filter((c) => c.relative >= floor && c.siblingSupported)
  const acceptedByFrame = (floor) => enriched.filter((c) => c.framePeak >= floor && c.siblingSupported)
  const variantNotes = (floor, rule) => {
    if (floor === null) return baseNotes
    const accepted = rule === 'frame' ? acceptedByFrame(floor) : acceptedBy(floor)
    return [...baseNotes, ...accepted].sort((a, b) => a.startSeconds - b.startSeconds)
  }

  const chain = async (notes) => {
    const suppressed = suppressHarmonicDoubles(notes, { samples: mono, sampleRate: SR })
    const views = await buildAnalysisViews(mono, SR)
    const analysis = await analyzeMusic(mono, SR, {
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
    return { events, score: scoreEvents(events, job.truth) }
  }
  const baseChain = await chain(baseNotes)
  const variants = {}
  for (const [rule, floors] of [['salience', FLOORS], ['frame', FRAME_FLOORS]]) {
  for (const floor of floors) {
    const accepted = rule === 'frame' ? acceptedByFrame(floor) : acceptedBy(floor)
    const notes = variantNotes(floor, rule)
    const added = notes.length - baseNotes.length
    const genuineAdded = accepted.filter((c) => c.isReal).length
    const chained = await chain(notes)
    variants[`${rule}_${floor}`] = {
      added,
      genuineAdded,
      falseAdded: added - genuineAdded,
      addedPrecision: added ? Math.round((genuineAdded / added) * 1000) / 1000 : null,
      arrangementF1: chained.score.eventF1,
      precision: chained.score.pitchPrecision,
      recall: chained.score.pitchRecall,
      melodyRecall: anchorRecall(chained.events, melodyAnchors(job.truth)).recall,
      invented: inventedRate(chained.events, job.truth),
    }
  }
  }
  report.rows.push({
    id: job.id,
    instrument: job.instrument,
    density: job.density,
    referenceNotes: job.truth.length,
    baseNotes: baseNotes.length,
    baseNoteF1: (() => {
      const tp = baseNotes.filter((n) => isTruth(n, job.truth)).length
      const p = baseNotes.length ? tp / baseNotes.length : 0
      const r = job.truth.length ? tp / job.truth.length : 0
      return { tp, precision: Math.round(p * 1000) / 1000, recall: Math.round(r * 1000) / 1000, f1: Math.round((p + r > 0 ? (2 * p * r) / (p + r) : 0) * 1000) / 1000 }
    })(),
    candidates: enriched.length,
    candidateReal: enriched.filter((c) => c.isReal).length,
    candidateSibling: enriched.filter((c) => c.sibling).length,
    baseArrangementF1: baseChain.score.eventF1,
    baseMelodyRecall: anchorRecall(baseChain.events, melodyAnchors(job.truth)).recall,
    variants,
  })
  const best = Object.entries(variants).sort((a, b) => b[1].arrangementF1 - a[1].arrangementF1)[0]
  const frameBest = Object.entries(variants).filter(([k]) => k.startsWith('frame_')).sort((a, b) => b[1].arrangementF1 - a[1].arrangementF1)[0]
  console.log(`${job.id} (${job.instrument}): base ${baseNotes.length} notes, ${enriched.length} candidates (${enriched.filter((c) => c.isReal).length} real) ` +
    `| best ${best[0]}: +${best[1].added} (+${best[1].genuineAdded} real), F1 ${baseChain.score.eventF1} -> ${best[1].arrangementF1}` +
    ` | frame rule ${frameBest[0]}: +${frameBest[1].added} (+${frameBest[1].genuineAdded} real), F1 -> ${frameBest[1].arrangementF1}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const mean = (rows, pick) => {
  const v = rows.map(pick).filter((x) => Number.isFinite(x))
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null
}
const pool = (rows) => {
  const out = {
    recordings: rows.length,
    candidates: rows.reduce((a, r) => a + r.candidates, 0),
    candidateReal: rows.reduce((a, r) => a + r.candidateReal, 0),
    baseArrangementF1: mean(rows, (r) => r.baseArrangementF1),
    baseMelodyRecall: mean(rows, (r) => r.baseMelodyRecall),
  }
  for (const floor of [...SALIENCE_FLOORS.map((f) => `salience_${f}`), ...[0.6, 0.7, 0.75, 0.8, 0.85].map((f) => `frame_${f}`)]) {
    out[floor] = {
      added: mean(rows, (r) => r.variants[floor].added),
      genuineAdded: rows.reduce((a, r) => a + r.variants[floor].genuineAdded, 0),
      falseAdded: rows.reduce((a, r) => a + r.variants[floor].falseAdded, 0),
      arrangementF1: mean(rows, (r) => r.variants[floor].arrangementF1),
      precision: mean(rows, (r) => r.variants[floor].precision),
      recall: mean(rows, (r) => r.variants[floor].recall),
      melodyRecall: mean(rows, (r) => r.variants[floor].melodyRecall),
      invented: mean(rows, (r) => r.variants[floor].invented),
    }
  }
  return out
}
report.summary.all = pool(report.rows)
report.summary.byInstrument = {}
for (const instrument of [...new Set(report.rows.map((r) => r.instrument))]) {
  report.summary.byInstrument[instrument] = pool(report.rows.filter((r) => r.instrument === instrument))
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nALL', JSON.stringify(report.summary.all, null, 2))
console.log('written', resolveOut(jsonOut))

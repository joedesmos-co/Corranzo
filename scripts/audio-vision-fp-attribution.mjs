#!/usr/bin/env node
/**
 * FALSE-NOTE ATTRIBUTION on real recordings.
 *
 * Answers the question the aggregate F1 cannot: on a dense take, WHICH notes
 * are wrong, where did they enter the pipeline, and what is the musical
 * relation of each wrong note to the music that is really there?
 *
 * Every arrangement note is put in exactly one bucket:
 *
 *   true            matches a reference note (pitch equal, onset within tol)
 *   duplicate       same pitch already emitted moments earlier (redundant)
 *   transcriptionFp present in the transcribed note set before arranging,
 *                   so the arranger only carried it through
 *   arrangementAdded NOT present before arranging, so the arranger created it
 *                   (range clamp / octave shift / position shift)
 *   wrongPitch      a reference note exists at that onset, but at another
 *                   pitch - the note is real, the pitch is wrong
 *   lateEcho        a reference note of the same pitch exists nearby but
 *                   outside the onset tolerance - a rhythm error, not an
 *                   invention
 *
 * Every MISSED reference note is also attributed:
 *
 *   neverTranscribed   the model never produced it
 *   droppedByArrangement  transcribed, then dropped on the way to the score
 *   pitchChanged       a note exists at that onset with another pitch
 *
 * Usage: node --expose-gc scripts/audio-vision-fp-attribution.mjs [--json out]
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/fp-attribution.json')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const TOL = Number(process.env.AV_TOL ?? 0.12)
const ECHO_TOL = Number(process.env.AV_ECHO_TOL ?? 0.4)
const DUP_TOL = Number(process.env.AV_DUP_TOL ?? 0.15)

const RECORDINGS = [
  // dense comping takes
  { id: 'guitarset-ss3-comp', base: '00_SS3-84-Bb_comp', density: 'dense' },
  { id: 'guitarset-bn2-comp', base: '00_BN2-131-B_comp', density: 'dense' },
  { id: 'guitarset-funk3-comp', base: '00_Funk3-112-C#_comp', density: 'dense' },
  // sparse solo takes
  { id: 'guitarset-jazz2-solo', base: '04_Jazz2-110-Bb_solo', density: 'sparse' },
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
      const duration = Number(observation.duration ?? 0)
      if (!Number.isFinite(midi) || !Number.isFinite(onset)) continue
      notes.push({ midi, onset, offset: onset + (Number.isFinite(duration) ? duration : 0.1) })
    }
  }
  return notes.sort((a, b) => a.onset - b.onset || a.midi - b.midi)
}

const has = (notes, midi, onset, tol = TOL) =>
  notes.some((n) => n.midi === midi && Math.abs((n.onset ?? n.startSeconds) - onset) <= tol)
const hasAt = (notes, onset, tol = TOL) =>
  notes.some((n) => Math.abs((n.onset ?? n.startSeconds) - onset) <= tol)

const report = { generatedAt: new Date().toISOString(), tolerance: TOL, rows: [], summary: {} }

for (const recording of RECORDINGS) {
  const wavPath = `/tmp/guitarset/${recording.base}_mic.wav`
  const jamsPath = `/tmp/guitarset/jams/${recording.base}.jams`
  if (!existsSync(wavPath) || !existsSync(jamsPath)) {
    console.warn(`skip ${recording.id}`)
    continue
  }
  const truth = truthNotesFromJams(jamsPath)
  const wav = readWavPcm(wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)

  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const raw = bp.notes.map((n) => ({
    midi: n.midi,
    startSeconds: n.startSeconds,
    endSeconds: n.endSeconds,
    amplitude: n.amplitude ?? null,
  }))
  const suppressed = suppressHarmonicDoubles(raw)
  const analysis = await analyzeMusic(mono, 22050, {
    views: await buildAnalysisViews(mono, 22050),
    corroborateNotes: false,
    predictNotes: async () => suppressed.notes.map((n) => ({ ...n })),
  })
  const beat0 = analysis.beats.beats[0] ?? 0
  const period = analysis.beats.beatPeriodSeconds
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  const contour = buildMelodyContour(analysis.melody, { beat0, beatPeriod: period })

  // The transcribed set (before the arranger) in seconds, so a note can be
  // traced to the model instead of blamed on the arranger.
  const transcribedEvents = quantized.map((n) => ({
    midi: n.midi,
    onset: beat0 + (n.quantizedStartBeat ?? 0) * period,
  }))

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

  const finalEvents = simplified.map((e) => ({
    midi: e.midi,
    onset: beat0 + (e.startBeat ?? 0) * period,
    duration: (e.durBeats ?? 0) * period,
    hand: e.hand,
    role: e.role,
  })).sort((a, b) => a.onset - b.onset)

  // --- attribute every final note --------------------------------------
  const truthUsed = new Set()
  const counts = { true: 0, duplicate: 0, transcriptionFp: 0, arrangementAdded: 0, wrongPitch: 0, lateEcho: 0 }
  const examples = { wrongPitch: [], lateEcho: [], transcriptionFp: [], arrangementAdded: [] }
  const seenFinal = []
  const wrongPitchIntervals = { octave: 0, step: 0, thirdOrFourth: 0, other: 0, exact: 0 }
  const lateEchoTiming = { under200ms: 0, '200to300ms': 0, over300ms: 0 }
  const lateEchoEvidence = { attackAtTruth: 0, attackAtModel: 0, both: 0, total: 0 }
  for (const event of finalEvents) {
    // A genuine match (each reference note can be claimed once).
    let matched = false
    for (let i = 0; i < truth.length; i += 1) {
      if (truthUsed.has(i)) continue
      const t = truth[i]
      if (t.midi === event.midi && Math.abs(t.onset - event.onset) <= TOL) {
        truthUsed.add(i)
        matched = true
        break
      }
    }
    if (matched) { counts.true += 1; seenFinal.push(event); continue }
    // Already emitted at this pitch moments earlier → redundant.
    if (seenFinal.some((p) => p.midi === event.midi && Math.abs(p.onset - event.onset) <= DUP_TOL)) {
      counts.duplicate += 1
      seenFinal.push(event)
      continue
    }
    // A real event at this onset, wrong pitch.
    if (hasAt(truth, event.onset) && !truth.some((t) => t.midi === event.midi && Math.abs(t.onset - event.onset) <= ECHO_TOL)) {
      counts.wrongPitch += 1
      // HOW wrong is the pitch? An octave displacement is a different musical
      // event from a semitone error or a wrong chord tone.
      const near = truth.filter((t) => Math.abs(t.onset - event.onset) <= TOL)
      if (near.length) {
        const best = near.reduce((a, b) => (Math.abs(b.midi - event.midi) < Math.abs(a.midi - event.midi) ? b : a), near[0])
        const delta = event.midi - best.midi
        const key = Math.abs(delta) === 0 ? 'exact' : Math.abs(delta) % 12 === 0 ? 'octave' : Math.abs(delta) <= 2 ? 'step' : Math.abs(delta) <= 5 ? 'thirdOrFourth' : 'other'
        wrongPitchIntervals[key] = (wrongPitchIntervals[key] ?? 0) + 1
        if (Math.abs(delta) % 12 !== 0) {
          wrongPitchIntervals.details = wrongPitchIntervals.details ?? []
          if (wrongPitchIntervals.details.length < 12) wrongPitchIntervals.details.push({ at: Math.round(event.onset * 100) / 100, got: event.midi, ref: best.midi, delta })
        }
      }
      if (examples.wrongPitch.length < 6) {
        examples.wrongPitch.push({ at: Math.round(event.onset * 100) / 100, got: event.midi, reference: near.map((t) => t.midi) })
      }
      seenFinal.push(event)
      continue
    }
    // The same pitch exists nearby but outside tolerance → timing error.
    if (truth.some((t) => t.midi === event.midi && Math.abs(t.onset - event.onset) <= ECHO_TOL)) {
      counts.lateEcho += 1
      const t = truth.find((x) => x.midi === event.midi && Math.abs(x.onset - event.onset) <= ECHO_TOL)
      if (t) {
        const deltaMs = Math.round((event.onset - t.onset) * 1000)
        const bucket = Math.abs(deltaMs) <= 200 ? 'under200ms' : Math.abs(deltaMs) <= 300 ? '200to300ms' : 'over300ms'
        lateEchoTiming[bucket] = (lateEchoTiming[bucket] ?? 0) + 1
        // Can a detected attack explain the truth time? If the attack detector
        // heard the string at the reference onset but the note was written
        // elsewhere, snapping to the attack is evidence, not a guess.
        const onsetTimes = (analysis.onsets ?? []).map((o) => o.seconds)
        const attackAtTruth = onsetTimes.some((s) => Math.abs(s - t.onset) <= 0.1)
        const attackAtModel = onsetTimes.some((s) => Math.abs(s - event.onset) <= 0.1)
        lateEchoEvidence.attackAtTruth += attackAtTruth ? 1 : 0
        lateEchoEvidence.attackAtModel += attackAtModel ? 1 : 0
        lateEchoEvidence.both += attackAtTruth && attackAtModel ? 1 : 0
        lateEchoEvidence.total += 1
      }
      if (examples.lateEcho.length < 6) {
        examples.lateEcho.push({ at: Math.round(event.onset * 100) / 100, midi: event.midi, referenceAt: Math.round((t?.onset ?? 0) * 100) / 100 })
      }
      seenFinal.push(event)
      continue
    }
    // Otherwise: was it carried from the transcription, or created here?
    const fromTranscription = has(transcribedEvents, event.midi, event.onset)
    if (fromTranscription) {
      counts.transcriptionFp += 1
      if (examples.transcriptionFp.length < 6) examples.transcriptionFp.push({ at: Math.round(event.onset * 100) / 100, midi: event.midi })
    } else {
      counts.arrangementAdded += 1
      if (examples.arrangementAdded.length < 6) examples.arrangementAdded.push({ at: Math.round(event.onset * 100) / 100, midi: event.midi })
    }
    seenFinal.push(event)
  }

  // --- attribute every missed reference note ---------------------------
  const missed = { neverTranscribed: 0, droppedByArrangement: 0, pitchChanged: 0 }
  const missedExamples = []
  for (let i = 0; i < truth.length; i += 1) {
    if (truthUsed.has(i)) continue
    const t = truth[i]
    if (!has(transcribedEvents, t.midi, t.onset)) {
      missed.neverTranscribed += 1
      continue
    }
    if (hasAt(finalEvents, t.onset)) {
      missed.pitchChanged += 1
      if (missedExamples.length < 6) {
        missedExamples.push({ at: Math.round(t.onset * 100) / 100, reference: t.midi, got: finalEvents.filter((e) => Math.abs(e.onset - t.onset) <= TOL).map((e) => e.midi) })
      }
      continue
    }
    missed.droppedByArrangement += 1
    if (missedExamples.length < 6) missedExamples.push({ at: Math.round(t.onset * 100) / 100, reference: t.midi, got: 'dropped' })
  }

  // --- harmonic relation of the invented notes ------------------------
  const harmonicRelation = { octave: 0, fifth: 0, fourthOrOther: 0, unrelated: 0 }
  for (const event of finalEvents) {
    if (truth.some((t) => t.midi === event.midi && Math.abs(t.onset - event.onset) <= TOL)) continue
    if (truth.some((t) => t.midi === event.midi && Math.abs(t.onset - event.onset) <= ECHO_TOL)) continue
    const nearest = truth.filter((t) => Math.abs(t.onset - event.onset) <= 0.2)
    if (!nearest.length) { harmonicRelation.unrelated += 1; continue }
    const intervals = nearest.map((t) => Math.abs(t.midi - event.midi) % 12)
    if (intervals.includes(0)) harmonicRelation.octave += 1
    else if (intervals.includes(7)) harmonicRelation.fifth += 1
    else if (intervals.includes(5)) harmonicRelation.fourthOrOther += 1
    else harmonicRelation.unrelated += 1
  }

  const trueCount = counts.true
  const bad = finalEvents.length - trueCount
  const row = {
    id: recording.id,
    density: recording.density,
    audioSeconds: Math.round((mono.length / 22050) * 10) / 10,
    referenceNotes: truth.length,
    modelNotes: raw.length,
    suppressed: suppressed.suppressed,
    transcribedNotes: transcribedEvents.length,
    arrangementNotes: finalEvents.length,
    counts,
    missed,
    harmonicRelation,
    wrongPitchIntervals,
    lateEchoTiming,
    lateEchoEvidence,
    falseRate: Math.round((bad / Math.max(1, finalEvents.length)) * 1000) / 1000,
    missedRate: Math.round(((truth.length - trueCount) / Math.max(1, truth.length)) * 1000) / 1000,
    examples,
    missedExamples,
  }
  report.rows.push(row)
  console.log(
    `${row.id} (${row.density}): ${finalEvents.length} notes, ${trueCount} true, ` +
    `FP ${bad} [${counts.transcriptionFp} transcription, ${counts.duplicate} duplicate, ` +
    `${counts.wrongPitch} wrong-pitch, ${counts.lateEcho} late-echo, ${counts.arrangementAdded} arrangement] | ` +
    `missed ${truth.length - trueCount} [${missed.neverTranscribed} never, ${missed.droppedByArrangement} dropped, ${missed.pitchChanged} pitch-changed] | ` +
    `harmonics o${harmonicRelation.octave} f${harmonicRelation.fifth} o4${harmonicRelation.fourthOrOther} u${harmonicRelation.unrelated}`,
  )
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const sum = (rows, pick) => rows.reduce((a, r) => a + pick(r), 0)
for (const density of ['dense', 'sparse']) {
  const rows = report.rows.filter((r) => r.density === density)
  if (!rows.length) continue
  const notes = sum(rows, (r) => r.arrangementNotes)
  const trueNotes = sum(rows, (r) => r.counts.true)
  const ref = sum(rows, (r) => r.referenceNotes)
  report.summary[density] = {
    recordings: rows.length,
    arrangementNotes: notes,
    trueNotes,
    inventedNotes: notes - trueNotes,
    inventedRate: Math.round(((notes - trueNotes) / Math.max(1, notes)) * 1000) / 1000,
    missedNotes: ref - trueNotes,
    missedRate: Math.round(((ref - trueNotes) / Math.max(1, ref)) * 1000) / 1000,
    byBucket: Object.fromEntries(Object.keys(rows[0].counts).map((k) => [k, sum(rows, (r) => r.counts[k])])),
    missedByBucket: Object.fromEntries(Object.keys(rows[0].missed).map((k) => [k, sum(rows, (r) => r.missed[k])])),
    harmonics: Object.fromEntries(Object.keys(rows[0].harmonicRelation).map((k) => [k, sum(rows, (r) => r.harmonicRelation[k])])),
    wrongPitchIntervals: {
      octave: sum(rows, (r) => r.wrongPitchIntervals.octave ?? 0),
      step: sum(rows, (r) => r.wrongPitchIntervals.step ?? 0),
      thirdOrFourth: sum(rows, (r) => r.wrongPitchIntervals.thirdOrFourth ?? 0),
      other: sum(rows, (r) => r.wrongPitchIntervals.other ?? 0),
    },
    lateEchoTiming: {
      under200ms: sum(rows, (r) => r.lateEchoTiming.under200ms ?? 0),
      '200to300ms': sum(rows, (r) => r.lateEchoTiming['200to300ms'] ?? 0),
      over300ms: sum(rows, (r) => r.lateEchoTiming.over300ms ?? 0),
    },
    lateEchoEvidence: {
      total: sum(rows, (r) => r.lateEchoEvidence.total ?? 0),
      attackAtTruth: sum(rows, (r) => r.lateEchoEvidence.attackAtTruth ?? 0),
      attackAtModel: sum(rows, (r) => r.lateEchoEvidence.attackAtModel ?? 0),
      both: sum(rows, (r) => r.lateEchoEvidence.both ?? 0),
    },
  }
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nsummary', JSON.stringify(report.summary, null, 2))
console.log('written', resolveOut(jsonOut))

#!/usr/bin/env node
/**
 * DENSE-MATERIAL EXPERIMENT: which, if any, evidence-backed filter removes
 * invented notes without touching the melody, the bass or genuine
 * accompaniment?
 *
 * The attribution study showed the dense problem is not "too many notes":
 * the arranger adds nothing, and the notes it writes are mostly real events
 * at a wrong pitch or a shifted time. The genuinely invented ones are the
 * notes with no reference support at all - the "unrelated" bucket.
 *
 * So this experiment tests filters that are allowed to look ONLY at evidence
 * the pipeline itself has:
 *
 *   chordOutlier      not a chord tone, not the melody, not the bass, and no
 *                     attack was detected where it is claimed
 *   chordOutlierLoose same, but does not require the missing attack
 *   weakGhost         no attack, and the model reports it much weaker than
 *                     the notes around it
 *   strongVoices      at each onset keep melody + bass + the strongest inner
 *                     voices (a solo instrument cannot play six notes at once)
 *   combined          chordOutlier + strongVoices
 *
 * Every variant is scored on dense AND sparse real takes with the shared
 * matcher, and the melody/bass anchor recall is checked separately so a
 * filter that protects the score by deleting the line is visible.
 *
 * Usage: node --expose-gc scripts/audio-vision-dense-filters.mjs
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
  chooseMelodyMidi,
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
const jsonOut = argValue('--json', 'benchmarks/audio-vision/dense-filters.json')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

const RECORDINGS = [
  { id: 'guitarset-ss3-comp', base: '00_SS3-84-Bb_comp', density: 'dense' },
  { id: 'guitarset-bn2-comp', base: '00_BN2-131-B_comp', density: 'dense' },
  { id: 'guitarset-funk3-comp', base: '00_Funk3-112-C#_comp', density: 'dense' },
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

/**
 * The filters. `ctx` carries the evidence the pipeline already has: the
 * detected chords, the detected attacks, the melodic contour and the grid.
 */
function applyFilter(notes, mode, ctx) {
  if (mode === 'off') return notes
  const { chords, onsets, beat0, period, contour } = ctx
  const chordAt = (seconds) => {
    const window = chords.find((c) => seconds >= (c.startSeconds ?? 0) && seconds < (c.endSeconds ?? Infinity))
    return window ?? null
  }
  const hasOnset = (seconds) => onsets.some((o) => Math.abs((o.seconds ?? o) - seconds) <= 0.07)
  const beatOf = (seconds) => Math.round(((seconds - beat0) / period) * 4) / 4
  const melodyMidiAt = (seconds) => {
    const key = Math.round(((seconds - beat0) / period) * 2) / 2
    const group = notes.filter((n) => Math.abs(beatOf(n.startSeconds) - key) < 0.01).map((n) => Math.round(n.midi)).sort((a, b) => b - a)
    if (!group.length) return null
    const contourForBeat = contour?.get?.(Math.round(key * 2) / 2)
    return chooseMelodyMidi(group, contourForBeat) ?? group[0]
  }
  // The bass root of each onset cluster (the lowest sounding note).
  const onsetsSorted = [...new Set(notes.map((n) => beatOf(n.startSeconds)))].sort((a, b) => a - b)
  const bassAt = new Map()
  for (const beat of onsetsSorted) {
    const group = notes.filter((n) => beatOf(n.startSeconds) === beat)
    if (group.length > 1) bassAt.set(beat, Math.min(...group.map((n) => Math.round(n.midi))))
  }
  if (mode === 'strongVoices' || mode === 'combined') {
    const kept = []
    for (const beat of onsetsSorted) {
      const group = notes.filter((n) => beatOf(n.startSeconds) === beat)
      if (group.length <= 3) { kept.push(...group); continue }
      const melody = melodyMidiAt(group[0].startSeconds)
      const bass = bassAt.get(beat)
      const ranked = [...group].sort((a, b) => (b.amplitude ?? 0) - (a.amplitude ?? 0))
      for (const note of ranked) {
        const midi = Math.round(note.midi)
        if (midi === melody || midi === bass || kept.filter((k) => beatOf(k.startSeconds) === beat).length < 2) {
          kept.push(note)
        }
      }
    }
    notes = kept
  }
  const amplitudes = notes.map((n) => n.amplitude ?? 0.5).sort((a, b) => a - b)
  const median = amplitudes[Math.floor(amplitudes.length / 2)] ?? 0.5
  return notes.filter((note) => {
    const seconds = note.startSeconds
    const midi = Math.round(note.midi)
    const chord = chordAt(seconds)
    const isChordTone = chord ? (chord.tones ?? []).includes(((midi % 12) + 12) % 12) : true
    const isMelody = midi === melodyMidiAt(seconds)
    const isBass = bassAt.get(beatOf(seconds)) === midi
    const onset = hasOnset(seconds)
    if (mode === 'chordOutlier') return !(isChordTone === false && !isMelody && !isBass && !onset)
    if (mode === 'chordOutlierLoose') return !(isChordTone === false && !isMelody && !isBass)
    if (mode === 'weakGhost') return !(!onset && (note.amplitude ?? 1) < median * 0.5)
    if (mode === 'combined') return !(isChordTone === false && !isMelody && !isBass && !onset)
    return true
  })
}

const MODES = ['off', 'strongVoices']

/**
 * Post-arrangement filters. The arrangement already knows which note is the
 * melody and which is the bass root, so a filter here cannot mistake the line
 * for an inner voice - that is exactly what the pre-arrangement variants did.
 */
function filterArrangement(events, mode, ctx) {
  if (mode === 'off') return events
  const { chords, onsets, beat0, period } = ctx
  const sec = (e) => beat0 + (e.startBeat ?? 0) * period
  const hasOnset = (seconds) => onsets.some((o) => Math.abs((o.seconds ?? o) - seconds) <= 0.07)
  const chordAt = (seconds) => chords.find((c) => seconds >= (c.startSeconds ?? 0) && seconds < (c.endSeconds ?? Infinity)) ?? null
  const isChordTone = (e, seconds) => {
    const chord = chordAt(seconds)
    if (!chord || !(chord.tones ?? []).length) return true
    return chord.tones.includes(((e.midi % 12) + 12) % 12)
  }
  // A note whose pitch is already sounding and which no attack supports is a
  // model re-report, not a new musical event.
  const alreadySounding = (e, index) => events.slice(0, index).some((p) =>
    p.midi === e.midi &&
    beat0 + (p.startBeat ?? 0) * period <= sec(e) + 0.02 &&
    beat0 + (p.startBeat ?? 0) * period + (p.durBeats ?? 0) * period >= sec(e) - 0.02)
  if (mode === 'arrChordOutlier') {
    return events.filter((e) => {
      const seconds = sec(e)
      if (e.isMelody || e.isBassRoot || e.role === 'melody' || e.role === 'bass') return true
      if (isChordTone(e, seconds)) return true
      return hasOnset(seconds)
    })
  }
  if (mode === 'arrDuplicate') {
    return events.filter((e, i) => {
      if (!alreadySounding(e, i)) return true
      return hasOnset(sec(e))
    })
  }
  if (mode === 'voicingSanity') {
    // A real voicing rarely contains a semitone clash or a doubled octave at
    // the same instant; those pairs are the classic signature of a pitch
    // estimator splitting one partial into two notes. Keep the melody and the
    // bass unconditionally, and keep the stronger note of every such pair.
    const sorted = [...events].sort((a, b) => sec(a) - sec(b))
    const drop = new Set()
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]
      if (drop.has(a)) continue
      if (a.isMelody || a.isBassRoot || a.role === 'melody' || a.role === 'bass') continue
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j]
        if (sec(b) - sec(a) > 0.03) break
        if (Math.abs(b.midi - a.midi) > 12) continue
        const interval = Math.abs(b.midi - a.midi)
        const isClash = interval === 1
        const isOctave = interval === 12
        if (!isClash && !isOctave) continue
        const protectedB = b.isMelody || b.isBassRoot || b.role === 'melody' || b.role === 'bass'
        if (protectedB) { drop.add(a); break }
        const stronger = (b.amplitude ?? b.strength ?? 0.5) > (a.amplitude ?? a.strength ?? 0.5) ? b : a
        drop.add(stronger === a ? b : a)
      }
    }
    return events.filter((e) => !drop.has(e))
  }
  if (mode === 'arrGhost') {
    return events.filter((e, i) => {
      if (e.isMelody || e.isBassRoot || e.role === 'melody' || e.role === 'bass') return true
      if (hasOnset(sec(e))) return true
      if (!isChordTone(e, sec(e))) return false
      if (alreadySounding(e, i)) return false
      return true
    })
  }
  return events
}
const report = { generatedAt: new Date().toISOString(), rows: [], summary: {} }

for (const recording of RECORDINGS) {
  const wavPath = `/tmp/guitarset/${recording.base}_mic.wav`
  const jamsPath = `/tmp/guitarset/jams/${recording.base}.jams`
  if (!existsSync(wavPath) || !existsSync(jamsPath)) { console.warn(`skip ${recording.id}`); continue }
  const truth = truthNotesFromJams(jamsPath)
  const anchors = melodyAnchors(truth)
  const bassAnchors = melodyAnchors(truth.map((n) => ({ ...n }))).length
    ? truth.slice().sort((a, b) => a.onset - b.onset).reduce((acc, n) => {
      const last = acc[acc.length - 1]
      if (last && Math.abs(n.onset - last.onset) < 0.06) { if (n.midi < last.midi) last.midi = n.midi } else acc.push({ onset: n.onset, midi: n.midi })
      return acc
    }, [])
    : []

  const wav = readWavPcm(wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const raw = bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude ?? null }))
  const suppressed = suppressHarmonicDoubles(raw)
  const analysis = await analyzeMusic(mono, 22050, {
    views: await buildAnalysisViews(mono, 22050),
    corroborateNotes: false,
    predictNotes: async () => suppressed.notes.map((n) => ({ ...n })),
  })
  const beat0 = analysis.beats.beats[0] ?? 0
  const period = analysis.beats.beatPeriodSeconds
  const contour = buildMelodyContour(analysis.melody, { beat0, beatPeriod: period })
  const ctx = { chords: analysis.chords, onsets: analysis.onsets ?? [], beat0, period, contour }
  const buildArrangement = (sourceNotes, { melodyPolicy = 'contour' } = {}) => {
    const quantized = quantizeToBeats(sourceNotes, analysis.beats.beats)
    // ADAPTIVE melody policy: the salience contour is reliable in a thin
    // texture and unreliable in a thick one. Count the notes per onset and
    // only trust the contour where the texture is thin; where it is thick the
    // top voice is the melody (the standard reading of a dense voicing).
    let melodyContourFor = contour
    if (melodyPolicy === 'adaptive' || melodyPolicy === 'adaptive2' || melodyPolicy === 'adaptive3') {
      const threshold = melodyPolicy === 'adaptive2' ? 2 : melodyPolicy === 'adaptive3' ? 3 : 4
      const groupSize = new Map()
      for (const n of quantized) {
        const key = Math.round((n.quantizedStartBeat ?? 0) * 4) / 4
        groupSize.set(key, (groupSize.get(key) ?? 0) + 1)
      }
      const halfBeatKey = (beat) => Math.round(beat * 2) / 2
      melodyContourFor = {
        get: (key) => {
          const size = groupSize.get(Math.round(key * 4) / 4) ?? groupSize.get(halfBeatKey(key)) ?? 0
          return size >= threshold ? undefined : contour.get(key)
        },
      }
    }
    const melodyByBeat = (analysis.melody ?? []).map((m) => ({ beat: (m.seconds - beat0) / period, midi: m.midi }))
    const arranged = arrangeSoloPiano({
      quantizedNotes: quantized,
      chords: analysis.chords,
      melodyByBeat,
      difficulty: 'intermediate',
      melodyContour: melodyPolicy === 'highest' ? null : melodyContourFor,
      beat0,
      beatPeriod: period,
    })
    return simplifyForDifficulty(
      arranged.events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
      'intermediate',
    ).map((e) => ({ ...e, startBeat: e.quantizedStartBeat ?? e.startBeat, durBeats: e.quantizedDurBeats ?? e.durBeats }))
  }

  const row = { id: recording.id, density: recording.density, referenceNotes: truth.length, variants: {} }
  for (const mode of MODES) {
    const filtered = applyFilter(analysis.predictedNotes.map((n) => ({ ...n })), mode, ctx)
    const simplified = buildArrangement(filtered)
    const events = simplified.map((e) => ({ midi: e.midi, onset: beat0 + (e.startBeat ?? 0) * period, duration: (e.durBeats ?? 0) * period }))
    const score = scoreEvents(events, truth)
    row.variants[mode] = {
      notes: events.length,
      removed: analysis.predictedNotes.length - filtered.length,
      eventF1: score.eventF1,
      pitchRecall: score.pitchRecall,
      pitchPrecision: score.pitchPrecision,
      missed: score.missed,
      falsePositives: score.falsePositives,
      melodyRecall: anchorRecall(events, anchors).recall,
      bassRecall: anchorRecall(events, bassAnchors).recall,
      invented: inventedRate(events, truth),
      density: Math.round((events.length / Math.max(0.001, mono.length / 22050)) * 100) / 100,
    }
  }
  // Post-arrangement variants: same arrangement, filtered with the roles known.
  for (const mode of ['arrChordOutlier', 'arrDuplicate', 'arrGhost', 'voicingSanity']) {
    const baseSimplified = buildArrangement(analysis.predictedNotes.map((n) => ({ ...n })))
    const filteredArrangement = filterArrangement(
      baseSimplified.map((e) => ({ ...e })),
      mode,
      { chords: analysis.chords, onsets: analysis.onsets ?? [], beat0, period },
    )
    const events = filteredArrangement.map((e) => ({ midi: e.midi, onset: beat0 + (e.startBeat ?? 0) * period, duration: (e.durBeats ?? 0) * period }))
    const score = scoreEvents(events, truth)
    row.variants[mode] = {
      notes: events.length,
      removed: baseSimplified.length - filteredArrangement.length,
      eventF1: score.eventF1,
      pitchRecall: score.pitchRecall,
      pitchPrecision: score.pitchPrecision,
      missed: score.missed,
      falsePositives: score.falsePositives,
      melodyRecall: anchorRecall(events, anchors).recall,
      bassRecall: anchorRecall(events, bassAnchors).recall,
      invented: inventedRate(events, truth),
      density: Math.round((events.length / Math.max(0.001, mono.length / 22050)) * 100) / 100,
    }
  }
  // Melody policy: the contour is evidence, but on a dense texture the
  // salience can be flat and pick an inner voice. Compare with the plain
  // "highest note is the melody" rule on the SAME notes.
  // Combinations: the melody policy alone gains a lot on dense material but
  // adds ~5 % notes; pair it with voice thinning to keep the density flat.
  const variantDefs = [
    { id: 'melody_highest', notes: () => analysis.predictedNotes.map((n) => ({ ...n })), policy: 'highest' },
    { id: 'melody_highest_thin', notes: () => applyFilter(analysis.predictedNotes.map((n) => ({ ...n })), 'strongVoices', ctx), policy: 'highest' },
    { id: 'melody_contour_thin', notes: () => applyFilter(analysis.predictedNotes.map((n) => ({ ...n })), 'strongVoices', ctx), policy: 'contour' },
    { id: 'melody_adaptive', notes: () => analysis.predictedNotes.map((n) => ({ ...n })), policy: 'adaptive' },
    { id: 'melody_adaptive_thin', notes: () => applyFilter(analysis.predictedNotes.map((n) => ({ ...n })), 'strongVoices', ctx), policy: 'adaptive' },
    { id: 'melody_adaptive2', notes: () => analysis.predictedNotes.map((n) => ({ ...n })), policy: 'adaptive2' },
    { id: 'melody_adaptive3', notes: () => analysis.predictedNotes.map((n) => ({ ...n })), policy: 'adaptive3' },
  ]
  for (const def of variantDefs) {
    const arr = buildArrangement(def.notes(), { melodyPolicy: def.policy })
    const events = arr.map((e) => ({ midi: e.midi, onset: beat0 + (e.startBeat ?? 0) * period, duration: (e.durBeats ?? 0) * period }))
    const score = scoreEvents(events, truth)
    row.variants[def.id] = {
      notes: events.length,
      removed: analysis.predictedNotes.length - def.notes().length,
      eventF1: score.eventF1,
      pitchRecall: score.pitchRecall,
      pitchPrecision: score.pitchPrecision,
      missed: score.missed,
      falsePositives: score.falsePositives,
      melodyRecall: anchorRecall(events, anchors).recall,
      bassRecall: anchorRecall(events, bassAnchors).recall,
      invented: inventedRate(events, truth),
      density: Math.round((events.length / Math.max(0.001, mono.length / 22050)) * 100) / 100,
    }
  }
  report.rows.push(row)
  const off = row.variants.off
  console.log(`${row.id} (${recording.density}) baseline F1=${off.eventF1} notes=${off.notes} melody=${off.melodyRecall} bass=${off.bassRecall}`)
  for (const mode of [...MODES, 'arrChordOutlier', 'arrDuplicate', 'arrGhost', 'voicingSanity', 'melody_highest', 'melody_highest_thin', 'melody_contour_thin', 'melody_adaptive', 'melody_adaptive_thin', 'melody_adaptive2', 'melody_adaptive3'].filter((m) => m !== 'off')) {
    const v = row.variants[mode]
    console.log(`   ${mode.padEnd(18)} F1=${v.eventF1} (${v.eventF1 - off.eventF1 >= 0 ? '+' : ''}${Math.round((v.eventF1 - off.eventF1) * 1000) / 1000}) notes=${v.notes} (-${v.removed}) melody=${v.melodyRecall} bass=${v.bassRecall} invented=${v.invented}`)
  }
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const mean = (rows, pick) => {
  const v = rows.map(pick).filter((x) => Number.isFinite(x))
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null
}
for (const density of ['dense', 'sparse']) {
  const rows = report.rows.filter((r) => r.density === density)
  if (!rows.length) continue
  report.summary[density] = {}
  for (const mode of [...MODES, 'arrChordOutlier', 'arrDuplicate', 'arrGhost', 'voicingSanity', 'melody_highest', 'melody_highest_thin', 'melody_contour_thin', 'melody_adaptive', 'melody_adaptive_thin', 'melody_adaptive2', 'melody_adaptive3']) {
    if (!rows[0].variants[mode]) continue
    report.summary[density][mode] = {
      eventF1: mean(rows, (r) => r.variants[mode].eventF1),
      notes: Math.round(mean(rows, (r) => r.variants[mode].notes)),
      melodyRecall: mean(rows, (r) => r.variants[mode].melodyRecall),
      bassRecall: mean(rows, (r) => r.variants[mode].bassRecall),
      invented: mean(rows, (r) => r.variants[mode].invented),
      density: mean(rows, (r) => r.variants[mode].density),
    }
  }
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nDENSE:', JSON.stringify(report.summary.dense, null, 1))
console.log('\nSPARSE:', JSON.stringify(report.summary.sparse, null, 1))
console.log('written', resolveOut(jsonOut))

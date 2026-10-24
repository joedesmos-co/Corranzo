#!/usr/bin/env node
/**
 * A/B: harmonic-sibling consolidation vs the shipped suppression, on the same
 * five real performances, with the damage counted note by note.
 *
 * Variants:
 *   off            what ships today (the amplitude-gated suppression only)
 *   onTop          the shipped suppression, then the sibling rule
 *   instead        the sibling rule instead of the shipped suppression
 *   strict         the sibling rule with a wider evidence margin
 *   noTwelfth      the sibling rule without the twelfth (octaves only)
 *
 * For every variant it also reports how many removed notes were GENUINE
 * (a reference note matched before removal), so a gain in F1 can never hide
 * music being deleted.
 *
 * Usage: node --expose-gc scripts/audio-vision-harmonic-siblings.mjs [--json out]
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
import { dropHarmonicSiblings, harmonicSalience } from '../src/features/audio-vision/harmonicEvidence.js'
import { scoreEvents, melodyAnchors, anchorRecall, inventedRate } from './lib/eventScore.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/harmonic-siblings.json')
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
      if (!Number.isFinite(midi) || !Number.isFinite(onset)) continue
      notes.push({ midi, onset })
    }
  }
  return notes.sort((a, b) => a.onset - b.onset)
}

const matchesTruth = (note, truth) =>
  truth.some((t) => t.midi === Math.round(note.midi) && Math.abs(t.onset - (note.startSeconds ?? 0)) <= 0.12)

const VARIANTS = {
  off: { mode: 'shipped' },
  onTop: { mode: 'onTop', amplitudeRatio: 0.85, salienceRatio: 0.85 },
  instead: { mode: 'instead', amplitudeRatio: 0.85, salienceRatio: 0.85 },
  strict: { mode: 'onTop', amplitudeRatio: 0.7, salienceRatio: 0.7 },
  noTwelfth: { mode: 'onTop', amplitudeRatio: 0.85, salienceRatio: 0.85, includeTwelfth: false },
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
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const raw = bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude ?? null }))

  const row = { id: recording.id, density: recording.density, referenceNotes: truth.length, variants: {} }
  for (const [name, variant] of Object.entries(VARIANTS)) {
    let notes = raw
    if (variant.mode !== 'instead') {
      const filtered = suppressHarmonicDoubles(notes)
      notes = filtered.notes
    }
    let removedNotes = []
    if (variant.mode !== 'shipped') {
      const result = dropHarmonicSiblings(notes, {
        samples: mono,
        sampleRate: 22050,
        amplitudeRatio: variant.amplitudeRatio,
        salienceRatio: variant.salienceRatio,
        includeTwelfth: variant.includeTwelfth !== false,
      })
      notes = result.notes
      removedNotes = result.dropped ?? []
    }
    // Damage: removed notes that matched a reference note.
    const damaged = removedNotes.filter((n) => matchesTruth(n, truth)).length
    const before = variant.mode === 'instead' ? raw.length : suppressHarmonicDoubles(raw).notes.length
    const analysis = await analyzeMusic(mono, 22050, {
      views: await buildAnalysisViews(mono, 22050),
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
    const score = scoreEvents(events, truth)
    row.variants[name] = {
      notes: events.length,
      removed: before - notes.length,
      damaged,
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
  report.rows.push(row)
  const off = row.variants.off
  console.log(`${row.id} (${recording.density}) shipped F1=${off.eventF1} P=${off.pitchPrecision} R=${off.pitchRecall} notes=${off.notes} melody=${off.melodyRecall} bass=${off.bassRecall}`)
  for (const name of Object.keys(VARIANTS).filter((v) => v !== 'off')) {
    const v = row.variants[name]
    console.log(`   ${name.padEnd(10)} F1=${v.eventF1} (${v.eventF1 - off.eventF1 >= 0 ? '+' : ''}${Math.round((v.eventF1 - off.eventF1) * 1000) / 1000}) P=${v.pitchPrecision} R=${v.pitchRecall} notes=${v.notes} (-${v.removed}, damaged ${v.damaged}) melody=${v.melodyRecall} bass=${v.bassRecall} FP=${v.falsePositives}/miss=${v.missed}`)
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
  for (const name of Object.keys(VARIANTS)) {
    report.summary[density][name] = {
      eventF1: mean(rows, (r) => r.variants[name].eventF1),
      pitchPrecision: mean(rows, (r) => r.variants[name].pitchPrecision),
      pitchRecall: mean(rows, (r) => r.variants[name].pitchRecall),
      notes: mean(rows, (r) => r.variants[name].notes),
      removed: mean(rows, (r) => r.variants[name].removed),
      damaged: rows.reduce((a, r) => a + r.variants[name].damaged, 0),
      falsePositives: mean(rows, (r) => r.variants[name].falsePositives),
      missed: mean(rows, (r) => r.variants[name].missed),
      melodyRecall: mean(rows, (r) => r.variants[name].melodyRecall),
      bassRecall: mean(rows, (r) => r.variants[name].bassRecall),
      invented: mean(rows, (r) => r.variants[name].invented),
      density: mean(rows, (r) => r.variants[name].density),
    }
  }
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
for (const density of ['dense', 'sparse']) {
  console.log(`\n${density.toUpperCase()}`)
  for (const [name, v] of Object.entries(report.summary[density] ?? {})) {
    console.log(`  ${name.padEnd(10)} F1 ${v.eventF1} P ${v.pitchPrecision} R ${v.pitchRecall} notes ${v.notes} removed ${v.removed} damaged ${v.damaged} melody ${v.melodyRecall} bass ${v.bassRecall}`)
  }
}
console.log('\nwritten', resolveOut(jsonOut))

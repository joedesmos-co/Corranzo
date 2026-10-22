#!/usr/bin/env node
/**
 * Real-recording acceptance: GuitarSet performances (CC-BY-4.0, Zenodo
 * 3371780) with their JAMS note truth, scored through the real pipeline.
 *
 * This is the "unfamiliar recordings" check: the model transcribes the audio,
 * the arrangement is written, and the result is compared with the annotated
 * notes of the performance itself. Real instruments, real takes, no synthetic
 * reference.
 *
 * The two transcription-level cleanups are A/B measured in the same run, so
 * the claim "this change helps" is a measurement, not a belief.
 *
 * Usage: node --expose-gc scripts/audio-vision-real-acceptance.mjs
 *        [--json benchmarks/audio-vision/real-acceptance.json]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { quantizeToBeats, suppressHarmonicDoubles, buildMelodyContour } from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { dropRingingRedetections } from '../src/features/audio-vision/noteCleanup.js'
import { holdNotesUntilNextOnset } from '../src/features/audio-vision/arrangementDurations.js'
import { scoreEvents, melodyAnchors, anchorRecall, inventedRate } from './lib/eventScore.mjs'
import { corroborateNotesByOnset } from '../src/features/audio-vision/musicAnalysis.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/real-acceptance.json')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))

/**
 * The GuitarSet performances used here. `solo` performances are a single
 * guitar (the supported task); `comp` performances are the same players
 * recorded together (a harder, denser case).
 */
const RECORDINGS = [
  { id: 'guitarset-jazz2-solo', base: '04_Jazz2-110-Bb_solo', kind: 'solo' },
  { id: 'guitarset-jazz1-solo', base: '04_Jazz1-200-B_solo', kind: 'solo' },
  { id: 'guitarset-ss3-comp', base: '00_SS3-84-Bb_comp', kind: 'comp' },
  { id: 'guitarset-bn2-comp', base: '00_BN2-131-B_comp', kind: 'comp' },
  { id: 'guitarset-funk3-comp', base: '00_Funk3-112-C#_comp', kind: 'comp' },
]

function truthNotesFromJams(path) {
  const jams = JSON.parse(readFileSync(path, 'utf8'))
  const notes = []
  for (const annotation of jams.annotations ?? []) {
    if (annotation.namespace !== 'note_midi' || !Array.isArray(annotation.data)) continue
    for (const observation of annotation.data) {
      const midi = Math.round(Number(observation.value))
      if (!Number.isFinite(midi) || midi < 21 || midi > 108) continue
      const onset = Number(observation.time)
      const duration = Number(observation.duration ?? 0)
      if (!Number.isFinite(onset)) continue
      notes.push({ midi, onset, offset: onset + (Number.isFinite(duration) ? duration : 0.1) })
    }
  }
  notes.sort((a, b) => a.onset - b.onset || a.midi - b.midi)
  return notes
}

const report = {
  generatedAt: new Date().toISOString(),
  onsetTolerance: 0.12,
  rows: [],
  summary: {},
}

for (const recording of RECORDINGS) {
  const wavPath = `/tmp/guitarset/${recording.base}_mic.wav`
  const jamsPath = `/tmp/guitarset/jams/${recording.base}.jams`
  if (!existsSync(wavPath) || !existsSync(jamsPath)) {
    console.warn(`skip ${recording.id} (corpus not materialized)`)
    continue
  }
  const truth = truthNotesFromJams(jamsPath)
  if (!truth.length) {
    console.warn(`skip ${recording.id} (no note truth)`)
    continue
  }
  const wav = readWavPcm(wavPath)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const started = Date.now()
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const modelMs = Date.now() - started
  const raw = bp.notes.map((n) => ({
    midi: n.midi,
    startSeconds: n.startSeconds,
    endSeconds: n.endSeconds,
    amplitude: n.amplitude ?? null,
  }))
  const asScored = (notes) => notes.map((n) => ({
    midi: n.midi,
    onset: n.startSeconds,
    duration: (n.endSeconds ?? n.startSeconds) - n.startSeconds,
  }))

  const views = await buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, {
    views,
    predictNotes: async () => raw.map((n) => ({
      midi: n.midi,
      startSeconds: n.startSeconds,
      endSeconds: n.endSeconds,
      amplitude: n.amplitude,
    })),
  })
  const beat0 = analysis.beats.beats[0] ?? 0
  const period = analysis.beats.beatPeriodSeconds
  const contour = buildMelodyContour(analysis.melody, { beat0, beatPeriod: period })
  const melodyByBeat = (analysis.melody ?? []).map((m) => ({ beat: (m.seconds - beat0) / period, midi: m.midi }))
  const truthInScore = truth.map((n) => ({ ...n, onset: n.onset - beat0 }))
  const anchors = melodyAnchors(truth)
  const bassTruth = melodyAnchors(truth.map((n) => ({ ...n, midi: n.midi })))

  // The arrangement, with the two cleanups switched on and off.
  const buildArrangement = ({ cleanup, hold, amplitudeRatio = 0, corroborate = true, maxNotesPerBeat = null }) => {
    let notes = raw
    if (cleanup) {
      const cleaned = dropRingingRedetections(notes, {
        onsetTimes: (analysis.onsets ?? []).map((o) => o.seconds),
        amplitudeRatio,
      })
      notes = cleaned.notes
    }
    // The corroboration gate, A/B measured: a short note with no detected
    // attack is dropped. On a guitar performance the flux detector misses
    // soft picking, so the gate can drop real notes.
    const gated = corroborate
      ? corroborateNotesByOnset(notes, (analysis.onsets ?? []).map((o) => o.seconds))
      : notes
    const quantized = quantizeToBeats(
      gated.map((n) => ({
        midi: n.midi,
        startSeconds: n.startSeconds,
        endSeconds: n.endSeconds,
        amplitude: n.amplitude,
      })),
      analysis.beats.beats,
    )
    const arranged = arrangeSoloGuitar({
      quantizedNotes: quantized,
      chords: analysis.chords,
      difficulty: 'intermediate',
      melodyContour: contour,
    })
    if (hold) {
      const held = holdNotesUntilNextOnset(arranged.events.map((e) => ({ ...e })), { maxBeats: 8 })
      arranged.events = held.events
    }
    const simplified = simplifyForDifficulty(
      arranged.events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
      'intermediate',
      { maxNotesPerBeat },
    ).map((e) => ({ ...e, startBeat: e.quantizedStartBeat ?? e.startBeat, durBeats: e.quantizedDurBeats ?? e.durBeats }))
    const events = simplified.map((e) => ({
      midi: e.midi,
      onset: beat0 + e.startBeat * period,
      duration: e.durBeats * period,
    }))
    const xml = buildArrangementMusicXml({
      events: simplified,
      targetPart: 'solo-guitar',
      bpm: analysis.tempo.bpm,
      title: recording.id,
    })
    let parsed = null
    try { parsed = parseMusicXml(xml, `${recording.id}.musicxml`) } catch { parsed = null }
    return {
      events,
      xml,
      parsed,
      xmlNotes: simplified.length,
      parsedNotes: (parsed?.notes ?? []).filter((n) => !n.isRest && Number.isFinite(n.midi)).length,
    }
  }

  const baseline = buildArrangement({ cleanup: false, hold: false })
  const improved = buildArrangement({ cleanup: true, hold: true })
  const cleanupOnly = buildArrangement({ cleanup: true, hold: false })
  const holdOnly = buildArrangement({ cleanup: false, hold: true })
  const cleanupAmp = buildArrangement({ cleanup: true, hold: false, amplitudeRatio: 0.7 })
  const cleanupAmpStrict = buildArrangement({ cleanup: true, hold: false, amplitudeRatio: 0.5 })
  const noCorroboration = buildArrangement({ cleanup: false, hold: false, corroborate: false })
  const budget20 = buildArrangement({ cleanup: false, hold: false, corroborate: true, maxNotesPerBeat: 2 })
  const budget15 = buildArrangement({ cleanup: false, hold: false, corroborate: true, maxNotesPerBeat: 1.5 })
  const budget15NoCorroboration = buildArrangement({ cleanup: false, hold: false, corroborate: false, maxNotesPerBeat: 1.5 })

  const row = {
    id: recording.id,
    kind: recording.kind,
    truthNotes: truth.length,
    audioSeconds: Math.round(mono.length / 22050 * 10) / 10,
    modelMs,
    modelNotes: raw.length,
    tempoBpm: analysis.tempo?.bpm ?? null,
    tempoSource: analysis.tempo?.source ?? null,
    model: { score: scoreEvents(asScored(raw), truth) },
    arrangements: {
      baseline: {
        score: scoreEvents(baseline.events, truth),
        melodyRecall: anchorRecall(baseline.events, anchors).recall,
        invented: inventedRate(baseline.events, truth),
        density: Math.round((baseline.events.length / Math.max(0.001, mono.length / 22050)) * 100) / 100,
        xmlNotes: baseline.xmlNotes,
        parsedNotes: baseline.parsedNotes,
      },
      cleanupOnly: {
        score: scoreEvents(cleanupOnly.events, truth),
        invented: inventedRate(cleanupOnly.events, truth),
        xmlNotes: cleanupOnly.xmlNotes,
      },
      holdOnly: {
        score: scoreEvents(holdOnly.events, truth),
        durationMaeMs: scoreEvents(holdOnly.events, truth).durationMaeMs,
        xmlNotes: holdOnly.xmlNotes,
      },
      noCorroboration: {
        score: scoreEvents(noCorroboration.events, truth),
        melodyRecall: anchorRecall(noCorroboration.events, anchors).recall,
        invented: inventedRate(noCorroboration.events, truth),
        xmlNotes: noCorroboration.xmlNotes,
      },
      budget20: {
        score: scoreEvents(budget20.events, truth),
        melodyRecall: anchorRecall(budget20.events, anchors).recall,
        invented: inventedRate(budget20.events, truth),
        xmlNotes: budget20.xmlNotes,
      },
      budget15: {
        score: scoreEvents(budget15.events, truth),
        melodyRecall: anchorRecall(budget15.events, anchors).recall,
        invented: inventedRate(budget15.events, truth),
        xmlNotes: budget15.xmlNotes,
      },
      budget15NoCorroboration: {
        score: scoreEvents(budget15NoCorroboration.events, truth),
        melodyRecall: anchorRecall(budget15NoCorroboration.events, anchors).recall,
        invented: inventedRate(budget15NoCorroboration.events, truth),
        xmlNotes: budget15NoCorroboration.xmlNotes,
      },
      cleanupAmp: {
        score: scoreEvents(cleanupAmp.events, truth),
        invented: inventedRate(cleanupAmp.events, truth),
        xmlNotes: cleanupAmp.xmlNotes,
      },
      cleanupAmpStrict: {
        score: scoreEvents(cleanupAmpStrict.events, truth),
        invented: inventedRate(cleanupAmpStrict.events, truth),
        xmlNotes: cleanupAmpStrict.xmlNotes,
      },
      improved: {
        score: scoreEvents(improved.events, truth),
        melodyRecall: anchorRecall(improved.events, anchors).recall,
        invented: inventedRate(improved.events, truth),
        density: Math.round((improved.events.length / Math.max(0.001, mono.length / 22050)) * 100) / 100,
        xmlNotes: improved.xmlNotes,
        parsedNotes: improved.parsedNotes,
      },
    },
  }
  report.rows.push(row)
  console.log(
    `${row.id}: model F1=${row.model.score.eventF1} (P=${row.model.score.pitchPrecision} R=${row.model.score.pitchRecall}) ` +
    `| arrangement baseline F1=${row.arrangements.baseline.score.eventF1} → improved F1=${row.arrangements.improved.score.eventF1} ` +
    `| invented ${row.arrangements.baseline.invented} → ${row.arrangements.improved.invented} ` +
    `| durMAE ${row.arrangements.baseline.score.durationMaeMs} → ${row.arrangements.improved.score.durationMaeMs}ms ` +
    `| notes ${row.arrangements.baseline.xmlNotes} → ${row.arrangements.improved.xmlNotes}`,
  )
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const mean = (values) => {
  const v = values.filter((x) => Number.isFinite(x))
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null
}
report.summary = {
  recordings: report.rows.length,
  modelEventF1: mean(report.rows.map((r) => r.model.score.eventF1)),
  arrangementBaselineF1: mean(report.rows.map((r) => r.arrangements.baseline.score.eventF1)),
  noCorroborationF1: mean(report.rows.map((r) => r.arrangements.noCorroboration.score.eventF1)),
  budget20F1: mean(report.rows.map((r) => r.arrangements.budget20.score.eventF1)),
  budget15F1: mean(report.rows.map((r) => r.arrangements.budget15.score.eventF1)),
  budget15NoCorroborationF1: mean(report.rows.map((r) => r.arrangements.budget15NoCorroboration.score.eventF1)),
  noCorroborationMelody: mean(report.rows.map((r) => r.arrangements.noCorroboration.melodyRecall)),
  budget15Melody: mean(report.rows.map((r) => r.arrangements.budget15.melodyRecall)),
  budget15Notes: mean(report.rows.map((r) => r.arrangements.budget15.xmlNotes)),
  baselineNotes: mean(report.rows.map((r) => r.arrangements.baseline.xmlNotes)),
  budget15Invented: mean(report.rows.map((r) => r.arrangements.budget15.invented)),
  cleanupAmpF1: mean(report.rows.map((r) => r.arrangements.cleanupAmp.score.eventF1)),
  cleanupAmpStrictF1: mean(report.rows.map((r) => r.arrangements.cleanupAmpStrict.score.eventF1)),
  cleanupAmpInvented: mean(report.rows.map((r) => r.arrangements.cleanupAmp.invented)),
  cleanupAmpStrictInvented: mean(report.rows.map((r) => r.arrangements.cleanupAmpStrict.invented)),
  arrangementImprovedF1: mean(report.rows.map((r) => r.arrangements.improved.score.eventF1)),
  baselineInvented: mean(report.rows.map((r) => r.arrangements.baseline.invented)),
  improvedInvented: mean(report.rows.map((r) => r.arrangements.improved.invented)),
  baselineDurationMaeMs: mean(report.rows.map((r) => r.arrangements.baseline.score.durationMaeMs)),
  improvedDurationMaeMs: mean(report.rows.map((r) => r.arrangements.improved.score.durationMaeMs)),
  baselineMelodyRecall: mean(report.rows.map((r) => r.arrangements.baseline.melodyRecall)),
  improvedMelodyRecall: mean(report.rows.map((r) => r.arrangements.improved.melodyRecall)),
}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
console.log('\nsummary', JSON.stringify(report.summary, null, 2))

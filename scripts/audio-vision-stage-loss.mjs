#!/usr/bin/env node
/**
 * §1 — STAGE-LOSS LEDGER: where does the music actually die?
 *
 * The pipeline is measured stage by stage, so a loss can be attributed to a
 * stage instead of to "the arrangement":
 *
 *   S0  audio          -> detected note events      (the pitch model, raw)
 *   S1  note events    -> musical transcription     (suppression + corroboration)
 *   S2  transcription  -> tempo/beat grid           (quantization, phase, tempo)
 *   S3  grid           -> musical transcription     (melody, bass, chords)
 *   S4  transcription  -> solo arrangement          (per target + difficulty)
 *   S5  arrangement    -> valid MusicXML            (emission + re-parse)
 *
 * Every stage is scored against a reference the pipeline never sees:
 *   - the independent synthesized reference (exact notes, onsets, hands),
 *   - the in-repo mic-real clips (Vienna piano / GuitarSet / EGSet truth),
 *   - the real recorded corpus (GuitarSet JAMS / TRIOS score-aligned MIDI)
 *     when it is materialized locally.
 *
 * Metrics are reported SEPARATELY and never blended:
 *   pitch precision/recall, onset MAE, duration error, full-reference event
 *   F1, note density, hand allocation, MusicXML validity.
 *
 * Usage: node --expose-gc scripts/audio-vision-stage-loss.mjs
 *        [--json benchmarks/audio-vision/stage-loss.json]
 *        [--md benchmarks/audio-vision/stage-loss.md]
 *        [--only substr] [--sources synth,micreal,real]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import {
  quantizeToBeats,
  suppressHarmonicDoubles,
  buildMelodyContour,
} from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { dropRingingRedetections } from '../src/features/audio-vision/noteCleanup.js'
import { holdNotesUntilNextOnset } from '../src/features/audio-vision/arrangementDurations.js'
import { renderReference, synthReferenceTruth, SYNTH_REFERENCE_BPM } from './lib/synthReference.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/stage-loss.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/stage-loss.md')
const resolveOut = (value) => (value.startsWith('/') ? value : join(root, value))
const onlyFilter = argValue('--only', null)
const sources = (argValue('--sources', 'synth,micreal,real') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

const ONSET_TOLERANCE = 0.12
const round = (value, digits = 3) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null)

/* ------------------------------------------------------------- comparison */

/**
 * Match predicted events against reference notes.
 * An event matches a reference note when the pitch is equal and the onset is
 * within the tolerance. Everything else is a false positive / missed note.
 */
function scoreEvents(predicted, reference, { tolerance = ONSET_TOLERANCE } = {}) {
  const used = new Set()
  const matches = []
  let falsePositives = 0
  for (const event of predicted) {
    let best = -1
    let bestDelta = Infinity
    for (let i = 0; i < reference.length; i += 1) {
      if (used.has(i)) continue
      const note = reference[i]
      if (note.midi !== event.midi) continue
      const delta = Math.abs((event.onset ?? 0) - note.onset)
      if (delta <= tolerance && delta < bestDelta) { best = i; bestDelta = delta }
    }
    if (best >= 0) {
      used.add(best)
      matches.push({ event, note: reference[best], delta: bestDelta })
    } else {
      falsePositives += 1
    }
  }
  const missed = reference.length - used.size
  const precision = predicted.length ? used.size / predicted.length : 0
  const recall = reference.length ? used.size / reference.length : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const onsetErrors = matches.map((m) => m.delta)
  const durationErrors = matches
    .filter((m) => Number.isFinite(m.event.duration) && Number.isFinite(m.note.offset))
    .map((m) => Math.abs((m.event.duration) - (m.note.offset - m.note.onset)))
  const median = (values) => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  return {
    predicted: predicted.length,
    reference: reference.length,
    matched: used.size,
    falsePositives,
    missed,
    pitchPrecision: round(precision),
    pitchRecall: round(recall),
    eventF1: round(f1),
    onsetMaeMs: matches.length ? Math.round((onsetErrors.reduce((a, b) => a + b, 0) / onsetErrors.length) * 1000) : null,
    onsetMedianMs: matches.length ? Math.round(median(onsetErrors) * 1000) : null,
    durationMaeMs: durationErrors.length ? Math.round((durationErrors.reduce((a, b) => a + b, 0) / durationErrors.length) * 1000) : null,
  }
}

/** Bass anchors: the LOWEST pitch of each onset cluster (the bass line). */
function bassAnchors(notes, clusterSeconds = 0.06) {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset)
  const anchors = []
  for (const note of sorted) {
    const last = anchors[anchors.length - 1]
    if (last && Math.abs(note.onset - last.onset) < clusterSeconds) {
      if (note.midi < last.midi) last.midi = note.midi
    } else {
      anchors.push({ onset: note.onset, midi: note.midi })
    }
  }
  return anchors
}

/** Melody anchors: the highest pitch of each onset cluster (the audible line). */
function melodyAnchors(notes, clusterSeconds = 0.06) {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset)
  const anchors = []
  for (const note of sorted) {
    const last = anchors[anchors.length - 1]
    if (last && Math.abs(note.onset - last.onset) < clusterSeconds) {
      if (note.midi > last.midi) last.midi = note.midi
    } else {
      anchors.push({ onset: note.onset, midi: note.midi })
    }
  }
  return anchors
}

function anchorRecall(events, anchors, tolerance = 0.25) {
  let hit = 0
  let errSum = 0
  for (const anchor of anchors) {
    const near = events.filter((e) => Math.abs(e.onset - anchor.onset) <= tolerance && e.midi === anchor.midi)
    if (near.length) {
      hit += 1
      errSum += Math.min(...near.map((e) => Math.abs(e.onset - anchor.onset)))
    }
  }
  return {
    recall: anchors.length ? round(hit / anchors.length) : null,
    maeMs: hit ? Math.round((errSum / hit) * 1000) : null,
    anchors: anchors.length,
  }
}

/** Share of events with no reference support nearby (invented material). */
function inventedRate(events, reference, tolerance = 0.3) {
  if (!events.length) return null
  let invented = 0
  for (const event of events) {
    const supported = reference.some((note) =>
      Math.abs(note.onset - event.onset) <= tolerance &&
      (((note.midi - event.midi) % 12) + 12) % 12 === 0)
    if (!supported) invented += 1
  }
  return round(invented / events.length)
}

/** MusicXML validity: every measure must be filled exactly, per voice. */
function xmlValidity(xml) {
  const measures = [...xml.matchAll(/<measure number="(\d+)">([\s\S]*?)<\/measure>/g)]
  const expected = 4 * 16
  let overfull = 0
  let underfull = 0
  for (const [, , body] of measures) {
    let cursor = 0
    let maxCursor = 0
    for (const token of body.matchAll(/<note>([\s\S]*?)<\/note>|<backup><duration>(\d+)<\/duration>|<forward><duration>(\d+)<\/duration>/g)) {
      if (token[2] != null) { cursor -= Number(token[2]); continue }
      if (token[3] != null) { cursor += Number(token[3]); maxCursor = Math.max(maxCursor, cursor); continue }
      const note = token[1] ?? ''
      if (/<chord\s*\/?>/.test(note)) continue
      cursor += Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1] ?? 0)
      maxCursor = Math.max(maxCursor, cursor)
    }
    if (maxCursor > expected) overfull += 1
    if (cursor !== expected) underfull += 1
  }
  return { measures: measures.length, overfull, underfull, valid: overfull === 0 && underfull === 0 }
}

/* ------------------------------------------------------------- references */

function loadSources() {
  const list = []
  if (sources.includes('synth')) {
    list.push({
      id: 'synth-reference',
      license: 'original (synthesized in-repo)',
      kind: 'synth',
      sampleRate: 22050,
      samples: renderReference(22050),
      truth: synthReferenceTruth(),
      tempoBpm: SYNTH_REFERENCE_BPM,
    })
  }
  if (sources.includes('micreal')) {
    const manifestPath = join(root, 'benchmarks/mic-real/manifest.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      for (const clip of manifest.clips ?? []) {
        const path = join(root, 'benchmarks/mic-real', clip.audio.file)
        if (!existsSync(path)) continue
        list.push({
          id: clip.id,
          license: clip.license,
          kind: 'micreal',
          path,
          truth: (clip.truth?.notes ?? []).map((n) => ({
            midi: n.midi,
            onset: n.onset,
            offset: n.offset,
          })),
        })
      }
    }
  }
  if (sources.includes('guitarset')) {
    // GuitarSet performances (CC-BY-4.0): real takes, real instruments, with
    // the note-level truth in the JAMS annotation.
    const recordings = [
      { id: 'guitarset-jazz2-solo', base: '04_Jazz2-110-Bb_solo' },
      { id: 'guitarset-jazz1-solo', base: '04_Jazz1-200-B_solo' },
      { id: 'guitarset-ss3-comp', base: '00_SS3-84-Bb_comp' },
      { id: 'guitarset-bn2-comp', base: '00_BN2-131-B_comp' },
      { id: 'guitarset-funk3-comp', base: '00_Funk3-112-C#_comp' },
    ]
    for (const recording of recordings) {
      const wavPath = `/tmp/guitarset/${recording.base}_mic.wav`
      const jamsPath = `/tmp/guitarset/jams/${recording.base}.jams`
      if (!existsSync(wavPath) || !existsSync(jamsPath)) continue
      const jams = JSON.parse(readFileSync(jamsPath, 'utf8'))
      const truth = []
      for (const annotation of jams.annotations ?? []) {
        if (annotation.namespace !== 'note_midi' || !Array.isArray(annotation.data)) continue
        for (const observation of annotation.data) {
          const midi = Math.round(Number(observation.value))
          const onset = Number(observation.time)
          const duration = Number(observation.duration ?? 0)
          if (!Number.isFinite(midi) || !Number.isFinite(onset)) continue
          truth.push({ midi, onset, offset: onset + (Number.isFinite(duration) ? duration : 0.1) })
        }
      }
      if (!truth.length) continue
      list.push({
        id: recording.id,
        license: 'CC-BY-4.0 (GuitarSet, Zenodo 3371780) - local evaluation only',
        kind: 'guitarset',
        path: wavPath,
        truth: truth.sort((a, b) => a.onset - b.onset),
      })
    }
  }
  if (sources.includes('real')) {
    const manifestPath = '/tmp/realcorpus/manifest.json'
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      for (const entry of manifest.entries ?? []) {
        if (!entry.truthNotes?.length) continue
        const audioPath = entry.audio?.startsWith?.('/') ? entry.audio : join(root, entry.audio ?? '')
        if (!existsSync(audioPath)) continue
        list.push({
          id: entry.id,
          license: entry.license,
          kind: 'real',
          path: audioPath,
          truth: entry.truthNotes.map((n) => ({ midi: n.midi, onset: n.onset, offset: n.offset })),
        })
      }
    }
  }
  return list
}

/* -------------------------------------------------------------------- run */

const entries = loadSources().filter((e) => !onlyFilter || e.id.includes(onlyFilter))
const report = {
  generatedAt: new Date().toISOString(),
  onsetTolerance: ONSET_TOLERANCE,
  sources: sources.join(','),
  rows: [],
  summary: {},
}
console.log(`stage-loss: ${entries.length} recordings`)

for (const entry of entries) {
  let mono
  let sampleRate = 22050
  if (entry.kind === 'synth') {
    mono = entry.samples
  } else {
    const wav = readWavPcm(entry.path)
    sampleRate = wav.sampleRate
    mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  }
  const truth = entry.truth
  if (!truth.length) continue
  const anchors = melodyAnchors(truth)
  const bassTruth = bassAnchors(truth)

  // S0 — the raw model output. The notes keep the model's own field names
  // (startSeconds/endSeconds) so the pipeline's own helpers (suppression,
  // corroboration) see exactly what they see in production.
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
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

  // S1 — the pipeline's own note set: harmonic-double suppression. The
  // ablation below shows what the suppression actually does to the music.
  // The notes keep the MODEL's field names here; scoring converts them.
  // Match the shipped pipeline (amplitude-only). AV_SUPPRESS_SPECTRAL=1 runs
  // the measured spectral variant for research.
  const spectralSuppression = process.env.AV_SUPPRESS_SPECTRAL === '1'
  const suppressed = suppressHarmonicDoubles(raw, spectralSuppression ? { samples: mono, sampleRate: 22050 } : {})
  const s1Model = suppressed.notes
  const s1Notes = asScored(s1Model)
  const suppressionAblation = {
    off: scoreEvents(asScored(raw), truth),
    ratio1_5: scoreEvents(asScored(suppressed.notes), truth),
    ratio3: scoreEvents(asScored(suppressHarmonicDoubles(raw, { minRatio: 3 }).notes), truth),
    ratio6: scoreEvents(asScored(suppressHarmonicDoubles(raw, { minRatio: 6 }).notes), truth),
  }
  // Damage / benefit of each suppression setting: how many DROPPED notes were
  // genuine (the music that was deleted) and how many were invented (the
  // artifacts that were removed).
  const isTruthNote = (note) => truth.some((t) =>
    t.midi === note.midi && Math.abs(t.onset - note.startSeconds) <= 0.12)
  const rawKey = (note) => `${note.midi}@${note.startSeconds.toFixed(2)}`
  const suppressionDamage = (minRatio) => {
    const after = suppressHarmonicDoubles(raw, minRatio ? { minRatio } : {}).notes
    const keptKeys = new Set(after.map(rawKey))
    const dropped = raw.filter((n) => !keptKeys.has(rawKey(n)))
    return {
      dropped: dropped.length,
      droppedGenuine: dropped.filter(isTruthNote).length,
      droppedInvented: dropped.filter((n) => !isTruthNote(n)).length,
    }
  }
  suppressionAblation.damage = {
    ratio1_5: suppressionDamage(1.5),
    ratio3: suppressionDamage(3),
    ratio6: suppressionDamage(6),
  }

  const views = await buildAnalysisViews(mono, 22050)
  // Match the shipped pipeline: the onset-corroboration gate is OFF by
  // default (it deleted real notes on real recordings); AV_CORROBORATE=1
  // reproduces the older behaviour for the ablation.
  const corroborate = process.env.AV_CORROBORATE === '1'
  const analysis = await analyzeMusic(mono, 22050, {
    views,
    corroborateNotes: corroborate,
    predictNotes: async () => s1Notes.map((n) => ({
      midi: n.midi,
      startSeconds: n.onset,
      endSeconds: n.onset + (n.duration ?? 0.1),
      amplitude: n.amplitude,
    })),
  })

  const beat0 = analysis.beats.beats[0] ?? 0
  const period = analysis.beats.beatPeriodSeconds
  // The score rebases time to its own start, so score-clock comparisons shift
  // by the first beat. Recorded so both clocks stay auditable.
  const truthInScoreClock = truth.map((n) => ({ ...n, onset: n.onset - beat0 }))

  // What kind of false positives survive? (a) a harmonic artifact: the same
  // pitch class as a kept note an octave/fifth away; (b) a near-duplicate of a
  // kept note (the same pitch a moment later); (c) something else.
  const classifyFalsePositives = (events, kept) => {
    const counts = { harmonic: 0, duplicate: 0, other: 0 }
    for (const event of events) {
      if (kept.some((k) => k.midi === event.midi && Math.abs(k.onset - event.onset) <= 0.12)) continue
      if (kept.some((k) => k.midi === event.midi && Math.abs(k.onset - event.onset) <= 0.3)) { counts.duplicate += 1; continue }
      if (kept.some((k) => {
        const interval = Math.abs(k.midi - event.midi) % 12
        return (interval === 0 || interval === 7) && Math.abs(k.onset - event.onset) <= 0.12
      })) { counts.harmonic += 1; continue }
      counts.other += 1
    }
    return counts
  }

  // S1b — the corroboration gate (inside the analysis): the model's notes
  // that survived the independent onset check.
  // The re-detection cleanup, A/B measured (with the analysis's onsets).
  const deduped = dropRingingRedetections(s1Model, {
    onsetTimes: (analysis.onsets ?? []).map((o) => o.seconds),
    amplitudeRatio: Number(process.env.AV_AMP_RATIO ?? 0),
  })
  const cleanupAblation = {
    off: scoreEvents(s1Notes, truth),
    on: scoreEvents(asScored(deduped.notes), truth),
    removed: deduped.removed,
    droppedGenuine: (deduped.dropped ?? []).filter((n) => truth.some((t) =>
      t.midi === n.midi && Math.abs(t.onset - n.startSeconds) <= 0.12)).length,
    droppedInvented: (deduped.dropped ?? []).filter((n) => !truth.some((t) =>
      t.midi === n.midi && Math.abs(t.onset - n.startSeconds) <= 0.12)).length,
  }

  const corroborated = (analysis.predictedNotes ?? []).map((n) => ({
    midi: n.midi,
    onset: n.startSeconds,
    duration: (n.endSeconds ?? 0) - (n.startSeconds ?? 0),
  }))
  const corroboratedScore = scoreEvents(corroborated, truth)

  // S2 — the beat grid: the same notes, snapped to the grid.
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  const s2Events = quantized.map((n) => ({
    midi: n.midi,
    onset: beat0 + (n.quantizedStartBeat ?? 0) * period,
    duration: (n.quantizedDurBeats ?? 0) * period,
  }))

  // S3 — the musical transcription (melody, bass, chords).
  const contour = buildMelodyContour(analysis.melody, { beat0, beatPeriod: period })
  const melodyByBeat = (analysis.melody ?? []).map((m) => ({ beat: (m.seconds - beat0) / period, midi: m.midi }))
  const s3 = {
    melodyAnchorRecall: anchorRecall(analysis.melody ?? [], anchors),
    chordWindows: analysis.chords?.length ?? 0,
    chordsWithHeardVoicing: (analysis.chords ?? []).filter((c) => (c.heardPcs ?? []).length > 0).length,
    bassFrames: analysis.bassLine?.length ?? 0,
    sections: analysis.sections?.length ?? 0,
    tempoBpm: analysis.tempo?.bpm ?? null,
    tempoSource: analysis.tempo?.source ?? null,
    tempoAmbiguous: Boolean(analysis.tempo?.ambiguousTempo),
    beat0: round(beat0),
    beatPeriod: round(period, 4),
  }

  const row = {
    id: entry.id,
    kind: entry.kind,
    license: entry.license,
    truthNotes: truth.length,
    melodyAnchors: anchors.length,
    s0: { ...scoreEvents(asScored(raw), truth), notes: raw.length },
    s1: { ...scoreEvents(s1Notes, truth), suppressed: suppressed.suppressed },
    suppressionAblation,
    cleanupAblation,
    corroborate,
    s1b: {
      ...corroboratedScore,
      notes: corroborated.length,
      falsePositiveKinds: classifyFalsePositives(corroborated, corroborated.filter((n) =>
        truth.some((t) => t.midi === n.midi && Math.abs(t.onset - n.onset) <= 0.12))),
    },
    s2: {
      ...scoreEvents(s2Events, truth),
      notes: s2Events.length,
      gridShiftMs: s2Events.length
        ? Math.round(((s2Events[0].onset - truth[0].onset) || 0) * 1000)
        : null,
    },
    s3,
    targets: {},
  }

  for (const targetPart of ['solo-piano', 'solo-guitar']) {
    row.targets[targetPart] = {}
    for (const difficulty of ['easy', 'intermediate', 'advanced']) {
      const arranged = targetPart === 'solo-piano'
        ? arrangeSoloPiano({
          quantizedNotes: quantized,
          chords: analysis.chords,
          melodyByBeat,
          difficulty,
          melodyContour: contour,
          beat0,
          beatPeriod: period,
        })
        : arrangeSoloGuitar({ quantizedNotes: quantized, chords: analysis.chords, difficulty, melodyContour: contour })
      const toSec = (e) => beat0 + e.startBeat * period
      const s4Events = arranged.events.map((e) => ({
        midi: e.midi,
        onset: toSec(e),
        duration: (e.durBeats ?? 0) * period,
      }))
      const simplified = simplifyForDifficulty(
        arranged.events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
        difficulty,
      ).map((e) => ({
        ...e,
        startBeat: e.quantizedStartBeat ?? e.startBeat,
        durBeats: e.quantizedDurBeats ?? e.durBeats,
      }))
      // The duration fix, A/B measured: a note sounds until the next note in
      // its own part replaces it.
      const durationAblation = (() => {
        const off = simplified.map((e) => ({
          midi: e.midi,
          onset: toSec(e),
          duration: (e.durBeats ?? 0) * period,
        }))
        const held = holdNotesUntilNextOnset(simplified.map((e) => ({ ...e })), { maxBeats: 8 })
        const on = held.events.map((e) => ({
          midi: e.midi,
          onset: toSec(e),
          duration: (e.durBeats ?? 0) * period,
        }))
        return { off: scoreEvents(off, truth), on: scoreEvents(on, truth), changed: held.changed }
      })()
      const s5Events = durationAblation.on.length ? durationAblation.on : simplified.map((e) => ({
        midi: e.midi,
        onset: toSec(e),
        duration: (e.durBeats ?? 0) * period,
      }))
      const xml = buildArrangementMusicXml({
        events: simplified,
        targetPart,
        bpm: analysis.tempo.bpm,
        title: entry.id,
      })
      let parsed = null
      let validity = xmlValidity(xml)
      try {
        parsed = parseMusicXml(xml, 'stage-loss.musicxml')
      } catch {
        validity = { ...validity, valid: false, parseError: true }
      }
      const parsedNotes = (parsed?.notes ?? [])
        .filter((n) => !n.isRest && Number.isFinite(n.midi))
        .map((n) => ({ midi: n.midi, onset: n.timeSeconds, duration: n.durationSeconds }))
      const density = s5Events.length / Math.max(0.001, analysis.totalSeconds)
      const handAccuracy = (() => {
        if (targetPart !== 'solo-piano' || !truth.some((t) => t.hand)) return null
        const byHand = new Map()
        for (const note of truth) {
          if (!note.hand) continue
          if (!byHand.has(note.hand)) byHand.set(note.hand, [])
          byHand.get(note.hand).push(note)
        }
        let total = 0
        let correct = 0
        for (const [hand, notes] of byHand) {
          const anchorsForHand = melodyAnchors(notes)
          for (const anchor of anchorsForHand) {
            const near = simplified.filter((e) => {
              const sec = toSec(e)
              return Math.abs(sec - anchor.onset) <= 0.25 && e.midi === anchor.midi
            })
            if (!near.length) continue
            total += 1
            if (near[0].hand === hand) correct += 1
          }
        }
        return total ? round(correct / total) : null
      })()
      row.targets[targetPart][difficulty] = {
        durationAblation,
        s4: scoreEvents(s4Events, truth),
        s5: scoreEvents(s5Events, truth),
        melodyAnchorRecall: anchorRecall(s5Events, anchors),
        bassAnchorRecall: anchorRecall(s5Events, bassTruth),
        xmlNotes: simplified.length,
        xmlParsedNotes: parsedNotes.length,
        densityPerSecond: round(density, 2),
        inventedRate: inventedRate(s5Events, truth),
        handAccuracy,
        tinyDurations: s5Events.filter((e) => (e.duration ?? 1) < 0.09).length,
        ledgerRisk: s5Events.filter((e) => e.midi < 40 || e.midi > 84).length,
        validity,
        scoreClock: { beat0: round(beat0), period: round(period, 4) },
      }
    }
  }
  report.rows.push(row)
  console.log(
    `  ${entry.id}: S0 F1=${row.s0.eventF1} (${row.s0.notes} notes) ` +
    `S1 F1=${row.s1.eventF1} (suppressed ${row.s1.suppressed}) ` +
    `ablation off=${row.suppressionAblation.off.eventF1} r3=${row.suppressionAblation.ratio3.eventF1} r6=${row.suppressionAblation.ratio6.eventF1} ` +
    `damage=${JSON.stringify(row.suppressionAblation.damage.ratio1_5)} ` +
    `cleanup=${row.cleanupAblation.off.eventF1}→${row.cleanupAblation.on.eventF1} (-${row.cleanupAblation.removed}: genuine ${row.cleanupAblation.droppedGenuine} / invented ${row.cleanupAblation.droppedInvented}) ` +
    `durationMAE(piano/inter)=${row.targets['solo-piano']?.intermediate?.durationAblation?.off?.durationMaeMs}→${row.targets['solo-piano']?.intermediate?.durationAblation?.on?.durationMaeMs}ms ` +
    `S1b F1=${row.s1b.eventF1} (${row.s1b.notes}) ` +
    `S2 F1=${row.s2.eventF1} | piano/inter F1=${row.targets['solo-piano'].intermediate.s5.eventF1} ` +
    `density=${row.targets['solo-piano'].intermediate.densityPerSecond} xml=${row.targets['solo-piano'].intermediate.validity.valid}`,
  )
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

/* ------------------------------------------------------------------ summary */

const aggregate = (rows, pick) => {
  const values = rows.map(pick).filter((v) => Number.isFinite(v))
  if (!values.length) return null
  return round(values.reduce((a, b) => a + b, 0) / values.length)
}
report.summary = {
  recordings: report.rows.length,
  s0: {
    eventF1: aggregate(report.rows, (r) => r.s0.eventF1),
    pitchRecall: aggregate(report.rows, (r) => r.s0.pitchRecall),
    onsetMaeMs: aggregate(report.rows, (r) => r.s0.onsetMaeMs),
  },
  s1: { eventF1: aggregate(report.rows, (r) => r.s1.eventF1) },
  s2: { eventF1: aggregate(report.rows, (r) => r.s2.eventF1) },
  pianoIntermediate: {
    eventF1: aggregate(report.rows, (r) => r.targets['solo-piano']?.intermediate?.s5?.eventF1),
    density: aggregate(report.rows, (r) => r.targets['solo-piano']?.intermediate?.densityPerSecond),
    invented: aggregate(report.rows, (r) => r.targets['solo-piano']?.intermediate?.inventedRate),
  },
  guitarIntermediate: {
    eventF1: aggregate(report.rows, (r) => r.targets['solo-guitar']?.intermediate?.s5?.eventF1),
  },
  xmlValid: report.rows.every((r) =>
    Object.values(r.targets).every((t) => Object.values(t).every((c) => c.validity.valid))),
}

writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 2))
const lines = [
  '# Stage-loss ledger (per stage, against a reference the pipeline never sees)',
  '',
  `generated ${report.generatedAt} · sources: ${report.sources} · onset tolerance ${ONSET_TOLERANCE}s`,
  '',
  '| recording | S0 model F1 | S1 transcription F1 | S2 grid F1 | S3 melody recall | piano/inter F1 | guitar/inter F1 | density | invented | xml ok |',
  '|---|---|---|---|---|---|---|---|---|---|',
]
for (const r of report.rows) {
  const p = r.targets['solo-piano']?.intermediate
  const g = r.targets['solo-guitar']?.intermediate
  lines.push(`| ${r.id} | ${r.s0.eventF1} | ${r.s1.eventF1} | ${r.s2.eventF1} | ${r.s3.melodyAnchorRecall.recall} | ${p?.s5?.eventF1} | ${g?.s5?.eventF1} | ${p?.densityPerSecond} | ${p?.inventedRate} | ${p?.validity?.valid} |`)
}
lines.push('', '## Aggregate', '', '```json', JSON.stringify(report.summary, null, 2), '```', '')
writeFileSync(resolveOut(mdOut), `${lines.join('\n')}\n`)
console.log('stage-loss written', jsonOut, mdOut)

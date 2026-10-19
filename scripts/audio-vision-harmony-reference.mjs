/**
 * P1/P2 — Valid harmony reference + end-to-end harmony attribution.
 *
 * Uses REAL chord annotations (GuitarSet JAMS `chord` namespace: root,
 * quality, and bass-slash for inversions) — the first trustworthy chord
 * ground truth in this project. Keeps the four reference layers SEPARATE:
 *   labelledChord : what the annotation actually says (may be null)
 *   soundingPcs  : pitch classes the artists play (from note truth)
 *   bass         : lowest sounding voice pitch class
 *   melody       : highest sounding voice pitch class
 *   ambiguous    : no label, or the sounding set cannot realize the label
 *
 * Scores the pipeline per stage so accompaniment failures can be attributed:
 *   S1 transcription  : are the annotated chord's tones present in the model's notes?
 *   S2 chord estimate : does the analyzed chord agree (root, quality, both)?
 *   S3 bass          : does the arrangement's lowest note match the label's bass?
 *   S4 voicing       : are the arrangement's accompaniment pitch classes a subset
 *                      of the annotated chord + sounding collection?
 * Timing errors are reported against annotated chord boundaries.
 *
 * Usage: node --expose-gc scripts/audio-vision-harmony-reference.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import {
  quantizeToBeats,
  buildMelodyContour,
  suppressHarmonicDoubles,
} from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/harmony-reference.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/harmony-reference.md')

const manifest = JSON.parse(readFileSync('/tmp/realcorpus/manifest.json', 'utf8'))

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
// Our analyzer's quality names -> JAMS-style short codes for comparison.
const QUALITY_ALIAS = { major: 'maj', minor: 'min', major7: 'maj7', minor7: 'min7', dominant7: 'dom7', diminished: 'dim', suspended4: 'sus4' }

const QUALITY_INTERVALS = {
  maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7],
  maj6: [0, 4, 7, 9], min6: [0, 3, 7, 9], dom7: [0, 4, 7, 10], hdim7: [0, 3, 6, 9],
  dim7: [0, 3, 6, 9], minmaj7: [0, 3, 7, 11],
}
function parseLabel(label) {
  if (!label || label === 'N' || label === 'X') return null
  const m = String(label).match(/^([A-G][#b]?):([a-z0-9]+)?(?:\/([A-G][#b]?|\d))?/)
  if (!m) return null
  const rootPc = PC[m[1]]
  if (rootPc == null) return null
  const quality = m[2] ?? 'maj'
  const bass = m[3]
  let bassPc = rootPc
  if (bass) bassPc = PC[bass] ?? (PC[bass] != null ? PC[bass] : null)
  if (bass != null && PC[bass] == null && /^\d$/.test(bass)) {
    const degree = Number(bass) - 1
    bassPc = (rootPc + [0, 4, 7][degree] ?? degree) % 12
  }
  const intervals = QUALITY_INTERVALS[quality]
  return { rootPc, quality, bassPc, intervals, label: String(label) }
}

const rows = []
for (const entry of manifest.entries) {
  if (!entry.truthChords?.length) continue
  console.log(`--- ${entry.id} (${entry.truthChords.length} labelled chords)`)
  // Manifest chords carry {startSeconds, endSeconds, root, quality, label};
  // parse the FULL quality from the label string (the manifest maps everything
  // non-minor to 'major', which would lose sevenths).
  const labels = entry.truthChords
    .map((c) => parseLabel(c.label))
    .filter(Boolean)
  if (!labels.length) continue

  const wav = readWavPcm(entry.audio)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const bpRaw = bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude }))
  const s1 = suppressHarmonicDoubles(bpRaw)
  const views = await buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: async () => s1.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude })),
  })
  const beat0 = analysis.beats.beats[0] ?? 0
  const period = analysis.beats.beatPeriodSeconds
  const contour = buildMelodyContour(analysis.melody, { beat0, beatPeriod: period })
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  const truthNotes = entry.truthNotes ?? []

  // Arrangements (intermediate: the middle difficulty carries real harmony).
  const pianoEvents = (() => {
    const { events } = arrangeSoloPiano({ quantizedNotes: quantized, chords: analysis.chords, melodyByBeat: analysis.melody.map((m) => ({ beat: (m.seconds - beat0) / period, midi: m.midi })), difficulty: 'intermediate', melodyContour: contour, beat0, beatPeriod: period })
    return simplifyForDifficulty(events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })), 'intermediate')
      .map((e) => ({ ...e, startBeat: e.quantizedStartBeat ?? e.startBeat, durBeats: e.quantizedDurBeats ?? e.durBeats, sec: beat0 + (e.quantizedStartBeat ?? e.startBeat) * period }))
  })()
  const guitarEvents = (() => {
    const { events } = arrangeSoloGuitar({ quantizedNotes: quantized, chords: analysis.chords, difficulty: 'intermediate', melodyContour: contour })
    return simplifyForDifficulty(events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })), 'intermediate')
      .map((e) => ({ ...e, startBeat: e.quantizedStartBeat ?? e.startBeat, durBeats: e.quantizedDurBeats ?? e.durBeats, sec: beat0 + (e.quantizedStartBeat ?? e.startBeat) * period }))
  })()

  const perChord = []
  const sums = {
    n: 0, rootHit: 0, qualityHit: 0, bothHit: 0,
    s1TonesPresent: 0, s1Missing: 0,
    s3BassHit: 0, s3BassTotal: 0,
    s4VoicingHit: 0, s4VoicingTotal: 0,
    timingErr: 0, timingN: 0,
    ambiguous: 0, matchedWindows: 0,
    seventhLabelHeard: 0, seventhLabelHeardKept: 0,
    seventhLabelNotHeard: 0, seventhLabelNotHeardStillClaimed: 0,
    triadLabels: 0, triadLabelClaimedSeventh: 0,
  }

  const modelledNotes = analysis.predictedNotes
  const pcsAt = (seconds) => {
    const set = new Set()
    for (const n of modelledNotes) {
      if (n.startSeconds <= seconds && n.endSeconds >= seconds) set.add(((n.midi % 12) + 12) % 12)
    }
    for (const n of truthNotes) {
      if (n.onset <= seconds && (n.offset ?? n.onset + 0.4) >= seconds) {
        // Only add truth pcs that the model also heard, so S1 measures the
        // transcription, not the truth.
      }
    }
    return set
  }
  const soundingTruthPcs = (seconds) => {
    const set = new Set()
    for (const n of truthNotes) {
      if (n.onset <= seconds && (n.offset ?? n.onset + 0.4) >= seconds) set.add(((n.midi % 12) + 12) % 12)
    }
    return set
  }
  const analysisChordAt = (seconds) => {
    let best = null
    let dist = Infinity
    for (const c of analysis.chords) {
      const mid = (c.startSeconds + c.endSeconds) / 2
      const d = Math.abs(mid - seconds)
      if (d < dist) {
        dist = d
        best = c
      }
    }
    return dist < 1.0 ? best : null
  }

  for (const label of entry.truthChords) {
    const parsed = parseLabel(label.label)
    const mid = label.startSeconds + ((label.endSeconds ?? label.startSeconds) - label.startSeconds) / 2
    const row = { seconds: Math.round(mid * 10) / 10, label: label.label }
    const chord = analysisChordAt(mid)
    if (!parsed || !parsed.intervals) {
      row.status = 'unparseable-or-no-chord'
      sums.ambiguous += 1
      perChord.push(row)
      continue
    }
    // Ambiguity: labelled chord not realizable from the sounding truth.
    const sounding = soundingTruthPcs(mid)
    const tones = new Set(parsed.intervals.map((iv) => (parsed.rootPc + iv) % 12))
    const realizable = sounding.size === 0 || [...tones].some((t) => sounding.has(t))
    if (!sounding.size || !realizable) {
      row.status = 'ambiguous-reference'
      sums.ambiguous += 1
      perChord.push(row)
      continue
    }
    sums.n += 1
    sums.matchedWindows += 1

    // S1 transcription: annotated tones present in the model's notes?
    const heard = pcsAt(mid)
    const missing = [...tones].filter((t) => !heard.has(t))
    sums.s1TonesPresent += tones.size - missing.length
    sums.s1Missing += missing.length

    // SEVENTH GUARD: did the label contain a seventh, did the transcription
    // hear it, and what did the analysis finally claim?
    const labelIsSeventh = /7/.test(String(label.label))
    if (labelIsSeventh) {
      const extTone = (parsed.rootPc + (QUALITY_INTERVALS[parsed.quality] ?? MAJOR)[1] + 1) % 12
      const seventhHeard = heard.has((parsed.rootPc + 10) % 12) || heard.has((parsed.rootPc + 11) % 12)
      if (seventhHeard) {
        sums.seventhLabelHeard += 1
        if (chord && /7/.test(chord.label)) sums.seventhLabelHeardKept += 1
      } else {
        sums.seventhLabelNotHeard += 1
        // If the transcription could not hear the 7th, any seventh we claim is
        // unsupported; count how often we still claim one (false extension).
        if (chord && /7/.test(chord.label)) sums.seventhLabelNotHeardStillClaimed += 1
      }
      void extTone
    } else {
      sums.triadLabels += 1
      if (chord && /7/.test(chord.label)) sums.triadLabelClaimedSeventh += 1
    }

    // S2 chord estimate.
    if (chord) {
      row.analyzed = chord.label
      if (chord.root === parsed.rootPc) sums.rootHit += 1
      if (chord.quality === parsed.quality || QUALITY_ALIAS[chord.quality] === parsed.quality) sums.qualityHit += 1
      if (chord.root === parsed.rootPc && (chord.quality === parsed.quality || QUALITY_ALIAS[chord.quality] === parsed.quality)) sums.bothHit += 1
    } else {
      row.analyzed = null
    }

    // S3 bass: arrangement's lowest note vs annotated bass.
    for (const [name, events] of [['piano', pianoEvents], ['guitar', guitarEvents]]) {
      const nearby = events.filter((e) => Math.abs(e.sec - mid) <= 0.35)
      if (!nearby.length) continue
      const lowest = Math.min(...nearby.map((e) => e.midi))
      sums.s3BassTotal += 1
      if (((lowest % 12) + 12) % 12 === parsed.bassPc) sums.s3BassHit += 1
      if (name === 'piano') row.pianoBass = ((lowest % 12) + 12) % 12
    }

    // S4 voicing: accompaniment pitch classes inside the annotated chord.
    for (const [name, events] of [['piano', pianoEvents], ['guitar', guitarEvents]]) {
      const accom = events.filter((e) => e.role !== 'melody' && Math.abs(e.sec - mid) <= 0.35)
      for (const e of accom) {
        sums.s4VoicingTotal += 1
        if (tones.has(((e.midi % 12) + 12) % 12)) sums.s4VoicingHit += 1
      }
    }

    // Timing: nearest analyzed boundary vs annotated boundary.
    if (chord) {
      const endSeconds = label.endSeconds ?? label.startSeconds
      const d = Math.min(Math.abs(chord.startSeconds - label.startSeconds), Math.abs(chord.endSeconds - endSeconds))
      sums.timingErr += d
      sums.timingN += 1
    }
    perChord.push(row)
  }

  const n = Math.max(1, sums.n)
  rows.push({
    id: entry.id,
    license: entry.license,
    labelledWindows: entry.truthChords.length,
    usableWindows: sums.n,
    ambiguousWindows: sums.ambiguous,
    rootAccuracy: sums.n ? Math.round((sums.rootHit / sums.n) * 1000) / 1000 : null,
    qualityAccuracy: sums.n ? Math.round((sums.qualityHit / sums.n) * 1000) / 1000 : null,
    rootAndQualityAccuracy: sums.n ? Math.round((sums.bothHit / sums.n) * 1000) / 1000 : null,
    s1ChordTonesPresentRate: (sums.s1TonesPresent + sums.s1Missing)
      ? Math.round((sums.s1TonesPresent / (sums.s1TonesPresent + sums.s1Missing)) * 1000) / 1000 : null,
    s1MissingTones: sums.s1Missing,
    s3BassAccuracy: sums.s3BassTotal ? Math.round((sums.s3BassHit / sums.s3BassTotal) * 1000) / 1000 : null,
    s3BassWindows: sums.s3BassTotal,
    s4VoicingAccuracy: sums.s4VoicingTotal ? Math.round((sums.s4VoicingHit / sums.s4VoicingTotal) * 1000) / 1000 : null,
    s4VoicingNotes: sums.s4VoicingTotal,
    timingMaeSeconds: sums.timingN ? Math.round((sums.timingErr / sums.timingN) * 1000) / 1000 : null,
    seventhGuard: {
      labelledSeventhsTotal: sums.seventhLabelHeard + sums.seventhLabelNotHeard,
      heardAndKept: sums.seventhLabelHeardKept,
      heard: sums.seventhLabelHeard,
      unheardStillClaimed: sums.seventhLabelNotHeardStillClaimed,
      triadLabels: sums.triadLabels,
      triadLabelsClaimedSeventh: sums.triadLabelClaimedSeventh,
    },
    perChord,
  })
  const r = rows[rows.length - 1]
  console.log(`  usable=${r.usableWindows} ambiguous=${r.ambiguousWindows} root=${r.rootAccuracy} quality=${r.qualityAccuracy} both=${r.rootAndQualityAccuracy}`)
  console.log(`  S1 tones present rate=${r.s1ChordTonesPresentRate} (missing ${r.s1MissingTones}) S3 bass=${r.s3BassAccuracy} S4 voicing=${r.s4VoicingAccuracy} timingMAE=${r.timingMaeSeconds}`)
  console.log(`  seventhGuard: ${JSON.stringify(r.seventhGuard)}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

writeFileSync(join(root, jsonOut), JSON.stringify({ rows }, null, 2))
const lines = ['# Harmony reference + staged attribution (REAL chord labels: GuitarSet JAMS)', '',
  '| recording | labelled | usable | ambiguous | root | quality | both | S1 tones | S3 bass | S4 voicing | timing MAE |',
  '|---|---|---|---|---|---|---|---|---|---|---|']
for (const r of rows) {
  lines.push(`| ${r.id} | ${r.labelledWindows} | ${r.usableWindows} | ${r.ambiguousWindows} | ${r.rootAccuracy} | ${r.qualityAccuracy} | ${r.rootAndQualityAccuracy} | ${r.s1ChordTonesPresentRate} | ${r.s3BassAccuracy} | ${r.s4VoicingAccuracy} | ${r.timingMaeSeconds} |`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log('done')

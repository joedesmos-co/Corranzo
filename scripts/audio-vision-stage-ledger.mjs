/**
 * §1 — Stage-loss ledger: where does melody actually die?
 *
 * Runs the REAL pipeline stages on truth-labeled mixes and scores melody
 * anchors (exact midi, ±0.25 s) after EACH stage:
 *  S1 pitch model (Basic Pitch + suppression)
 *  S2 quantization (grid snap)
 *  S3 arrangement (conflict resolve, per target)
 *  S4 difficulty simplify (easy vs advanced)
 *  S5 MusicXML emission + re-parse
 * Plus matched-anchor onset MAE (onset timing error) at S1 and S3.
 *
 * This separates model misses from arranger drops with numbers, not prose.
 * Frozen eval audio; no tuning knobs in this script.
 *
 * Usage: node --expose-gc scripts/audio-vision-stage-ledger.mjs [--json p] [--md p] [--only substr]
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
  suppressHarmonicDoubles,
  buildMelodyContour,
} from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/stage-ledger.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/stage-ledger.md')
const onlyFilter = argValue('--only', null)
const manifest = JSON.parse(readFileSync('/tmp/realcorpus/manifest.json', 'utf8'))
// Part-tagged TRIOS truth (drives the bass/extraction metric). Optional.
let TRIOS_PARTS = null
try {
  const trios = JSON.parse(readFileSync('/tmp/trios-truth.json', 'utf8'))
  TRIOS_PARTS = trios.takes
} catch { /* TRIOS not materialized */ }

function melodyAnchors(truth) {
  const sorted = [...truth].sort((a, b) => a.onset - b.onset)
  const anchors = []
  for (const t of sorted) {
    const last = anchors[anchors.length - 1]
    if (last && Math.abs(t.onset - last.onset) < 0.06) {
      if (t.midi > last.midi) last.midi = t.midi
    } else {
      anchors.push({ onset: t.onset, midi: t.midi })
    }
  }
  return anchors
}

function recallAt(events, anchors, tol = 0.25) {
  let hit = 0
  let errSum = 0
  for (const a of anchors) {
    const near = events.filter((e) => Math.abs(e.sec - a.onset) <= tol && e.midi === a.midi)
    if (near.length) {
      hit += 1
      errSum += Math.min(...near.map((e) => Math.abs(e.sec - a.onset)))
    }
  }
  return {
    recall: anchors.length ? Math.round((hit / anchors.length) * 1000) / 1000 : null,
    maeMs: hit ? Math.round((errSum / hit) * 1000) : null,
    hit,
    anchors: anchors.length,
  }
}

/** Share of arrangement notes with NO truth support nearby (invented). */
function inventedRate(eventsSec, truthNotes, tol = 0.3) {
  if (!eventsSec.length) return null
  let invented = 0
  for (const e of eventsSec) {
    const supported = truthNotes.some((t) => Math.abs(t.onset - e.sec) <= tol && (((t.midi - e.midi) % 12) + 12) % 12 === 0)
    if (!supported) invented += 1
  }
  return Math.round((invented / eventsSec.length) * 1000) / 1000
}

const ENTRIES = manifest.entries.filter((e) => !onlyFilter || e.id.includes(onlyFilter))
const report = { tol: 0.25, rows: [], generatedAt: new Date().toISOString() }

for (const entry of ENTRIES) {
  if (!entry.truthNotes?.length) continue
  console.log(`--- ${entry.id}`)
  const anchors = melodyAnchors(entry.truthNotes)
  // Part-tagged truth for bass extraction + invented-note metrics.
  let bassNotes = []
  let partTruthNotes = entry.truthNotes
  if (TRIOS_PARTS) {
    const takeKey = entry.id.replace('trios-', '').replace('-mix', '')
    const take = TRIOS_PARTS[takeKey]
    if (take?.parts) {
      const parts = Object.entries(take.parts).filter(([p]) => !['kick', 'snare', 'ride'].includes(p))
      const byMedian = parts.map(([p, data]) => {
        const mids = data.notes.map((n) => n.midi).sort((x, y) => x - y)
        return { part: p, median: mids[Math.floor(mids.length / 2)], notes: data.notes }
      }).sort((a, b) => a.median - b.median)
      bassNotes = byMedian[0]?.notes ?? []
      partTruthNotes = parts.flatMap(([, data]) => data.notes)
    }
  }
  const wav = readWavPcm(entry.audio)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bpOut = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const bpRaw = bpOut.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude }))
  // S1: model + suppression (the pipeline's actual S1).
  const s1 = suppressHarmonicDoubles(bpRaw)
  const s1Events = s1.notes.map((n) => ({ midi: n.midi, sec: n.startSeconds }))
  const views = buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: async () => s1.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude })),
  })
  const beat0 = analysis.beats.beats[0] ?? 0
  const period = analysis.beats.beatPeriodSeconds
  // Score-clock anchors: the emitted score starts at t=0 (leading silence
  // trimmed), so anchors shift by the first beat's audio time. Recorded so
  // both clocks are auditable.
  const anchorsScore = melodyAnchors(entry.truthNotes).map((a) => ({ onset: a.onset - beat0, midi: a.midi }))
  // S2: quantization.
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  const s2Events = quantized.map((n) => ({ midi: n.midi, sec: beat0 + (n.quantizedStartBeat ?? 0) * period }))
  // Melody contour (detected evidence) — the same input the pipeline uses.
  const contour = buildMelodyContour(analysis.melody, { beat0, beatPeriod: period })
  const melodyByBeat = (analysis.melody ?? []).map((m) => ({ beat: (m.seconds - beat0) / period, midi: m.midi }))
  const row = {
    id: entry.id,
    license: entry.license,
    anchors: anchors.length,
    tempoBpm: analysis.tempo.bpm,
    beat0: Math.round(beat0 * 1000) / 1000,
    bpRawNotes: bpRaw.length,
    suppressed: s1.suppressed,
    s1: recallAt(s1Events, anchors),
    s2: recallAt(s2Events, anchors),
    targets: {},
  }
  for (const targetPart of ['solo-piano', 'solo-guitar']) {
    row.targets[targetPart] = {}
    for (const difficulty of ['easy', 'advanced']) {
      const arranged = targetPart === 'solo-piano'
        ? arrangeSoloPiano({ quantizedNotes: quantized, chords: analysis.chords, melodyByBeat, difficulty, melodyContour: contour, beat0, beatPeriod: period })
        : arrangeSoloGuitar({ quantizedNotes: quantized, chords: analysis.chords, difficulty, melodyContour: contour })
      const toSec = (e) => beat0 + e.startBeat * period
      // S3: arrangement (pre-simplify).
      const s3 = recallAt(arranged.events.map((e) => ({ midi: e.midi, sec: toSec(e) })), anchors)
      // S4: difficulty simplify.
      const simplified = simplifyForDifficulty(
        arranged.events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
        difficulty,
      ).map((e) => ({ ...e, startBeat: e.quantizedStartBeat ?? e.startBeat, durBeats: e.quantizedDurBeats ?? e.durBeats }))
      const s4 = recallAt(simplified.map((e) => ({ midi: e.midi, sec: toSec(e) })), anchors)
      // S5: MusicXML emission + re-parse. The score intentionally rebases
      // time to score start (leading silence trimmed), so anchors must be
      // compared in SCORE coordinates: shift by beat0. Without this the
      // metric measures a clock offset, not emission fidelity.
      const xml = buildArrangementMusicXml({ events: simplified, targetPart, bpm: analysis.tempo.bpm, title: entry.id })
      let s5 = { recall: null, maeMs: null, hit: 0, anchors: anchors.length }
      try {
        const parsed = parseMusicXml(xml, 'ledger.musicxml')
        // Map parsed note times directly (seconds, tempo-aware already).
        s5 = recallAt((parsed?.notes ?? []).filter((n) => !n.isRest && Number.isFinite(n.midi)).map((n) => ({ midi: n.midi, sec: n.timeSeconds })), anchorsScore)
      } catch { /* stays null */ }
      const bassRecall = bassNotes.length
        ? recallAt(simplified.map((e) => ({ midi: e.midi, sec: toSec(e) })), melodyAnchors(bassNotes))
        : null
      row.targets[targetPart][difficulty] = {
        s3, s4, s5,
        xmlNotes: simplified.length,
        bassRecall: bassRecall?.recall ?? null,
        inventedRate: inventedRate(simplified.map((e) => ({ midi: e.midi, sec: toSec(e) })), partTruthNotes),
      }
      console.log(`  ${targetPart}/${difficulty}: S1=${row.s1.recall} S2=${row.s2.recall} S3=${s3.recall} S4=${s4.recall} S5=${s5.recall}`)
    }
  }
  report.rows.push(row)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

writeFileSync(join(root, jsonOut), JSON.stringify(report, null, 2))
const lines = ['# Stage-loss ledger (melody anchors, exact midi ±0.25 s)', '',
  `generated ${report.generatedAt}`, '',
  '| recording | target | S1 model | S2 quant | S3 arrange/easy | S4 simpl/easy | S5 xml/easy | S3 adv | S4 adv | S5 adv | onsetMAE S1→S3 |',
  '|---|---|---|---|---|---|---|---|---|---|---|']
for (const r of report.rows) {
  for (const [part, cfgs] of Object.entries(r.targets)) {
    lines.push(`| ${r.id} | ${part} | ${r.s1.recall} | ${r.s2.recall} | ${cfgs.easy.s3.recall} | ${cfgs.easy.s4.recall} | ${cfgs.easy.s5.recall} | ${cfgs.advanced.s3.recall} | ${cfgs.advanced.s4.recall} | ${cfgs.advanced.s5.recall} | ${r.s1.maeMs}→${cfgs.advanced.s3.maeMs ?? '—'} |`)
  }
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log('done')

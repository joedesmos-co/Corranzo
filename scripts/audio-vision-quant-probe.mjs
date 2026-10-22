/**
 * M1 — Quantization-residual attribution against drift-free MIDI truth.
 *
 * The pickup probe measured quantization residual up to ~0.92 beats, but a
 * residual alone cannot distinguish expressive timing from error. This script
 * computes, for every TRANSCRIBED note, the residual to the detected beat grid
 * and asks what each residual actually is:
 *
 *   swing        | residual near a systematic offset (+/- 1/3 beat) rather than 0
 *                 - i.e. the grid is right and the performance really is swung
 *   rubato       | residual varies smoothly across neighbouring beats
 *   beat-error   | residual clusters tightly near +/- 1 beat (grid mis-phase)
 *   onset-error  | the note's onset is far from ANY grid position (missed or
 *                 spurious onset) - the residual is large and not near a beat
 *   quantization | residual small but non-zero, no musical pattern
 *
 * Reference = GuitarSet per-string MIDI truth (drift-free), so this measures
 * the transcription against the truth rather than against itself.
 *
 * Usage: node --expose-gc scripts/audio-vision-quant-probe.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { quantizeToBeats } from '../src/features/audio-vision/arrangementModel.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/quant-probe.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/quant-probe.md')
const TRACKS = [
  { id: 'guitarset-jazz-solo', jams: '/tmp/guitarset/jams/04_Jazz1-200-B_solo.jams', wav: '/tmp/guitarset/04_Jazz1-200-B_solo_mic.wav' },
  { id: 'guitarset-ss-comp', jams: '/tmp/guitarset/jams/00_SS3-84-Bb_comp.jams', wav: '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav' },
  { id: 'guitarset-funk3', jams: '/tmp/guitarset/jams/00_Funk3-112-C#_comp.jams', wav: '/tmp/guitarset/00_Funk3-112-C#_comp_mic.wav' },
  { id: 'holdout-jazz3', jams: '/tmp/guitarset/jams/01_Jazz3-137-Eb_comp.jams', wav: '/tmp/guitarset/01_Jazz3-137-Eb_comp_mic.wav' },
]

function truthNotesOf(jams) {
  const out = []
  for (const a of jams.annotations) {
    if (a.namespace !== 'note_midi' || !Array.isArray(a.data)) continue
    for (const d of a.data) {
      if (d.time === '' || d.value === '') continue
      out.push({ midi: Math.round(d.value), onset: d.time, offset: d.time + (d.duration || 0.3) })
    }
  }
  return out.sort((a, b) => a.onset - b.onset)
}

const rows = []
for (const track of TRACKS) {
  if (!existsSync(track.wav)) {
    console.log(`skip ${track.id} (missing audio)`)
    continue
  }
  const jams = JSON.parse(readFileSync(track.jams, 'utf8'))
  const truth = truthNotesOf(jams)
  const wav = readWavPcm(track.wav)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const views = buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: async () => bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude })),
  })
  const beats = analysis.beats.beats
  const period = analysis.beats.beatPeriodSeconds
  const truthTempo = jams.annotations.find((a) => a.namespace === 'tempo')?.data?.[0]?.value ?? null

  // For each truth note, find the transcribed note of the same pitch nearest in
  // time, then attribute the residual.
  const attributed = { swing: 0, rubato: 0, beatError: 0, onsetError: 0, fine: 0 }
  const residuals = []
  const matchedPairs = []
  for (const t of truth) {
    const candidates = analysis.predictedNotes
      .filter((n) => n.midi === t.midi)
      .map((n) => ({ n, dist: Math.abs(n.startSeconds - t.onset) }))
      .sort((a, b) => a.dist - b.dist)
    if (!candidates.length || candidates[0].dist > 0.3) {
      attributed.onsetError += 1
      continue
    }
    const onset = candidates[0].n.startSeconds
    const beatFloat = (onset - (beats[0] ?? 0)) / period
    const residual = beatFloat - Math.round(beatFloat)
    const wrapped = ((residual % 1) + 1) % 1 // distance to nearest grid line
    residuals.push(wrapped)
    matchedPairs.push({ onset: wrapped })
    // Swing signature: a systematic ~1/3-beat offset (not 0, not random).
    const nearThird = Math.abs(wrapped - 1 / 3) < 0.06 || Math.abs(wrapped - 2 / 3) < 0.06
    const nearHalf = Math.abs(wrapped - 0.5) < 0.05
    const nearZero = Math.abs(wrapped) < 0.05 || Math.abs(wrapped - 1) < 0.05
    const nearBeat = Math.abs(wrapped - 0.5) > 0.45
    if (nearZero) attributed.fine += 1
    else if (nearThird || nearHalf) attributed.swing += 1
    else if (nearBeat) attributed.beatError += 1
    else attributed.rubato += 1
  }
  residuals.sort((a, b) => a - b)
  const median = residuals.length ? residuals[Math.floor(residuals.length / 2)] : null
  const p90 = residuals.length ? residuals[Math.floor(residuals.length * 0.9)] : null
  const row = {
    id: track.id,
    truthNotes: truth.length,
    matched: residuals.length,
    truthTempo,
    estimatedTempo: analysis.tempo.bpm,
    tempoError: truthTempo != null ? Math.abs(analysis.tempo.bpm - truthTempo) : null,
    beatPeriod: Number(period.toFixed(4)),
    residualMedian: median != null ? Number(median.toFixed(3)) : null,
    residualP90: p90 != null ? Number(p90.toFixed(3)) : null,
    residualMax: residuals.length ? Number(residuals[residuals.length - 1].toFixed(3)) : null,
    attributed,
  }
  rows.push(row)
  console.log(`${row.id}: truth ${truthTempo} BPM vs estimated ${analysis.tempo.bpm} (err ${row.tempoError}) | matched ${residuals.length}/${truth.length}`)
  console.log(`   residual median=${row.residualMedian} p90=${row.residualP90} max=${row.residualMax} beats | attribution ${JSON.stringify(attributed)}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

writeFileSync(join(root, jsonOut), JSON.stringify({ rows }, null, 2))
const lines = ['# Quantization-residual attribution (vs drift-free MIDI truth)', '',
  '| track | truth BPM | est BPM | matched | residual med | p90 | max | fine | swing | rubato | beatError | onsetError |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
for (const r of rows) {
  lines.push(`| ${r.id} | ${r.truthTempo ?? '—'} | ${r.estimatedTempo} | ${r.matched}/${r.truthNotes} | ${r.residualMedian} | ${r.residualP90} | ${r.residualMax} | ${r.attributed.fine} | ${r.attributed.swing} | ${r.attributed.rubato} | ${r.attributed.beatError} | ${r.attributed.onsetError} |`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log('done')

/**
 * M1 — Harmony error attribution on real mixes (drift-free TRIOS MIDI truth).
 *
 * For every analyzed chord window, the SIMULTANEOUSLY SOUNDING TRUTH voices
 * define the reference: pitch-class set, lowest voice (bass), highest voice
 * (melody), and whether a recognizable triad/7th exists at all. Each window
 * is classified into exactly ONE failure category, so the ledger explains WHY
 * harmony inference fails instead of reporting one aggregate number.
 *
 * Categories (mutually exclusive, in priority order):
 *   root-ok-quality-ok        : nothing wrong
 *   reference-underdetermined : truth set forms no recognizable chord
 *   melody-as-root            : analyzed root is the truth MELODY pitch class
 *   bass-disagree             : analyzed root is a truth chord tone but not root
 *   invented-pc               : analyzed root not present in the truth set
 *   quality-major-minor       : root right, third wrong
 *   seventh-confusion         : root right, extension claimed/omitted wrongly
 *
 * Companion cuts: drum interference (windows with nearby drum onsets vs
 * without), boundary timing error vs truth chord changes.
 *
 * Usage: node scripts/audio-vision-harmony-attribute.mjs [--only str] [--json p] [--md p]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/harmony-attribute.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/harmony-attribute.md')
const onlyFilter = argValue('--only', null)

const trios = JSON.parse(readFileSync('/tmp/trios-truth.json', 'utf8')).takes
const pc = (midi) => ((midi % 12) + 12) % 12

const MAJOR = [0, 4, 7]
const MINOR = [0, 3, 7]
const MAJ7 = [0, 4, 7, 11]
const MIN7 = [0, 3, 7, 10]
const DOM7 = [0, 4, 7, 10]
const DIM = [0, 3, 6]
const SUS4 = [0, 5, 7]
const QUALITIES = [
  ['major', MAJOR], ['minor', MINOR], ['major7', MAJ7], ['minor7', MIN7],
  ['dominant7', DOM7], ['diminished', DIM], ['suspended4', SUS4],
]

function intervalSetFromRoot(rootPc, intervals) {
  return new Set(intervals.map((iv) => (rootPc + iv) % 12))
}

function classifyTruth(soundingVoices) {
  if (soundingVoices.length < 2) return { underdetermined: true }
  const pcs = [...new Set(soundingVoices.map((v) => pc(v.midi)))]
  const candidates = []
  for (let rootPc = 0; rootPc < 12; rootPc += 1) {
    for (const [quality, intervals] of QUALITIES) {
      const needed = intervalSetFromRoot(rootPc, intervals)
      const present = pcs.filter((p) => needed.has(p)).length
      candidates.push({ rootPc, quality, intervals, present, coverage: present / needed.size })
    }
  }
  candidates.sort((a, b) => b.coverage - a.coverage || b.present - a.present)
  const best = candidates[0]
  if (!best || best.coverage < 0.75) return { underdetermined: true, pcs }
  return { underdetermined: false, pcs, rootPc: best.rootPc, quality: best.quality, intervals: best.intervals, coverage: best.coverage }
}

function soundingAt(notes, seconds) {
  return notes.filter((n) => n.onset <= seconds && (n.offset ?? n.onset + 0.4) > seconds)
}

const rows = []
for (const [take, data] of Object.entries(trios)) {
  if (onlyFilter && !take.includes(onlyFilter)) continue
  if (!data.mix?.notes?.length) continue
  console.log(`--- ${take}`)
  const wav = readWavPcm(join('/tmp/trios/TRIOS Dataset', take, 'mix.wav'))
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const views = await buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, { views: { harmonic: views.harmonic, percussive: views.percussive }, predictNotes: null })
  // Confidence vs correctness pairs (justifies abstention thresholds).
  const confPairs = []

  const drumNotes = (data.parts ? (data.parts.kick?.notes ?? []).concat(data.parts.snare?.notes ?? [], data.parts.ride?.notes ?? []) : [])
  const counts = {}
  const bump = (k) => { counts[k] = (counts[k] ?? 0) + 1 }
  const withDrum = { n: 0, hit: 0 }
  const withoutDrum = { n: 0, hit: 0 }
  const boundaryErrors = []
  const totalWeighted = { n: 0, hit: 0 }

  for (const chord of analysis.chords) {
    const midSeconds = (chord.startSeconds + chord.endSeconds) / 2
    const sounding = soundingAt(data.mix.notes, midSeconds)
    const truth = classifyTruth(sounding)
    if (truth.underdetermined) {
      bump('reference-underdetermined')
      continue
    }
    const truthPcs = new Set(truth.pcs)
    const bassPc = pc(Math.min(...sounding.map((s) => s.midi)))
    const melodyPc = pc(Math.max(...sounding.map((s) => s.midi)))
    const drumNear = drumNotes.some((d) => Math.abs(d.onset - midSeconds) <= 0.15)
    const bucket = drumNear ? withDrum : withoutDrum
    bucket.n += 1
    const agree = chord.root === truth.rootPc && chord.quality === truth.quality
    if (agree) bucket.hit += 1
    totalWeighted.n += 1
    if (agree) totalWeighted.hit += 1

    confPairs.push({ confidence: chord.confidence, agree })
    if (agree) {
      bump('root-ok-quality-ok')
    } else if (chord.root === melodyPc && melodyPc !== truth.rootPc) {
      bump('melody-as-root')
    } else if (!truthPcs.has(chord.root)) {
      bump('invented-pc')
    } else if (chord.root !== truth.rootPc) {
      bump('bass-disagree')
    } else if (chord.quality !== truth.quality) {
      const truthSeventh = ['major7', 'minor7', 'dominant7'].includes(truth.quality)
      const analyzedSeventh = ['major7', 'minor7', 'dominant7'].includes(chord.quality)
      const truthIntervals = QUALITIES.find(([q]) => q === truth.quality)?.[1] ?? MAJOR
      const truthThird = truthIntervals[1]
      const analyzedIntervals = QUALITIES.find(([q]) => q === chord.quality)?.[1] ?? MAJOR
      const sameThird = analyzedIntervals[1] === truthThird
      if (truthSeventh !== analyzedSeventh) bump('seventh-confusion')
      else if (!sameThird) bump('quality-major-minor')
      else bump('quality-other')
    } else {
      bump('quality-other')
    }
  }

  // Boundary timing: compare analyzed chord boundaries to truth chord changes.
  const truthTimes = []
  for (let t = 0.5; t < analysis.totalSeconds; t += 0.5) {
    const before = new Set(soundingAt(data.mix.notes, t - 0.4).map((n) => pc(n.midi)))
    const after = new Set(soundingAt(data.mix.notes, t + 0.4).map((n) => pc(n.midi)))
    const union = new Set([...before, ...after])
    if (union.size && [...union].some((p) => !before.has(p) || !after.has(p))) truthTimes.push(t)
  }
  for (const change of truthTimes) {
    const nearest = analysis.chords.reduce((best, c) => {
      const d = Math.min(Math.abs(c.startSeconds - change), Math.abs(c.endSeconds - change))
      return d < best ? d : best
    }, Infinity)
    if (nearest < Infinity) boundaryErrors.push(Math.round(nearest * 1000) / 1000)
  }

  const total = counts['root-ok-quality-ok'] ?? 0
  const win = totalWeighted.n
  rows.push({
    take,
    windows: win,
    rootAndQualityAccuracy: win ? Math.round((totalWeighted.hit / win) * 1000) / 1000 : null,
    categories: counts,
    withDrumAccuracy: withDrum.n ? Math.round((withDrum.hit / withDrum.n) * 1000) / 1000 : null,
    withDrumWindows: withDrum.n,
    withoutDrumAccuracy: withoutDrum.n ? Math.round((withoutDrum.hit / withoutDrum.n) * 1000) / 1000 : null,
    withoutDrumWindows: withoutDrum.n,
    boundaryMaeSeconds: boundaryErrors.length
      ? Math.round((boundaryErrors.reduce((a, b) => a + b, 0) / boundaryErrors.length) * 1000) / 1000
      : null,
    boundaryChanges: boundaryErrors.length,
    confidenceSeparation: separationScore(confPairs),
    confBucketAccuracy: confBucketAccuracy(confPairs),
  })
  console.log('  ', JSON.stringify(counts))
  console.log('   confSep=', rows[rows.length - 1].confidenceSeparation, JSON.stringify(rows[rows.length - 1].confBucketAccuracy))
  console.log(`   acc=${rows[rows.length - 1].rootAndQualityAccuracy} drum=${rows[rows.length - 1].withDrumAccuracy}(${withDrum.n}) nodrum=${rows[rows.length - 1].withoutDrumAccuracy}(${withoutDrum.n}) boundaryMAE=${rows[rows.length - 1].boundaryMaeSeconds}`)
}

function separationScore(pairs) {
  // Point-biserial correlation between chord confidence and being correct.
  if (pairs.length < 8) return null
  const xs = pairs.map((p) => p.confidence)
  const ys = pairs.map((p) => (p.agree ? 1 : 0))
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sx = 0, sy = 0
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sx += (xs[i] - mx) ** 2
    sy += (ys[i] - my) ** 2
  }
  return sx > 0 && sy > 0 ? Math.round((sxy / Math.sqrt(sx * sy)) * 1000) / 1000 : null
}

function confBucketAccuracy(pairs) {
  const buckets = { low: [0, 0], mid: [0, 0], high: [0, 0] }
  for (const p of pairs) {
    const key = p.confidence < 0.5 ? 'low' : p.confidence < 0.75 ? 'mid' : 'high'
    buckets[key][1] += 1
    if (p.agree) buckets[key][0] += 1
  }
  const out = {}
  for (const [k, v] of Object.entries(buckets)) {
    if (v[1]) out[k] = { accuracy: Math.round((v[0] / v[1]) * 1000) / 1000, n: v[1] }
  }
  return out
}

writeFileSync(join(root, jsonOut), JSON.stringify({ rows }, null, 2))
const lines = ['# Harmony error attribution (real mixes, TRIOS MIDI reference)', '',
  '| take | windows | root+quality acc | underdetermined | underdet% | with-drum acc | no-drum acc | boundary MAE s |',
  '|---|---|---|---|---|---|---|---|']
for (const r of rows) {
  const u = r.categories['reference-underdetermined'] ?? 0
  lines.push(`| ${r.take} | ${r.windows} | ${r.rootAndQualityAccuracy} | ${u} | ${r.windows ? Math.round((u / r.windows) * 100) : 0}% | ${r.withDrumAccuracy} (${r.withDrumWindows}) | ${r.withoutDrumAccuracy} (${r.withoutDrumWindows}) | ${r.boundaryMaeSeconds} |`)
}
lines.push('', '## Chord confidence vs correctness (point-biserial; buckets low<0.5 mid<0.75 high)', '')
for (const r of rows) {
  lines.push(`- ${r.take}: r=${r.confidenceSeparation} ${JSON.stringify(r.confBucketAccuracy)}`)
}
lines.push('', '## Failure categories per take', '')
for (const r of rows) {
  lines.push(`- ${r.take}: ${Object.entries(r.categories).map(([k, v]) => `${k}=${v}`).join(', ')}`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log('done')

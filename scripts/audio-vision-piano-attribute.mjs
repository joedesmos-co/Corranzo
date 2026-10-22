/**
 * P1 — Piano residual-error attribution (no tuning).
 *
 * On δ-aligned truth (align-probe.json shifts, DSP-derived, frozen), classifies
 * every Basic Pitch miss and invention into independently checkable classes:
 *  misses: clustered (<75 ms from another truth onset), harmonic-shadow
 *    (octave/fifth of a simultaneously matched pitch), soft-short (duration
 *    <120 ms), absent (none of the above — genuine model miss).
 *  inventions: harmonic-fp (octave/fifth/doubling of a nearby truth pitch),
 *    pedal-ring (truth pitch that ended >300 ms earlier still sounding),
 *    other.
 * Spectral baseline scored the same way for comparison.
 *
 * Usage: node --expose-gc scripts/audio-vision-piano-attribute.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/piano-attribute.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/piano-attribute.md')
const TOL = 0.1

const manifest = JSON.parse(readFileSync(join(root, 'benchmarks/mic-real/manifest.json'), 'utf8'))
const probe = JSON.parse(readFileSync(join(root, 'benchmarks/audio-vision/align-probe.json'), 'utf8'))
const deltaById = Object.fromEntries(probe.rows.map((r) => [r.id, r.bestDelta]))
const excluded = new Set((manifest.excluded ?? []).map((e) => e.id))
const clips = manifest.clips.filter((c) => c.instrument === 'piano' && !excluded.has(c.id) && c.truth?.notes?.length)

function isOctaveOrFifth(a, b) {
  const d = Math.abs(a - b) % 12
  return d === 0 || d === 7 || d === 5
}

function attribute(predicted, truth) {
  const used = new Set()
  const matchedTruth = new Set()
  for (let ti = 0; ti < truth.length; ti += 1) {
    const t = truth[ti]
    for (let i = 0; i < predicted.length; i += 1) {
      if (used.has(i) || predicted[i].midi !== t.midi) continue
      if (Math.abs(predicted[i].startSeconds - t.onset) <= TOL) {
        used.add(i)
        matchedTruth.add(ti)
        break
      }
    }
  }
  const miss = { clustered: 0, harmonicShadow: 0, softShort: 0, absent: 0 }
  truth.forEach((t, ti) => {
    if (matchedTruth.has(ti)) return
    const clustered = truth.some((o, oi) => oi !== ti && Math.abs(o.onset - t.onset) < 0.075)
    if (clustered) {
      miss.clustered += 1
      return
    }
    const shadow = [...matchedTruth].some((mi) => {
      const m = truth[mi]
      return Math.abs(m.onset - t.onset) <= TOL && isOctaveOrFifth(m.midi, t.midi)
    })
    if (shadow) {
      miss.harmonicShadow += 1
      return
    }
    if ((t.offset ?? t.onset + 0.5) - t.onset < 0.12) {
      miss.softShort += 1
      return
    }
    miss.absent += 1
  })
  const invent = { harmonicFp: 0, pedalRing: 0, other: 0 }
  predicted.forEach((p, i) => {
    if (used.has(i)) return
    const near = truth.filter((t) => Math.abs(t.onset - p.startSeconds) <= TOL)
    if (near.some((t) => isOctaveOrFifth(t.midi, p.midi) && t.midi !== p.midi)) {
      invent.harmonicFp += 1
      return
    }
    const rung = truth.some((t) => t.midi === p.midi && (t.offset ?? 0) < p.startSeconds - 0.3 && (t.offset ?? 0) > p.startSeconds - 3)
    if (rung) {
      invent.pedalRing += 1
      return
    }
    invent.other += 1
  })
  return { miss, invent, matched: matchedTruth.size, nTruth: truth.length, nPred: predicted.length }
}

const rows = []
for (const clip of clips) {
  const delta = deltaById[clip.id] ?? 0
  const wav = readWavPcm(join(root, 'benchmarks/mic-real', clip.audio.file))
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const truth = clip.truth.notes
    .map((n) => ({ midi: n.midi, onset: n.onset + delta, offset: (n.offset ?? n.onset + 0.5) + delta }))
    .filter((t) => t.onset >= 0.01)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const bpNotes = bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds }))
  const analysis = await analyzeMusic(mono, 22050, { predictNotes: null })
  const specNotes = analysis.predictedNotes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds }))
  const row = {
    id: clip.id,
    delta,
    bp: attribute(bpNotes, truth),
    spectral: attribute(specNotes, truth),
  }
  rows.push(row)
  console.log(`${clip.id}: BP miss=${JSON.stringify(row.bp.miss)} invent=${JSON.stringify(row.bp.invent)} | SPEC miss=${JSON.stringify(row.spectral.miss)} invent=${JSON.stringify(row.spectral.invent)}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

writeFileSync(join(root, jsonOut), JSON.stringify({ tol: TOL, rows }, null, 2))
const total = (m, cls, sub) => rows.reduce((a, r) => a + r[m][cls][sub], 0)
const matched = (m) => rows.reduce((a, r) => a + r[m].matched, 0)
const nTruth = rows.reduce((a, r) => a + r.bp.nTruth, 0)
const lines = ['# Piano residual-error attribution (δ-aligned truth, ±100 ms)', '',
  `BP matched ${matched('bp')}/${nTruth}; misses clustered=${total('bp', 'miss', 'clustered')} harmonicShadow=${total('bp', 'miss', 'harmonicShadow')} softShort=${total('bp', 'miss', 'softShort')} absent=${total('bp', 'miss', 'absent')}.`,
  `BP inventions harmonicFp=${total('bp', 'invent', 'harmonicFp')} pedalRing=${total('bp', 'invent', 'pedalRing')} other=${total('bp', 'invent', 'other')}.`,
  `SPEC matched ${matched('spectral')}/${nTruth}; misses clustered=${total('spectral', 'miss', 'clustered')} harmonicShadow=${total('spectral', 'miss', 'harmonicShadow')} softShort=${total('spectral', 'miss', 'softShort')} absent=${total('spectral', 'miss', 'absent')}.`, '',
  '| clip | method | clustered | harmonicShadow | softShort | absent | harmonicFp | pedalRing | other |',
  '|---|---|---|---|---|---|---|---|---|']
for (const r of rows) {
  for (const m of ['bp', 'spectral']) {
    const a = r[m]
    lines.push(`| ${r.id} | ${m} | ${a.miss.clustered} | ${a.miss.harmonicShadow} | ${a.miss.softShort} | ${a.miss.absent} | ${a.invent.harmonicFp} | ${a.invent.pedalRing} | ${a.invent.other} |`)
  }
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')

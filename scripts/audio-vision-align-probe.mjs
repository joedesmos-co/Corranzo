/**
 * A1 — Truth/audio alignment probe (DSP-only, no model, no tuning).
 *
 * For each truth-labeled clip, grid-searches a global onset shift
 * δ ∈ [-1, +1] s maximizing truth↔energy-peak matches. A consistent nonzero
 * δ per performance/source indicates a truth origin/drift problem (independent
 * evidence for quarantine); δ≈0 with few matches indicates genuinely weak
 * transients or detector limits.
 *
 * Usage: node scripts/audio-vision-align-probe.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { magnitudeSpectrogram, spectralFlux } from '../src/features/audio-vision/dsp.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/align-probe.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/align-probe.md')

const manifest = JSON.parse(readFileSync(join(root, 'benchmarks/mic-real/manifest.json'), 'utf8'))
const excluded = new Set((manifest.excluded ?? []).map((e) => e.id))

function energyPeaks(mono, sr) {
  const { frames, frameSeconds } = magnitudeSpectrogram(mono, { sampleRate: sr })
  const flux = spectralFlux(frames)
  const mx = Math.max(...flux)
  const peaks = []
  for (let i = 2; i < flux.length - 2; i += 1) {
    if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > mx * 0.08) {
      peaks.push(i * frameSeconds)
    }
  }
  return { peaks, frameSeconds, maxFlux: mx, rms: Math.sqrt(mono.reduce((a, b) => a + b * b, 0) / mono.length) }
}

function matchScore(truth, peaks, delta, tol = 0.075) {
  let hit = 0
  let eligible = 0
  for (const t of truth) {
    const shifted = t.onset + delta
    if (shifted < 0.02) continue // starts before/without clip evidence
    eligible += 1
    if (peaks.some((p) => Math.abs(p - shifted) <= tol)) hit += 1
  }
  return { hit, eligible, rate: eligible ? hit / eligible : 0 }
}

const rows = []
for (const clip of manifest.clips) {
  if (excluded.has(clip.id) || !clip.truth?.notes?.length) continue
  const wav = readWavPcm(join(root, 'benchmarks/mic-real', clip.audio.file))
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const { peaks, rms } = energyPeaks(mono, 22050)
  const truth = clip.truth.notes
  const atZero = matchScore(truth, peaks, 0)
  let best = { delta: 0, ...atZero }
  for (let d = -1.0; d <= 1.001; d += 0.025) {
    const s = matchScore(truth, peaks, Math.round(d * 1000) / 1000)
    if (s.rate > best.rate || (s.rate === best.rate && Math.abs(d) < Math.abs(best.delta))) {
      best = { delta: Math.round(d * 1000) / 1000, ...s }
    }
  }
  rows.push({
    id: clip.id,
    instrument: clip.instrument,
    dataset: clip.dataset,
    split: clip.split,
    fileSampleRate: wav.sampleRate,
    labeledSampleRate: clip.audio.sampleRate,
    rms: Math.round(rms * 100000) / 100000,
    truthNotes: truth.length,
    peaks: peaks.length,
    zeroShiftRate: Math.round(atZero.rate * 1000) / 1000,
    bestDelta: best.delta,
    bestRate: Math.round(best.rate * 1000) / 1000,
    bestHit: best.hit,
    bestEligible: best.eligible,
  })
  console.log(`${clip.id} [${clip.instrument}]: sr=${wav.sampleRate} rms=${rms.toFixed(4)} truth=${truth.length} peaks=${peaks.length} rate@0=${atZero.rate.toFixed(2)} bestδ=${best.delta}s rate=${best.rate.toFixed(2)} (${best.hit}/${best.eligible})`)
}

writeFileSync(join(root, jsonOut), JSON.stringify({ rows }, null, 2))
const lines = ['# Truth/audio alignment probe (DSP-only, no model)', '',
  '| clip | instr | sr | rms | truth | peaks | rate@0 | best δ | best rate |', '|---|---|---|---|---|---|---|---|---|']
for (const r of rows) {
  lines.push(`| ${r.id} | ${r.instrument} | ${r.fileSampleRate} | ${r.rms} | ${r.truthNotes} | ${r.peaks} | ${r.zeroShiftRate} | ${r.bestDelta} | ${r.bestRate} |`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')

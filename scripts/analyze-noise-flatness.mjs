#!/usr/bin/env node
/**
 * Noisy-room discriminator probe (Step 5, NEW domain): spectral flatness
 * (geometric/arithmetic mean of window power spectrum) + tonality
 * (peak-to-mean energy) on real clips.
 *
 * Prior rejected approaches all worked on ENERGY (static threshold,
 * persistence, span, flux-admission). Flatness is a SHAPE metric:
 * broadband noise is spectrally flat (flatness ~1), harmonic music is
 * peaky (flatness << 1). This probe measures whether any flatness/
 * tonality threshold separates room noise from quiet real playing
 * BEFORE proposing a gate — the same discipline as the rejected vetoes.
 *
 * Analysis only; never changes verdicts.
 *
 * Usage: node scripts/analyze-noise-flatness.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CLIPS = [
  ['room-quiet (0.0023 RMS)', 'benchmarks/mic-accuracy/clips/real-room-quiet.wav'],
  ['room-noisy (0.016 RMS)', 'benchmarks/mic-accuracy/clips/real-room-noisy.wav'],
  ['piano mf C4', 'benchmarks/mic-accuracy/clips/real-piano-c4.wav'],
  ['piano pp C4 (UIowa)', 'benchmarks/mic-accuracy/clips/uiowa-piano-pp-c4.wav'],
  ['piano mf C4 (UIowa)', 'benchmarks/mic-accuracy/clips/uiowa-piano-mf-c4.wav'],
  ['guitar mf G3 (UIowa)', 'benchmarks/mic-accuracy/clips/uiowa-guitar-mf-g3.wav'],
  ['guitar G3 (real)', 'benchmarks/mic-accuracy/clips/real-guitar-g3.wav'],
  ['octave C4+C5 (composite)', 'benchmarks/mic-composites/clips/octave-piano-c4-c5.wav'],
  ['strum Em (UIowa)', 'benchmarks/mic-polyphony/clips/uiowa-guitar-mf-open-em-strum.wav'],
  ['power chord (mic-real)', 'benchmarks/mic-real/clips/acoustic-power-dyad.wav'],
]

async function readMono(path) {
  const { readWavPcm } = await import(join(ROOT, 'scripts', 'lib', 'readWavPcm.mjs'))
  const wav = readWavPcm(path)
  return { samples: Float32Array.from(wav.samples), sampleRate: wav.sampleRate }
}

// 1024-point Hann FFT magnitude power spectrum per 46 ms frame.
function frameFlatness(samples, start, length) {
  const n = 1 << 10
  const win = new Float32Array(n)
  for (let i = 0; i < n && start + i < samples.length; i += 1) {
    win[i] = samples[start + i] * (0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))))
  }
  const mag = new Float32Array(n / 2)
  for (let k = 1; k < n / 2; k += 1) {
    let re = 0
    let im = 0
    for (let x = 0; x < n; x += 1) {
      const angle = (-2 * Math.PI * k * x) / n
      re += win[x] * Math.cos(angle)
      im += win[x] * Math.sin(angle)
    }
    mag[k] = re * re + im * im + 1e-24
  }
  let sumLog = 0
  let sum = 0
  let peak = 0
  for (let k = 1; k < n / 2; k += 1) {
    sumLog += Math.log(mag[k])
    sum += mag[k]
    if (mag[k] > peak) {
      peak = mag[k]
    }
  }
  const count = n / 2 - 1
  const geometric = Math.exp(sumLog / count)
  const arithmetic = sum / count
  return {
    flatness: geometric / arithmetic,
    tonality: peak / arithmetic,
  }
}

const rows = []
for (const [label, rel] of CLIPS) {
  const { samples, sampleRate } = await readMono(join(ROOT, rel))
  const hop = Math.floor(sampleRate * 0.023)
  const values = []
  for (let start = 0; start + hop <= samples.length; start += hop) {
    values.push(frameFlatness(samples, start, hop))
  }
  const sortedFlat = values.map((v) => v.flatness).sort((a, b) => a - b)
  const sortedTone = values.map((v) => v.tonality).sort((a, b) => a - b)
  rows.push({
    label,
    flatMin: sortedFlat[0],
    flatP25: sortedFlat[Math.floor(sortedFlat.length * 0.25)],
    flatMed: sortedFlat[Math.floor(sortedFlat.length / 2)],
    toneP25: sortedTone[Math.floor(sortedTone.length * 0.25)],
    toneMed: sortedTone[Math.floor(sortedTone.length / 2)],
  })
}

for (const row of rows) {
  console.log(
    `${row.label.padEnd(30)} flatness[min=${row.flatMin.toFixed(4)} p25=${row.flatP25.toFixed(4)} med=${row.flatMed.toFixed(4)}] tonality[p25=${row.toneP25.toFixed(0)} med=${row.toneMed.toFixed(0)}]`,
  )
}
// Gate sweep: skip/refuse inference when flatness > F (and tonality < T).
for (const f of [0.02, 0.05, 0.1, 0.2]) {
  const blocked = rows.filter((r) => r.flatP25 > f)
  console.log(`flatnessGate p25>${f}: blocks [${blocked.map((r) => r.label.split(' ')[0]).join(', ')}]`)
}

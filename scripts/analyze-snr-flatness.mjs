#!/usr/bin/env node
/**
 * SNR mix probe (Step 5): does the flatness gate protect quiet playing
 * in NOISY rooms, or suppress it? Mixes real room noise under real notes
 * at decreasing SNRs and reports flatness + whether a candidate gate
 * would block inference.
 *
 * Usage: node scripts/analyze-snr-flatness.mjs [--gate 0.1]
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE = Number(process.argv.find((a, i) => process.argv[i - 1] === '--gate') ?? 0.1)

const NOTES = [
  ['pp piano C4', 'benchmarks/mic-accuracy/clips/uiowa-piano-pp-c4.wav'],
  ['mf piano C4', 'benchmarks/mic-accuracy/clips/real-piano-c4.wav'],
  ['guitar G3', 'benchmarks/mic-accuracy/clips/real-guitar-g3.wav'],
]
const NOISE = 'benchmarks/mic-accuracy/clips/real-room-noisy.wav'

async function readMono(path) {
  const { readWavPcm } = await import(join(ROOT, 'scripts', 'lib', 'readWavPcm.mjs'))
  const wav = readWavPcm(path)
  return { samples: Float32Array.from(wav.samples), sampleRate: wav.sampleRate }
}

function rms(samples) {
  let sum = 0
  for (const v of samples) {
    sum += v * v
  }
  return Math.sqrt(sum / Math.max(samples.length, 1))
}

function frameFlatness(samples, start, n) {
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
  for (let k = 1; k < n / 2; k += 1) {
    sumLog += Math.log(mag[k])
    sum += mag[k]
  }
  const count = n / 2 - 1
  return Math.exp(sumLog / count) / (sum / count)
}

const noise = await readMono(join(ROOT, NOISE))
for (const [label, rel] of NOTES) {
  const note = await readMono(join(ROOT, rel))
  const length = Math.min(note.samples.length, Math.floor(note.sampleRate * 2))
  const mix = new Float32Array(length)
  const noteLevel = rms(note.samples.subarray(0, length))
  for (let i = 0; i < length; i += 1) {
    mix[i] = note.samples[i]
  }
  for (const snrDb of [20, 10, 6, 3, 0, -3]) {
    const noiseGain = (noteLevel / Math.max(rms(noise.samples), 1e-9)) * 10 ** (-snrDb / 20)
    for (let i = 0; i < length; i += 1) {
      mix[i] = note.samples[i] + noise.samples[i % noise.samples.length] * noiseGain
    }
    const flat = []
    for (let start = 0; start + 1024 <= length; start += Math.floor(note.sampleRate * 0.023)) {
      flat.push(frameFlatness(mix, start, 1024))
    }
    flat.sort((a, b) => a - b)
    const p25 = flat[Math.floor(flat.length * 0.25)]
    const med = flat[Math.floor(flat.length / 2)]
    console.log(`${label.padEnd(14)} SNR ${String(snrDb).padStart(3)} dB: flatness p25=${p25.toFixed(4)} med=${med.toFixed(4)} gate-blocked=${p25 > GATE}`)
  }
}

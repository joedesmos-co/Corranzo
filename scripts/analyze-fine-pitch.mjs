#!/usr/bin/env node
/**
 * M2 sub-semitone / inharmonicity probe v2 — three features per case:
 *   centsDev: fine-pitch deviation from equal temperament
 *   prominence: fine-pitch peak / sweep mean (coherence: a real tone
 *     concentrates energy; noise skirts spread it)
 *   relLevel: band level relative to the CLIP's strongest band at the
 *     same time (is this pitch actually audible?)
 *
 * Analysis only; verdicts never change here.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { readWavPcm } = await import(join(ROOT, 'scripts', 'lib', 'readWavPcm.mjs'))

const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12)

function goertzel(samples, start, length, freq, sampleRate) {
  const end = Math.min(start + length, samples.length)
  const n = end - start
  if (n <= 0) {
    return 0
  }
  const omega = (2 * Math.PI * freq) / sampleRate
  const coeff = 2 * Math.cos(omega)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  for (let i = start; i < end; i += 1) {
    s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(Math.max(s1 * s1 + s2 * s2 - coeff * s1 * s2, 0)) / n
}

function finePitch(samples, start, length, sampleRate, midi) {
  const f0 = midiToFreq(midi)
  const steps = 37
  const energies = []
  for (let k = -((steps - 1) / 2); k <= (steps - 1) / 2; k += 1) {
    energies.push(goertzel(samples, start, length, f0 * 2 ** ((k * 5) / 1200), sampleRate))
  }
  let peakIndex = 0
  let sum = 0
  for (let i = 0; i < energies.length; i += 1) {
    if (energies[i] > energies[peakIndex]) {
      peakIndex = i
    }
    sum += energies[i]
  }
  const center = (steps - 1) / 2
  let cents = (peakIndex - center) * 5
  const a = energies[peakIndex - 1] ?? 0
  const b = energies[peakIndex]
  const c = energies[peakIndex + 1] ?? 0
  const denom = a - 2 * b + c
  if (b > 0 && Math.abs(denom) > 1e-20) {
    const delta = (0.5 * (a - c)) / denom
    if (Math.abs(delta) <= 1) {
      cents += delta * 5
    }
  }
  const mean = sum / energies.length
  return { centsDev: cents, level: b, prominence: mean > 0 ? b / mean : 0 }
}

const CASES = [
  // label, file, midi, atMs, kind
  ['octave-up-48 GHOST C4 (parent C3)', 'benchmarks/mic-polyphony/clips/uiowa-piano-mf-split-c3-e4-g4.wav', 60, 150, 'ghost'],
  ['octave-up-48 parent C3', 'benchmarks/mic-polyphony/clips/uiowa-piano-mf-split-c3-e4-g4.wav', 48, 150, 'parent'],
  ['octave-up-48 TRUE E4', 'benchmarks/mic-polyphony/clips/uiowa-piano-mf-split-c3-e4-g4.wav', 64, 150, 'true'],
  ['octave-up-48 TRUE G4', 'benchmarks/mic-polyphony/clips/uiowa-piano-mf-split-c3-e4-g4.wav', 67, 150, 'true'],
  ['octave-up-55 GHOST G4 (parent G3)', 'benchmarks/mic-polyphony/clips/uiowa-guitar-mf-adjacent-g3-b3.wav', 67, 130, 'ghost'],
  ['octave-up-55 parent G3', 'benchmarks/mic-polyphony/clips/uiowa-guitar-mf-adjacent-g3-b3.wav', 55, 130, 'parent'],
  ['octave-up-55 TRUE B3', 'benchmarks/mic-polyphony/clips/uiowa-guitar-mf-adjacent-g3-b3.wav', 59, 130, 'true'],
  ['neighbor-64 GHOST Eb4 (decay)', 'benchmarks/mic-polyphony/clips/uiowa-guitar-mf-low-high-e2-e4.wav', 63, 1640, 'ghost'],
  ['neighbor-64 parent E4 (decay)', 'benchmarks/mic-polyphony/clips/uiowa-guitar-mf-low-high-e2-e4.wav', 64, 1640, 'parent'],
  ['neighbor-64 parent E2 (decay)', 'benchmarks/mic-polyphony/clips/uiowa-guitar-mf-low-high-e2-e4.wav', 40, 1640, 'parent'],
  ['neighbor-60 GHOST 59 (decay)', 'benchmarks/mic-real/clips/electric-gtechs-quiet.wav', 59, 550, 'ghost'],
  ['neighbor-60 parent 60', 'benchmarks/mic-real/clips/electric-gtechs-quiet.wav', 60, 550, 'parent'],
  ['octave chord TRUE C4', 'benchmarks/mic-composites/clips/octave-piano-c4-c5.wav', 60, 113, 'true'],
  ['octave chord TRUE C5', 'benchmarks/mic-composites/clips/octave-piano-c4-c5.wav', 72, 113, 'true'],
  ['rolled octave TRUE C4', 'benchmarks/mic-composites/clips/rolled-octave-piano-c4-c5.wav', 60, 113, 'true'],
  ['rolled octave TRUE C5', 'benchmarks/mic-composites/clips/rolled-octave-piano-c4-c5.wav', 72, 363, 'true'],
  ['power dyad TRUE low', 'benchmarks/mic-real/clips/acoustic-power-dyad.wav', 49, 150, 'true'],
  ['power dyad TRUE high', 'benchmarks/mic-real/clips/acoustic-power-dyad.wav', 56, 150, 'true'],
  ['C4 attack reference (pp)', 'benchmarks/mic-accuracy/clips/uiowa-piano-pp-c4.wav', 60, 150, 'true'],
]

// Noise-floor reference: midway between semitones (no ET pitch anywhere near).
const PROBE_SEMITONE = 0.5

const clips = new Map()
function load(rel) {
  if (!clips.has(rel)) {
    const wav = readWavPcm(join(ROOT, rel))
    clips.set(rel, { samples: Float32Array.from(wav.samples), sampleRate: wav.sampleRate })
  }
  return clips.get(rel)
}

console.log('kind    case                                          cents     level       prom    relLevel')
for (const [label, file, midi, atMs, kind] of CASES) {
  const { samples, sampleRate } = load(file)
  const start = Math.floor((atMs / 1000) * sampleRate)
  const length = Math.floor(sampleRate * 0.12)
  const peak = finePitch(samples, start, length, sampleRate, midi)
  // Noise floor at the nearest half-semitone offset from the candidate.
  const noiseFreq = midiToFreq(midi + PROBE_SEMITONE)
  const noise = goertzel(samples, start, length, noiseFreq, sampleRate)
  // Clip loudest band at this time (scan C2..C7).
  let loudest = 0
  for (let m = 36; m <= 96; m += 1) {
    loudest = Math.max(loudest, goertzel(samples, start, length, midiToFreq(m), sampleRate))
  }
  console.log(
    `${kind.padEnd(7)} ${label.padEnd(44)} ${(peak.centsDev >= 0 ? '+' : '') + peak.centsDev.toFixed(1)}`.padEnd(66)
    + ` ${peak.level.toExponential(2)} ${peak.prominence.toFixed(2)}`.padEnd(30)
    + ` ${(peak.level / Math.max(loudest, 1e-12)).toFixed(4)} noise=${noise.toExponential(1)}`,
  )
}

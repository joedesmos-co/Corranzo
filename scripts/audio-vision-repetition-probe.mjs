/**
 * M1 — Bar-level musical repetition as tempo evidence (a different domain from
 * the five rejected onset-based heuristics).
 *
 * Hypothesis: a 1.5-beat reading mis-frames the bar, so bar-scale repetition
 * (self-similarity of the chroma/harmonic sequence at the candidate bar period)
 * should be stronger at the TRUE bar period than at 1.5x it. This is a different
 * signal from onset intervals, comb salience, phase contrast or flux phase.
 *
 * Also measured: chord-change periodicity from the reference annotations, and
 * bar-normalised self-similarity, so the result is not a single magic number.
 *
 * Reference = JAMS beats (downbeats = position 1) on the benchmark recordings,
 * used once to see whether repetition separates the lock at all.
 *
 * Usage: node --expose-gc scripts/audio-vision-repetition-probe.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { magnitudeSpectrogram, chromaOfSpectrum } from '../src/features/audio-vision/dsp.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { readWavPcm } from './lib/readWavPcm.mjs'

const TRACKS = [
  { id: 'ss-comp', wav: '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav', truth: 84 },
  { id: 'jazz2', wav: '/tmp/guitarset/00_Jazz2-110-Bb_comp_mic.wav', truth: 110 },
  { id: 'bn2', wav: '/tmp/guitarset/00_BN2-131-B_comp_mic.wav', truth: 131 },
  { id: 'funk3', wav: '/tmp/guitarset/00_Funk3-112-C#_comp_mic.wav', truth: 112 },
  { id: 'rock2', wav: '/tmp/guitarset/00_Rock2-142-D_comp_mic.wav', truth: 142 },
]

/** Chroma sequence downsampled to ~10 Hz frames. */
function chromaSequence(mono) {
  const { frames, fftSize, frameSeconds } = await magnitudeSpectrogram(mono, {
    sampleRate: 22050,
    fftSize: 4096,
    hop: 2048,
  })
  const out = []
  for (const spectrum of frames) out.push(chromaOfSpectrum(spectrum, fftSize, 22050, { minHz: 65, maxHz: 2100 }))
  return { sequence: out, frameSeconds }
}

/**
 * Self-similarity at a candidate period: mean cosine similarity between frames
 * one period apart (strong when the music repeats every `period` seconds).
 * Only positive-energy frame pairs are counted so silence cannot inflate it.
 */
function repetitionScore(sequence, period, frameSeconds) {
  const lag = Math.round(period / frameSeconds)
  if (lag < 2 || lag >= sequence.length - 1) return null
  let sum = 0
  let count = 0
  for (let i = 0; i + lag < sequence.length; i += 1) {
    const a = sequence[i]
    const b = sequence[i + lag]
    const na = Math.hypot(...a)
    const nb = Math.hypot(...b)
    if (na <= 0 || nb <= 0) continue
    let dot = 0
    for (let k = 0; k < a.length; k += 1) dot += a[k] * b[k]
    sum += dot / (na * nb)
    count += 1
  }
  return count > 4 ? sum / count : null
}

for (const track of TRACKS) {
  if (!existsSync(track.wav)) {
    console.log(`skip ${track.id}`)
    continue
  }
  const wav = readWavPcm(track.wav)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const { sequence, frameSeconds } = chromaSequence(mono)
  const beatPeriod = 60 / track.truth
  const trueBar = beatPeriod * 4
  // Candidate bars: true, 1.5x, 2x, 0.5x (a 1.5-beat lock reads the bar as 6
  // beats, so its implied bar is 1.5x - and a 1-beat half-lock reads 0.5x).
  const candidates = [
    ['true bar (4 beats)', trueBar],
    ['1.5x bar (6 beats)', trueBar * 1.5],
    ['0.5x bar (2 beats)', trueBar * 0.5],
    ['2x bar (8 beats)', trueBar * 2],
  ]
  const scores = {}
  for (const [label, period] of candidates) {
    const value = repetitionScore(sequence, period, frameSeconds)
    scores[label] = value == null ? null : Number(value.toFixed(4))
  }
  // Also: does repetition peak at the true bar when scanning a range? That is
  // the stronger test - it asks whether the signal can FIND the bar at all.
  let best = { label: null, score: -Infinity, period: null }
  for (let period = 0.5; period <= beatPeriod * 12; period += Math.max(0.05, beatPeriod / 8)) {
    // Only test musically meaningful bar widths (1..12 beats).
    const beats = period / beatPeriod
    if (beats < 0.5) continue
    const value = repetitionScore(sequence, period, frameSeconds)
    if (value != null && value > best.score) {
      best = { label: `${beats.toFixed(2)} beats`, score: value, period }
    }
  }
  console.log(`\n=== ${track.id} (truth ${track.truth} BPM, bar ${trueBar.toFixed(2)}s) ===`)
  for (const [label, value] of Object.entries(scores)) console.log(`  ${label.padEnd(20)} ${value}`)
  console.log(`  scan best: ${best.label} (${best.score.toFixed(4)}) | true-bar score ${scores['true bar (4 beats)']}`)
  const trueVs15 = scores['true bar (4 beats)'] - scores['1.5x bar (6 beats)']
  console.log(`  true bar vs 1.5x bar: ${trueVs15 >= 0 ? '+' : ''}${trueVs15.toFixed(4)} -> ${trueVs15 > 0.02 ? 'SEPARATES' : 'does not separate'}`)
}

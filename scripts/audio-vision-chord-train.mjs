/**
 * A3 — Chord recognition calibration on SYNTHESIZED train fixtures.
 *
 * Renders triads + seventh/dim/sus chords across all 12 roots (saw+triangle
 * blend, 2 s each, 120 Hz-2 kHz band) and scores recognizeChord. This is the
 * TRAIN split: template/weight changes are accepted here, then verified
 * read-only on GuitarSet eval recordings (never tuned there).
 *
 * Usage: node scripts/audio-vision-chord-train.mjs
 */
import { chromaOfSpectrum, recognizeChord, magnitudeSpectrogram } from '../src/features/audio-vision/dsp.js'

const SR = 22050
const QUALITIES = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
  diminished: [0, 3, 6],
  suspended4: [0, 5, 7],
}

function renderChord(root, intervals, seconds = 2) {
  const out = new Float32Array(Math.floor(seconds * SR))
  for (const iv of intervals) {
    const midi = 48 + root + iv
    const freq = 440 * 2 ** ((midi - 69) / 12)
    for (let i = 0; i < out.length; i += 1) {
      const t = i / SR
      const env = Math.min(1, t * 20) * Math.exp(-0.4 * t)
      out[i] += 0.22 * env * (Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(4 * Math.PI * freq * t))
    }
  }
  return out
}

function recognizeRendered(samples) {
  const { frames, fftSize } = magnitudeSpectrogram(samples, { sampleRate: SR })
  // Average chroma over the stable middle second (skip attack).
  const acc = new Float64Array(12)
  const start = Math.floor(frames.length * 0.25)
  const end = Math.floor(frames.length * 0.75)
  for (let f = start; f < end; f += 1) {
    const c = chromaOfSpectrum(frames[f], fftSize, SR)
    for (let k = 0; k < 12; k += 1) acc[k] += c[k]
  }
  for (let k = 0; k < 12; k += 1) acc[k] /= Math.max(1, end - start)
  return recognizeChord(acc)
}

const perQuality = {}
let rootHits = 0
let fullHits = 0
let total = 0
for (const [quality, intervals] of Object.entries(QUALITIES)) {
  perQuality[quality] = { root: 0, full: 0, n: 0 }
  for (let root = 0; root < 12; root += 1) {
    const rec = recognizeRendered(renderChord(root, intervals))
    const rootOk = rec.root === root
    const fullOk = rootOk && rec.quality === quality
    perQuality[quality].n += 1
    if (rootOk) {
      perQuality[quality].root += 1
      rootHits += 1
    }
    if (fullOk) {
      perQuality[quality].full += 1
      fullHits += 1
    }
    total += 1
    if (!fullOk) console.log(`  miss: truth ${root}/${quality} -> got ${rec.label} (${rec.quality}, score ${rec.score.toFixed(3)})`)
  }
}
console.log('---')
for (const [q, s] of Object.entries(perQuality)) {
  console.log(`${q}: root ${s.root}/${s.n} full ${s.full}/${s.n}`)
}
console.log(`TOTAL root ${rootHits}/${total} full ${fullHits}/${total}`)
process.exit(0)

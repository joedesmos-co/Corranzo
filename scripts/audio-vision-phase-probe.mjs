/**
 * #1 — Phase-bias diagnostic: exactly where does a constant ~0.05 s offset
 * between baseline and silence-padded audio appear?
 *
 * Dumps, for the baseline and each padded variant: the first onset frame and
 * its time, the beat-grid anchor, the first note's onset, and the first
 * checkpoint that a practice engine would build. The first row that is NOT a
 * pure time shift of the baseline locates the bias.
 */
import { readFileSync } from 'node:fs'
import {
  magnitudeSpectrogram,
  spectralFlux,
  pickOnsetFrames,
  estimateTempoFromEnvelope,
  buildBeatGrid,
} from '../src/features/audio-vision/dsp.js'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { importAudioFile } from '../src/features/audio-vision/audioImport.js'
import { quantizeToBeats } from '../src/features/audio-vision/arrangementModel.js'
import { readWavPcm } from './lib/readWavPcm.mjs'

const SOURCE = '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav'
const raw = readWavPcm(SOURCE)
const original = Float32Array.from(raw.samples)
const FRAME = 512 / 22050

function pad(samples, seconds, sampleRate) {
  const n = Math.floor(seconds * sampleRate)
  const out = new Float32Array(samples.length + n)
  out.set(samples, n)
  return out
}

async function trace(samples, sampleRate, label) {
  const imported = await importAudioFile(
    { name: `${label}.wav`, size: 99, type: 'audio/wav' },
    new ArrayBuffer(8),
    async () => ({
      channelData: [Float32Array.from(samples), Float32Array.from(samples)],
      sampleRate,
      durationSeconds: samples.length / sampleRate,
      channelCount: 2,
    }),
  )
  const mono = imported.samples
  const { frames, frameSeconds } = magnitudeSpectrogram(mono, { sampleRate: 22050 })
  const flux = spectralFlux(frames)
  const picked = pickOnsetFrames(flux)
  const tempo = estimateTempoFromEnvelope(flux, frameSeconds)
  const grid = buildBeatGrid({ onsetFrames: picked, frameSeconds, bpm: tempo.bpm, totalSeconds: mono.length / 22050 })
  const views = buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: null,
  })
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  const firstQuant = quantized[0]
  return {
    label,
    firstOnsetFrame: picked[0] ?? null,
    firstOnsetSeconds: picked[0] != null ? picked[0] * frameSeconds : null,
    firstBeat: analysis.beats.beats[0] ?? null,
    secondBeat: analysis.beats.beats[1] ?? null,
    beatPeriod: analysis.beats.beatPeriodSeconds,
    tempo: analysis.tempo.bpm,
    firstNoteRaw: analysis.predictedNotes[0]?.startSeconds ?? null,
    firstNoteBeatFloat: firstQuant?.beatFloat ?? null,
    firstNoteBeatQuant: firstQuant?.quantizedStartBeat ?? null,
    firstNoteTime: firstQuant != null
      ? (analysis.beats.beats[0] ?? 0) + firstQuant.quantizedStartBeat * analysis.beats.beatPeriodSeconds
      : null,
    anchorVsOnset: grid.anchorSeconds != null && picked[0] != null ? grid.anchorSeconds - picked[0] * frameSeconds : null,
  }
}

const base = await trace(original, raw.sampleRate, 'baseline')
const show = (r, padSeconds = 0) => {
  const shift = (v) => (v == null ? '—' : `${(v - (padSeconds ? (baseFirst(r) ?? v) : v)).toFixed(4)}`)
  console.log(`${r.label.padEnd(12)} onsetFrame=${r.firstOnsetFrame} onsetT=${r.firstOnsetSeconds?.toFixed(4)} beat0=${r.firstBeat?.toFixed(4)} beat1=${r.secondBeat?.toFixed(4)} period=${r.beatPeriod.toFixed(4)} tempo=${r.tempo}`)
  console.log(`${''.padEnd(12)} noteRaw=${r.firstNoteRaw?.toFixed(4)} beatFloat=${r.firstNoteBeatFloat?.toFixed(4)} beatQuant=${r.firstNoteBeatQuant} noteT=${r.firstNoteTime?.toFixed(4)}`)
  void shift
}
function baseFirst() { return null }

console.log('=== BASELINE ===')
show(base)
for (const padSeconds of [1, 2, 5]) {
  const padded = await trace(pad(original, padSeconds, raw.sampleRate), raw.sampleRate, `pad${padSeconds}s`)
  console.log(`=== PAD ${padSeconds}s (expected pure shift of ${padSeconds}) ===`)
  show(padded)
  const d = (a, b) => (a == null || b == null ? null : +(a - b).toFixed(4))
  console.log(`   deltas vs (baseline + ${padSeconds}s):`)
  console.log(`     onsetTime ${padSeconds} + ${d(padded.firstOnsetSeconds, (base.firstOnsetSeconds ?? 0) + padSeconds)}`)
  console.log(`     beat0     ${padSeconds} + ${d(padded.firstBeat, (base.firstBeat ?? 0) + padSeconds)}`)
  console.log(`     noteT     ${padSeconds} + ${d(padded.firstNoteTime, (base.firstNoteTime ?? 0) + padSeconds)}`)
}

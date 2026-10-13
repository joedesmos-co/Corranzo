/**
 * #1 — Leading-silence root cause: stage-by-stage comparison.
 *
 * Pads a real recording with N seconds of digital silence and reports what each
 * stage produces for original vs padded: onsets, tempo, beat grid, quantized
 * notes, and the final analysis. The first stage whose output is NOT a pure
 * time shift of the baseline is the root cause.
 *
 * Usage: node --expose-gc scripts/audio-vision-silence-probe.mjs [--source p] [--pad 0,1,2,5]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
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
import { readWavPcm } from './lib/readWavPcm.mjs'

const args = process.argv.slice(2)
function arg(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
mkdirSync('/tmp/av-silence', { recursive: true })
const SOURCE = arg('--source', '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav')
const PADS = arg('--pad', '0,1,2,5').split(',').map(Number)
const raw = readWavPcm(SOURCE)
const original = Float32Array.from(raw.samples)

function padSamples(samples, seconds, sampleRate) {
  if (!seconds) return samples
  const padLength = Math.floor(seconds * sampleRate)
  const out = new Float32Array(samples.length + padLength)
  out.set(samples, padLength)
  return out
}

async function analyse(samples, sampleRate) {
  const imported = await importAudioFile(
    { name: 'silence-probe.wav', size: 99, type: 'audio/wav' },
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
  return {
    imported,
    mono,
    onsets: picked.map((f) => Math.round(f * frameSeconds * 1000) / 1000),
    tempo,
    grid,
    notes: analysis.predictedNotes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds })),
    analysis,
  }
}

// Compare a padded result against the UNSHIFTED baseline: every baseline event
// should appear in the padded result at exactly `shift` seconds later.
function onsetRecall(baseline, other, shift) {
  if (!baseline.length) return null
  let hit = 0
  for (const b of baseline) {
    if (other.some((o) => Math.abs(o - (b + shift)) <= 0.06)) hit += 1
  }
  return Math.round((hit / baseline.length) * 1000) / 1000
}

function noteRecall(baseline, other, shift) {
  if (!baseline.length) return null
  let hit = 0
  for (const b of baseline) {
    if (other.some((o) => o.midi === b.midi && Math.abs(o.startSeconds - (b.startSeconds + shift)) <= 0.08)) hit += 1
  }
  return Math.round((hit / baseline.length) * 1000) / 1000
}

// 1. Baseline first so comparisons have a reference.
const baselineResult = await analyse(original, raw.sampleRate)
const rows = [{
  padSeconds: 0,
  tempo: baselineResult.tempo.bpm,
  onsetCount: baselineResult.onsets.length,
  onsetRecall: 1,
  firstOnset: baselineResult.onsets[0] ?? null,
  beatCount: baselineResult.grid.beats.length,
  firstBeat: baselineResult.grid.beats[0] ?? null,
  beatPeriod: baselineResult.grid.beatPeriodSeconds,
  noteCount: baselineResult.notes.length,
  noteRecall: 1,
  rms: Number(baselineResult.imported.rms.toFixed(6)),
}]
console.log(`PAD     0s: tempo=${rows[0].tempo} onsets=${rows[0].onsetCount} beats=${rows[0].beatCount} notes=${rows[0].noteCount} firstOnset=${rows[0].firstOnset} firstBeat=${rows[0].firstBeat}`)

for (const padSeconds of PADS) {
  if (padSeconds === 0) continue
  const samples = padSamples(original, padSeconds, raw.sampleRate)
  const result = await analyse(samples, raw.sampleRate)
  const row = {
    padSeconds,
    tempo: result.tempo.bpm,
    onsetCount: result.onsets.length,
    onsetRecall: onsetRecall(baselineResult.onsets, result.onsets, padSeconds),
    firstOnset: result.onsets[0] ?? null,
    beatCount: result.grid.beats.length,
    firstBeat: result.grid.beats[0] ?? null,
    beatPeriod: result.grid.beatPeriodSeconds,
    noteCount: result.notes.length,
    noteRecall: noteRecall(baselineResult.notes, result.notes, padSeconds),
    firstNoteTime: result.notes[0]?.startSeconds ?? null,
    expectedFirstNoteTime: (baselineResult.notes[0]?.startSeconds ?? 0) + padSeconds,
    rms: Number(result.imported.rms.toFixed(6)),
  }
  rows.push(row)
  const residual = row.firstNoteTime != null ? (row.firstNoteTime - row.expectedFirstNoteTime).toFixed(3) : '—'
  console.log(`PAD ${String(padSeconds).padStart(4)}s: tempo=${row.tempo} onsets=${row.onsetCount} (recall ${row.onsetRecall}) beats=${row.beatCount} firstBeat=${row.firstBeat} notes=${row.noteCount} (recall ${row.noteRecall}) residual-shift=${residual} (expect 0)`)
}

writeFileSync('/tmp/av-silence/report.json', JSON.stringify({ source: SOURCE, rows }, null, 2))
console.log('\nwrote /tmp/av-silence/report.json')

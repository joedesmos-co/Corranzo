/**
 * M2 — Format/condition invariance, computed in-process (no ffmpeg).
 *
 * Same musical content must not yield substantially different extracted notes
 * because of harmless differences. Transformations applied to ONE recording:
 * gain (±dB), mono/stereo folding, 44.1k -> 48k resampling, leading silence,
 * and mild additive noise. The transformed variants are NOT independent
 * performances - they are format/condition controls.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { importAudioFile } from '../src/features/audio-vision/audioImport.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'

const outDir = '/tmp/av-invariance'
mkdirSync(outDir, { recursive: true })
const SOURCE = '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav'

// Onsets are stored relative to the FIRST note, so leading silence (which only
// shifts the absolute clock) cannot masquerade as a musical change.
function fingerprint(notes, originSeconds = 0) {
  return notes
    .map((n) => `${Math.round(n.midi)}@${Math.round((n.startSeconds - originSeconds) * 10) / 10}`)
    .sort()
    .join('|')
}

function decodeWith(samples, sampleRate, channels = 1) {
  return async () => ({
    channelData: channels > 1 ? [samples, samples] : [samples],
    sampleRate,
    durationSeconds: samples.length / sampleRate,
    channelCount: channels,
  })
}

async function run(label, transform) {
  const raw = readWavPcm(SOURCE)
  const { samples, sampleRate, channels } = transform(raw)
  const buf = new ArrayBuffer(8)
  const imported = await importAudioFile(
    { name: `${label}.wav`, size: 99, type: 'audio/wav' },
    buf,
    decodeWith(samples, sampleRate, channels),
  )
  if (!imported.ok) {
    console.log(`${label}: IMPORT FAILED (${imported.code}) ${imported.message?.slice(0, 80) ?? ''}`)
    return { label, failed: imported.code }
  }
  const views = await buildAnalysisViews(imported.samples, imported.sampleRate)
  const analysis = await analyzeMusic(imported.samples, imported.sampleRate, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: null,
  })
  const origin = analysis.predictedNotes.length ? Math.min(...analysis.predictedNotes.map((n) => n.startSeconds)) : 0
  const fp = fingerprint(analysis.predictedNotes, origin)
  return {
    label,
    notes: analysis.predictedNotes.length,
    tempo: analysis.tempo.bpm,
    onsetCount: analysis.onsets.length,
    fingerprint: fp,
    rms: Number(imported.rms.toFixed(5)),
  }
}

const variants = [
  ['baseline', (r) => r],
  ['gain-6dB', (r) => ({ ...r, samples: Float32Array.from([...r.samples].map((v) => v * 2)) })],
  ['gain-12dB', (r) => ({ ...r, samples: Float32Array.from([...r.samples].map((v) => v * 4)) })],
  ['mono-from-stereo-duplicate', (r) => ({ samples: r.samples, sampleRate: r.sampleRate, channels: 2 })],
  ['leading-silence-2s', (r) => {
    const pad = new Float32Array(Math.floor(2 * r.sampleRate))
    return { samples: Float32Array.from([...pad, ...r.samples]), sampleRate: r.sampleRate, channels: r.channels }
  }],
  ['resample-48k', (r) => {
    // Decimate-free approximation: state the decode at 48k with the same
    // samples so the import performs its 48k -> 22050 resample.
    return { samples: r.samples, sampleRate: 48000, channels: r.channels }
  }],
  ['mild-noise-snr-40dB', (r) => {
    const noisy = Float32Array.from(r.samples.map((v, i) => v + (Math.random() - 0.5) * 0.004 * ((i % 2) ? 1 : -1)))
    return { samples: noisy, sampleRate: r.sampleRate, channels: r.channels }
  }],
]

const rows = []
let baseline = null
for (const [label, transform] of variants) {
  const row = await run(label, transform)
  if (row.fingerprint && baseline === null) baseline = row.fingerprint
  if (row.fingerprint) row.identicalToBaseline = row.fingerprint === baseline
  rows.push(row)
  console.log(`${row.label}: notes=${row.notes} tempo=${row.tempo} onsets=${row.onsetCount} identical=${row.identicalToBaseline ?? 'n/a'} rms=${row.rms}`)
}

// Compare with tolerance: for each baseline note find a same-pitch variant note
// within 0.15 s of its origin-relative onset. Beat anchors can drift slightly
// when the onset grid shifts, and that is not a musical difference.
function parse(fp) {
  return fp.split('|').map((token) => {
    const [midi, onset] = token.split('@')
    return { midi: Number(midi), onset: Number(onset) }
  })
}
const baseNotes = parse(baseline)
const rows2 = rows.filter((r) => r.fingerprint).map((r) => {
  const notes = parse(r.fingerprint)
  const used = new Set()
  let shared = 0
  for (const b of baseNotes) {
    for (let i = 0; i < notes.length; i += 1) {
      if (used.has(i) || notes[i].midi !== b.midi) continue
      if (Math.abs(notes[i].onset - b.onset) <= 0.15) {
        used.add(i)
        shared += 1
        break
      }
    }
  }
  return {
    label: r.label,
    overlapWithBaseline: Math.round((shared / Math.max(1, baseNotes.length)) * 1000) / 1000,
    notes: r.notes,
    tempo: r.tempo,
  }
})
console.log('\noverlap with baseline (fraction of baseline notes present):')
for (const r of rows2) console.log(`  ${r.label}: ${r.overlapWithBaseline}`)

writeFileSync('/tmp/av-invariance/report.json', JSON.stringify({ rows, overlap: rows2 }, null, 2))
console.log('\nwrote /tmp/av-invariance/report.json')

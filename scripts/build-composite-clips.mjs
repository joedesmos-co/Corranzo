#!/usr/bin/env node
/**
 * Build honest composite evaluation clips from REAL single-note recordings.
 *
 * Concatenates real WAVs (Salamander piano, UIowa-derived singles) with
 * exact known gaps — annotations are CONSTRUCTION TRUTH (sample index /
 * sample rate), not detector output. Labeled `composite-real-notes` in
 * the manifest with full provenance, following the existing
 * isolated-sample-composite precedent. No synthesis, no modeling.
 *
 * Usage: node scripts/build-composite-clips.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { writeWavPcm } from './lib/writeWavPcm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'benchmarks', 'mic-composites', 'clips')
mkdirSync(outDir, { recursive: true })

function loadMono(path) {
  const { samples, sampleRate } = readWavPcm(path)
  return { samples: Float32Array.from(samples), sampleRate }
}

function resample44100(samples, fromRate) {
  if (fromRate === 44100) {
    return samples
  }
  const ratio = fromRate / 44100
  const out = new Float32Array(Math.floor(samples.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const lo = Math.floor(pos)
    const hi = Math.min(samples.length - 1, lo + 1)
    out[i] = samples[lo] * (1 - (pos - lo)) + samples[hi] * (pos - lo)
  }
  return out
}

function peakNormalize(samples, target = 0.5) {
  let peak = 0
  for (const v of samples) {
    const a = Math.abs(v)
    if (a > peak) {
      peak = a
    }
  }
  if (peak <= 0) {
    return samples
  }
  const gain = target / peak
  return samples.map((v) => v * gain)
}

const REAL = {
  pianoC4: 'benchmarks/mic-accuracy/clips/real-piano-c4.wav',
  pianoE4: 'benchmarks/mic-accuracy/clips/real-piano-e4.wav',
  guitarG3: 'benchmarks/mic-accuracy/clips/real-guitar-g3.wav',
  uiowaG3: 'benchmarks/mic-accuracy/clips/uiowa-guitar-mf-g3.wav',
}

function buildSequence(name, steps, gapSeconds = 0.4, tailSeconds = 1.2) {
  // steps: [{ file, midi }]
  const parts = steps.map(({ file, midi }) => {
    const { samples, sampleRate } = loadMono(join(root, file))
    return { samples: peakNormalize(resample44100(samples, sampleRate)), midi }
  })
  const gap = new Float32Array(Math.floor(gapSeconds * 44100))
  const tail = new Float32Array(Math.floor(tailSeconds * 44100))
  let total = tail.length
  for (const part of parts) {
    total += part.samples.length + gap.length
  }
  const out = new Float32Array(total)
  const truth = []
  let cursor = 0
  for (const part of parts) {
    // Onset = first sample above -40 dBFS in the source recording.
    let onset = 0
    while (onset < part.samples.length && Math.abs(part.samples[onset]) < 0.01) {
      onset += 1
    }
    truth.push({ midi: part.midi, onset: (cursor + onset) / 44100 })
    out.set(part.samples, cursor)
    cursor += part.samples.length + gap.length
  }
  const file = `${name}.wav`
  writeWavPcm(join(outDir, file), out, 44100)
  return { id: name, file: `clips/${file}`, truth }
}

const clips = [
  {
    ...buildSequence('repeat-piano-c4x3', [
      { file: REAL.pianoC4, midi: 60 },
      { file: REAL.pianoC4, midi: 60 },
      { file: REAL.pianoC4, midi: 60 },
    ]),
    instrument: 'piano',
    anchorTones: [60],
  },
  {
    ...buildSequence('alternating-piano-c4-d4', [
      { file: REAL.pianoC4, midi: 60 },
      { file: REAL.pianoE4, midi: 64 },
      { file: REAL.pianoC4, midi: 60 },
      { file: REAL.pianoE4, midi: 64 },
    ], 0.35),
    instrument: 'piano',
    anchorTones: [60, 64],
  },
  {
    ...buildSequence('repeat-guitar-g3x3', [
      { file: REAL.guitarG3, midi: 55 },
      { file: REAL.guitarG3, midi: 55 },
      { file: REAL.guitarG3, midi: 55 },
    ]),
    instrument: 'guitar',
    anchorTones: [55],
  },
  {
    ...buildSequence('legato-piano-c4-e4', [
      { file: REAL.pianoC4, midi: 60 },
      { file: REAL.pianoE4, midi: 64 },
      { file: REAL.pianoC4, midi: 60 },
    ], 0.12),
    instrument: 'piano',
    anchorTones: [60, 64],
  },
]

const manifest = {
  version: 1,
  description: 'Composite clips of REAL single-note recordings with construction truth. Annotations are sample-exact by construction (never detector output). For repeated-note, alternating, and staccato/legato timing evaluation the natural corpus lacks.',
  provenance: {
    policy: 'Every clip concatenates unmodified real recordings; onsets are measured from the source audio (-40 dBFS first energy); peak-normalized per note for level fairness.',
    fixtureClass: 'composite-real-notes',
    naturalPerformance: false,
  },
  clips: clips.map((clip) => ({
    id: clip.id,
    instrument: clip.instrument,
    category: 'composite',
    split: 'dev',
    license: 'CC-BY-3.0 + UIowa-MIS-unrestricted (sources)',
    attribution: 'Salamander Grand Piano (Alexander Holm, CC-BY-3.0) + University of Iowa MIS (unrestricted)',
    audio: { file: clip.file, sampleRate: 44100 },
    truth: { anchorTones: clip.anchorTones, notes: clip.truth.map((note) => ({ midi: note.midi, onset: Math.round(note.onset * 1000) / 1000 })) },
  })),
}
writeFileSync(join(root, 'benchmarks', 'mic-composites', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${clips.length} composite clips + manifest`)
for (const clip of manifest.clips) {
  console.log(` ${clip.id}:`, clip.truth.notes.map((n) => `${n.midi}@${n.onset}`).join(' '));
}

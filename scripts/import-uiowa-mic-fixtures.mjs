#!/usr/bin/env node
/**
 * Import a small redistributable real-recorded sample subset from the
 * University of Iowa Musical Instrument Samples collection and derive compact
 * mic replay fixtures from it.
 *
 * Source license/provenance: https://theremin.music.uiowa.edu/mis.html
 * "freely available ... used for any projects, without restrictions."
 *
 * Requires macOS afconvert for AIFF -> WAV conversion.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { writeWavPcm } from './lib/writeWavPcm.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = join(ROOT, 'tmp/uiowa-mic-sources')
const POLY_DIR = join(ROOT, 'benchmarks/mic-polyphony/clips')
const ACCURACY_DIR = join(ROOT, 'benchmarks/mic-accuracy/clips')
const ACCURACY_MANIFEST = join(ROOT, 'benchmarks/mic-accuracy/manifest.json')
const POLY_MANIFEST = join(ROOT, 'benchmarks/mic-polyphony/manifest.json')
const SAMPLE_RATE = 44100
const BASE_URL = 'https://theremin.music.uiowa.edu/'
const SOURCE_ATTRIBUTION =
  'University of Iowa Musical Instrument Samples (MIS) — freely redistributable per https://theremin.music.uiowa.edu/mis.html'

const SOURCES = [
  {
    key: 'piano-mf-c3',
    url: 'sound files/MIS/Piano_Other/piano/Piano.mf.C3.aiff',
    midi: 48,
    instrument: 'piano',
  },
  {
    key: 'piano-mf-c4',
    url: 'sound files/MIS/Piano_Other/piano/Piano.mf.C4.aiff',
    midi: 60,
    instrument: 'piano',
  },
  {
    key: 'piano-mf-e4',
    url: 'sound files/MIS/Piano_Other/piano/Piano.mf.E4.aiff',
    midi: 64,
    instrument: 'piano',
  },
  {
    key: 'piano-mf-g4',
    url: 'sound files/MIS/Piano_Other/piano/Piano.mf.G4.aiff',
    midi: 67,
    instrument: 'piano',
  },
  {
    key: 'piano-mf-b4',
    url: 'sound files/MIS/Piano_Other/piano/Piano.mf.B4.aiff',
    midi: 71,
    instrument: 'piano',
  },
  {
    key: 'piano-pp-c4',
    url: 'sound files/MIS/Piano_Other/piano/Piano.pp.C4.aiff',
    midi: 60,
    instrument: 'piano',
  },
  {
    key: 'piano-pp-e4',
    url: 'sound files/MIS/Piano_Other/piano/Piano.pp.E4.aiff',
    midi: 64,
    instrument: 'piano',
  },
  {
    key: 'piano-pp-g4',
    url: 'sound files/MIS/Piano_Other/piano/Piano.pp.G4.aiff',
    midi: 67,
    instrument: 'piano',
  },
  {
    key: 'guitar-mf-e2',
    url: 'sound files/MIS/Piano_Other/guitar/Guitar.mf.sulE.E2B2.mono.aif',
    midi: 40,
    instrument: 'guitar',
    string: 6,
    fret: 0,
    noteIndex: 0,
  },
  {
    key: 'guitar-mf-a2',
    url: 'sound files/MIS/Piano_Other/guitar/Guitar.mf.sulA.A2B2.mono.aif',
    midi: 45,
    instrument: 'guitar',
    string: 5,
    fret: 0,
    noteIndex: 0,
  },
  {
    key: 'guitar-mf-d3',
    url: 'sound files/MIS/Piano_Other/guitar/Guitar.mf.sulD.D3B3.mono.aif',
    midi: 50,
    instrument: 'guitar',
    string: 4,
    fret: 0,
    noteIndex: 0,
  },
  {
    key: 'guitar-mf-g3',
    url: 'sound files/MIS/Piano_Other/guitar/Guitar.mf.sulG.G3B3.mono.aif',
    midi: 55,
    instrument: 'guitar',
    string: 3,
    fret: 0,
    noteIndex: 0,
  },
  {
    key: 'guitar-mf-b3',
    url: 'sound files/MIS/Piano_Other/guitar/Guitar.mf.sulB.B3.mono.aif',
    midi: 59,
    instrument: 'guitar',
    string: 2,
    fret: 0,
    noteIndex: 0,
  },
  {
    key: 'guitar-mf-e4',
    url: 'sound files/MIS/Piano_Other/guitar/Guitar.mf.sul_E.E4B4.mono.aif',
    midi: 64,
    instrument: 'guitar',
    string: 1,
    fret: 0,
    noteIndex: 0,
  },
]

const DERIVED_FIXTURES = [
  {
    file: join(ACCURACY_DIR, 'uiowa-piano-mf-c4.wav'),
    notes: [{ key: 'piano-mf-c4', atMs: 80, gain: 0.9 }],
    seconds: 1.8,
    manifest: {
      target: 'accuracy',
      id: 'uiowa-piano-mf-c4',
      label: 'note',
      expectedMidi: 60,
      instrument: 'piano',
      tone: 'acoustic-piano',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1700,
      notes: 'UIowa MIS Piano.mf.C4 — single-note regression fixture.',
    },
  },
  {
    file: join(ACCURACY_DIR, 'uiowa-piano-pp-c4.wav'),
    notes: [{ key: 'piano-pp-c4', atMs: 80, gain: 0.85 }],
    seconds: 1.8,
    manifest: {
      target: 'accuracy',
      id: 'uiowa-piano-pp-c4',
      label: 'note',
      expectedMidi: 60,
      instrument: 'piano',
      tone: 'acoustic-piano',
      dynamic: 'pp',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1700,
      notes: 'UIowa MIS Piano.pp.C4 — soft single-note fixture.',
    },
  },
  {
    file: join(ACCURACY_DIR, 'uiowa-guitar-mf-g3.wav'),
    notes: [{ key: 'guitar-mf-g3', atMs: 80, gain: 0.95 }],
    seconds: 1.6,
    manifest: {
      target: 'accuracy',
      id: 'uiowa-guitar-mf-g3',
      label: 'note',
      expectedMidi: 55,
      instrument: 'guitar',
      tone: 'acoustic-guitar',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1500,
      notes: 'UIowa MIS Guitar.mf G3 open string — single-note regression fixture.',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-piano-mf-c4-e4-dyad.wav'),
    notes: [
      { key: 'piano-mf-c4', atMs: 80, gain: 0.72 },
      { key: 'piano-mf-e4', atMs: 80, gain: 0.72 },
    ],
    seconds: 1.9,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-piano-mf-c4-e4-dyad',
      label: 'chord',
      expectedMidis: [60, 64],
      chordType: 'simultaneous',
      instrument: 'piano',
      tone: 'acoustic-piano',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1800,
      notes: 'UIowa-derived simultaneous C4+E4 dyad.',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-piano-mf-c-major-triad.wav'),
    notes: [
      { key: 'piano-mf-c4', atMs: 80, gain: 0.58 },
      { key: 'piano-mf-e4', atMs: 80, gain: 0.58 },
      { key: 'piano-mf-g4', atMs: 80, gain: 0.58 },
    ],
    seconds: 1.9,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-piano-mf-c-major-triad',
      label: 'chord',
      expectedMidis: [60, 64, 67],
      chordType: 'simultaneous',
      instrument: 'piano',
      tone: 'acoustic-piano',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1800,
      notes: 'UIowa-derived simultaneous C major triad.',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-piano-mf-cmaj7.wav'),
    notes: [
      { key: 'piano-mf-c4', atMs: 80, gain: 0.5 },
      { key: 'piano-mf-e4', atMs: 80, gain: 0.5 },
      { key: 'piano-mf-g4', atMs: 80, gain: 0.5 },
      { key: 'piano-mf-b4', atMs: 80, gain: 0.5 },
    ],
    seconds: 2.0,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-piano-mf-cmaj7',
      label: 'chord',
      expectedMidis: [60, 64, 67, 71],
      chordType: 'simultaneous',
      instrument: 'piano',
      tone: 'acoustic-piano',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1900,
      notes: 'UIowa-derived four-note Cmaj7 chord.',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-piano-mf-ringing-c-major.wav'),
    notes: [
      { key: 'piano-mf-c4', atMs: 80, gain: 0.55 },
      { key: 'piano-mf-e4', atMs: 80, gain: 0.55 },
      { key: 'piano-mf-g4', atMs: 80, gain: 0.55 },
    ],
    seconds: 3.2,
    roomLevel: 0.0018,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-piano-mf-ringing-c-major',
      label: 'chord',
      expectedMidis: [60, 64, 67],
      chordType: 'simultaneous',
      instrument: 'piano',
      tone: 'acoustic-piano',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 3000,
      notes: 'UIowa-derived ringing C major triad (longer sustain window).',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-piano-pp-c-major-triad.wav'),
    notes: [
      { key: 'piano-pp-c4', atMs: 80, gain: 0.48 },
      { key: 'piano-pp-e4', atMs: 80, gain: 0.48 },
      { key: 'piano-pp-g4', atMs: 80, gain: 0.48 },
    ],
    seconds: 1.9,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-piano-pp-c-major-triad',
      label: 'chord',
      expectedMidis: [60, 64, 67],
      chordType: 'simultaneous',
      instrument: 'piano',
      tone: 'acoustic-piano',
      dynamic: 'pp',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1800,
      notes: 'UIowa-derived soft simultaneous C major triad.',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-piano-mf-split-c3-e4-g4.wav'),
    notes: [
      { key: 'piano-mf-c3', atMs: 80, gain: 0.56 },
      { key: 'piano-mf-e4', atMs: 80, gain: 0.54 },
      { key: 'piano-mf-g4', atMs: 80, gain: 0.54 },
    ],
    seconds: 2.0,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-piano-mf-split-c3-e4-g4',
      label: 'chord',
      expectedMidis: [48, 64, 67],
      chordType: 'split-register',
      instrument: 'piano',
      tone: 'acoustic-piano',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1900,
      notes: 'UIowa-derived split-register chord (bass C3 + treble E4/G4).',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-guitar-mf-adjacent-g3-b3.wav'),
    notes: [
      { key: 'guitar-mf-g3', atMs: 80, gain: 0.66 },
      { key: 'guitar-mf-b3', atMs: 96, gain: 0.62 },
    ],
    seconds: 1.7,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-guitar-mf-adjacent-g3-b3',
      label: 'chord',
      expectedMidis: [55, 59],
      chordType: 'simultaneous',
      instrument: 'guitar',
      tone: 'acoustic-guitar',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1600,
      expectedStringFrets: [
        { string: 3, fret: 0, midi: 55 },
        { string: 2, fret: 0, midi: 59 },
      ],
      notes: 'UIowa-derived adjacent guitar open strings G3+B3.',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-guitar-mf-low-high-e2-e4.wav'),
    notes: [
      { key: 'guitar-mf-e2', atMs: 80, gain: 0.68 },
      { key: 'guitar-mf-e4', atMs: 115, gain: 0.48 },
    ],
    seconds: 1.8,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-guitar-mf-low-high-e2-e4',
      label: 'chord',
      expectedMidis: [40, 64],
      chordType: 'split-register',
      instrument: 'guitar',
      tone: 'acoustic-guitar',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1700,
      expectedStringFrets: [
        { string: 6, fret: 0, midi: 40 },
        { string: 1, fret: 0, midi: 64 },
      ],
      notes: 'UIowa-derived low+high guitar open E strings.',
    },
  },
  {
    file: join(POLY_DIR, 'uiowa-guitar-mf-open-em-strum.wav'),
    notes: [
      { key: 'guitar-mf-e2', atMs: 80, gain: 0.42 },
      { key: 'guitar-mf-a2', atMs: 102, gain: 0.4 },
      { key: 'guitar-mf-d3', atMs: 124, gain: 0.38 },
      { key: 'guitar-mf-g3', atMs: 146, gain: 0.35 },
      { key: 'guitar-mf-b3', atMs: 168, gain: 0.33 },
      { key: 'guitar-mf-e4', atMs: 190, gain: 0.3 },
    ],
    seconds: 2.0,
    manifest: {
      target: 'polyphony',
      id: 'uiowa-guitar-mf-open-em-strum',
      label: 'chord',
      expectedMidis: [40, 45, 50, 55, 59, 64],
      chordType: 'rolled',
      rollMs: 110,
      instrument: 'guitar',
      tone: 'acoustic-guitar',
      dynamic: 'mf',
      expectedOnsetMs: 120,
      startMs: 40,
      endMs: 1900,
      expectedStringFrets: [
        { string: 6, fret: 0, midi: 40 },
        { string: 5, fret: 0, midi: 45 },
        { string: 4, fret: 0, midi: 50 },
        { string: 3, fret: 0, midi: 55 },
        { string: 2, fret: 0, midi: 59 },
        { string: 1, fret: 0, midi: 64 },
      ],
      notes: 'UIowa-derived open Em strum (rolled across six strings).',
    },
  },
]

function download(url, filePath) {
  if (existsSync(filePath)) {
    return
  }
  execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '-o', filePath, new URL(url, BASE_URL).toString()], {
    stdio: 'inherit',
  })
}

function convertAiffToWav(aiffPath, wavPath) {
  if (existsSync(wavPath)) {
    return
  }
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${SAMPLE_RATE}`, '-c', '1', aiffPath, wavPath], {
    stdio: 'inherit',
  })
}

function peakAbs(samples) {
  let peak = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample))
  }
  return peak
}

function findOnsets(samples, sampleRate, expectedCount = 1) {
  const frame = Math.max(128, Math.floor(sampleRate * 0.01))
  const hop = Math.max(64, Math.floor(sampleRate * 0.005))
  const rmsFrames = []
  let maxRms = 0
  for (let start = 0; start + frame <= samples.length; start += hop) {
    let sum = 0
    for (let index = start; index < start + frame; index += 1) {
      sum += samples[index] * samples[index]
    }
    const rms = Math.sqrt(sum / frame)
    rmsFrames.push({ start, rms })
    maxRms = Math.max(maxRms, rms)
  }

  const threshold = Math.max(maxRms * 0.12, 0.004)
  const minGap = Math.floor(sampleRate * 0.32)
  const onsets = []
  let armed = true
  let lastOnset = -Infinity
  for (const item of rmsFrames) {
    if (armed && item.rms >= threshold && item.start - lastOnset > minGap) {
      onsets.push(item.start)
      lastOnset = item.start
      armed = false
      if (onsets.length >= expectedCount) {
        break
      }
    } else if (item.rms < threshold * 0.35) {
      armed = true
    }
  }
  return onsets
}

function extractNote(samples, sampleRate, { noteIndex = 0, seconds = 1.35 } = {}) {
  const onsets = findOnsets(samples, sampleRate, noteIndex + 1)
  const onset = onsets[noteIndex] ?? onsets[0] ?? 0
  const lead = Math.floor(sampleRate * 0.04)
  const start = Math.max(0, onset - lead)
  const length = Math.floor(sampleRate * seconds)
  const note = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    note[index] = samples[start + index] ?? 0
  }

  const peak = peakAbs(note)
  const targetPeak = 0.72
  if (peak > 0) {
    const gain = Math.min(3.5, targetPeak / peak)
    for (let index = 0; index < note.length; index += 1) {
      note[index] *= gain
    }
  }
  return note
}

function roomBed(length, level = 0.0025) {
  const buffer = new Float32Array(length)
  let state = 0x5eed1234
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    buffer[index] = ((state / 0xffffffff) * 2 - 1) * level
  }
  return buffer
}

function mixFixture(extracted, fixture) {
  const length = Math.floor(SAMPLE_RATE * fixture.seconds)
  const output = roomBed(length, fixture.roomLevel ?? 0.0025)
  for (const note of fixture.notes) {
    const source = extracted.get(note.key)
    if (!source) {
      throw new Error(`Missing extracted source: ${note.key}`)
    }
    const offset = Math.floor((note.atMs / 1000) * SAMPLE_RATE)
    for (let index = 0; index < source.length && offset + index < output.length; index += 1) {
      output[offset + index] += source[index] * (note.gain ?? 1)
    }
  }
  const peak = peakAbs(output)
  if (peak > 0.94) {
    const gain = 0.94 / peak
    for (let index = 0; index < output.length; index += 1) {
      output[index] *= gain
    }
  }
  return output
}

function upsertManifestClip(manifestPath, clip) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const withoutExisting = manifest.clips.filter((entry) => entry.id !== clip.id)
  manifest.clips = [...withoutExisting, clip]
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function buildManifestClip(fixture) {
  const meta = fixture.manifest
  if (!meta) {
    throw new Error(`Fixture missing manifest metadata: ${fixture.file}`)
  }
  const wavName = basename(fixture.file)
  const clip = {
    id: meta.id,
    label: meta.label,
    instrument: meta.instrument,
    micDevice: 'uiowa-mis',
    tone: meta.tone,
    dynamic: meta.dynamic ?? null,
    noiseCondition: 'clean',
    sourceType: 'uiowa-mis-derived',
    file: `clips/${wavName}`,
    redistribution: 'uiowa-mis-unrestricted',
    attribution: SOURCE_ATTRIBUTION,
    notes: meta.notes,
  }
  if (meta.label === 'note') {
    clip.expectedMidi = meta.expectedMidi
    clip.expectedOnsetMs = meta.expectedOnsetMs ?? 120
    if (Number.isFinite(meta.startMs)) clip.startMs = meta.startMs
    if (Number.isFinite(meta.endMs)) clip.endMs = meta.endMs
  } else {
    clip.expectedMidis = meta.expectedMidis
    clip.expectedOnsetMs = meta.expectedOnsetMs ?? 120
    clip.chordType = meta.chordType ?? 'simultaneous'
    if (Number.isFinite(meta.rollMs)) clip.rollMs = meta.rollMs
    if (Number.isFinite(meta.startMs)) clip.startMs = meta.startMs
    if (Number.isFinite(meta.endMs)) clip.endMs = meta.endMs
    if (meta.expectedStringFrets) clip.expectedStringFrets = meta.expectedStringFrets
  }
  return clip
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('import-uiowa-mic-fixtures currently requires macOS afconvert')
  }

  mkdirSync(CACHE_DIR, { recursive: true })
  mkdirSync(POLY_DIR, { recursive: true })
  mkdirSync(ACCURACY_DIR, { recursive: true })

  const extracted = new Map()
  for (const source of SOURCES) {
    const sourceName = source.url.split('/').pop()
    const aiffPath = join(CACHE_DIR, sourceName)
    const wavPath = join(CACHE_DIR, sourceName.replace(/\.aiff?$/i, '.wav'))
    download(source.url, aiffPath)
    convertAiffToWav(aiffPath, wavPath)
    const wav = readWavPcm(wavPath)
    if (wav.sampleRate !== SAMPLE_RATE) {
      throw new Error(`Unexpected sample rate ${wav.sampleRate} for ${wavPath}`)
    }
    extracted.set(
      source.key,
      extractNote(wav.samples, wav.sampleRate, {
        noteIndex: source.noteIndex ?? 0,
        seconds: source.instrument === 'guitar' ? 1.3 : 1.55,
      }),
    )
  }

  for (const fixture of DERIVED_FIXTURES) {
    const samples = mixFixture(extracted, fixture)
    writeWavPcm(fixture.file, samples, SAMPLE_RATE)
    console.error(`Wrote ${resolve(fixture.file)} (${samples.length} samples)`)

    const clip = buildManifestClip(fixture)
    const manifestPath = fixture.manifest.target === 'accuracy' ? ACCURACY_MANIFEST : POLY_MANIFEST
    upsertManifestClip(manifestPath, clip)
    console.error(`Upserted ${clip.id} → ${manifestPath}`)
  }

  if (process.argv.includes('--clean-cache')) {
    rmSync(CACHE_DIR, { recursive: true, force: true })
  }
}

main()

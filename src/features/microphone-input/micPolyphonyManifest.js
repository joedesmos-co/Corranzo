import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeInstrumentId } from '../instruments/instruments.js'
import { sliceClipSamples } from './micAccuracyManifest.js'
import { renderSyntheticChordClip, MIC_POLYPHONY_CHORD_TYPES } from './micSyntheticChordClips.js'

const DEFAULT_MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../benchmarks/mic-polyphony/manifest.json',
)

export { MIC_POLYPHONY_CHORD_TYPES }

export function normalizeExpectedMidis(midis) {
  if (!Array.isArray(midis)) {
    return []
  }
  return [...new Set(midis.filter((midi) => Number.isFinite(midi)))].sort((a, b) => a - b)
}

export function normalizeMicPolyphonyClip(clip = {}) {
  const expectedMidis = normalizeExpectedMidis(clip.expectedMidis)
  return {
    ...clip,
    expectedMidis: expectedMidis.length ? expectedMidis : null,
    instrument: clip.instrument ? normalizeInstrumentId(clip.instrument) : null,
    micDevice: clip.micDevice ?? null,
    noiseCondition: clip.noiseCondition ?? (clip.synthetic ? 'synthetic' : null),
    chordType: clip.chordType ?? (clip.label === 'chord' ? MIC_POLYPHONY_CHORD_TYPES.SIMULTANEOUS : null),
    rollMs: clip.rollMs ?? null,
    pedal: Boolean(clip.pedal),
    startMs: clip.startMs ?? null,
    endMs: clip.endMs ?? null,
    source: clip.synthetic ? 'synthetic' : clip.file ? 'file' : 'unknown',
  }
}

export function resolveMicPolyphonyManifestPath(path = DEFAULT_MANIFEST_PATH) {
  return resolve(path)
}

export function loadMicPolyphonyManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const resolved = resolveMicPolyphonyManifestPath(manifestPath)
  const raw = readFileSync(resolved, 'utf8')
  const manifest = JSON.parse(raw)
  if (!Array.isArray(manifest.clips)) {
    throw new Error(`Invalid mic polyphony manifest: ${resolved}`)
  }
  return {
    ...manifest,
    manifestPath: resolved,
    clipsDir: dirname(resolved),
    clips: manifest.clips.map(normalizeMicPolyphonyClip),
  }
}

export function resolveMicPolyphonyClipAudio(clip, manifest, sampleRate = 44100) {
  const normalized = normalizeMicPolyphonyClip(clip)
  if (normalized.synthetic) {
    return {
      samples: renderSyntheticChordClip(normalized.synthetic, sampleRate),
      sampleRate,
      missingFile: false,
      source: 'synthetic',
    }
  }

  if (!normalized.file) {
    return { samples: null, sampleRate, missingFile: true, source: 'missing' }
  }

  const filePath = join(manifest.clipsDir, normalized.file)
  if (!existsSync(filePath)) {
    return { samples: null, sampleRate, missingFile: true, source: 'missing', filePath }
  }

  return { samples: null, sampleRate, missingFile: false, source: 'file', filePath }
}

export { sliceClipSamples }

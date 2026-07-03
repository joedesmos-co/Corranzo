import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeInstrumentId } from '../instruments/instruments.js'
import { renderSyntheticClip } from './micSyntheticClips.js'

const DEFAULT_MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../benchmarks/mic-accuracy/manifest.json',
)

export const MIC_REGISTER_BUCKETS = {
  BASS: 'bass',
  MID: 'mid',
  TREBLE: 'treble',
}

/** Piano-style register buckets for per-note breakdown in replay reports. */
export function midiRegisterBucket(midi) {
  if (midi == null || !Number.isFinite(midi)) {
    return null
  }
  if (midi < 48) {
    return MIC_REGISTER_BUCKETS.BASS
  }
  if (midi <= 72) {
    return MIC_REGISTER_BUCKETS.MID
  }
  return MIC_REGISTER_BUCKETS.TREBLE
}

export function normalizeMicAccuracyClip(clip = {}) {
  return {
    ...clip,
    instrument: clip.instrument ? normalizeInstrumentId(clip.instrument) : null,
    micDevice: clip.micDevice ?? null,
    noiseCondition: clip.noiseCondition ?? (clip.synthetic ? 'synthetic' : null),
    startMs: clip.startMs ?? null,
    endMs: clip.endMs ?? null,
    source: clip.synthetic ? 'synthetic' : clip.file ? 'file' : 'unknown',
  }
}

/**
 * Slice PCM samples to a manifest window. `startMs`/`endMs` are relative to clip start.
 */
export function sliceClipSamples(samples, sampleRate, { startMs = null, endMs = null } = {}) {
  if (!samples?.length || !sampleRate) {
    return samples
  }
  const startIndex =
    startMs != null ? Math.max(0, Math.floor((startMs / 1000) * sampleRate)) : 0
  const endIndex =
    endMs != null
      ? Math.min(samples.length, Math.floor((endMs / 1000) * sampleRate))
      : samples.length
  if (startIndex >= endIndex) {
    return new Float32Array(0)
  }
  return samples.subarray(startIndex, endIndex)
}

export function resolveMicAccuracyManifestPath(path = DEFAULT_MANIFEST_PATH) {
  return resolve(path)
}

export function loadMicAccuracyManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const resolved = resolveMicAccuracyManifestPath(manifestPath)
  const raw = readFileSync(resolved, 'utf8')
  const manifest = JSON.parse(raw)
  if (!Array.isArray(manifest.clips)) {
    throw new Error(`Invalid mic accuracy manifest: ${resolved}`)
  }
  return {
    ...manifest,
    manifestPath: resolved,
    clipsDir: dirname(resolved),
    clips: manifest.clips.map(normalizeMicAccuracyClip),
  }
}

/**
 * Resolve clip audio for replay. Synthetic clips are rendered in-memory;
 * file clips return { missingFile: true } when the WAV is not present yet.
 */
export function resolveMicAccuracyClipAudio(clip, manifest, sampleRate = 44100) {
  const normalized = normalizeMicAccuracyClip(clip)
  if (normalized.synthetic) {
    return {
      samples: renderSyntheticClip(normalized.synthetic, sampleRate),
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

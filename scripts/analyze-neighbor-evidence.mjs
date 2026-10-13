#!/usr/bin/env node
/**
 * M2 neighbor-ghost separability probe: for every scorer pool note
 * adjacent-by-semitone to a checkpoint's expected pitch, record flux /
 * span / presence, split by true-vs-unexpected. Decides whether a
 * confirm-stage neighbor veto can be calibrated WITHOUT hitting true
 * neighbor notes.
 *
 * Usage: node scripts/analyze-neighbor-evidence.mjs --notes <saved.json>...
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadManifestClips() {
  const map = new Map()
  const specs = [
    ['mic-real', (clip) => clip.audio?.file ? join('benchmarks/mic-real', clip.audio.file) : null],
    ['mic-polyphony', (clip) => clip.file ? join('benchmarks/mic-polyphony', clip.file) : null],
    ['mic-accuracy', (clip) => clip.file ? join('benchmarks/mic-accuracy', clip.file) : null],
    ['mic-composites', (clip) => clip.audio?.file ? join('benchmarks/mic-composites', clip.audio.file) : null],
  ]
  for (const [name, fileOf] of specs) {
    try {
      const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', name, 'manifest.json'), 'utf8'))
      for (const clip of manifest.clips ?? []) {
        const file = fileOf(clip)
        if (file) {
          map.set(clip.id, join(ROOT, file))
        }
      }
    } catch {
      // corpus missing
    }
  }
  return map
}

const { readWavPcm } = await import(join(ROOT, 'scripts', 'lib', 'readWavPcm.mjs'))
const streamUrl = new URL('../src/features/microphone-input/micNeuralStream.js', import.meta.url).href
const evidenceUrl = new URL('../src/features/microphone-input/micAttackEvidence.js', import.meta.url).href
const stream = await import(streamUrl)
const evidence = await import(evidenceUrl)

const files = []
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--notes' && process.argv[i + 1]) {
    files.push(process.argv[i + 1])
    i += 1
  }
}
if (!files.length) {
  console.error('usage: analyze-neighbor-evidence.mjs --notes <a.json> [--notes <b.json>...]')
  process.exit(1)
}
const fileMap = loadManifestClips()
const rows = []
for (const file of files) {
  const { clips } = JSON.parse(readFileSync(file, 'utf8'))
  for (const clip of clips) {
    const expected = clip.expected ?? []
    const truth = new Set([...(Array.isArray(clip.truthMidis) ? clip.truthMidis.map(Number) : [])])
    if (!expected.length) {
      continue
    }
    const audioFile = fileMap.get(clip.id)
    if (!audioFile) {
      continue
    }
    let wav
    try {
      wav = readWavPcm(audioFile)
    } catch {
      continue
    }
    const samples = Float32Array.from(wav.samples)
    const envelope = evidence.computeFluxEnvelope(samples, wav.sampleRate)
    const snapshots = evidence.captureAttackSnapshots({ samples, sampleRate: wav.sampleRate, envelope, bufferStartMs: 0 })
    // Pool from raw model windows (model-visible truth).
    const pool = new Map()
    for (const window of clip.windows ?? []) {
      for (const note of window.notes ?? []) {
        const midi = Math.round(note.midi)
        const onsetMs = window.windowStartMs + note.start * 1000
        const key = `${midi}@${Math.round(onsetMs)}`
        if (!pool.has(key)) {
          pool.set(key, { midi, onsetMs })
        }
      }
    }
    for (const entry of pool.values()) {
      const clipTimeMs = entry.onsetMs - 1000
      if (clipTimeMs < 0) {
        continue
      }
      // Semitone adjacency to any expected pitch (either direction).
      const adjacent = expected.some((midi) => Math.abs(midi - entry.midi) === 1)
      if (!adjacent) {
        continue
      }
      rows.push({
        clip: clip.id,
        midi: entry.midi,
        expectedNeighbors: expected.filter((midi) => Math.abs(midi - entry.midi) === 1).join(','),
        isTrue: truth.has(entry.midi),
        flux: Number(evidence.fluxAtMs(envelope, clipTimeMs, 0).toFixed(3)),
        presence: Number(evidence.attackCombPresence(snapshots, entry.midi, clipTimeMs).presence.toFixed(3)),
        span: 'n/a',
      })
    }
  }
}
const trues = rows.filter((r) => r.isTrue)
const ghosts = rows.filter((r) => !r.isTrue)
console.log(`semitone-adjacent pool notes: true=${trues.length} unexpected=${ghosts.length}`)
for (const r of trues) {
  console.log(` TRUE ${r.clip} midi=${r.midi} (near ${r.expectedNeighbors}) flux=${r.flux} presence=${r.presence}`)
}
for (const r of ghosts) {
  console.log(` GHOST ${r.clip} midi=${r.midi} (near ${r.expectedNeighbors}) flux=${r.flux} presence=${r.presence}`)
}

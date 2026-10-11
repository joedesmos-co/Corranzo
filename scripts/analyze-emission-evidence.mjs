#!/usr/bin/env node
/**
 * Emission-evidence distributions (Step 5, observation only): for every
 * scorer pool entry across saved benchmark windows, compute
 * capture-derived attack evidence (flux + comb presence + span) from the
 * clip WAV and label true-vs-ghost by frozen truth. Decides whether ANY
 * joint rule separates ghosts from true notes — the final veto arbiter.
 *
 * Verdicts are NEVER changed here (analysis only, no confirm calls).
 *
 * Usage: node scripts/analyze-emission-evidence.mjs --notes <saved.json>
 *   [--lead 1.0] (benchmark lead-silence seconds to subtract)
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback = null) {
  const prefix = `--${name}`
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === prefix) {
      return process.argv[i + 1] ?? fallback
    }
    if (process.argv[i].startsWith(`${prefix}=`)) {
      return process.argv[i].slice(prefix.length + 1)
    }
  }
  return fallback
}

const require = createRequire(import.meta.url)
const streamUrl = new URL('../src/features/microphone-input/micNeuralStream.js', import.meta.url).href
const evidenceUrl = new URL('../src/features/microphone-input/micAttackEvidence.js', import.meta.url).href
const stream = await import(streamUrl)
const evidence = await import(evidenceUrl)

function loadManifestClips() {
  const map = new Map()
  const specs = [
    ['mic-real', (clip) => clip.audio?.file ? join('benchmarks', 'mic-real', clip.audio.file) : null],
    ['mic-polyphony', (clip) => clip.file ? join('benchmarks', 'mic-polyphony', clip.file) : null],
    ['mic-accuracy', (clip) => clip.file ? join('benchmarks', 'mic-accuracy', clip.file) : null],
    ['mic-composites', (clip) => clip.audio?.file ? join('benchmarks', 'mic-composites', clip.audio.file) : null],
  ]
  for (const [name, fileOf] of specs) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', name, 'manifest.json'), 'utf8'))
    } catch {
      continue
    }
    for (const clip of manifest.clips ?? []) {
      const file = fileOf(clip)
      if (file) {
        map.set(clip.id, join(ROOT, file))
      }
    }
  }
  return map
}

const NOTES_PATH = arg('notes')
const LEAD = Number(arg('lead', '1.0'))
if (!NOTES_PATH) {
  console.error('usage: analyze-emission-evidence.mjs --notes <saved.json>')
  process.exit(1)
}

const { clips } = JSON.parse(readFileSync(NOTES_PATH, 'utf8'))
const files = loadManifestClips()
const { readWavPcm } = await import(join(ROOT, 'scripts', 'lib', 'readWavPcm.mjs'))

const rows = []
for (const clip of clips) {
  const file = files.get(clip.id)
  if (!file) {
    continue
  }
  let wav
  try {
    wav = readWavPcm(file)
  } catch {
    continue
  }
  // Scorer-identical pool build.
  const state = stream.createNeuralStreamState({ windowSeconds: 0.5, hopSeconds: 0.25, edgeSuppressMs: 80, octaveOverlapRatio: 0.7 })
  const attacks = []
  for (const window of [...clip.windows].sort((a, b) => a.windowStartMs - b.windowStartMs)) {
    stream.emitNeuralStreamNotes(state, window.notes.map((note) => ({
      midi: Math.round(note.midi),
      startOffsetSeconds: note.start,
      endOffsetSeconds: note.end,
    })), window.windowStartMs)
    attacks.push(...stream.drainNeuralStreamEvents(state))
  }
  const pool = new Map()
  for (const attack of attacks) {
    pool.set(`${attack.midi}@${Math.round(attack.onsetCaptureMs)}`, {
      midi: attack.midi,
      start: attack.onsetCaptureMs / 1000,
      end: attack.endCaptureMs / 1000,
    })
  }
  for (const sustained of stream.getNeuralStreamSustained(state)) {
    const key = `${sustained.midi}@${Math.round(sustained.onsetMs)}`
    if (!pool.has(key)) {
      pool.set(key, { midi: sustained.midi, start: sustained.onsetMs / 1000, end: sustained.onsetMs / 1000 + 1, sustained: true })
    }
  }
  // Evidence from clip audio (offline mirror of the live hook path).
  const samples = Float32Array.from(wav.samples)
  const envelope = evidence.computeFluxEnvelope(samples, wav.sampleRate)
  const snapshots = evidence.captureAttackSnapshots({ samples, sampleRate: wav.sampleRate, envelope, bufferStartMs: 0 })
  const truth = new Set([...(clip.expected ?? []), ...parseTruth(clip.truthMidis)])
  for (const entry of pool.values()) {
    const clipTimeMs = (entry.start - LEAD) * 1000
    const attackFlux = evidence.fluxAtMs(envelope, Math.max(clipTimeMs, 0), 0)
    const { presence } = evidence.attackCombPresence(snapshots, entry.midi, Math.max(clipTimeMs, 0))
    rows.push({
      clip: clip.id,
      split: clip.split,
      midi: entry.midi,
      span: Number((entry.end - entry.start).toFixed(3)),
      flux: Number(attackFlux.toFixed(3)),
      presence: Number(presence.toFixed(3)),
      sustained: Boolean(entry.sustained),
      isTrue: truth.has(entry.midi),
    })
  }
}

function parseTruth(value) {
  if (Array.isArray(value)) {
    return value.map(Number).filter(Number.isFinite)
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.map(Number).filter(Number.isFinite)
      }
    } catch {
      return []
    }
  }
  return []
}

const trues = rows.filter((r) => r.isTrue && !r.sustained)
const ghosts = rows.filter((r) => !r.isTrue && !r.sustained)
console.log(`pool entries=${rows.length} true-attacks=${trues.length} ghost-attacks=${ghosts.length}`)
function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(3)
}
for (const [label, set] of [['TRUE', trues], ['GHOST', ghosts]]) {
  const f = set.map((r) => r.flux).sort((a, b) => a - b)
  const p = set.map((r) => r.presence).sort((a, b) => a - b)
  const s = set.map((r) => r.span).sort((a, b) => a - b)
  console.log(`${label} n=${set.length} flux[min=${f[0]?.toFixed(3)} p25=${quantile(f, 0.25)} med=${quantile(f, 0.5)}] presence[min=${p[0]?.toFixed(3)} p25=${quantile(p, 0.25)} med=${quantile(p, 0.5)}] span[p25=${quantile(s, 0.25)} med=${quantile(s, 0.5)}]`)
}
// Joint-rule sweep: veto iff flux<T & span<S & presence<P. True hits must be 0.
for (const [ft, st, pt] of [[0.2, 0.2, 0.5], [0.3, 0.25, 0.8], [0.5, 0.3, 1.0], [1.0, 0.2, 0.5]]) {
  const tHit = trues.filter((r) => r.flux < ft && r.span < st && r.presence < pt)
  const gHit = ghosts.filter((r) => r.flux < ft && r.span < st && r.presence < pt)
  console.log(`rule flux<${ft} span<${st} presence<${pt}: TRUE ${tHit.length}/${trues.length} ${tHit.slice(0, 5).map((r) => `${r.clip}:${r.midi}`).join(' ')} | GHOST ${gHit.length}/${ghosts.length} ${gHit.slice(0, 8).map((r) => `${r.clip}:${r.midi}`).join(' ')}`)
}

#!/usr/bin/env node
/**
 * Batch attack-flux calibration: for every deduped model emission in saved
 * benchmark windows, measure HF-flux height at onset + span, joined with
 * clip truth. Answers: do TRUE notes always carry attack transients?
 *
 * Usage: node scripts/calibrate-attack-flux.mjs \
 *   --notes /tmp/neural-notes.json --manifests mic-accuracy,mic-polyphony \
 *   [--notes2 /tmp/micreal-dev.json --manifests2 mic-real]
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function readMonoWav(path) {
  const buffer = readFileSync(path)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const ascii = (offset, length) => {
    let value = ''
    for (let i = 0; i < length; i += 1) {
      value += String.fromCharCode(view.getUint8(offset + i))
    }
    return value
  }
  let offset = 12
  let channels = 1
  let sampleRate = 44100
  let bits = 16
  let dataOffset = -1
  let dataSize = 0
  while (offset + 8 <= view.byteLength) {
    const id = ascii(offset, 4)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bits = view.getUint16(offset + 22, true)
    } else if (id === 'data') {
      dataOffset = offset + 8
      dataSize = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  const bytesPerSample = bits / 8
  const frames = Math.floor(dataSize / (bytesPerSample * channels))
  const mono = new Float32Array(frames)
  for (let f = 0; f < frames; f += 1) {
    let sum = 0
    for (let c = 0; c < channels; c += 1) {
      const at = dataOffset + (f * channels + c) * bytesPerSample
      sum += bits === 16 ? view.getInt16(at, true) / 32768 : view.getFloat32(at, true)
    }
    mono[f] = sum / channels
  }
  return { samples: mono, sampleRate }
}

function fluxEnvelope(samples, sampleRate) {
  const hop = Math.floor(sampleRate * 0.005)
  const count = Math.floor(samples.length / hop)
  const hf = new Float32Array(count)
  for (let f = 0; f < count; f += 1) {
    let hsum = 0
    let prev = 0
    const start = f * hop
    const end = Math.min(start + hop, samples.length)
    for (let i = start; i < end; i += 1) {
      const d = samples[i] - prev
      hsum += d * d
      prev = samples[i]
    }
    hf[f] = Math.sqrt(hsum / Math.max(end - start, 1))
  }
  const flux = new Float32Array(count)
  for (let f = 1; f < count; f += 1) {
    flux[f] = Math.max(0, Math.log1p(hf[f] * 50) - Math.log1p(hf[f - 1] * 50))
  }
  return { flux, hop, sampleRate, max: Math.max(...flux, 1e-9) }
}

function fluxAt(env, timeSec, windowMs = 60) {
  const center = Math.round((timeSec * env.sampleRate) / env.hop)
  const radius = Math.round(windowMs / 5)
  let peak = 0
  for (let f = Math.max(1, center - radius); f <= Math.min(env.flux.length - 1, center + radius); f += 1) {
    peak = Math.max(peak, env.flux[f])
  }
  return peak / env.max
}

function dedup(clip) {
  const all = []
  for (const window of clip.windows ?? []) {
    for (const note of window.notes ?? []) {
      if (note.start < 0.08 || 0.5 - note.start < 0.08) {
        continue
      }
      if (note.end - note.start < 0.06) {
        continue
      }
      all.push({ midi: Math.round(note.midi), start: note.start + window.windowStartMs / 1000, end: note.end + window.windowStartMs / 1000 })
    }
  }
  // NOTE: benchmark pads 1 s lead silence; saved windowStartMs includes it.
  // Detect lead by checking for notes starting near -1..0? The scorer treats
  // windowStartMs as capture ms directly (clip-relative + 1000 lead offset
  // in test helper). For flux we need CLIP-relative time: subtract lead if
  // the earliest window starts at 0 and notes cluster >= 0.8.
  const out = []
  const byMidi = new Map()
  for (const note of all.sort((a, b) => a.start - b.start)) {
    const open = byMidi.get(note.midi)
    if (open && note.start - open.end < 0.12) {
      open.end = Math.max(open.end, note.end)
      continue
    }
    const entry = { ...note }
    byMidi.set(note.midi, entry)
    out.push(entry)
  }
  return out
}

function loadManifestClips(names) {
  const map = new Map()
  for (const name of names.split(',')) {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', name, 'manifest.json'), 'utf8'))
    for (const clip of manifest.clips ?? []) {
      const file = clip.file ?? (clip.audio?.file ? join('benchmarks/mic-real', clip.audio.file) : null)
      if (!file) {
        continue
      }
      map.set(clip.id, {
        file: join(ROOT, name === 'mic-real' ? file : join('benchmarks', name, file)),
        truth: new Set([
          ...((clip.expectedMidis ?? clip.expected ?? [])),
          ...((clip.truth?.notes ?? []).map((n) => n.midi)),
          ...((clip.truth?.anchorTones ?? [])),
        ]),
      })
    }
  }
  return map
}

function processSaved(notesPath, manifestNames) {
  const { clips } = JSON.parse(readFileSync(notesPath, 'utf8'))
  const manifest = loadManifestClips(manifestNames)
  const rows = []
  for (const clip of clips) {
    const entry = manifest.get(clip.id)
    if (!entry) {
      continue
    }
    let env
    try {
      const { samples, sampleRate } = readMonoWav(entry.file)
      env = fluxEnvelope(samples, sampleRate)
    } catch {
      continue
    }
    // Saved windows include 1 s lead silence: clip-relative = t - 1.0.
    // (benchmark prepends LEAD_SILENCE_SECONDS=1.0 then subtracts it for
    // `got` lines; saved windowStartMs is pre-subtraction.)
    for (const note of dedup(clip)) {
      const clipTime = note.start - 1.0
      if (clipTime < -0.5) {
        continue
      }
      rows.push({
        clip: clip.id,
        split: clip.split,
        midi: note.midi,
        span: Number((note.end - note.start).toFixed(2)),
        flux: Number(fluxAt(env, Math.max(clipTime, 0)).toFixed(3)),
        isTrue: entry.truth.has(note.midi),
      })
    }
  }
  return rows
}

const rows = [
  ...processSaved(arg('notes'), arg('manifests', 'mic-accuracy,mic-polyphony')),
]
if (arg('notes2')) {
  rows.push(...processSaved(arg('notes2'), arg('manifests2', 'mic-real')))
}
const trues = rows.filter((r) => r.isTrue)
const ghosts = rows.filter((r) => !r.isTrue)
function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}
for (const [label, set] of [['TRUE', trues], ['GHOST', ghosts]]) {
  const f = set.map((r) => r.flux).sort((a, b) => a - b)
  const s = set.map((r) => r.span).sort((a, b) => a - b)
  console.log(`${label} n=${set.length} flux[min=${f[0]} p5=${quantile(f, 0.05)} p25=${quantile(f, 0.25)} med=${quantile(f, 0.5)}] span[min=${s[0]} p5=${quantile(s, 0.05)} med=${quantile(s, 0.5)}]`)
}
// Joint rule probe: low-flux AND short among TRUE (must be ~0).
for (const ft of [0.15, 0.2, 0.25]) {
  for (const st of [0.12, 0.2, 0.3]) {
    const hit = trues.filter((r) => r.flux < ft && r.span < st)
    console.log(`TRUE flux<${ft} & span<${st}: ${hit.length}/${trues.length} ${hit.slice(0, 6).map((r) => `${r.clip}:${r.midi}@${r.flux}/${r.span}`).join(' ')}`)
  }
}
// Ghost recall of the same rule.
for (const ft of [0.15, 0.2, 0.25]) {
  for (const st of [0.12, 0.2, 0.3]) {
    const hit = ghosts.filter((r) => r.flux < ft && r.span < st)
    console.log(`GHOST flux<${ft} & span<${st}: ${hit.length}/${ghosts.length} ${hit.slice(0, 8).map((r) => `${r.clip}:${r.midi}`).join(' ')}`)
  }
}

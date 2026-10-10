#!/usr/bin/env node
/**
 * R2 calibration probe: find all exact-octave co-onset pairs in scorer
 * pools and report span ratios, split by true-candidate vs ghost.
 *
 * Usage: node scripts/probe-octave-pairs.mjs --notes <saved-notes.json>
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

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
const vite = await import('vite-node/server').catch(() => null)

const NOTES_PATH = arg('notes')
if (!NOTES_PATH) {
  console.error('usage: probe-octave-pairs.mjs --notes <saved-notes.json>')
  process.exit(1)
}

// The stream/hybrid sources are ESM with no deps — load via data-URL shim:
// simplest robust path is `node --experimental-... `; instead import the
// file URLs directly (pure modules, no bare imports).
const ROOT = new URL('..', import.meta.url).href
const stream = await import(new URL('src/features/microphone-input/micNeuralStream.js', ROOT).href)
const { clips } = JSON.parse(readFileSync(NOTES_PATH, 'utf8'))

const hits = []
for (const clip of clips) {
  const state = stream.createNeuralStreamState({ windowSeconds: 0.5, hopSeconds: 0.25, edgeSuppressMs: 80, octaveOverlapRatio: 0.7 })
  const windows = [...clip.windows].sort((a, b) => a.windowStartMs - b.windowStartMs)
  const attacks = []
  for (const window of windows) {
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
  // UNION persistence per pitch across all windows (mirrors stream-track
  // lastEndMs continuity: same pitch re-heard within 120 ms continues).
  const unions = new Map()
  for (const window of windows) {
    for (const note of window.notes ?? []) {
      const midi = Math.round(note.midi)
      const s = window.windowStartMs / 1000 + (note.start ?? 0)
      const e = window.windowStartMs / 1000 + (note.end ?? note.start ?? 0)
      const u = unions.get(midi)
      if (!u) {
        unions.set(midi, { start: s, end: e })
      } else if (s - u.end < 0.12) {
        u.end = Math.max(u.end, e)
      } else {
        // True repeat: keep the LONGEST segment (ghosts never repeat).
        const prevSpan = u.end - u.start
        if (e - s > prevSpan) {
          unions.set(midi, { start: s, end: e })
        }
      }
    }
  }
  const poolNotes = [...pool.values()]
  const expected = new Set(clip.expected ?? [])
  for (const cand of poolNotes) {
    for (const other of poolNotes) {
      if (other.midi !== cand.midi - 12) {
        continue
      }
      const gap = Math.abs(other.start - cand.start)
      if (gap > 0.06) {
        continue
      }
      const cu = unions.get(cand.midi)
      const pu = unions.get(other.midi)
      const cSpan = cand.end - cand.start
      const pSpan = other.end - other.start
      const uSpan = cu ? cu.end - cu.start : null
      const uPspan = pu ? pu.end - pu.start : null
      hits.push({
        clip: clip.id,
        split: clip.split,
        cand: cand.midi,
        parent: other.midi,
        gapMs: Math.round(gap * 1000),
        cSpan: Number(cSpan.toFixed(2)),
        pSpan: Number(pSpan.toFixed(2)),
        ratio: cSpan > 0 ? Number((pSpan / cSpan).toFixed(2)) : null,
        uSpan: uSpan == null ? null : Number(uSpan.toFixed(2)),
        uPspan: uPspan == null ? null : Number(uPspan.toFixed(2)),
        uRatio: uSpan > 0 ? Number((uPspan / uSpan).toFixed(2)) : null,
        candExpected: expected.has(cand.midi),
        parentExpected: expected.has(other.midi),
        r2fires: cSpan <= 0.3 && pSpan >= 2 * cSpan && pSpan >= 0.3 && !expected.has(other.midi),
      })
    }
  }
}
const fires = hits.filter((h) => h.r2fires)
console.log(`pairs=${hits.length} r2fires=${fires.length}`)
for (const h of hits) {
  console.log(`pair ${h.clip} C=${h.cand}(exp=${h.candExpected}) P=${h.parent}(exp=${h.parentExpected}) gap=${h.gapMs}ms cSpan=${h.cSpan} pSpan=${h.pSpan} ratio=${h.ratio} UNION=${h.uSpan}/${h.uPspan}=${h.uRatio}`)
}
const trueVetoes = fires.filter((h) => h.candExpected)
console.log(`TRUE-candidate vetoes (must be 0): ${trueVetoes.length}`)
for (const h of hits.filter((h) => !h.r2fires && h.candExpected && h.ratio != null && h.ratio >= 1.5)) {
  console.log(`near-miss true: ${h.clip} C=${h.cand} P=${h.parent} cSpan=${h.cSpan} pSpan=${h.pSpan} ratio=${h.ratio}`)
}

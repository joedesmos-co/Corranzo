#!/usr/bin/env node
/**
 * Streaming pipeline end-to-end on real data (Stage 6, N2/N3) — no model.
 *
 * Replays Basic Pitch note events (tmp/basicpitch/notes.json) through
 * micNeuralStream's windowing/dedup/filters/grouping exactly as the live
 * path would (2 s windows, 1 s hop, per-window note slices as inference).
 * Measures the precision/recall tradeoff of the streaming layer vs raw
 * windowed notes, plus dedup/filter statistics.
 *
 * Usage:
 *   node scripts/mic-neural-stream-e2e.mjs [--split dev] [--json tmp/neural-stream-e2e.json]
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createNeuralStreamState,
  drainNeuralStreamEvents,
  pushNeuralStreamAudio,
  setNeuralStreamSampleRate,
} from '../src/features/microphone-input/micNeuralStream.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODEL_RATE = 22050

function main() {
  const args = process.argv.slice(2)
  const splitFilter = args.includes('--split') ? args[args.indexOf('--split') + 1] : 'all'
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', 'mic-real', 'manifest.json'), 'utf8'))
  const bp = JSON.parse(readFileSync(join(ROOT, 'tmp', 'basicpitch', 'notes.json'), 'utf8'))

  const rows = []
  const totals = { rawNotes: 0, streamed: 0, merged: 0, droppedEdge: 0, droppedShort: 0, droppedOctave: 0 }
  for (const clip of manifest.clips) {
    if (splitFilter !== 'all' && (clip.split ?? 'dev') !== splitFilter) {
      continue
    }
    const entry = bp[clip.id]
    if (!entry) {
      continue
    }
    const wavLength = Math.round(3.0 * MODEL_RATE)
    const state = createNeuralStreamState({ windowSeconds: 2.0, hopSeconds: 1.0 })
    setNeuralStreamSampleRate(state, MODEL_RATE)
    // infer(window) = ground BP notes overlapping the window, as offsets.
    const infer = ({ windowStartCaptureMs }) => {
      const windowStartSeconds = windowStartCaptureMs / 1000
      return entry.notes
        .filter((note) => note.start < windowStartSeconds + 2.0 && note.end > windowStartSeconds)
        .map((note) => ({
          midi: note.midi,
          startOffsetSeconds: note.start - windowStartSeconds,
          endOffsetSeconds: note.end - windowStartSeconds,
        }))
    }
    // Feed in 0.5 s capture chunks (as live audio would arrive).
    const chunk = Math.floor(0.5 * MODEL_RATE)
    for (let offset = 0; offset < wavLength; offset += chunk) {
      pushNeuralStreamAudio(state, {
        samples: new Float32Array(Math.min(chunk, wavLength - offset)),
        captureStartMs: (offset / MODEL_RATE) * 1000,
        infer,
      })
    }
    const events = drainNeuralStreamEvents(state)
    const anchor = clip.truth.anchorTones
    const truth = new Set(clip.truth.notes.map((n) => n.midi))
    const det = new Set(events.map((event) => event.midi))
    const anchorHit = anchor.filter((m) => det.has(m)).length
    const truthHit = [...truth].filter((m) => det.has(m)).length
    const fp = [...det].filter((m) => !truth.has(m))
    const groups = new Set(events.map((event) => event.chordGroupId)).size
    // Raw baseline: distinct BP pitches in the anchor window (no streaming).
    const raw = new Set(
      entry.notes
        .filter((n) => clip.truth.anchorOnset == null || (n.start < clip.truth.anchorOnset + 1.0 && n.end > clip.truth.anchorOnset - 0.3))
        .map((n) => n.midi),
    )
    const rawHit = anchor.filter((m) => raw.has(m)).length
    rows.push({
      id: clip.id,
      anchor,
      rawDetected: [...raw].sort((a, b) => a - b),
      streamedDetected: [...det].sort((a, b) => a - b),
      rawAnchorRecall: anchor.length ? rawHit / anchor.length : null,
      streamedAnchorRecall: anchor.length ? anchorHit / anchor.length : null,
      fp,
      groups,
    })
    totals.rawNotes += raw.size
    totals.streamed += det.size
    totals.merged += state.stats.merged
    totals.droppedEdge += state.stats.droppedEdge
    totals.droppedShort += state.stats.droppedShort
    totals.droppedOctave += state.stats.droppedOctave
    console.log(`${clip.id} raw=[${[...raw].sort((a, b) => a - b)}] streamed=[${[...det].sort((a, b) => a - b)}] fp=[${fp}] groups=${groups}`)
  }

  const agg = (fn) => {
    const relevant = rows.filter((r) => r.anchor.length)
    return relevant.length ? fn(relevant) / relevant.length : null
  }
  console.log('\n# Streaming layer tradeoff (dev shown; eval identical procedure)')
  console.log(`mean raw anchor recall:      ${agg((rs) => rs.reduce((a, r) => a + r.rawAnchorRecall, 0)).toFixed(2)}`)
  console.log(`mean streamed anchor recall: ${agg((rs) => rs.reduce((a, r) => a + r.streamedAnchorRecall, 0)).toFixed(2)}`)
  console.log(`filter stats: ${JSON.stringify(totals)}`)

  const jsonIndex = args.indexOf('--json')
  if (jsonIndex !== -1 && args[jsonIndex + 1]) {
    const outPath = join(ROOT, args[jsonIndex + 1])
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify({ rows, totals }, null, 2))
    console.log(`\nWrote ${outPath}`)
  }
}

main()

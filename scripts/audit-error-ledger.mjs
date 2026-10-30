#!/usr/bin/env node
/**
 * M1 recognition-error ledger: classify every frozen failure by pipeline
 * stage using saved benchmark windows + truth.
 *
 * Stages: model (never emits the pitch in any window) / edge (emits only
 * in windows overlapping the 80 ms edge-suppress zone) / stream-gate
 * (emitted but dropped by octave/ghost gates) / confirm (in pool but
 * never confirmed — window/timing) / false-award (unexpected completion).
 *
 * Usage: node scripts/audit-error-ledger.mjs --notes <saved.json> [--notes2 ...]
 */
import { readFileSync } from 'node:fs'

function arg(name) {
  const prefix = `--${name}`
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === prefix) {
      return process.argv[i + 1] ?? null
    }
    if (process.argv[i].startsWith(`${prefix}=`)) {
      return process.argv[i].slice(prefix.length + 1)
    }
  }
  return null
}

const files = []
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--notes' && process.argv[i + 1]) {
    files.push(process.argv[i + 1])
  }
  if (process.argv[i].startsWith('--notes=')) {
    files.push(process.argv[i].slice(8))
  }
}
if (!files.length) {
  console.error('usage: audit-error-ledger.mjs --notes <a.json> [--notes <b.json>...]')
  process.exit(1)
}

const ledger = []
for (const file of files) {
  const { clips } = JSON.parse(readFileSync(file, 'utf8'))
  for (const clip of clips) {
    const expected = new Set(clip.expected ?? [])
    const truth = new Set([
      ...(Array.isArray(clip.truthMidis) ? clip.truthMidis.map(Number) : []),
    ])
    const inWindow = new Map() // midi -> [{ windowStart, note }]
    const inPool = new Set()
    for (const window of clip.windows ?? []) {
      for (const note of window.notes ?? []) {
        const midi = Math.round(note.midi)
        if (!inWindow.has(midi)) {
          inWindow.set(midi, [])
        }
        inWindow.get(midi).push({ windowStart: window.windowStartMs / 1000, start: note.start, end: note.end })
      }
    }
    // The stream already dropped gate-killed notes; treat "in windows"
    // as model-visible, "expected & in windows" as pipeline-visible.
    for (const midi of expected) {
      const hits = inWindow.get(midi) ?? []
      if (hits.length) {
        inPool.add(midi)
      }
    }
    for (const midi of expected) {
      const hits = inWindow.get(midi) ?? []
      if (hits.length) {
        continue
      }
      ledger.push({
        clip: clip.id,
        split: clip.split,
        kind: 'miss',
        midi,
        stage: 'model',
        detail: 'never emitted in any window (model cannot hear it)',
      })
    }
    // Pool notes that are expected and emitted: any dropped by gates would
    // be invisible here (windows hold raw model output), so a miss with
    // emissions is a confirm/stage question.
    for (const midi of expected) {
      const hits = inWindow.get(midi) ?? []
      if (!hits.length) {
        continue
      }
      const spans = hits.map((h) => `${h.start.toFixed(2)}-${h.end.toFixed(2)}`)
      ledger.push({
        clip: clip.id,
        split: clip.split,
        kind: 'emitted',
        midi,
        stage: 'confirm-candidate',
        detail: `emitted in ${hits.length} window(s): ${spans.slice(0, 4).join(' ')}`,
      })
    }
    // False-award + unexpected inventory.
    const unexpected = []
    for (const [midi, hits] of inWindow) {
      if (!expected.has(midi)) {
        unexpected.push(`${midi}x${hits.length}`)
      }
    }
    if (unexpected.length) {
      ledger.push({
        clip: clip.id,
        split: clip.split,
        kind: 'unexpected',
        midi: null,
        stage: 'model-fp',
        detail: unexpected.join(' '),
      })
    }
  }
}

const misses = ledger.filter((e) => e.kind === 'miss')
const emitted = ledger.filter((e) => e.kind === 'emitted')
const unexpected = ledger.filter((e) => e.kind === 'unexpected')
console.log(`=== MISSES (model never emitted) n=${misses.length}`)
for (const m of misses) {
  console.log(` ${m.clip} [${m.split}] midi=${m.midi}`)
}
console.log(`\n=== EXPECTED NOTES THE MODEL DID EMIT (confirm-stage candidates) n=${emitted.length}`)
for (const m of emitted) {
  console.log(` ${m.clip} [${m.split}] midi=${m.midi} :: ${m.detail}`)
}
console.log(`\n=== UNEXPECTED MODEL OUTPUT (FP inventory) n=${unexpected.length}`)
for (const m of unexpected) {
  console.log(` ${m.clip} [${m.split}] :: ${m.detail}`)
}

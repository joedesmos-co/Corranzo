#!/usr/bin/env node
/**
 * Diagnostic: what are the model's false positives, and why are the durations
 * wrong? Prints the model's notes next to the truth for one recording, so the
 * pattern (harmonics, duplicates, split notes, wrong durations) can be seen
 * rather than guessed.
 *
 * Usage: node --expose-gc scripts/audio-vision-fp-dump.mjs [--source synth]
 */
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { renderReference, synthReferenceTruth } from './lib/synthReference.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { existsSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const source = argValue('--source', 'synth')

let mono
let truth
let label
if (source === 'synth') {
  mono = renderReference(22050)
  truth = synthReferenceTruth()
  label = 'synth-reference'
} else {
  const wav = readWavPcm(source)
  mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  truth = []
  label = source
}

const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
const notes = bp.notes
  .map((n) => ({
    midi: n.midi,
    start: n.startSeconds,
    end: n.endSeconds,
    dur: (n.endSeconds ?? n.startSeconds) - n.startSeconds,
    amp: n.amplitude ?? null,
  }))
  .sort((a, b) => a.start - b.start || a.midi - b.midi)

const matched = new Set()
for (const note of notes) {
  for (let i = 0; i < truth.length; i += 1) {
    if (matched.has(i)) continue
    const t = truth[i]
    if (t.midi === note.midi && Math.abs(t.onset - note.start) <= 0.12) { matched.add(i); note.truth = true; break }
  }
}

console.log(`--- ${label}: ${notes.length} model notes, ${truth.length} truth notes`)
console.log('truth:')
for (const t of truth.slice(0, 24)) {
  console.log(`  t=${t.onset.toFixed(3)} dur=${(t.offset - t.onset).toFixed(3)} midi=${t.midi} ${t.hand ?? ''}`)
}
console.log('model (M = matched truth, F = false positive):')
for (const note of notes.slice(0, 48)) {
  console.log(`  ${note.truth ? 'M' : 'F'} t=${note.start.toFixed(3)} dur=${note.dur.toFixed(3)} midi=${note.midi} amp=${note.amp == null ? '—' : note.amp.toFixed(3)}`)
}

// The duration comparison, matched pairs only.
const durations = []
for (const note of notes) {
  if (!note.truth) continue
  const t = truth.find((x) => x.midi === note.midi && Math.abs(x.onset - note.start) <= 0.12)
  if (!t) continue
  durations.push({ model: note.dur, truth: t.offset - t.onset })
}
const median = (values) => {
  const s = [...values].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
console.log('duration (model vs truth):')
console.log('  median model', median(durations.map((d) => d.model))?.toFixed(3),
  'median truth', median(durations.map((d) => d.truth))?.toFixed(3))
console.log('  ratios', durations.slice(0, 16).map((d) => (d.truth > 0 ? (d.model / d.truth).toFixed(2) : '—')).join(' '))

await closeBasicPitchNode()

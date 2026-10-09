/**
 * Real-bench annotation survey (temporary analysis helper).
 * Loads JAMS per-string annotations + MIDI truth, prints onset-cluster
 * candidates per source file for excerpt selection.
 */
import { readFileSync } from 'node:fs'
import pkg from '@tonejs/midi'
const { Midi } = pkg

const JAMS_DIRS = {
  eg: '/tmp/corranzo-realbench/egset12',
  gs: '/tmp/corranzo-realbench/guitarset/jams',
}

export function loadJamsNotes(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const notes = []
  for (const ann of data.annotations ?? []) {
    if (Array.isArray(ann.data) && String(ann.namespace ?? '').startsWith('note')) {
      for (const n of ann.data) {
        notes.push({ onset: n.time, offset: n.time + n.duration, midi: Math.round(n.value) })
      }
    }
  }
  return notes.sort((a, b) => a.onset - b.onset)
}

export function loadMidiNotes(path) {
  const midi = new Midi(readFileSync(path))
  const notes = []
  for (const track of midi.tracks ?? []) {
    for (const n of track.notes ?? []) {
      notes.push({ onset: n.time, offset: n.time + n.duration, midi: n.midi, velocity: n.velocity })
    }
  }
  return notes.sort((a, b) => a.onset - b.onset)
}

/** Cluster note onsets within `tolerance` seconds into chord events. */
export function clusterOnsets(notes, tolerance = 0.12) {
  const clusters = []
  for (const note of notes) {
    const open = clusters[clusters.length - 1]
    if (open && note.onset - open.onset <= tolerance) {
      open.tones.add(note.midi)
      open.end = Math.max(open.end, note.onset)
      open.notes.push(note)
    } else {
      clusters.push({ onset: note.onset, end: note.onset, tones: new Set([note.midi]), notes: [note] })
    }
  }
  return clusters
}

function summarize(label, notes, duration) {
  const clusters = clusterOnsets(notes)
  const sizes = clusters.map((c) => c.tones.size)
  const hist = {}
  for (const s of sizes) hist[s] = (hist[s] ?? 0) + 1
  console.log(`${label}: notes=${notes.length} dur~${duration}s clusters=${clusters.length} sizeHist=${JSON.stringify(hist)}`)
  const picks = { single: [], dyad: [], triad: [], dense: [] }
  for (const c of clusters) {
    const tones = [...c.tones].sort((a, b) => a - b)
    const entry = `${c.onset.toFixed(2)}s [${tones}]`
    // Prefer clusters isolated by 0.4s from neighbors for clean excerpts.
    if (c.tones.size === 1 && picks.single.length < 4) picks.single.push(entry)
    else if (c.tones.size === 2 && picks.dyad.length < 3) picks.dyad.push(entry)
    else if (c.tones.size === 3 && picks.triad.length < 3) picks.triad.push(entry)
    else if (c.tones.size >= 4 && picks.dense.length < 3) picks.dense.push(entry)
  }
  for (const [k, v] of Object.entries(picks)) console.log(`   ${k}: ${v.slice(0, 4).join(' | ')}`)
}

const args = process.argv.slice(2)
const only = args[0] ?? null

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const isEntrypoint = process.argv[1] != null &&
  fileURLToPath(import.meta.url) === process.argv[1]
if (!isEntrypoint) {
  // Imported as a library (annotation loaders for the excerpt builder).
} else {
if (!only || only === 'eg') {
  for (const f of readdirSync(JAMS_DIRS.eg).filter((f) => f.endsWith('.jams')).sort()) {
    const notes = loadJamsNotes(`${JAMS_DIRS.eg}/${f}`)
    summarize(`EG ${f}`, notes)
  }
}
if (!only || only === 'gs') {
  for (const f of readdirSync(JAMS_DIRS.gs).filter((f) => f.endsWith('.jams')).sort()) {
    const notes = loadJamsNotes(`${JAMS_DIRS.gs}/${f}`)
    summarize(`GS ${f}`, notes)
  }
}
if (!only || only === 'vn') {
  for (const f of ['Mozart_K331_1st-mov_p01.mid', 'Schubert_D783_no15_p01.mid']) {
    const notes = loadMidiNotes(`/tmp/corranzo-realbench/vienna/midi/${f}`)
    summarize(`VN ${f}`, notes)
  }
}
if (!only || only === 'gt') {
  const notes = loadMidiNotes('/tmp/corranzo-realbench/gtechs/midi_allsinglenotes.mid')
  summarize('GT allsinglenotes', notes)
  const vel = notes.map((n) => n.velocity ?? 0).sort((a, b) => a - b)
  console.log(`   velocity min=${vel[0]?.toFixed(2)} p10=${vel[Math.floor(vel.length * 0.1)]?.toFixed(2)} max=${vel[vel.length - 1]?.toFixed(2)}`)
}
}

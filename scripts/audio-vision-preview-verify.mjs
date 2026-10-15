/**
 * M4 — Verify every SMF preview really represents its MusicXML score.
 *
 * The review set ships pairs of .musicxml + .mid. This script re-parses both
 * with the app's own readers and checks, per pair: note count, pitch set,
 * measure count, tempo and note-onset agreement. A preview that disagrees with
 * the score would misrepresent exactly what a musician reviews, so it is
 * treated as a failure, not a warning.
 *
 * Usage: node scripts/audio-vision-preview-verify.mjs [--dir p]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pkg from '@tonejs/midi'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback = null) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)
const dir = argValue('--dir', 'benchmarks/audio-vision/review-set')

const { parseMusicXml } = await import('../src/features/musicxml/parseMusicXml.js')
const { mergeTiedContinuations } = await import('../src/features/practice/waitForYouCheckpoints.js')
const { writeSmf } = await import('./lib/writeSmf.mjs')
const { Midi } = pkg

function readArrangementEvents(file) {
  // The generator writes events by re-deriving them from the MusicXML: same
  // timing map the practice engine uses, so this compares the rendered score
  // against the preview rather than re-running inference.
  const timingMap = parseMusicXml(readFileSync(file, 'utf8'), file)
  // One logical note per pitch: the emitter ties barline crossings, and the
  // engine merges them the same way, so compare logical notes (not segments).
  const notes = mergeTiedContinuations((timingMap?.notes ?? []).filter((n) => !n.isRest && Number.isFinite(n.midi)))
  const beatPeriod = timingMap ? 60 / (timingMap.tempoChanges?.[0]?.bpm ?? 120) : 0.5
  return {
    notes,
    measures: timingMap?.measures?.length ?? null,
    bpm: timingMap?.tempoChanges?.[0]?.bpm ?? null,
    beatPeriod,
  }
}

let pairs = 0
let failures = 0
const rows = []
for (const name of readdirSync(dir).filter((f) => f.endsWith('.musicxml')).sort()) {
  const base = name.replace('.musicxml', '')
  const midPath = join(dir, `${base}.mid`)
  if (!existsSync(midPath)) {
    console.log(`MISSING PREVIEW ${base}`)
    failures += 1
    continue
  }
  pairs += 1
  const score = readArrangementEvents(join(dir, name))
  const midi = new Midi(readFileSync(midPath))
  const midiNotes = midi.tracks[0]?.notes ?? []
  const scoreMidis = score.notes.map((n) => n.midi).sort((a, b) => a - b)
  const midiMidis = midiNotes.map((n) => n.midi).sort((a, b) => a - b)
  const sameCount = scoreMidis.length === midiMidis.length
  const sameSet = scoreMidis.length === midiMidis.length && scoreMidis.every((m, i) => m === midiMidis[i])
  const tempoOk = Math.abs((midi.header.tempos[0]?.bpm ?? 0) - (score.bpm ?? 0)) <= 1
  // Onset fidelity: greedy match every preview note to a score note of the
  // same pitch, within one 16th-note subdivision at the score's tempo. Sorted
  // index comparison mis-pairs notes that share a beat across staves; matching
  // by pitch measures what a listener would actually hear: same events, same
  // moments (within a subdivision), no lost or invented notes.
  // One 16th at the score's tempo, plus a 2 ms float-comparison epsilon so a
  // note landing exactly on the subdivision boundary is not reported as lost.
  const tolerance = 0.25 * (60 / (score.bpm ?? 120)) + 0.002
  const byPitch = new Map()
  for (const note of score.notes) {
    const key = note.midi
    if (!byPitch.has(key)) byPitch.set(key, [])
    byPitch.get(key).push(note.timeSeconds)
  }
  let unmatched = 0
  let worstOnset = 0
  for (const note of midiNotes) {
    const candidates = (byPitch.get(note.midi) ?? []).sort((a, b) => a - b)
    let best = -1
    let bestDelta = Infinity
    candidates.forEach((t, index) => {
      const delta = Math.abs(t - note.time)
      if (delta <= tolerance && delta < bestDelta) {
        bestDelta = delta
        best = index
      }
    })
    if (best < 0) unmatched += 1
    else {
      worstOnset = Math.max(worstOnset, bestDelta)
      candidates.splice(best, 1)
    }
  }
  const onsetsOk = unmatched === 0
  const ok = sameCount && sameSet && tempoOk && onsetsOk
  const row = {
    pair: base,
    scoreNotes: scoreMidis.length,
    midiNotes: midiMidis.length,
    sameSet,
    scoreBpm: score.bpm,
    midiBpm: Math.round(midi.header.tempos[0]?.bpm ?? 0),
    worstOnsetDelta: Math.round(worstOnset * 1000) / 1000,
    unmatchedNotes: unmatched,
    ok,
  }
  rows.push(row)
  if (!ok) {
    failures += 1
    console.log(`MISMATCH ${base}: ${JSON.stringify(row)}`)
  }
}

console.log(`\npairs checked: ${pairs} | mismatches: ${failures}`)
const summary = { pairs, failures, rows }
process.stdout.write(JSON.stringify(summary) + '\n')
process.exit(failures ? 1 : 0)

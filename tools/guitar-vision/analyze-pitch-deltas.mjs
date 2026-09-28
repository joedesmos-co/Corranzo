#!/usr/bin/env node
/**
 * Guitar Vision — Phase 0 pitch-delta forensics.
 *
 * Aligns generated MusicXML against ground truth measure by measure and reports
 * the distribution of semitone deltas. Answers one question: is pitch failure a
 * *systematic offset* (fixable geometry bug) or *unstructured noise* (needs a
 * real model)?
 *
 * Usage:
 *   node tools/guitar-vision/analyze-pitch-deltas.mjs \
 *     --generated gen.musicxml --truth truth.musicxml
 */
import { readFileSync } from 'node:fs'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'

function argValue(args, flag, fallback = null) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : fallback
}

const TECHNIQUE_FAMILIES = [
  'hammer-on',
  'pull-off',
  'bend',
  'vibrato',
  'slide',
  'pre-bend',
  'bend-release',
  'harmonic',
  'artificial-harmonic',
  'pinch-harmonic',
  'tapping',
  'palm-mute',
  'let-ring',
  'dead-note',
  'ghost-note',
  'tremolo-picking',
  'natural-harmonic',
]

function load(path) {
  return parseMusicXml(readFileSync(path, 'utf8'), path)
}

function pitchNotes(doc) {
  return (doc.notes ?? []).filter((note) => !note.isRest && Number.isFinite(note.midi))
}

const args = process.argv.slice(2)
const generatedPath = argValue(args, '--generated')
const truthPath = argValue(args, '--truth')
if (!generatedPath || !truthPath) {
  console.error('usage: --generated <musicxml> --truth <musicxml>')
  process.exit(1)
}

const generated = load(generatedPath)
const truth = load(truthPath)
const genNotes = pitchNotes(generated)
const truthNotes = pitchNotes(truth)

// Part ids differ between generated and truth (generated uses P1, imported
// scores use a content hash), so pair parts positionally rather than by id.
const partOrder = (doc) => {
  const ids = [...new Set((doc.notes ?? []).map((note) => note.partId))]
  return new Map(ids.map((id, index) => [id, index]))
}
const genPartIndex = partOrder(generated)
const truthPartIndex = partOrder(truth)
const key = (note, index) => `${index}:${note.measureNumber}`
const group = (notes, index) => {
  const map = new Map()
  for (const note of notes) {
    const id = key(note, index.get(note.partId) ?? 0)
    if (!map.has(id)) map.set(id, [])
    map.get(id).push(note)
  }
  for (const list of map.values()) {
    list.sort((left, right) => left.quarterTime - right.quarterTime || left.midi - right.midi)
  }
  return map
}
const genByMeasure = group(genNotes, genPartIndex)
const truthByMeasure = group(truthNotes, truthPartIndex)

const deltaCounts = new Map()
let compared = 0
let exact = 0
let withinTwo = 0
let withinOctave = 0

for (const [id, tNotes] of truthByMeasure) {
  const gNotes = genByMeasure.get(id) ?? []
  const width = Math.min(tNotes.length, gNotes.length)
  for (let index = 0; index < width; index += 1) {
    compared += 1
    const delta = gNotes[index].midi - tNotes[index].midi
    deltaCounts.set(delta, (deltaCounts.get(delta) ?? 0) + 1)
    if (delta === 0) exact += 1
    if (Math.abs(delta) <= 2) withinTwo += 1
    if (Math.abs(delta) <= 12) withinOctave += 1
  }
}

const pct = (n) => (compared ? ((n / compared) * 100).toFixed(1) : '0.0')
console.log(`truth notes        ${truthNotes.length}`)
console.log(`generated notes    ${genNotes.length}`)
console.log(`index-paired       ${compared}`)
console.log(`exact pitch        ${exact}  (${pct(exact)}%)`)
console.log(`within 2 semitones ${withinTwo}  (${pct(withinTwo)}%)`)
console.log(`within 1 octave    ${withinOctave}  (${pct(withinOctave)}%)`)
console.log('')
console.log('semitone delta distribution (generated - truth), index-paired:')
const sorted = [...deltaCounts.entries()].sort((a, b) => b[1] - a[1])
for (const [delta, count] of sorted.slice(0, 18)) {
  const share = (count / compared) * 100
  const bar = '#'.repeat(Math.max(1, Math.round(share)))
  console.log(`  ${String(delta).padStart(4)} : ${String(count).padStart(5)}  ${String(share.toFixed(1)).padStart(5)}%  ${bar}`)
}

const techniqueCounts = (doc) => {
  const counts = Object.fromEntries(TECHNIQUE_FAMILIES.map((name) => [name, 0]))
  for (const note of doc.notes ?? []) {
    for (const technique of note.guitarTechniques ?? []) {
      if (technique.kind in counts) counts[technique.kind] += 1
    }
  }
  return counts
}
const genTech = techniqueCounts(generated)
const truthTech = techniqueCounts(truth)
console.log('')
console.log('technique marking counts (parsed from MusicXML):')
console.log(`  ${'family'.padEnd(20)}${'truth'.padStart(8)}${'generated'.padStart(12)}`)
for (const family of TECHNIQUE_FAMILIES) {
  console.log(`  ${family.padEnd(20)}${String(truthTech[family]).padStart(8)}${String(genTech[family]).padStart(12)}`)
}

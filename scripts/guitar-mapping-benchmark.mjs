#!/usr/bin/env node
/**
 * Guitar mapping-quality benchmark (independent of semantic OMR evaluator).
 *
 * Usage:
 *   node scripts/guitar-mapping-benchmark.mjs --label before --json tmp/out.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getInstrument } from '../src/features/instruments/instruments.js'
import { deriveTabPositions } from '../src/features/instruments/fretboard.js'
import { evaluateGuitarMapping } from '../src/features/instruments/guitarMappingQuality.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GUITAR = getInstrument('guitar').strings

const FIXTURES = [
  'guitar-standard-chords-vector',
  'guitar-paired-chords-vector',
  'guitar-techniques-paired-vector',
  'guitar-tab-sparse-vector',
]

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function stripFrets(notes) {
  return (notes ?? [])
    .filter((note) => !note.isTabMirror)
    .map((note) => {
      const { string, fret, ...rest } = note
      return { ...rest }
    })
}

function summarize(metrics) {
  return {
    events: metrics.eventCount,
    notes: metrics.noteCount,
    invalidAssignments: metrics.invalidAssignments,
    sameStringConflicts: metrics.sameStringConflicts,
    impossibleChords: metrics.impossibleChords,
    overMaxFret: metrics.overMaxFret,
    avgJump: metrics.avgJump,
    p95Jump: metrics.p95Jump,
    maxJump: metrics.maxJump,
    avgSpan: metrics.avgSpan,
    maxSpan: metrics.maxSpan,
    repeatedNoteSameStringPct: metrics.repeatedNoteSameStringPct,
    failureCounts: metrics.failureCounts,
  }
}

function runFixture(id) {
  const truthPath = join(ROOT, `benchmarks/omr-fixtures/${id}/${id}.musicxml`)
  const truth = parseMusicXml(readFileSync(truthPath, 'utf8'), `${id}.musicxml`)
  let omr = null
  for (const candidate of [
    join(ROOT, `tmp/guitar-pitch-sprint-1/${id}.after.omr.musicxml`),
    join(ROOT, `tmp/guitar-mapping-sprint-1/${id}.omr.musicxml`),
  ]) {
    try {
      omr = parseMusicXml(readFileSync(candidate, 'utf8'), `${id}.omr.musicxml`)
      break
    } catch {
      // optional
    }
  }

  const truthDerivedNotes = deriveTabPositions(stripFrets(truth.notes), GUITAR)
  const truthDerived = evaluateGuitarMapping(truthDerivedNotes, GUITAR)
  const result = {
    id,
    truthDerived: summarize(truthDerived),
    omrAsEmitted: null,
    omrDerivedFromMidi: null,
  }
  if (omr) {
    const emitted = omr.notes.filter((note) => !note.isTabMirror && !note.isRest)
    result.omrAsEmitted = summarize(evaluateGuitarMapping(emitted, GUITAR))
    result.omrDerivedFromMidi = summarize(
      evaluateGuitarMapping(deriveTabPositions(stripFrets(omr.notes), GUITAR), GUITAR),
    )
  }
  return result
}

function main() {
  const args = process.argv.slice(2)
  const label = argValue(args, '--label') ?? 'run'
  const jsonPath = argValue(args, '--json')
  const fixtures = FIXTURES.map(runFixture)
  const payload = {
    kind: 'guitar-mapping-benchmark',
    label,
    createdAt: new Date().toISOString(),
    stage1PitchFrozen: true,
    fixtures,
  }
  const text = [
    `Guitar mapping benchmark — ${label}`,
    ...fixtures.map((fixture) => {
      const row = fixture.truthDerived
      return (
        `- ${fixture.id}: invalid=${row.invalidAssignments} sameString=${row.sameStringConflicts} ` +
        `impossible=${row.impossibleChords} avgJump=${row.avgJump?.toFixed?.(3) ?? row.avgJump} ` +
        `p95=${row.p95Jump} maxSpan=${row.maxSpan} repeatRetain=${row.repeatedNoteSameStringPct?.toFixed?.(1) ?? row.repeatedNoteSameStringPct}%`
      )
    }),
  ].join('\n')
  console.log(text)
  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`)
  }
}

main()

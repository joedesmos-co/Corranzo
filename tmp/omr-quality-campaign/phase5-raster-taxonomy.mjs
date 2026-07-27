#!/usr/bin/env node
/**
 * Phase 5 — rebuild raster-source defect taxonomy for piano-articulation-scan
 * (0 PDF text glyphs → raster path). Classify defects without changing production.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { normalizeSemanticNotes } from '../../src/features/omr/semanticMusicXmlEvaluator.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ATTEMPT = join(ROOT, 'tmp/omr-quality-campaign/attempts/phase1-primary-beam')
const TRUTH = join(
  ROOT,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml',
)

const report = JSON.parse(
  await readFile(join(ATTEMPT, 'reports/piano-articulation-scan.json'), 'utf8'),
)
const truthXml = await readFile(TRUTH, 'utf8')
const generatedXml = await readFile(
  join(ATTEMPT, 'generated/piano-articulation-scan.musicxml'),
  'utf8',
)
const truthNotes = normalizeSemanticNotes(parseMusicXml(truthXml, 't'), {
  includeRests: true,
})
const generatedNotes = normalizeSemanticNotes(parseMusicXml(generatedXml, 'g'), {
  includeRests: true,
})

const byCode = new Map()
const byMeasure = new Map()
for (const measure of report.measures ?? []) {
  for (const defect of measure.defects ?? []) {
    byCode.set(defect.code, (byCode.get(defect.code) ?? 0) + 1)
    const key = String(measure.measureNumber)
    if (!byMeasure.has(key)) byMeasure.set(key, [])
    byMeasure.get(key).push(defect.code)
  }
}

console.log('TOTAL defects', [...byCode.values()].reduce((a, b) => a + b, 0))
console.log('BY CODE', JSON.stringify(Object.fromEntries([...byCode].sort((a, b) => b[1] - a[1]))))

// Pitch/register: incorrect-pitch + missing/extra that are octave or neighbor
let pitchRegister = 0
let articulation = 0
let rhythmDuration = 0
let chordLabel = 0
let sustain = 0
let structure = 0
let other = 0

for (const [code, count] of byCode) {
  if (['incorrect-pitch'].includes(code)) pitchRegister += count
  else if (['missing-staccato', 'missing-accent', 'missing-tenuto', 'missing-marcato'].includes(code))
    articulation += count
  else if (['duration-mismatch', 'onset-mismatch', 'missing-dot', 'dotted-rhythm-error'].includes(code))
    rhythmDuration += count
  else if (code === 'incorrect-chord') chordLabel += count
  else if (['missing-tie', 'incorrect-tie', 'tie-vs-slur-confusion'].includes(code)) sustain += count
  else if (['missing-note', 'extra-note', 'missing-measure', 'extra-measure', 'merged-measure', 'split-measure', 'volta-mismatch', 'tempo-mismatch'].includes(code))
    structure += count
  else other += count
}

console.log('\nTAXONOMY BUCKETS')
console.log(JSON.stringify({ pitchRegister, articulation, rhythmDuration, chordLabel, sustain, structure, other }, null, 2))

// Note inventory stability
const truthSounding = truthNotes.filter((n) => !n.isRest)
const genSounding = generatedNotes.filter((n) => !n.isRest)
console.log('\nNOTE INVENTORY truth=', truthSounding.length, 'generated=', genSounding.length)

// Articulation TP preservation check from report classes if present
console.log('\nclass scores', JSON.stringify(report.classes ?? report.summary?.classes ?? null, null, 2)?.slice(0, 800))

// Per-measure top offenders
console.log('\nPER MEASURE')
for (const [m, codes] of [...byMeasure].sort((a, b) => a[0] - b[0])) {
  const counts = {}
  for (const c of codes) counts[c] = (counts[c] ?? 0) + 1
  console.log('m' + m, JSON.stringify(counts))
}

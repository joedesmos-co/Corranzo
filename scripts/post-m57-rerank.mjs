#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DENSE_PATH = join(ROOT, 'tmp/omr-benchmark-dashboard/fixtures/dense.json')
const CLEAN_PATH = join(ROOT, 'tmp/omr-benchmark-dashboard/fixtures/clean.json')
const OUT_JSON = join(ROOT, 'tmp/omr-benchmark-dashboard/post-m57-rerank.json')
const OUT_MD = join(ROOT, 'tmp/omr-benchmark-dashboard/post-m57-rerank.md')

function countByMeasure(entries) {
  const map = new Map()
  for (const entry of entries) {
    map.set(entry.measureNumber, (map.get(entry.measureNumber) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([measureNumber, count]) => ({ m: measureNumber, count }))
}

function countPattern(entries, keyFn) {
  const map = new Map()
  for (const entry of entries) {
    const key = keyFn(entry)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([key, count]) => ({ pattern: key, count }))
}

function pageForMeasure(m) {
  if (m <= 16) return 1
  if (m <= 32) return 2
  if (m <= 48) return 3
  if (m <= 64) return 4
  if (m <= 80) return 5
  if (m <= 96) return 6
  if (m <= 112) return 7
  return 8
}

const dense = JSON.parse(readFileSync(DENSE_PATH, 'utf8'))
const clean = JSON.parse(readFileSync(CLEAN_PATH, 'utf8'))
const perMeasure = dense.perMeasure ?? []
const debug = dense.debug ?? {}
const wrongDurations = debug.wrongDurations ?? []
const missingNotes = debug.missingNotes ?? []
const extraNotes = debug.extraNotes ?? []

const pitchAtCorrectOnsetCount =
  (dense.totals.onsetCorrectMatchedCount ?? 0) - (dense.totals.pitchCorrectAtCorrectOnsetCount ?? 0)
const pitchOnsetCoupledCount = (dense.totals.wrongPitchCount ?? 0) - pitchAtCorrectOnsetCount
const durAtCorrectOnsetPitch = wrongDurations.filter(
  (entry) =>
    Math.abs(entry.onsetDiffQuarters ?? 0) < 0.08 && (entry.pitchDeltaSemitones ?? 0) === 0,
)
const durOnsetCoupled = wrongDurations.filter(
  (entry) => Math.abs(entry.onsetDiffQuarters ?? 0) >= 0.08,
)

const q1toHalf = durAtCorrectOnsetPitch.filter(
  (entry) =>
    Math.abs((entry.truth?.durationQuarters ?? 0) - 1) < 0.01 &&
    Math.abs((entry.generated?.durationQuarters ?? 0) - 0.5) < 0.01,
)

const chordHotspots = perMeasure
  .filter((measure) => measure.chordMismatchCount > 0)
  .map((measure) => ({
    m: measure.measureNumber,
    page: measure.page ?? pageForMeasure(measure.measureNumber),
    chord: measure.chordMismatchCount,
    pitch: measure.wrongPitchCount,
    onset: measure.wrongOnsetCount,
    dur: measure.wrongDurationCount,
    missing: measure.missingNoteCount,
    extra: measure.extraNoteCount,
    pure:
      measure.wrongPitchCount === 0 &&
      measure.wrongOnsetCount === 0 &&
      measure.wrongDurationCount === 0 &&
      measure.missingNoteCount === 0 &&
      measure.extraNoteCount === 0,
  }))
  .sort((left, right) => right.chord - left.chord)

const page8Measures = perMeasure.filter((measure) => measure.measureNumber >= 119)
const page8 = page8Measures.reduce(
  (acc, measure) => ({
    pitch: acc.pitch + measure.wrongPitchCount,
    onset: acc.onset + measure.wrongOnsetCount,
    chord: acc.chord + measure.chordMismatchCount,
    missing: acc.missing + measure.missingNoteCount,
    dur: acc.dur + measure.wrongDurationCount,
  }),
  { pitch: 0, onset: 0, chord: 0, missing: 0, dur: 0 },
)

const payload = {
  generatedAt: new Date().toISOString(),
  context: 'post-m57 opening lead-note merge runtime (minStackNotes=3)',
  baseline: {
    dense: dense.totals,
    clean: clean.totals,
  },
  shipped: {
    m57: { chordDelta: -6, before: 6, after: 0 },
    m113: { chord: 0 },
    globalChord: { before: 189, after: 183 },
  },
  decoupledRerank: [
    { rank: 1, bucket: 'wrongPitch @ correct onset', count: pitchAtCorrectOnsetCount },
    { rank: 2, bucket: 'wrongDuration @ correct onset+pitch', count: durAtCorrectOnsetPitch.length },
    { rank: 3, bucket: 'chordMismatch (raw total)', count: dense.totals.chordMismatchCount },
    { rank: 4, bucket: 'missingNotes', count: dense.totals.missingNoteCount },
    { rank: 5, bucket: 'extraNotes', count: dense.totals.extraNoteCount },
    { rank: 6, bucket: 'wrongPitch onset-coupled', count: pitchOnsetCoupledCount },
    { rank: 7, bucket: 'wrongOnset (raw total)', count: dense.totals.wrongOnsetCount },
    { rank: 8, bucket: 'wrongDuration onset-coupled', count: durOnsetCoupled.length },
  ],
  pitchAtCorrectOnsetCount,
  pitchOnsetCoupledCount,
  durIndependentHot: countByMeasure(durAtCorrectOnsetPitch),
  durationPatternsIndependent: countPattern(
    durAtCorrectOnsetPitch,
    (entry) => `${entry.truth?.durationQuarters}->${entry.generated?.durationQuarters}`,
  ),
  q1toHalfIndependent: {
    count: q1toHalf.length,
    byMeasure: countByMeasure(q1toHalf),
  },
  chordHotspots: chordHotspots.slice(0, 15),
  pureChordHotspots: chordHotspots.filter((entry) => entry.pure).slice(0, 10),
  missingHotspots: countByMeasure(missingNotes),
  extraHotspots: countByMeasure(extraNotes),
  m7MissingCount: missingNotes.filter((entry) => entry.measureNumber === 7).length,
  page8,
}

writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`)

const pureChord = chordHotspots.filter((entry) => entry.pure)
const md = `# OMR error rerank (post-m57)

Baseline: chord **${dense.totals.chordMismatchCount}**, pitch **${dense.totals.wrongPitchCount}**, duration **${dense.totals.wrongDurationCount}**, onset **${dense.totals.wrongOnsetCount}**

## Decoupled rerank

| Rank | Bucket | Count |
|-----:|--------|------:|
| 1 | wrongPitch @ correct onset | ${pitchAtCorrectOnsetCount} |
| 2 | wrongDuration @ correct onset+pitch | ${durAtCorrectOnsetPitch.length} |
| 3 | chordMismatch raw | ${dense.totals.chordMismatchCount} |
| 4 | missingNotes | ${dense.totals.missingNoteCount} |
| 5 | extraNotes | ${dense.totals.extraNoteCount} |
| 6 | wrongPitch onset-coupled | ${pitchOnsetCoupledCount} |
| 7 | wrongOnset raw | ${dense.totals.wrongOnsetCount} |
| 8 | wrongDuration onset-coupled | ${durOnsetCoupled.length} |

## Pure chord hotspots (no pitch/onset/dur/miss/extra)

| m | page | chord |
|--:|:----:|------:|
${pureChord
  .slice(0, 10)
  .map((row) => `| ${row.m} | ${row.page} | ${row.chord} |`)
  .join('\n')}

## Top entangled chord hotspots

| m | page | chord | pitch | onset | dur | miss | extra |
|--:|:----:|------:|------:|------:|----:|-----:|------:|
${chordHotspots
  .slice(0, 12)
  .map(
    (row) =>
      `| ${row.m} | ${row.page} | ${row.chord} | ${row.pitch} | ${row.onset} | ${row.dur} | ${row.missing} | ${row.extra} |`,
  )
  .join('\n')}

## Duration @ correct onset+pitch

Independent count: **${durAtCorrectOnsetPitch.length}** (onset-coupled: ${durOnsetCoupled.length})
Top pattern 1q→0.5q: **${q1toHalf.length}**

| m | count |
|--:|------:|
${countByMeasure(q1toHalf)
  .slice(0, 6)
  .map((row) => `| ${row.m} | ${row.count} |`)
  .join('\n')}

## Pitch @ correct onset hotspots

| m | page | count |
|--:|:----:|------:|
${perMeasure
  .filter((measure) => measure.wrongPitchCount > 0)
  .sort((left, right) => right.wrongPitchCount - left.wrongPitchCount)
  .slice(0, 12)
  .map((row) => `| ${row.measureNumber} | ${row.page ?? pageForMeasure(row.measureNumber)} | ${row.wrongPitchCount} |`)
  .join('\n')}

Page 8 (m119–125): pitch **${page8.pitch}**, onset **${page8.onset}**, chord **${page8.chord}**, dur **${page8.dur}**

## Missing / extra hotspots

| m | missing | extra |
|--:|--------:|------:|
${[...new Set([...countByMeasure(missingNotes).map((r) => r.m), ...countByMeasure(extraNotes).map((r) => r.m)])]
  .slice(0, 8)
  .map((m) => {
    const miss = missingNotes.filter((e) => e.measureNumber === m).length
    const extra = extraNotes.filter((e) => e.measureNumber === m).length
    return `| ${m} | ${miss} | ${extra} |`
  })
  .join('\n')}

## Closed

- **m57**: fixed opening lead-note merge minStack 3 (−6 chord)
- **m113**: fixed opening lead-note merge (−12 chord prior)
- **m33**: fixed inner-voice phase
- **m25**: phantom stack realign (−20 chord partial)

---

## Recommendation: **m94 terminal phantom/stack chord grouping (Family B end-of-measure)**

**Single safest next target** — highest pure-chord isolation after m57 closure.

### Why m94 (not m61 / m70 / page-8 pitch / m7 missing)

| Candidate | Chord | Isolation | Mechanism (diagnosed) | Simulation |
|-----------|------:|-----------|----------------------|------------|
| **m94** | 8 | **pure** (0 pitch/onset/dur/miss/extra) | Terminal phantom @2.25q + stack splits @2.5–3.5q — **not** opening lead | Needs harness (phantom drop/shift at terminal beats) |
| m61 | 26 | entangled (3 miss, 3 extra) | Sixteenth solo/stack alternation | — |
| m7 | 20 | entangled (11 miss, 3 extra) | Column sparsity / extraction loss | — |
| m70 | 8 | entangled (3 onset, 6 dur) | 1q→0.5q duration + onset coupling | — |
| Page 8 pitch | 81 | cluster | Staff-gap register residue | — |
| m27/m88 | 4 each | pure-ish (0 pitch, small onset) | Likely onset-coupled chord residue | Lower impact |

### m94 diagnosis (from \`post-m113-candidate-diagnosis.json\`)

| Beat | Truth | Generated | Issue |
|-----:|------:|----------:|-------|
| 2.25 | 0 | 1 | Phantom solo column |
| 2.5 | 1 | 2 | Stack over-count |
| 3.0 | 2 | 4 | Stack merge/split |
| 3.5 | 4 | 0 | Missing terminal stack |

Column layout: dense stacks through 1.75q, then fragmenting phantom/split columns at **2.25–3.25q** — same **Family B phantom-column** class as m25/m29/m89 but at **measure terminal** not opening.

Opening lead-note merge (shipped m57/m113) **does not touch m94** (confirmed in merge3 probe: m94 chord stays 8).

### Next step (diagnosis + simulation only)

1. Extend \`simulate-phantom-columns.mjs\` funnel for m94 terminal signature (phantom @ ≥2.25q, linked stack shift or drop).
2. Simulate **drop phantom** / **shift terminal stack** variants under benchmark gate.
3. Promote only if chord 183→~175, m94 8→0, clean 100%, controls m25/m29/m89/m57 unchanged.

**Do not** broaden opening merge or inner-voice rules for m94.

---

Machine-readable: \`tmp/omr-benchmark-dashboard/post-m57-rerank.json\`
`

writeFileSync(OUT_MD, md)
console.log(`Wrote ${OUT_JSON}`)
console.log(`Wrote ${OUT_MD}`)

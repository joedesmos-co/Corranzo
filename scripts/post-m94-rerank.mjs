#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DENSE_PATH = join(ROOT, 'tmp/omr-benchmark-dashboard/fixtures/dense.json')
const CLEAN_PATH = join(ROOT, 'tmp/omr-benchmark-dashboard/fixtures/clean.json')
const OUT_JSON = join(ROOT, 'tmp/omr-benchmark-dashboard/post-m94-rerank.json')
const OUT_MD = join(ROOT, 'tmp/omr-benchmark-dashboard/post-m94-rerank.md')

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
const chordGroupMismatches = debug.chordGroupMismatches ?? []

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

const pureChord = chordHotspots.filter((entry) => entry.pure)

const payload = {
  generatedAt: new Date().toISOString(),
  context: 'post-m94 terminal early column correction runtime',
  baseline: { dense: dense.totals, clean: clean.totals },
  shipped: {
    m94: { chordDelta: -8, before: 8, after: 0 },
    globalChord: { before: 183, after: 175 },
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
  pureChordHotspots: pureChord,
  chordHotspots: chordHotspots.slice(0, 15),
  nearPureChord: chordHotspots.filter(
    (entry) =>
      entry.pitch === 0 &&
      entry.missing === 0 &&
      entry.extra === 0 &&
      entry.dur === 0 &&
      entry.onset > 0 &&
      entry.onset <= 2,
  ),
  page8,
  recommendation: 'stop-no-safe-isolated-target',
}

writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`)

const md = `# OMR error rerank (post-m94)

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

## Pure chord hotspots

${pureChord.length ? '| m | page | chord |\n|--:|:----:|------:|\n' + pureChord.map((r) => `| ${r.m} | ${r.page} | ${r.chord} |`).join('\n') : '_None remaining._'}

Family B opening/terminal phantom sprint lane is **closed** (m57, m113, m94 all fixed).

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

## Near-pure chord (onset-only coupling ≤2)

| m | page | chord | onset |
|--:|:----:|------:|------:|
${payload.nearPureChord
  .map((row) => `| ${row.m} | ${row.page} | ${row.chord} | ${row.onset} |`)
  .join('\n')}

## Duration @ correct onset+pitch

Independent count: **${durAtCorrectOnsetPitch.length}** · 1q→0.5q: **${q1toHalf.length}**

| m | count |
|--:|------:|
${countByMeasure(q1toHalf)
  .slice(0, 6)
  .map((row) => `| ${row.m} | ${row.count} |`)
  .join('\n')}

## Pitch @ correct onset (top)

| m | page | count |
|--:|:----:|------:|
${perMeasure
  .filter((m) => m.wrongPitchCount > 0)
  .sort((a, b) => b.wrongPitchCount - a.wrongPitchCount)
  .slice(0, 10)
  .map((row) => `| ${row.measureNumber} | ${row.page ?? pageForMeasure(row.measureNumber)} | ${row.wrongPitchCount} |`)
  .join('\n')}

Page 8 (m119–125): pitch **${page8.pitch}**, onset **${page8.onset}**, chord **${page8.chord}**

## Missing / extra

| m | missing | extra |
|--:|--------:|------:|
${[...new Set([...countByMeasure(missingNotes).map((r) => r.m), ...countByMeasure(extraNotes).map((r) => r.m)])]
  .slice(0, 6)
  .map((m) => {
    const miss = missingNotes.filter((e) => e.measureNumber === m).length
    const extra = extraNotes.filter((e) => e.measureNumber === m).length
    return `| ${m} | ${miss} | ${extra} |`
  })
  .join('\n')}

## Closed (shipped)

- m33 inner-voice phase
- m25/m29/m89 mid-measure phantom stack realign
- m113/m57 opening lead-note merge
- m94 terminal early column forward shift

---

## Recommendation: **STOP — no safe isolated precision target**

The narrow phantom/opening-chord promotion lane has no remaining **pure** hotspots and no **simulation-backed** narrow fix ready to promote.

### Why stop (not m61 / m27 / page-8)

| Candidate | Chord | Isolation | Why not next |
|-----------|------:|-----------|--------------|
| **(none pure)** | — | — | Zero pure-chord measures remain |
| m61 | 26 | **entangled** (3 miss, 3 extra) | Sixteenth solo/stack alternation — different rule family; prior inner-voice narrow slice intentionally skipped |
| m97 | 16 | entangled (2 pitch, 1 onset) | Same alternation class as m61 |
| m27 / m88 | 6 / 4 | near-pure (1–2 onset) | Phantom-like splits but **onset-coupled**; no passing simulation; broadening terminal signature risks m29/m89 |
| m25 residual | 4 | onset-coupled (2) | Phantom remove/merge simulations **failed** earlier; only stack-shift shipped |
| m7 | 20 | entangled (11 miss) | Extraction/column sparsity — no narrow runtime fix |
| m70 | 8 | entangled (6 dur, 3 onset) | Duration + onset coupling |
| Page 8 pitch | 81 | cluster | Register/staff-gap residue across m119–125 — not one-measure promotion |

### What improved this sprint arc

| Stage | Chord | Pure hotspot closed |
|-------|------:|-------------------|
| Post inner-voice | 221 | m33 |
| Post phantom | 201 | m25 partial |
| Post opening merge | 183 | m57, m113 |
| **Post m94 terminal** | **175** | **m94** |

Remaining chord errors are **entangled** with onset, pitch, missing/extra, or duration. Further gains require a **different bucket** (pitch register, extraction, or measure-local diagnosis with new simulation harnesses) — not another broad phantom heuristic.

### If resuming OMR later (diagnosis-only, not promotion)

1. **m27/m88** — trace whether mid-measure phantom split resembles m94; build measure-local simulation before any runtime.
2. **Page 8 pitch** — staff-gap / register funnel (81 errors).
3. **m61** — only after dedicated alternation diagnosis (miss/extra entangled).

**No code changes recommended this turn.**

---

Machine-readable: \`tmp/omr-benchmark-dashboard/post-m94-rerank.json\`
`

writeFileSync(OUT_MD, md)
console.log(`Wrote ${OUT_JSON}`)
console.log(`Wrote ${OUT_MD}`)

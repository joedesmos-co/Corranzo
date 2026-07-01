#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DENSE_PATH = join(ROOT, 'tmp/omr-benchmark-dashboard/fixtures/dense.json')
const CLEAN_PATH = join(ROOT, 'tmp/omr-benchmark-dashboard/fixtures/clean.json')
const OUT_JSON = join(ROOT, 'tmp/omr-benchmark-dashboard/post-inner-voice-rerank.json')
const OUT_MD = join(ROOT, 'tmp/omr-benchmark-dashboard/post-inner-voice-rerank.md')

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

const dense = JSON.parse(readFileSync(DENSE_PATH, 'utf8'))
const clean = JSON.parse(readFileSync(CLEAN_PATH, 'utf8'))
const perMeasure = dense.perMeasure ?? []
const debug = dense.debug ?? {}
const wrongDurations = debug.wrongDurations ?? []
const missingNotes = debug.missingNotes ?? []

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
    page: measure.page,
    chord: measure.chordMismatchCount,
    pitch: measure.wrongPitchCount,
    onset: measure.wrongOnsetCount,
    dur: measure.wrongDurationCount,
    missing: measure.missingNoteCount,
    extra: measure.extraNoteCount,
    pure:
      measure.wrongPitchCount === 0 &&
      measure.wrongOnsetCount === 0 &&
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
  context: 'post-inner-voice-phase runtime (narrow stack>=5)',
  baseline: {
    dense: dense.totals,
    clean: clean.totals,
  },
  innerVoiceShipped: {
    chordDelta: -18,
    m33: { before: 18, after: 0 },
    m113: { chord: 12, note: 'fix applied but chord unchanged — investigate false-positive apply' },
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
  m7MissingCount: missingNotes.filter((entry) => entry.measureNumber === 7).length,
  page8,
}

writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`)

const md = `# OMR error rerank (post inner-voice phase runtime)

**Baseline:** \`tmp/omr-benchmark-dashboard/fixtures/dense.json\`  
**Context:** Narrow inner-voice phase correction shipped (−18 chord, m33 fixed)  
**Code changes:** None (analysis only)

## Current dense totals

| Metric | Value |
|--------|------:|
| Chord mismatch | **221** (was 239 pre-fix) |
| Wrong pitch | 147 |
| Wrong duration | 103 |
| Wrong onset | 94 |
| Missing | 31 |
| Extra | 28 |
| F1 | 98.95% |
| Clean | unchanged |

## What inner-voice fixed

| Measure | Chord before → after |
|---------|---------------------|
| **m33** | 18 → **0** |
| m61 / m7 / m25 | unchanged (by design) |

**m113:** inner-voice rule applied but chord stays **12** — likely false-positive pattern match; do not extend rule.

---

## Decoupled rerank (independent buckets)

| Rank | Bucket | Count |
|-----:|--------|------:|
| 1 | wrongPitch @ correct onset | ${pitchAtCorrectOnsetCount} |
| 2 | wrongDuration @ correct onset+pitch | ${durAtCorrectOnsetPitch.length} |
| 3 | chordMismatch (raw) | ${dense.totals.chordMismatchCount} |
| 4 | missingNotes | ${dense.totals.missingNoteCount} |
| 5 | extraNotes | ${dense.totals.extraNoteCount} |
| 6 | wrongPitch onset-coupled | ${pitchOnsetCoupledCount} |
| 7 | wrongOnset (raw) | ${dense.totals.wrongOnsetCount} |
| 8 | wrongDuration onset-coupled | ${durOnsetCoupled.length} |

---

## Chord hotspots (post-fix)

| m | page | chord | pitch | onset | missing | extra | pure? |
|--:|:----:|------:|------:|------:|--------:|------:|:-----:|
${chordHotspots
  .slice(0, 10)
  .map((row) => {
    const page = row.page ?? (row.m <= 16 ? 1 : row.m <= 32 ? 2 : row.m <= 48 ? 3 : row.m <= 64 ? 4 : row.m <= 80 ? 5 : row.m <= 96 ? 6 : row.m <= 112 ? 7 : 8)
    return `| ${row.m} | ${page} | ${row.chord} | ${row.pitch} | ${row.onset} | ${row.missing} | ${row.extra} | ${row.pure ? 'yes' : 'no'} |`
  })
  .join('\n')}

**Pure chord-only** (no pitch/onset/missing/extra in measure): m113 (12), m94 (8), m57 (6).

---

## Missing-note hotspots

| m | count | share |
|--:|------:|------:|
${countByMeasure(missingNotes)
  .slice(0, 5)
  .map((row) => `| ${row.m} | ${row.count} | ${Math.round((row.count / dense.totals.missingNoteCount) * 100)}% |`)
  .join('\n')}

**m7** holds **${payload.m7MissingCount}/31** missing notes (beats 1–2.5 harmonic window) — Family A column sparsity, not rhythm phase.

---

## Duration @ correct onset+pitch

Top pattern: **1q→0.5q** — ${q1toHalf.length} instances.

| m | count |
|--:|------:|
${countByMeasure(q1toHalf)
  .slice(0, 6)
  .map((row) => `| ${row.m} | ${row.count} |`)
  .join('\n')}

**m70** remains the densest isolated duration hotspot (also 8 chord, 3 onset — partially coupled).

---

## Pitch @ correct onset

Page 8 trailing (m119–125): **${page8.pitch}** pitch / **${page8.onset}** onset errors.

Non–page 8: m6 (10), m8 (12) — cross-staff / detection coupling.

---

## Closed / deprioritized

| Target | Why |
|--------|-----|
| m33 inner-voice | **Shipped** |
| Global onset snap | Ruled out (prior diagnosis) |
| m61 narrow +0.25q | Skipped intentionally (+3 onset side effect in full detector) |
| m25 phantom columns | Needs **removal** not phase shift (Family B) |
| m113 extend inner-voice | Applied but **0 chord gain** — revert or tighten gate in separate task |

---

## Recommendation: **diagnose m25 phantom-column chord grouping (Family B)**

**Single safest next target** among remaining high-impact work:

1. **Impact:** m25 is the #2 chord hotspot (**24** mismatches), pitch/onset/duration clean in measure, no missing/extra — same independence profile m33 had before fix.
2. **Safety:** Family B fix is **column removal / phantom suppression**, not another global onset shift — orthogonal to shipped inner-voice rule; clean score unaffected if gated on dense phantom signature.
3. **Scope:** One measure-local pattern (+0.25q phantom columns, uniform stacks) — not m7 detection loss or page-8 pitch register soup.
4. **Not m7 first:** 11 missing notes need extraction/glyph diagnosis; highest missing density but **no obvious safe runtime fix**.
5. **Not m61 next:** Still #1 chord (26) but entangled missing/extra (3/3) and 4-note stacks — requires different rule than shipped narrow phase.
6. **Not m70 duration yet:** Only **${q1toHalf.length}** independent \`1q→0.5q\` fleet-wide; m70 repro needed before any cap/floor change (m17 lesson).

**Next step:** diagnosis-only on m25 — map phantom columns @+0.25q, simulate **drop** (not shift) under benchmark gate; controls m7/m34/m33 gains/m61 unchanged.

---

Machine-readable: \`tmp/omr-benchmark-dashboard/post-inner-voice-rerank.json\`
`

writeFileSync(OUT_MD, md)
console.log(`Wrote ${OUT_JSON}`)
console.log(`Wrote ${OUT_MD}`)

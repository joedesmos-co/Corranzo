# Inner-voice phase correction — runtime promotion

**Shipped:** narrow slice only (`stack >= 5`, alternating solo/stack, +0.25q)  
**Code:** `src/features/omr/innerVoicePhaseCorrection.js` wired in `runPdfOmrPipeline.js`

## Before / after (dense)

| Metric | Before | After | Δ |
|--------|-------:|------:|--:|
| Chord mismatches | 239 | **221** | **−18** |
| Wrong onset | 94 | 94 | 0 |
| Wrong pitch | 147 | 147 | 0 |
| Wrong duration | 103 | 103 | 0 |
| Chord grouping accuracy | 91.84% | **92.43%** | +0.59pp |

## Before / after (clean)

| Metric | Before | After | Δ |
|--------|-------:|------:|--:|
| Chord mismatches | 0 | 0 | 0 |
| Wrong onset | 0 | 0 | 0 |

## Watch measures (dense)

| Measure | Chord before → after | Onset | Notes |
|---------|---------------------|-------|-------|
| **m33** | 18 → **0** | 0 → 0 | Target fixed |
| m61 | 26 → 26 | 0 → 0 | Skipped (4-note stacks) |
| m7 | 20 → 20 | 8 → 8 | Control stable |
| m25 | 24 → 24 | 2 → 2 | Control stable |
| m34 | 0 → 0 | 0 → 0 | Control stable |

Runtime applied correction on **2 measures** (m33, m113).

## Artifacts

- Before: `before/clean.json`, `before/dense.json` (pre-runtime baseline from narrow sim)
- After: `after/report.json`, `after/report.md`, `after/dense.json`

## Acceptance

All gates pass: chord −18, onset/pitch/duration unchanged, clean unchanged, controls untouched.

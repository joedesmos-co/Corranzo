# OMR V3 Cursor Progress

Date: 2026-07-17  
Branch: `codex/omr-v3-production-qualification`

## Baseline (reproduced)

Independent production gate: **blocked**, `regressionCount: 6`.

Dense independent baseline: duration **0.3409** (V2 0.3939), F1 0.6987, onset 0.3561, chord 0.5740, measure error 2.

## Phase 1 — Dense piano duration — COMPLETE

### Root cause

Independent V3 keeps detector durations that are systematically too long (quarters / dotted quarters where truth is mostly eighths). Overlap-aware lane allocation then fragments stem-continuous voices, so MusicXML cumulative timing and duration both suffer. Beam evidence covers only ~41/262 heads.

### Attempted approaches

1. **Structural lanes before duration** — allowed approximate overlaps in stem lanes, then shortened. Dense duration rose, but created voice overlaps and damaged F1/grand/beginner.
2. **Pre-lane stem-family shorten** — improved dense duration but regressed grand/beginner when unconstrained; packing gates helped but still reshaped lanes.
3. **Measure-end ladder snap** — collateral damage on grand/scan; reverted.
4. **Beam second-guessing in refine** — no-op or slight F1 loss; removed.

### Rejected approaches

- General next-onset lengthening (`tmp/omr-v3-independent-lane-duration/`).
- Broad uniform beat grid on grand staff.
- Any fixture-ID or truth-matching special case.

### Implementation

After overlap-aware lane membership is fixed, `refineApproximatePackedDurations` shortens approximate durations inside stem/lane families that show a packed short subdivision (nearest ladder 1–2 with mean/gap agreement). Only overlong values (≥ quarter) are rewritten. Never lengthens. Beam durations left to the upstream handoff.

### Tests

`tests/omrV3Voices.test.js`:

- packed stem-continuous approximate notes shorten to next-onset subdivision
- beamed eighths are not lengthened across a sparse gap
- approximate eighths are not lengthened to fill a sparse lane gap

### Qualification impact

| Metric | Before | After |
| --- | ---: | ---: |
| Independent enforced regressions | 6 | **5** |
| Dense duration | 0.3409 | **0.4621** (V2 0.3939) |
| Dense F1 | 0.6987 | 0.6948 |
| Dense onset | 0.3561 | 0.3674 |
| Dense chord | 0.5740 | 0.5740 |
| Beginner / grand / tuplet / scan independent metrics | baseline | unchanged |

Dense is removed from `productionGate` regressions. Remaining: grand, tuplets, scan, paired-guitar chords, paired-guitar techniques.

### Remaining risk

- Dense F1 dipped ~0.4pp vs prior independent V3 (still far above V2).
- Packing uses geometric onset means; very irregular engraving may abstain correctly.
- Phase 2+ blockers untouched.

## Phase 2 — Grand-staff onset and voice — COMPLETE

### Root cause

Shared onset columns used drifted geometric `measureRelativePosition` values (e.g. 0.04/0.24/0.46/0.67 instead of 0/0.25/0.5/0.75). Both staves inherited the same float onsets, so every event was approximately quantized and duration packing could not see true beat gaps.

### Implementation

`quantizeJointGrandStaffOnsetColumns` snaps shared non-grace columns onto the measure beat grid when column count equals beats and spacing is regular (±35%). Applied once per grand-staff measure before per-staff voice solving. Extended packed-duration refine to allow quarter/half packing targets (≤8) so overlong detector values shorten to beat/half gaps after onsets stabilize.

### Qualification impact

| Metric | Before | After | V2 |
| --- | ---: | ---: | ---: |
| Independent regressions | 5 | **4** | — |
| Grand onset | 0.6136 | **1.0000** | 0.9773 |
| Grand F1 | 0.9432 | **1.0000** | 0.9886 |
| Grand duration | 0.5568 | **0.8409** | 0.8182 |
| Grand chord / pitch | 1.0 / 0.66 | 1.0 / 0.625 | 0.9775 / 0.625 |

Beginner, dense, tuplet, and scan independent metrics remain non-regressing vs prior phase.

## Phase 3 — Tuplet duration inference — COMPLETE

### Root cause

Single-staff uniform recovery only fired when item count equaled beat count (quarters). The tuplet fixture’s dominant measures are packed eighths (8), sixteenths (16), and full-bar 3:2 triplets (12). Those stayed on drifted geometric onsets with overlong approximate detector durations. True tuplets appear only in measure 3; V2 still scored duration via spacing, while independent V3 had no owned tuplet ratio and no subdivision grid.

### Attempted / rejected

- Inferring tuplets only by post-hoc measure fitting without a structural slot count.
- Broadening the rejected grand-staff uniform item grid (`tmp/omr-v3-uniform-grid-trial/`).
- Relying on packed stem-family refine alone (no stem/beam families → singleton no-ops).
- Treating ASCII measure numbers as tuplet numerals without staff-relative structure.

### Implementation

Extended `recoverUniformBeatGrid` (single-notation only) to uniform **subdivision** factors `{1,2,3,4}` keyed by unique onset columns:

- factor 1: historical beat grid
- factor 2 / 4: ordinary eighth / sixteenth packing
- factor 3: owned **3:2** tuplet — sounding slot = `totalDivisions / (beats * 3)`, with `technical.tuplet` + `OMR_V3_RELATIONSHIP_TYPE.TUPLET` groups

Requires regular inter-column spacing (±20%). Packed-duration refine skips subdivision/tuplet recoveries so the integer ladder cannot collapse `4/3` to `1`.

### Tests

`tests/omrV3Voices.test.js`:

- packed eighth and sixteenth subdivision grids
- 3:2 tuplet sounding durations + tuplet relationships

### Qualification impact

| Metric | Before | After | V2 / acceptance |
| --- | ---: | ---: | ---: |
| Independent regressions | 4 | **3** | — |
| Tuplet duration | 0.5079 | **0.9206** | ≥ 0.7778 |
| Tuplet F1 | 0.9048 | **0.9683** | ≥ 0.8889 |
| Tuplet onset | 0.5873 | **0.7302** | ≥ 0.5556 |
| Tuplet chord | 0.8000 | **0.9688** | ≥ 0.7746 |
| Beginner / grand / dense | unchanged | unchanged | no regression |
| Scan / paired guitar | unchanged | unchanged | still blocked |

### Remaining

Scan beam/stem, paired-guitar chords, paired-guitar techniques.

## Phase 4 — Scanned piano beam/stem — PARTIAL / NOT CLEARED

### Root cause

Raster path never built `beamStemGraph`, so independent V3 received no beam/stem ownership. Noteheads survive, but onset columns are irregular on the grand staff, durations stay overlong (many halves/wholes), and chord grouping lags V2. Existing `buildBeamStemGraph` already supports rendered-image recovery, but scan ink yields few high-confidence beam attachments.

### Attempted / rejected

- Feeding ungated raster ownership into V3 — F1/onset rose slightly, duration fell (0.3333 → 0.3243); still far below V2 floors.
- MAD-to-beat-grid snap for noisy grand-staff columns — damaged scan F1 (0.804 → 0.774).
- Lowering confidence floors / widening gap tolerances — rejected as gate weakening.

### Implementation

- Raster measures now build and attach `beamStemGraph` / diagnostics (score-graph parity with vector).
- Detector symbol ownership applies only when `beamOwnership.confidence >= 0.7` (shared with duration handoff).
- Raster → independent V3 still omits the graph until attachments clear duration/onset/chord acceptance without collateral damage.
- Added abstention test for broken/sparse beam ink.

### Qualification impact

Scan independent metrics unchanged vs Phase 3 baseline (still regressing). Enforced independent regressions remain **3**.

### Remaining risk

Clearing `piano-articulation-scan` needs stronger conservative raster stem/beam ink association and/or scan-safe onset clustering that does not repeat the rejected MAD snap.

## Next

Phase 5 — Paired-guitar chord fusion.

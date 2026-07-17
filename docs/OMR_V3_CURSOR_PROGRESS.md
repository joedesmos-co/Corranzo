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

Scan beam/stem (sole remaining enforced regression after guitar).

## Phase 4 — Scanned piano beam/stem — COMPLETE

### Root cause

Raster noteheads matched V2 F1, but independent V3 inherited only geometric `positionInMeasure` while V2’s `assembleMeasureRhythm` packs chords and assigns `startDivision`. Joint grand-staff snap abstained on irregular columns; beam attachment stayed ~4%; MAD/order beat snaps damaged F1.

### Attempted / rejected

- Feeding ungated raster beam ownership into V3 — duration regressed.
- MAD-to-beat-grid snap — F1 0.804→0.774.
- Order-based snap without regularity / column compress — F1 collapse on scan/dense.
- Lowering the 0.7 ownership floor — rejected.

### Implementation

1. **Detector-local rhythm stamp** (`assembleOmrMeasureRhythm.js`) — after measure packing / even-quarter fallback, stamp `onsetDivisions` + packed `durationDivisions` onto surviving noteheads for independent V3 (not V2 MusicXML replay).
2. **Stem-only raster handoff** — pass `beamStemGraph` into V3 with split gates: stem grouping at stemConfidence ≥ 0.7; beam duration only when beams are attached at beamConfidence ≥ 0.7.
3. **Stem confidence recalibration** — typical short rendered stems (~10px) clear 0.7 without lowering the floor.
4. **Bass accompaniment gap fill** — on grand-staff bass staff, lengthen approximate short durations to the next lane onset (quarters → halves).

### Qualification impact

| Metric | Before | After | V2 floor |
| --- | ---: | ---: | ---: |
| Independent regressions (full gate) | 1 (this) | **0** | — |
| F1 | 0.804 | **0.804** | ≥ 0.804 |
| Onset | 0.3874 | **0.6126** | ≥ 0.6126 |
| Duration | 0.3333 | **0.5766** | ≥ 0.4685 |
| Chord | 0.5191 | **0.6048** | ≥ 0.6048 |
| Pitch / measure error | equal / 0 | equal / 0 | — |

Vector piano + guitar fixtures remain non-regressing. Full gate: `regressionCount: 0`; remaining blockers are rollout-only (`runtime-candidate-not-implemented`, `rollback-not-verified`).

## Next

Implement guarded production rollout (default-off runtime candidate + V2 kill switch) and real-PDF / negative-page evidence per handoff §§6–7. Do not enable V3 by default until those blockers clear.

## Phase 5 — Paired-guitar chord fusion — COMPLETE

### Root cause

Within shared onset columns, pairing used only `soundingMidi` distance ≤ 2. Detector notation midis are often octave-wrong or garbage (e.g. 19/28), while TAB frets are reliable, so pair recall sat at ~0.26. Paired events also skipped approximate measure-end duration recovery, dropping overflow notation notes. After pairing improved, all raw paired noteheads still lacked exact `onsetDivisions`, so geometric `measureRelativePosition` dominated onset/duration/chord/F1.

### Implementation

**Pairing (prior):**

- Octave/written/sounding-aware pitch distance for notation↔TAB.
- Vertical-rank fallback only when a note has **no** pitch-compatible TAB in the column.
- Enable `allowApproximateMeasureEndRecovery` for paired notation events.

**Joint onset timing (this phase):**

- `quantizeJointGuitarNotationTabOnsetColumns` remaps shared columns by order onto a joint grid (no geometric gap-regularity requirement — that approach was rejected).
- Only columns with notation noteheads participate (tab-only clusters do not consume early beats).
- Active count == beats → equal beat grid; count == beats+1 → monotonic compress onto beats; count < beats → first N beats; singleton → downbeat.
- `refineApproximatePairedDurations` assigns approximate durations to beat length when onset is on the beat grid, else to the next-onset gap. Exact detector durations untouched.

### Qualification impact

| Metric | Before timing | After | V2 floor |
| --- | ---: | ---: | ---: |
| Independent regressions (full gate) | 3 (incl. this) | **removed** | — |
| F1 | 0.628 | **0.7059** | ≥ 0.686 |
| Onset | 0.181 | **0.6207** | ≥ 0.5172 |
| Duration | 0.2931 | **0.6207** | ≥ 0.3621 |
| Chord | 0.4476 | **0.5455** | ≥ 0.4786 |
| Pitch | ~0.12 | **0.1293** | ≥ 0.1121 |
| Measure error | 2 | **2** | ≤ 2 |

Standard and TAB-only Guitar remain non-regressing.

### Rejected / remaining

- Unconditional rank pairing (false-matched unpaired-note tests).
- Gap-regularity beat snap on irregular guitar columns (`joint beat-grid snap` earlier).
- Passing Piano beam evidence into Guitar (`tmp/omr-v3-beam-evidence-all/`).

## Phase 6 — Paired-guitar techniques — COMPLETE

Same joint onset path. Pair recall already **1.0**; timing was the blocker.

| Metric | Before timing | After | V2 floor |
| --- | ---: | ---: | ---: |
| F1 | 0.600 | **0.700** | ≥ 0.700 |
| Onset | 0.250 | **0.6563** | ≥ 0.6563 |
| Duration | 0.1875 | **0.6563** | ≥ 0.500 |
| Chord | 0.4634 | **0.5385** | ≥ 0.5385 |
| Measure error | 4 | **4** | ≤ 4 |

## Tests

`tests/omrV3Guitar.test.js`:

- equal-order joint grid + approximate gap/beat duration fill
- beats+1 monotonic compression onto the beat grid
- singleton approximate column → downbeat
- exact `onsetDivisions` abstain from remapping

## Next

Independent enforced regressions are **0**. Next: guarded rollout tooling + real-PDF/negative-page evidence (handoff §§6–7). Do not enable V3 by default until those blockers clear.

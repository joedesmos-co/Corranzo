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

## Phase 7 — Guarded rollout tooling — COMPLETE

### Implementation

- `omrV3RuntimeCandidate` (default **false**) arms category/`fullV3` promotions in `resolveOmrV3RolloutOptions`.
- Requested promotions alone never resolve on; `omrV3Rollback` kills shadow, candidate, and promotions synchronously.
- When candidate + `fullV3` are armed and independent V3 MusicXML is valid (`invalidEventCount === 0`), runtime MusicXML may swap; telemetry records category, decision, confidence, latency, and byte-length delta (no PDF retention).
- Category keys (`structure`, `guitarFusion`, …) arm cohort flags only — they do not swap MusicXML.
- Dashboard gate evidence is **measured**, not hardcoded: `assessOmrV3RuntimeCandidateReadiness` + `verifyOmrV3RollbackByteIdentity`.

### Qualification impact

Full gate (`tmp/cursor-full/report.json`):

| Field | Value |
| --- | --- |
| `regressionCount` | **0** |
| `runtimeCandidateImplemented` | **true** |
| `rollbackVerified` | **true** |
| `productionGate.pass` | **true** (`eligible-for-production-rollout`) |
| Default runtime | **V2** (candidate off) |

### Remaining

Handoff §6 real-PDF / negative-page evidence is still required before enabling any cohort in production UI. Do not turn the candidate on by default.

## Phase 8 — Real-PDF truth and negative-page evidence — COMPLETE (scaffolded)

### Implementation

- `classifyOmrNegativePage` / `isMusicalOmrStaffSystem` — page-level isolation when **zero** systems look musical (decorative hatching, hairline ornaments). Confident barlines and noisy scanned 5-line staves are preserved so healthy music is not stripped.
- Wired in `processOmrPage` before note recognition; isolated regions record `kind: non-musical-page`.
- Vendored LoC Twinkle crops: `twinkle-1880-loc-cover.pdf` (reject-honestly diagnostic) and `twinkle-1880-loc-music-p2.pdf` (import-only).
- Dashboard: optional `realScoreTruth` block when an import-only fixture also has a truth file (never feeds the enforced gate).
- Dense piano / orchestral stress fixtures document honest low-confidence rejection; beginner workbook remains local-only non-redistributable (CC0 `piano-beginner-single-vector` is the licensed equivalent).

### Qualification impact

| Check | Result |
| --- | --- |
| Twinkle cover playable events | **0** (isolated → honest `no-systems` reject; V3 owns independent rejection) |
| Twinkle 2-page unsafe accept (421 notes) | **Removed** — cover isolated; remaining music page rejects low-confidence |
| `guitar-paired-scan` enforced reject | **pass** (`no-notes`) — not damaged by classifier |
| Enforced recognition regressions | **0** |
| `productionGate.pass` | **true** (still default-off V3) |
| Independently verified scan MusicXML | **Not yet** — music-page crop scaffolded for future `realScoreTruth` |

### Remaining gap

Hand-verified MusicXML for the Twinkle music crop (or another redistribution-safe scan crop) is still required for full §6 item 1 “independently verified truth.” Until then, leave V3 default-off and do not enable a production cohort.

### Theme crop dual-transcription attempt (2026-07-17) — BLOCKED

Target: `benchmarks/omr-stress/twinkle-1880-loc/twinkle-1880-loc-theme-m1-3.pdf` (`tmp/omr-s6-probe/twinkle-theme-m1-3-full.png`).

Two independent crop-only transcriptions were run and **did not cross-check**:

| | [Transcribe Theme full A](de254b98-dafc-44e2-ac4d-2b85363ebcca) | [Transcribe Theme full B](39db273d-4826-41d5-a2e8-0dbd7e79b2ff) |
| --- | --- | --- |
| Key | **2 flats** (Bb, Eb) | **1 flat** (Bb) |
| Meter | inferred **2/4** (not printed) | inferred **4/4** + 2-beat pickup |
| Complete measures | **2** + partial M3 | **3** + partial M4 |
| Pickup treble | **Bb4** quarter | **F5, C5** quarters |
| Confidence | Low–medium note-level; high on structure/key | High for M1–M3 |

Both agree: grand staff; no printed time signature; “Theme.” / “Allegro Moderato.”; dynamic **p**; bass triplet texture in the measure-2 region.

**Decision (accepted):** Stop inferring ground truth from this ambiguous scan. Preserve evidence; leave production qualification unchanged. Treat the fixture as **blocked pending independent human-verified truth**. Do not revisit unless a generalized algorithm naturally improves it or verified truth becomes available.

Abandoned earlier targets: dense page-2 opening (ambiguous chord stacks) and bass-truncated Theme crop.

## Phase 1b — Dense duration residual verification + packing/lengthen interaction — COMPLETE

### Reproduce (2026-07-17)

Fresh live dense run (`tmp/cursor-dense-fresh/`, `tmp/cursor-dense/live-duration-probe.json`):

| Metric | V2 | Independent V3 (pre-1b) | Handoff floor |
| --- | ---: | ---: | ---: |
| duration | 0.3939 | **0.4811** | ≥ 0.3939 |
| F1 | 0.4563 | 0.6756 | ≥ 0.6987 (handoff baseline) |
| onset | 0.3333 | 0.3674 | ≥ 0.3561 |
| chord | 0.2892 | 0.3930 | ≥ 0.5740 (Phase 1 peak) |
| measure error | 11 | 2 | ≤ 2 |
| invalid / dup / overlap | — | 0 / 0 / 0 | 0 |

V2 duration regression was already cleared by Phase 1 packing. Residual wrong-duration anatomy:

- 49 duration mismatches, but only **1** with correct onset **and** pitch
- Dominant coupled pattern: truth eighth (0.5) matched to generated quarter (1.0) under wrong pitch/voice
- Serializer: 243/257 approximate; musical stage: 31 measure-end clips; packing recoveries present (`lane-gap-shorten` / `lane-subdivision-continuity`) plus **106** `lane-gap-lengthen` on bass

### Root cause (proven)

First pure duration-propagation defect after Phase 1:

1. `refineApproximatePackedDurations` shortens overlong approximate notes in packed stem/lane families.
2. `fillApproximateLaneGaps` then runs on every bass-clef staff and lengthens any approximate duration shorter than the geometric gap to the next lane onset.
3. Incomplete lane membership leaves sparse gaps, so packing-shortened eighths are stretched back (often to non-ladder floats). That also damaged dense chord grouping (0.393 vs Phase 1 peak 0.574).

Not primarily: onset clustering, serialization, or confidence. Secondary residual duration score is still matcher-coupled (onset/voice/pitch), which is outside a duration-only fix.

### Implementation

In `fillApproximateLaneGaps` (`omrV3Voices.js`):

- Skip items already recovered by packing (`lane-gap-shorten`, `lane-subdivision-continuity`).
- Snap lengthen targets with `snapDownToLadder` (never exceed gap; no raw geometric floats).

Bass accompaniment lengthen still fires when packing did not rewrite the note (quarters → halves).

### Tests

`tests/omrV3Voices.test.js`:

- bass accompaniment quarters lengthen to next onset when packing abstains
- packed bass subdivision shorten is not undone by gap lengthen

### Qualification impact

| Fixture | Before 1b | After 1b | Notes |
| --- | ---: | ---: | --- |
| Dense duration | 0.4811 | **0.4735** | still ≫ V2 0.3939 |
| Dense F1 | 0.6756 | **0.6833** | improved |
| Dense chord | 0.3930 | **0.5740** | restored Phase 1 peak |
| Dense onset | 0.3674 | 0.3674 | unchanged |
| Grand / beginner / scan / guitar enforced | — | unchanged vs V2 floors | no regression |
| Full gate | pass | **pass**, `regressionCount: 0` | `tmp/cursor-full-densefix/report.json` |

### Remaining risk / research bound

Further dense duration gains (toward matched-duration parity with V2’s 0.87 on matched notes) require joint onset/voice/pitch solving: almost all remaining duration mismatches are not pure duration. Do not restore general next-onset lengthening. Theme-scan MusicXML remains human-blocked.

## Next

All handoff §§1–7 algorithmic/regression blockers are cleared under the independent gate. Remaining production blockers are human/visual: independently verified scan MusicXML (Theme crop blocked) and explicit opt-in before any UI cohort. Keep runtime candidate default-off.

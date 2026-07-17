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

## Next

Phase 2 — Grand-staff onset and voice reasoning.

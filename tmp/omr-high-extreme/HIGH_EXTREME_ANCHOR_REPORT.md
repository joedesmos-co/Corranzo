# High-extreme chord pitch anchoring — campaign report

- HEAD at start: `f2d3f05` — recovered-ledger rhythm integration
- Evaluator: frozen 2.0.0 / schema 2
- Production commit from this campaign: **none** (no accepted fix)

## Baseline by register (Phase 1)

Artifacts: `PHASE_1_HIGH_EXTREME_BASELINE.md`, `high_extreme_inventory.json`, `corpus-baseline.*`

### High-extreme (primary)

| Metric | Value |
|---|---:|
| Chord events | 20 |
| Exact chord accuracy | **15%** (3/20) |
| Incorrect chords | 17 |
| Missing tones | 24 |
| Extra tones | 21 |
| Incorrect pitches | 45 |
| Octave errors | 0 |
| Wrong-staff errors | 0 |
| Ink anchor successes | 2 |
| Glyph-metrics fallbacks | 52 |

Dominant fallback reasons on incorrect chords:

- `no-head-sized-component` ×28/20
- `ambiguous-components` ×19/17
- `component-outside-font-origin-range` ×5/5

All incorrect high-extreme chords are on `piano-dense-advanced-vector` (m5–m8).

### Safety context (must not regress)

| Gate | Baseline |
|---|---:|
| low-extreme exact | 76.47% (missing tones 6) |
| Mean Pitch | 72.4% |
| Mean Rhythm | 80.2% |
| incorrect-chord | 159 |
| missing / extra notes | 73 / 106 |
| Guitar-standard | R 100% / P 86% |

## Exact RC-B root cause (Phase 2)

Artifact: `PHASE_2_RC_B_ROOT_CAUSE.md`  
Crops: `crops/dense-m*.png`  
Probe: `diagnostics/anchor-probe-rows.json`

**First failing function:** `resolveNoteheadAnchor` (`src/features/omr/pitchFromStaffPosition.js`)

Under dense upper ledgers:

1. Long horizontal ledger runs are treated like staff rows and suppressed, shredding the notehead → `no-head-sized-component`.
2. Neighbor chord tones in the same window trigger `ambiguous-components`, discarding all ink.
3. Pitch falls back to glyph-metric Y (~0.32 staff-spaces below raw origin), often one diatonic step off when ink would have differed by ~0.22 spaces.

Wrong-staff / octave-clamp / evaluator alignment are not the drivers (0 wrong-staff, 0 octave errors in the high-extreme bin).

## Visual evidence

Dense treble stacks several ledger lines above the staff with shared stems, beams, displaced seconds, and accidentals. Ledger ink crosses every notehead body — matching mechanisms 5/6/7/8/12 from the campaign taxonomy.

## Experiments (Phase 3) — all rejected

| Experiment | High-extreme exact | Global Pitch | Notes | Decision |
|---|---:|---:|---|---|
| A. Extreme-only: do not suppress non-staff rows + own nearest stacked head (all registers) | 20% | 71.8% ↓ | Ink↑ but missing/extra↑; Guitar pitch↓ | **Revert** |
| B. Extreme staff-row-only suppression (no ownership change) | 15% | 72.4% | No high-extreme gain; tiny measureStructure noise | **Revert** |
| C. Extreme-above ownership only + staff-row-only suppression | 15% | 72.3% | Missing/extra worse (26/24); little ink uptake | **Revert** |

Aggressive ink recovery improves fallback *rates* but selects wrong centers often enough to raise incorrect pitches and miss tones. Ownership outside the extreme-above gate risks low/guitar stacks.

## Focused tests

No production-accepted test changes. Synthetic high-ledger fixtures were attempted; they do not yet reproduce the fixture-scale failure cleanly enough to land without gate regressions.

Existing suite remains green on reverted tree (`omrFontAwarePitchAnchor`, extreme-register, recovered-tone rhythm).

## High-extreme before / after

| | Before | After accepted fix |
|---|---:|---:|
| Exact % | 15% | **15%** (unchanged — no accepted fix) |
| Missing tones | 24 | 24 |
| Extra tones | 21 | 21 |

## Global corpus before / after

Unchanged at HEAD `f2d3f05` (production not modified).

## Known limitations

1. High-extreme accuracy is still ~15%, dominated by dense `piano-dense-advanced-vector` stacks.
2. A large share of residual ±1 pitch defects may also involve **accidental provenance** (RC-D); inventing alters is forbidden.
3. `ambiguous-components` reject is load-bearing for ordinary staff chords; widening ownership is unsafe without stronger per-glyph origin models.
4. Ledger reconstruction / ownership provenance (Phase 4) was not required to prove RC-B, but remains the likely next structural lever once a safe ink/metric split exists.
5. Raster reconstruction is out of scope for this campaign (per brief).

## Recommendation

1. Keep RC-A + recovered-tone rhythm frozen.
2. Next iteration should add **font/glyph-class anchor profiles** (SMuFL origin → optical center) used when ink rejects, before broadening ink ownership.
3. Pair that with **ledger-vs-staff run classification** (length/relative to glyph, not only extreme Y).
4. Only then revisit extreme-above stacked-head ownership with fixture-backed failing tests.
5. After vector high-extreme is stable, schedule **raster component reconstruction** as a separate campaign.

## Deliverables retained under `tmp/omr-high-extreme/` (not committed)

- `PHASE_1_HIGH_EXTREME_BASELINE.md`
- `PHASE_2_RC_B_ROOT_CAUSE.md`
- `high_extreme_inventory.json` (+ full inventory)
- `corpus-baseline.json` / `.txt`
- crops + diagnostics
- this report

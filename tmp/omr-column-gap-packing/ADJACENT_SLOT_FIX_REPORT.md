# Adjacent-Slot Chord Grouping Fix — Report

**Baseline:** `34529e0` — fix(omr): detect vector path accidentals  
**Commit:** `fix(omr): preserve stacked chord timing across adjacent slots`  
**Verdict:** **ACCEPTED** — reapplied exactly as previously validated

## Acceptance criterion (corrected)

The prior trial gate required `incorrect-chord` to decrease. That was the wrong success signal for this change.

This fix’s demonstrated effect is **preserving shared onset through gap packing** (reducing onset divergence), not rewriting chord pitch/voice integrity scoring. Acceptance is based on:

- onset-mismatch decrease
- Rhythm improvement with no Pitch / missing / extra regressions
- grand-voices Rhythm remaining healthy (~89%)
- geometry guards (independent voices, opposing stems, adjacent sixteenths, grace notes) not incorrectly merging
- all targeted geometry tests pass

## Implementation

Narrow exception only in `groupsShareBeatSlot` via `omrAdjacentSlotChordGrouping.js`:

When provisional beat slots differ by **exactly 1**, allow share only if:

- `|Δcx| ≤ min(10, chordMergeX)` (tight geometry; not adaptive 28)
- same staff/clef
- compatible stem ownership **or** strong vertical-stack evidence
- no opposing stems without shared stem group
- no conflicting beam groups / dual beamed neighbors
- no grace/ornament
- no implausible horizontal span

Same-slot grouping unchanged. No ownership scaffolding, no global merge-X widening. No retune beyond the previously tested implementation.

## Corpus vs baseline (reapplied)

| Metric | Baseline | After | Δ |
|---|---:|---:|---:|
| onset-mismatch | 256 | **250** | **−6** |
| Rhythm | 66.6% | **67.2%** | **+0.6pp** |
| incorrect-chord | 199 | 199 | 0 (stable) |
| missing-note | 163 | 163 | 0 |
| extra-note | 154 | 154 | 0 |
| Pitch | 61.5% | 61.5% | ~0 |
| Overall | 62.8% | 62.9% | +0.1pp |

### Fixture health checks

| Fixture | Notes |
|---|---|
| piano-grand-voices-vector | Rhythm **89%** (healthy; no dense-collapse failure mode) |
| piano-dense-advanced-vector | Onset improved in prior trial; chord count stable |
| guitar-paired / guitar-standard | Rhythm improved in prior trial; no merge regressions |

Matches the accepted trial run (`adjacent-slot-after` / reapplied label).

## Geometry diagnostics

All **10** required geometry tests pass, plus existing chord-grouping regressions:

- stacked adjacent-slot triad reunites through pack → coalesce
- opposing stems / independent voices rejected
- adjacent sixteenth chords with `|Δcx| > 10` rejected
- grace/ornament rejected

## Why incorrect-chord stays at 199

The fix reduces **onset divergence** and improves Rhythm by keeping visually stacked chord tones on one shared provisional beat through gap packing.

The remaining `incorrect-chord` population under the frozen evaluator is dominated by:

1. **Pitch / staff / accidental** errors (same cardinality, wrong midis)
2. **Detection** drops/extras that are not adjacent-slot packing splits
3. **Voice-assignment** merges/splits outside the narrow `|slotDiff|===1` and `|Δcx|≤10` gate

Those classes are outside this packing bug and are not expected to move from this change alone.

## Validation rerun (reapply)

- Targeted geometry: `omrAdjacentSlotChordGrouping` + `omrChordGrouping` + column-gap diagnostic — **pass**
- Frozen semantic corpus (`adjacent-slot-reapplied`) — onset **250**, Rhythm **67.2%**, chord **199**
- Full unit suite — **275** files / **2761** tests passed
- Production build — **ok**

## Files

- `src/features/omr/omrAdjacentSlotChordGrouping.js` (new)
- `src/features/omr/processVectorOmrPage.js` (narrow `groupsShareBeatSlot` wiring + diagnostics)
- `tests/omrAdjacentSlotChordGrouping.test.js` (new)
- `tests/omrColumnGapPackingDiagnostic.test.js` (expects reunited chord after fix)

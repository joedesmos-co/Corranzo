# Orphan notehead reassignment

## Problem

Probe funnel showed ~14 SMuFL noteheads outside rectangular measure boxes. All were in the **horizontal gap between systems** (~0.005 left of a new system's first-measure `x0`), with valid pitch mapping and clear staff proximity.

## Fix

`src/features/omr/vectorOrphanNoteheads.js` — after normal in-box assignment:

1. Collect orphan notehead glyphs (not already assigned)
2. Pick nearest system by staff-line distance (reject if ambiguous between systems)
3. Pick nearest measure using orphan horizontal pads (`±0.025` on first/last system measures)
4. Require pitch mapping success
5. Rebuild affected measures with `orphanGlyphs` (`source: vector-glyph-orphan`)

## Diagnostics

Pipeline `diagnostics.orphans` / `diagnostics.orphanNoteheads`:

- `orphanNoteheadCount`
- `reassignedOrphanCount`
- `rejectedOrphanReasons`

## Benchmark comparison (Cruel Angel dense)

| Metric | Before orphan pass | After |
|--------|-------------------|-------|
| generatedNoteCount | 2794 | **2808** (+14) |
| noteCountDifference | −16 | **−2** |
| missingNoteCount | 329 | **320** (−9) |
| noteDetectionF1 | 88.54% | **88.64%** |
| pitchAccuracy | 24.80% | **25.12%** |
| onsetAccuracy | 60.18% | **60.85%** |

## Gymnopédie (clean)

Unchanged: **100%** pitch, noteDetectionF1, **469/469** notes.

## Remaining gap

2 notes short of truth (2810 vs 2808). Likely residual measure-allocation or matching issues, not orphan glyphs.

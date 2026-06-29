# Dense OMR notehead detection / measure assignment

## Root cause

Funnel analysis (`npm run omr:probe-noteheads`) on Cruel Angel showed all **2810** PDF notehead glyphs present; losses were at **measure assignment**, not glyph extraction or pitch mapping:

| Stage | Count |
|-------|------:|
| PDF notehead glyphs | 2810 |
| In any measure box (old bounds) | 2794 |
| Outside all boxes | **16** |
| Pitch rejected | 0 |
| Pipeline emitted (before) | 2790 |

Outside glyphs clustered at:
1. **~0.02 past `x1`** on the **last measure of each system** (barline slightly left of noteheads)
2. **Inter-system vertical gaps** (ledger tails between grand-staff systems; old `yPad=0.025` too tight on dense pages)

Staff assignment / pitch mapping was not dropping notes (`pitchRejected: 0`).

## Fix

`src/features/omr/vectorGlyphMeasureBounds.js` — vector glyph allocation bounds:
- Use measure **`x0`** (not `playableX0`) for horizontal inclusion
- **`+0.028` normalized `x1` pad** on last measure per system
- **`yPad = max(0.035, staffGap × 3)`** so dense 6-line staves never shrink below prior padding

Wired through `vectorGlyphInMeasure()` in `noteheadsForMeasure()` / `buildVectorMeasureRecord()`.

## Benchmark comparison

### Cruel Angel (dense)

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| generatedNoteCount | 2790 | **2794** | +4 |
| noteCountDifference | −20 | **−16** | +4 |
| missingNoteCount | 331 | **329** | −2 |
| noteDetectionF1 | 88.54% | **88.54%** | — |
| pitchAccuracy | 24.80% | **24.80%** | — |
| onsetAccuracy | 60.07% | **60.18%** | +0.11 |

### Gymnopédie (clean)

| Metric | Before | After |
|--------|--------|-------|
| pitchAccuracy | 98.51% | **100%** |
| noteDetectionF1 | 99.36% | **100%** |
| generatedNoteCount | 467 | **469** (= truth) |

## Remaining gap

~16 PDF glyphs still fall outside measure boxes (mostly inter-system ledger tails). Further gain needs page-level orphan reassignment or system-gap-aware vertical bounds without cross-system bleed.

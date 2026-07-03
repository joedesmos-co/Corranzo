# OMR Tie/Slur Accuracy Sprint — diagnosis

**Date:** 2026-07-02  
**Algorithm changes:** None (cross-measure arc threshold simulation had zero recall gain; reverted)

## Audit (enforced fixtures)

| Fixture | detected | applied | tie gap | uncertainSlurs | false ties |
|---------|----------|---------|---------|----------------|------------|
| Gymnopédie (clean) | 6 | 6 | 0 | 164 | 0 |
| Cruel Angel (dense) | 27 | 11 | 16 | 800 | n/a |
| Twinkle (simple) | 0 | 0 | 0 | 0 | **0** |

Slurs are **diagnostic-only** (`uncertainSlurCount`): different-pitch ink arcs and SMuFL slur glyphs. They never emit `<tie>` marks.

## Gymnopédie tie recall: 6 / 14 (43%)

Voice-ordered truth pairs vs `appliedTiePairs`:

| Status | Pairs |
|--------|-------|
| **Hit (6)** | m48→49, m49→50, m50→51 (F#4); m58→59, m59→60 (E4); m69→70 (D5) |
| **Miss (8)** | m9→10, m10→11, m11→12 (F#4); m19→20, m20→21 (E4); m25→26, m30→31, m64→65 (D5) |

All hits and misses are **cross-measure same-pitch** chains. Accuracy metrics stay 100% because duration/onset matching tolerates missing ties.

## Root cause (missed ties)

1. **Detection, not application:** `detectedTieCount === appliedTieCount` (6=6); ink-arc probe never fires for the eight missed pairs.
2. **Notes are present:** Generated MusicXML contains the correct pitch instances in adjacent measures (e.g. m9 F#4@1 → m10 F#4@0) but without tie flags.
3. **Ink-arc failure at barline:** `detectInkArcBetween` column-coverage test fails on early-page cross-measure arcs where the barline breaks continuous ink (m9–12, m19–21). Later chains (m48+) pass the same test — not a missing-note defect.
4. **Slur separation works:** `countUncertainSlurs` only increments on **different-pitch** adjacent instances; same-pitch arcs route to tie detection, not slur count.

## Simulations

| Candidate | Gym recall | Twinkle false ties | Verdict |
|-----------|------------|-------------------|---------|
| Relax cross-measure arc thresholds (0.45/0.65) | 6/14 | 0 | **No gain — reverted** |

## Decision

**No detector change.** Narrow threshold tweak did not improve recall. Next work needs per-pair ink-arc debugging on m9→10 / m64→65 (barline-interrupted arcs) before loosening coverage rules.

## Tests added

- `src/features/omr/omrTieRecallAnalysis.js` — `extractVoiceOrderedTiePairs`, `evaluateTieRecall`, `summarizeTieSlurDiagnostics`
- `tests/omrTieRecall.test.js` — same-pitch tie, different-pitch slur guard, Gymnopédie 6/14 pin, Twinkle 0 false ties

# OMR Accuracy Sprint 2 — Rhythm and tie diagnosis

**Date:** 2026-07-02  
**Code changes:** Diagnostics only (`analyzeOnsetErrorCoupling`, `rankRhythmRootCauses`)  
**Algorithm changes:** None (simulated sixteenth cluster snap had zero effect)

## Baseline (enforced fixtures)

| Fixture | Pitch | Duration | Onset | Chord | F1 | wrongOnset | wrongDuration | chordMismatch |
|---------|------:|---------:|------:|------:|---:|-----------:|--------------:|--------------:|
| Gymnopédie (clean) | 100% | 100% | 100% | 100% | 100% | 0 | 0 | 0 |
| Cruel Angel (dense) | 94% | 96% | 96% | 94% | 99% | 94 | 77 | 172 |
| Twinkle (simple) | 100% | 97% | 93% | 100% | 100% | 6 | 3 | 0 |

## Rerank (dense, proven accuracy buckets)

| Rank | Bucket | Count | Role |
|-----:|--------|------:|------|
| 1 | **onset/rhythm** | **94** | **Primary root cause** |
| 2 | pitch | 147 | Often matcher/grouping artifact when onset slips |
| 3 | chord | 172 | **89% onset/detection-coupled** — downstream symptom |
| 4 | duration/rhythm-independent | 33 | too-short 20, too-long 9, beamed-subdivision 4 |
| 5 | duration onset-coupled | 44 | Follows onset errors |
| 6 | extra/missing | 56 | Detection, not rhythm grid |
| — | ties gap | 16 | detected 27, applied 11 — does not move metrics on clean |
| — | slurs | 800 | Unmodeled feature counter |

Tie recall on Gymnopédie: 6 detected/applied vs 14 in truth (detection gap), but clean accuracy metrics remain 100% — tie work is secondary to onset/rhythm.

## Onset error signature (dense)

- **100%** of wrong onsets are **±0.50q** or **±0.75q** (voice-phase / dotted-eighth grid slips)
- **75** pitch/duration-coupled vs **19** strict-independent (pitch=0, duration ok)
- Hotspots: m9 (18), m121 (9), m7–8 (15 combined), m119–124 (page 8 run)

## Where errors are introduced

1. **`processVectorOmrPage.js` → `buildNoteEventsFromGroups`**: x-position → `startDivision` for dense sixteenth grids (`shouldInferRhythmFromPositions`).
2. **`runPdfOmrPipeline.js`**: post-hoc column corrections (inner-voice phase, phantom, terminal) — only 2 measures touched on dense; not the bulk of errors.
3. **Evaluator greedy matching**: couples onset errors with pitch mismatches when repeated pitch classes appear in one measure (majority of “independent” onset count in loose filter).

## Simulations run

| Candidate | Result |
|-----------|--------|
| Sixteenth `snapStartDivision` in dense cluster phase | **No change** — dense 94/77/172 identical; clean/simple unchanged |
| Note-column span `positionInMeasure` renormalization | **Regressed** — dense onset 94→285, duration 77→103; Twinkle failed; reverted |

## Decision

**No OMR algorithm change.** Safest highest-impact target is onset/rhythm inference, but the narrowest generic fix tested (cluster snap alignment) did not move metrics. Broader rhythm changes (beam ownership, position denominator, inner-voice phase expansion) are flagged as regression-prone in `OMR_ENGINE.md`.

## Next largest bucket

**Pitch (147 on dense)** — heterogeneous; many are coupling artifacts. Independent duration errors (33) are the next rhythm-specific target after onset slot assignment is validated measure-by-measure.

# OMR Tie Ink-Arc Sprint — diagnosis

**Date:** 2026-07-02  
**Algorithm changes:** None (barline-split promotion simulated — no Gym recall gain on real PDF)

## Benchmark (enforced fixtures, unchanged)

| Fixture | Pitch | Duration | Onset | Chord | F1 | Ties detected/applied | False ties |
|---------|------:|---------:|------:|------:|---:|--------------------:|-----------:|
| Gymnopédie | 100% | 100% | 100% | 100% | 100% | 6 / 6 | 0 |
| Cruel Angel | 94% | 96% | 96% | 94% | 99% | 27 / 11 | n/a |
| Twinkle | 100% | 97% | 93% | 100% | 100% | 0 / 0 | **0** |

**Gymnopédie tie recall vs truth: 6 / 14 (43%)** — unchanged.

## Missed true ties (8 pairs)

| Chain | Pitch | Cross-measure | Barline | Slur risk |
|-------|-------|:-------------:|:-------:|:---------:|
| m9→10→11→12 | F#4 | yes | yes | low (same pitch) |
| m19→20→21 | E4 | yes | yes | low |
| m25→26 | D5 | yes | yes | low |
| m30→31 | D5 | yes | yes | low |
| m64→65 | D5 | yes | yes | low |

## Recalled ties (6 pairs)

| Chain | Pitch | Notes |
|-------|-------|-------|
| m48→49→50→51 | F#4 | Later-page chains; unified ink window passes |
| m58→59→60 | E4 | Same |
| m69→70 | D5 | Same |

## Root-cause classification

| Bucket | Count | Evidence |
|--------|------:|----------|
| **Barline-interrupted arc** | **8** | Unified `probeInkArcWindow` fails when barline column breaks column coverage; notes exist at correct pitch |
| Same-pitch true tie (recalled) | 6 | Unified window passes end-to-end |
| Different-pitch slur | 0 false ties | `countUncertainSlurs` guards different MIDI |
| Ambiguous arc | 164 uncertain slurs on Gym | Diagnostic only — never emits `<tie>` |

### Per-pair mechanism (missed)

1. **Detection, not application:** `detectedTieCount === appliedTieCount` (6=6).
2. **Same-pitch confirmed:** Truth and generated both have matching MIDI at adjacent measures.
3. **Ink geometry:** Tie arc spans measure boundary; vertical barline ink sits inside the unified x-window and fails the 50%/75% column-coverage test.
4. **Staff-line filter:** Continuous-row exclusion works on hits; misses are not staff-line false positives.
5. **Neighboring slur risk:** Low on missed pairs — all same-pitch chains.

## Simulations run

| Candidate | Gym recall | Twinkle false ties | Cruel Angel metrics | Verdict |
|-----------|------------|-------------------|----------------------|---------|
| Relax cross-measure thresholds (0.45/0.65) | 6/14 | 0 | unchanged | **No gain** (prior sprint) |
| Barline-split windows only (replace unified) | **1/14** | 0 | unchanged | **Regressed — reverted** |
| Unified first, split fallback | 6/14 | 0 | unchanged | **No gain** |

Synthetic barline test confirms split windows **can** detect interrupted arcs (`probeCrossMeasureTiePair` → `barline-interrupted`), but on the real Gymnopédie PDF the split segments do not simultaneously pass with matching sides for m9→10 — likely due to measure-box boundary vs. playable-ink mismatch and shallow arc apex near the barline.

## Decision

**No detector promotion.** Threshold lowering and naive barline-split both fail acceptance. Next pass needs **per-pair ink traces on the live PDF** (not just synthetic) to tune segment bounds or arc-side consistency without breaking m48+ recalls.

## Diagnostics added

- `probeInkArcWindow`, `crossMeasureInkArcSegments` exported from `detectVectorTies.js`
- `omrTieInkArcDiagnostics.js` — `probeCrossMeasureTiePair`, `TIE_ARC_CLASS`
- `tests/omrTieRecall.test.js` — barline-interrupted probe pins, Gym 6/14, Twinkle 0 false ties

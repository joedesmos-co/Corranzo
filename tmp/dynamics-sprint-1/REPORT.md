# Dynamics Recognition Sprint 1 — Report

## Status
**ACCEPTED and frozen (2026-07-26).** See `ACCEPTED.md`.
Real-world validation scaffold: `benchmarks/omr-dynamics-validation/`.
Follow-on recognition: Tempo Recognition Sprint 1.

## Defect taxonomy (established)

| Layer | Failure mode | Pre-sprint |
| --- | --- | --- |
| 1. Symbol recognition | Markings never detected on vector path | Dominant |
| 1. Symbol recognition | Invented `p`/`mf`/`f` from anonymous ink | Raster FP risk |
| 2. Staff/measure/onset | Page-level first text hit stamped on every measure | Wrong onset / duplicates |
| 3. MusicXML emission | No per-position `<dynamics>`; no `<wedge>` | Incomplete |
| 4. Playback | Secondary — maps velocity only if MusicXML present | Out of polish scope |

Frozen evaluator lists Dynamics / hairpins as **unsupported** — corpus Dynamics scores use the independent harness (`omrDynamicsQuality.js`).

## Dominant root causes fixed
1. **Never detected (vector)** — dynamics now attached on vector and raster via `attachDynamicsToMeasureRecords`.
2. **Misclassified / invented** — `detectDynamicNearMeasure` disabled (always `null`).
3. **Wrong association** — per-item text/SMuFL candidates associated to measure boxes by x/y; onset from playable span; staff hint from vertical band.
4. **Not emitted** — MusicXML emits `<dynamics>` + `<wedge type="crescendo|diminuendo|stop">` with optional staff/offset.
5. **Hairpin start/stop** — open wedges get bounded auto-stop on later measures.
6. **Duplicate / FP control** — fretted pages reject lone ASCII `p`/`f` (technique letters); ink hairpins only on non-TAB pages.

## Synthetic harness (independent; truth MusicXML has no dynamics)

| Metric | Before | After |
| --- | ---: | ---: |
| F1 | 0.0 | **1.0** |
| Recall | 0.0 | **1.0** |
| Precision | 1.0 | **1.0** |
| TP / FP / FN | 0 / 0 / 8 | **8 / 0 / 0** |

Per-symbol after (synthetic sprint tokens):

| Symbol | TP | FP | FN |
| --- | ---: | ---: | ---: |
| pp | 1 | 0 | 0 |
| p | 1 | 0 | 0 |
| mp | 1 | 0 | 0 |
| mf | 1 | 0 | 0 |
| f | 1 | 0 | 0 |
| ff | 1 | 0 | 0 |
| crescendo | 1 | 0 | 0 |
| diminuendo | 1 | 0 | 0 |

Staff-association errors: 0 · Onset-association errors: 0 (on the synthetic sequence fixture).

## Frozen semantic corpus gate (non-regression)

| Class | Before (Interp. freeze) | After Dynamics S1 | Δ |
| --- | ---: | ---: | ---: |
| Overall | 61.9% | 61.9% | 0 |
| Pitch | 58.4% | 58.4% | 0 |
| Rhythm | 65.2% | 65.2% | 0 |
| Sustain/Tie | 46.7% | 46.7% | 0 |
| Articulation | 83.9% | 83.9% | 0 |
| Measure Structure | 66.1% | 66.1% | 0 |
| Interpretation | 13.3% | 13.3% | 0 |

Interpretation defects unchanged: `repeat-mismatch` ×4, `volta-mismatch` ×4.

Corpus PDF truth has **no** printed dynamics → Dynamics class not scored by frozen evaluator. Corpus OMR emission after FP gates: **0 dynamics / 0 wedges** on all 9 enforced fixtures (no new FPs).

## Focused tests
`tests/dynamicsSprint1.test.js` — cases 1–10 plus SMuFL, component merge, cresc./dim. words, quality harness.

## Remaining unsupported / deferred
- D.C. / D.S. / Segno / Coda / Fine (Interpretation deferred)
- Ink-only hairpins on fretted/TAB pages (disabled — beams/slurs FP)
- Lone ASCII `p`/`f` on fretted pages (technique collision)
- `sf` / `fp` / `rfz` / `ppp` / `fff` beyond sprint-1 map
- Shared piano dynamics as explicit dual-staff emission (currently staff unset / shared)
- Voice-level dynamics inside a staff
- Expressive playback curves (intentionally not added)

## Files
- `src/features/omr/detectOmrDynamics.js` — recognition + association
- `src/features/omr/omrDynamicsQuality.js` — independent TP/FP/FN harness
- `src/features/omr/processOmrPage.js` — vector + raster attach
- `src/features/omr/buildOmrMusicXml.js` — dynamics + wedge emission
- `src/features/omr/detectOmrExpression.js` — re-exports + articulations/pedal
- `tests/dynamicsSprint1.test.js`

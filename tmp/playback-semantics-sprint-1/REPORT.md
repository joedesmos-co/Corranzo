# Playback Semantics Sprint 1 — Report

## Frozen recognition (untouched)
Tempo · Dynamics · Articulations · Ties · Repeats/voltas · Pitch/Rhythm · Guitar mapping · evaluator `2.0.0`

Tempo Sprint 1 accepted: `tmp/tempo-sprint-1/ACCEPTED.md`  
Tempo validation corpus scaffold: `benchmarks/omr-tempo-validation/`

## Policy (documented)
`src/features/playback/playbackExpressionPolicy.js`

| Mark | Performed effect |
| --- | --- |
| Staccato | sounding × 0.5 |
| Tenuto | sounding × 1.05 (≤ 1.15) |
| Accent | velocity + 0.12 |
| Marcato | velocity + 0.20, sounding × 0.65 |
| Fermata | sounding × 1.75 |
| Dynamics pp…ff | `DYNAMICS_TO_VELOCITY` |
| Wedge without endpoint dynamic | ±0.18 velocity fallback |

Written durations / MIDI pitch / guitar frets are never rewritten.

## What shipped
- Tenuto / marcato / fermata consumption in schedule
- Fermata parse from MusicXML notations
- Wedge parse + velocity interpolation (staff-aware dynamics sticky across measures)
- Multi-note tie-chain middle absorption + `tieChainId`
- Richer schedule fields + `playbackSemanticsBenchmark.js`
- Focused tests: `tests/playbackSemanticsSprint1.test.js` (15)

## Metrics (focused harness)

| Check | Result |
| --- | --- |
| Tie continuation re-attacks | **0** |
| Three-note tie chain | 2 suppressed, 1 attack |
| Partial chord tie | only tied pitch suppressed |
| Slurs | independent attacks |
| Staccato / accent / marcato / fermata | policy ratios applied |
| pp → mf → ff | ordered velocities |
| Cresc / dim wedges | interpolated |
| Dotted-quarter tempo | 72 → 108 quarter BPM |
| Mid-score / repeat tempo | correct performed onsets / passes |
| Piano + Guitar pitch | unchanged |

## Frozen semantic corpus (non-regression)

| Class | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Overall | 61.9% | 61.9% | 0 |
| Pitch | 58.4% | 58.4% | 0 |
| Rhythm | 65.2% | 65.2% | 0 |
| Sustain | 46.7% | 46.7% | 0 |
| Articulation | 83.9% | 83.9% | 0 |
| Measure Structure | 66.1% | 66.1% | 0 |
| Interpretation | 13.3% | 13.3% | 0 |

## Still unavailable / deferred
- Gradual rit/accel ramps beyond discrete tempo events
- Sample-library / piano-tone replacement
- Architecture refactor of the audio engine
- Hairpin interpolation when OMR never emitted wedges (recognition gap on corpus PDFs)

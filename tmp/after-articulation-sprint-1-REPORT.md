# Articulation Sprint 1 Report

**Evaluator:** frozen 2.0.0 / schema 2 (untouched)

## Scoreboard (mean across fixtures)

| Class | Before | After | Δ pp |
| --- | ---: | ---: | ---: |
| Overall | 53.9% | 54.5% | +0.6 |
| Articulation | 68.5% | 72.6% | +4.1 |
| Sustain/Tie | 77.8% | 77.8% | +0 |
| Rhythm | 63.2% | 63.2% | +0 |
| Pitch | 16.7% | 16.7% | +0 |
| Measure structure | 51% | 51% | +0 |
| Interpretation | 0% | 0% | +0 |
| Playback | 100% | 100% | +0 |

## Articulation defect counts (corpus roll-up)

| Code | Before | After | Δ |
| --- | ---: | ---: | ---: |
| missing-staccato | 27 | 27 | +0 |
| missing-accent | 35 | 31 | -4 |
| missing-tenuto | 0 | 0 | +0 |
| missing-marcato | 0 | 0 | +0 |
| unexpected-staccato | 0 | 0 | +0 |
| unexpected-accent | 0 | 0 | +0 |

## Per-fixture Articulation

| Fixture | Before | After | Δ pp | Sustain | Rhythm |
| --- | ---: | ---: | ---: | ---: | ---: |
| piano-beginner-single-vector | 100% | 100% | +0 | 100→100 | 84.1→84.1 |
| piano-grand-voices-vector | 0% | 0% | +0 | 100→100 | 65.6→65.6 |
| piano-rhythm-tuplets-vector | 100% | 100% | +0 | 0→0 | 64.9→64.9 |
| piano-articulation-scan | 16.7% | 16.7% | +0 | 100→100 | 91.3→91.3 |
| piano-dense-advanced-vector | 0% | 36.8% | +36.8 | 100→100 | 43.8→43.8 |
| guitar-tab-sparse-vector | 100% | 100% | +0 | 100→100 | 17.2→17.2 |
| guitar-standard-chords-vector | 100% | 100% | +0 | 100→100 | 46→46 |
| guitar-paired-chords-vector | 100% | 100% | +0 | 100→100 | 72.7→72.7 |
| guitar-techniques-paired-vector | 100% | 100% | +0 | 0→0 | 83.3→83.3 |

## Root causes fixed

- Vector accent/staccato staff-space used a mis-cleffed note’s tiny staff gap and rejected valid marks ~31px above chord heads (dense accents 0→37%).
- One SMuFL articulation glyph above a chord was bound only to the nearest head; MusicXML truth encodes the mark on every chord tone — added chord-column broadcast.
- Accent vertical reach / measure y-pad were too tight for marks above compressed staff estimates; floored articulation staff-space and allowed column-aligned pixel reach.

## Remaining dominant articulation failures

- piano-grand-voices-vector still A=0% on the evaluator despite emitting 12 staccato + 12 accent — pitch/event pairing is broken (pitch 0%), so articulation TP cannot land on aligned pairs.
- piano-articulation-scan remains raster-only: missing-staccato and missing-accent dominate; crude ink staccato still FPs; no reliable raster accent yet (raster changes reverted to protect Sustain orphan-start).
- missing-accent ×31 and missing-staccato ×27 still the top articulation defects; no tenuto/marcato/fermata in this corpus.

## Acceptance

- Articulation improves measurably: **PASS** (68.5% → 72.6%)
- Sustain/Tie does not regress >1 pp: **PASS** (0 pp)
- Rhythm does not regress >1 pp: **PASS** (0 pp)
- No other category drops >1 pp: **PASS** 
- Evaluator untouched: **PASS**

## Sustain/Tie freeze (pre-sprint sanity)

Orphan-start keep in `finalizeRasterPageTies.js` uses general musical/visual conditions only (unpaired enrich candidate, staccato mark, not last measure, division≥4, highest midi in event, no later same-pitch). No fixture name, measure number, exact pitch, or benchmark chord index. **Sustain/Tie work remains frozen at 77.8%.**

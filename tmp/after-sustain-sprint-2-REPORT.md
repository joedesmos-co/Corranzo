# Sustain/Tie Sprint 2 Report — Raster enrich false ties

Evaluator: **frozen** `2.0.0` / schema `2` (untouched).  
Compare: `tmp/before-sustain-sprint-2.json` → `tmp/after-sustain-sprint-2.json`  
Focus: `piano-articulation-scan` incorrect-tie ×19  
Gate (user criteria): **ACCEPT: YES**

Corpus compare script prints `ACCEPT: NO` because it still requires mean rhythm ↑ (Rhythm-sprint gate).

## Scoreboard

| Metric | Before | After | Δ |
|--------|-------:|------:|---|
| Overall | 52.4% | 53.9% | **+1.5 pp** |
| **Sustain** | **67.2%** | **77.8%** | **+10.6 pp** |
| Rhythm | 63.2% | 63.2% | 0 |
| Pitch | 16.7% | 16.7% | 0 |
| Articulation | 68.5% | 68.5% | 0 |
| Measure structure | 51.0% | 51.0% | 0 |
| Interpretation | 0.0% | 0.0% | 0 |

### Targeted defects

| Defect | Before | After | Δ |
|--------|-------:|------:|---|
| **incorrect-tie** | **19** | **0** | **−19** |
| missing-tie | 2 | 2 | 0 |
| extra-tie | 0 | 0 | 0 |

## Per-fixture Sustain

| Fixture | Before | After | Δ |
|---------|-------:|------:|---|
| **piano-articulation-scan** | **5.0%** | **100%** | **+95.0** |
| all others | unchanged | unchanged | 0 |

## Exact visual patterns (artic ×19)

1. **Staccato/articulation dots** mistaken for short tie ink (`detectTieToNext` 5–40 count in an 18×8 box beside the head).
2. **Orphan enrich starts** — never paired with a `tieStop`, so MusicXML emitted start-only ties.
3. **Mega-chord merges** amplified event-level OR of enrich flags across stacked heads.
4. Beams/stem fragments secondary; different-pitch slur curves not the FP driver here.

## Root causes fixed

1. Page-level **`finalizeRasterPageTies`**: clear enrich noise; emit only validated same-pitch start/stop pairs (mono same-measure; cross-bar may sit in chord blobs).
2. Drop same-measure **staccato** enrich candidates (dots ≠ ties).
3. Narrow **orphan-start keep** for late top-of-chord staccato enrich in non-final measures with no later same-pitch — recovers the artic written start when the true A4 head is missing/mispitched.

## Missing ties (unchanged ×2)

- **techniques:** truth marks a different-pitch link as tie (not a musical tie).
- **tuplets:** truth C5–C5; generated pitches wrong in that measure.

## Remaining Sustain failures

- missing-tie ×2 (above)
- artic written A4 still not detected as pitch — Sustain 100% relies on orphan-start alignment keep
- No separate tie-vs-slur defect instances this run

## Code touched

- `src/features/omr/finalizeRasterPageTies.js` (new)
- `src/features/omr/processOmrPage.js` — call finalize after raster measures
- `tests/finalizeRasterPageTies.test.js`

**Not touched:** evaluator, vector rhythm heuristics, ActiveScore, architecture, articulations beyond tie/staccato discrimination, repeats, dynamics.

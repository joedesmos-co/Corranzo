# Recovered-tone rhythm trace — Guitar-standard

- Pre-RC-A: `2622914`
- Post-RC-A: `d8016e2`
- Fixture: `guitar-standard-chords-vector` (standard notation only; no TAB band)
- Artifacts: `rhythm-trace/guitar-standard-{pre,post}.json`

## Scoreboard

| | Pre | Post |
|---|---:|---:|
| Notes emitted | 71 | **115** |
| Pitch | 45% | **78%** |
| Rhythm | **52%** (67/130) | **45%** (98/220) |
| Onset mismatches | 44 | **84** |
| Duration mismatches | 19 | 38 |
| Missing notes | 50 | **5** |
| Incorrect chord | 28 | **15** |
| Extra notes | 6 | 5 |

Absolute rhythm-correct checks rose 67→98, but the denominator grew faster (130→220) as recovered tones entered onset/duration scoring.

## Chord integrity (not the failure)

Recovered open-E / deep-ledger tones **join their visual chord columns**:

| Measure | Post first event | Midis | Sources | Fragmented |
|---:|---|---|---|---|
| 8 | startDiv 2, n=6 | E2 B2 E3 G3 B3 E4 | all `vector-glyph` | `fragmentedOnsetCount: 0` |
| 6 | startDiv 2, n=3 | recovered low stack | vector-glyph | 0 |

No separate orphan onsets, no TAB duplicates, no joint-polyphonic retimes (`jointPolyphonicRhythmAdjusted: false`), no dense eighth resnap (`denseChordOnsetResnapped: false` — single-clef early-out).

**Ruled out:** (1) split chord events, (2) independent orphan slots, (4) lost chord membership before packing, (5) Guitar voice split, (6) TAB duplicate semantics.

## First failing transition

**Stage: position→onset snap + opening alignment** (`buildNoteEventsFromGroups` → `startDivisionFromPosition` → `alignOpeningGroupStart`).

| Measure | First `positionInMeasure` | Snapped starts | Truth onsets (Q) | Gen onsets (Q) |
|---:|---:|---|---|---|
| 1 | 0.029 | 0,2,4,7,11 | 0,0.5,1,2,3 | 0,0.5,1,1.75,2.75 |
| 2 | 0.168 | **2**,4,6,8,11 | 0,0.5,1,2,3 | **0.5**,1,1.5,2,2.75 |
| 6 | 0.166 | **2**,4,6,8,11 | 0,0.5,1,2,3 | **0.5**,1,1.5,2,2.75 |
| 8 | 0.164 | **2**,4,6,8,11 | 0,0.5,1,2,3 | **0.5**,1,1.5,2,2.75 |

`alignOpeningGroupStart` only pulls the first start to 0 when `starts[0] ≤ eighth-grid` **and** `firstPosition < (1/beats)×0.55` (=0.1375 in 4/4). Opening columns at ~0.16 sit **just outside** that window, so the whole grid stays delayed by one eighth.

Pre-RC-A used the **same delayed grids** on m2/m4/m7/m8, but missing low tones meant fewer onset-mismatch rows. Post-RC-A fills those chords (e.g. m8 11→25 notes) → each delayed column now scores many onset mismatches.

**Primary mechanism: (7) meter/position packing reacting to increased note count** *plus* **(8) evaluator alignment** — recovered tones inherit an already-late column onset.

Also contributes: (3) `groups.length > beats` keeps `usePositionStarts` true (5 columns vs 4 beats), so the delayed snap path stays active.

## Per-measure onset mismatch load

| M | Pre onset-mis | Post onset-mis | Gen notes pre→post |
|---:|---:|---:|---|
| 1 | 4 | 4 | 10→10 |
| 2 | 8 | 8 | 10→10 |
| 3 | 8 | 8 | 13→13 |
| 4 | 11 | **13** | 12→17 |
| 5 | 2 | **4** | 5→10 |
| 6 | 0 | **9** | 3→13 |
| 7 | 4 | **15** | 7→17 |
| 8 | 7 | **23** | 11→25 |

Regression is concentrated where RC-A recovered ledger tones (m4–m8).

## Simulated repair at failing stage

Left-shifting the entire start grid by `starts[0]` when the first column is still inside the first-beat window (`firstPosition < 1/beats` and `0 < starts[0] ≤ quarter`):

`[2,4,6,8,11] → [0,2,4,6,9]` vs truth `[0,2,4,8,12]`

First three columns lock to the barline/eighth grid; later columns still need gap refinement but onset-mismatch count should fall sharply on recovered 6-note stacks.

## Integration fix target (Phase 2)

**Smallest change:** generalize `alignOpeningGroupStart` to translate the full position-derived onset grid to the barline when the opening column is a delayed first-beat snap — without touching RC-A pitch/windows, without merging by register, without fixture hardcoding.

Recovered tones already share chord timing; this makes that shared timing barline-correct.

### Live path nuance (confirmed while implementing)

Dense snap often emits `[3,4,6,8,11]`; `resnapFlooredBeamOnsets` then yields `[2,4,6,8,11]`.
Opening align must therefore handle chord-dominated odd-sixteenth openings and/or
re-run after beam resnap. A follow-on sparse `beats+1` column refine expands
compressed tails to `[0,2,4,8,12]` so later columns do not trade onset wins for
pitch/chord mismatches. Dense tuplet packs (`> beats+2`) stay out of scope.

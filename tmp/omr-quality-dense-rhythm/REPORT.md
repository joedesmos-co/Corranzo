# OMR Quality Sprint — Dense Notation & Rhythm Refinement

## Shipped slice

The largest high-confidence remaining category was **wrong note duration**
(382 cases). The shipped fix addresses the repeated
vector-lane margin drift that compressed terminal eighths into sixteenths.

| Rank | Baseline category | Count |
| ---: | --- | ---: |
| 1 | wrong note duration | 382 |
| 2 | dense beam grouping | 262 |
| 3 | dense chord separation | 149 |
| 4 | missing rest | 66 |
| 5 | tuplet grouping | 12 |
| 6 | wrong rest duration | 2 |
| 7 | invented rest | 1 |

Raster/vector are source-availability strata, not mutually exclusive failure
causes, so they are reported separately from the actionable ranking:

- vector-source direct defects: **553**
- raster-source direct defects: **59**

## Real-score result

- Wrong note-duration errors: **382 → 356**
  (26 fewer; 6.8% reduction).
- Carol of the Bells semantic score: **49% → 50%**.
- Carol rhythm score: **51% → 61%**.
- Dense chord errors: **149 → 147**.
- Rest and tuplet categories: unchanged.
- Changed MusicXML measures: Carol of the Bells only.
- MIDI inventory, note count, ties/slurs, accidentals, articulations, and
  key-signature semantics: unchanged in every validation source.
- Corrected onsets intentionally change parsed cross-staff attack ordering in
  Carol only; performed-reference playback stays
  **91% → 91%**.

Representative measure 1 now matches truth exactly:

- before starts/durations: 0/1, 1.25/.5, 1.75/.5, 2.25/.5, 2.75/.25
- after and truth: 0/1, 1/.5, 1.5/.5, 2/.5, 2.5/.5

## Frozen regressions

- Frozen semantic corpus: all class deltas **0**; regressions **0**.
- The generic comparator prints neutral ACCEPT: NO because it requires a scored
  corpus improvement. The dedicated real-score taxonomy records the 26-case
  duration reduction.
- Audio and playback-expression code were untouched.

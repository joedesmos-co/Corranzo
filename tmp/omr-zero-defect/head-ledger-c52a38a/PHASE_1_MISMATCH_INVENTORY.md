# Phase 1 — Semantic Mismatch Inventory

- Commit: `c52a38a`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 9/9
- Total structured mismatches: **319**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 97 |
| onset-mismatch | 57 |
| incorrect-pitch | 54 |
| incorrect-chord | 44 |
| extra-note | 14 |
| tempo-mismatch | 9 |
| missing-staccato | 8 |
| missing-tie | 7 |
| missing-note | 6 |
| missing-rest | 4 |
| missing-accent | 4 |
| volta-mismatch | 4 |
| repeat-mismatch | 4 |
| incorrect-tie | 3 |
| extra-rest | 1 |
| rest-duration-error | 1 |
| dotted-rhythm-error | 1 |
| split-measure | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 98 |
| voice-onset-assignment | 57 |
| accidental-or-staff-position | 45 |
| chord-grouping | 44 |
| other | 23 |
| missing-or-extra-extraction | 20 |
| articulation | 12 |
| sustain-tie | 10 |
| staff-pitch-assignment | 9 |
| measure-structure | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 12 | 32/32 | onset-mismatch:5, duration-mismatch:3, missing-rest:1, missing-note:1 |
| piano-grand-voices-vector | 3 | 88/88 | missing-tie:2, tempo-mismatch:1 |
| piano-rhythm-tuplets-vector | 71 | 63/63 | onset-mismatch:28, duration-mismatch:24, missing-note:4, extra-note:4 |
| piano-articulation-scan | 52 | 88/88 | duration-mismatch:32, missing-staccato:8, missing-accent:4, incorrect-tie:3 |
| piano-dense-advanced-vector | 52 | 264/264 | incorrect-pitch:26, incorrect-chord:24, split-measure:1, tempo-mismatch:1 |
| guitar-tab-sparse-vector | 72 | 32/40 | duration-mismatch:30, onset-mismatch:23, extra-note:8, incorrect-pitch:4 |
| guitar-standard-chords-vector | 27 | 115/115 | incorrect-pitch:12, incorrect-chord:9, duration-mismatch:2, onset-mismatch:1 |
| guitar-paired-chords-vector | 27 | 116/116 | incorrect-pitch:12, duration-mismatch:6, incorrect-chord:6, repeat-mismatch:2 |
| guitar-techniques-paired-vector | 3 | 32/32 | missing-tie:2, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 319/319
- withCandidateIds: 278/319
- withGlyphIds: 211/319
- withStemOwnership: 211/319
- withBeamOwnership: 211/319
- withAccidentalProvenance: 174/319
- withFirstDivergence: 319/319

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

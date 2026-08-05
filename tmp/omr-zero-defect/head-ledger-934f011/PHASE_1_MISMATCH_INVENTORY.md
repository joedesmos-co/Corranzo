# Phase 1 — Semantic Mismatch Inventory

- Commit: `934f011`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 9/9
- Total structured mismatches: **252**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 67 |
| incorrect-pitch | 50 |
| incorrect-chord | 42 |
| onset-mismatch | 34 |
| tempo-mismatch | 9 |
| missing-staccato | 8 |
| missing-tie | 7 |
| missing-note | 6 |
| extra-note | 6 |
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
| duration-inference | 68 |
| accidental-or-staff-position | 44 |
| chord-grouping | 42 |
| voice-onset-assignment | 34 |
| other | 23 |
| missing-or-extra-extraction | 12 |
| articulation | 12 |
| sustain-tie | 10 |
| staff-pitch-assignment | 6 |
| measure-structure | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 12 | 32/32 | onset-mismatch:5, duration-mismatch:3, missing-rest:1, missing-note:1 |
| piano-grand-voices-vector | 3 | 88/88 | missing-tie:2, tempo-mismatch:1 |
| piano-rhythm-tuplets-vector | 71 | 63/63 | onset-mismatch:28, duration-mismatch:24, missing-note:4, extra-note:4 |
| piano-articulation-scan | 52 | 88/88 | duration-mismatch:32, missing-staccato:8, missing-accent:4, incorrect-tie:3 |
| piano-dense-advanced-vector | 52 | 264/264 | incorrect-pitch:26, incorrect-chord:24, split-measure:1, tempo-mismatch:1 |
| guitar-tab-sparse-vector | 5 | 32/32 | repeat-mismatch:2, volta-mismatch:2, tempo-mismatch:1 |
| guitar-standard-chords-vector | 27 | 115/115 | incorrect-pitch:12, incorrect-chord:9, duration-mismatch:2, onset-mismatch:1 |
| guitar-paired-chords-vector | 27 | 116/116 | incorrect-pitch:12, duration-mismatch:6, incorrect-chord:6, repeat-mismatch:2 |
| guitar-techniques-paired-vector | 3 | 32/32 | missing-tie:2, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 252/252
- withCandidateIds: 211/252
- withGlyphIds: 211/252
- withStemOwnership: 211/252
- withBeamOwnership: 211/252
- withAccidentalProvenance: 174/252
- withFirstDivergence: 252/252

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

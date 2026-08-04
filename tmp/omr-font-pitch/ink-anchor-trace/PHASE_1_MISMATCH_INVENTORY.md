# Phase 1 — Semantic Mismatch Inventory

- Commit: `73f0ef6`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 4/4
- Total structured mismatches: **341**

## Counts by defect code

| Code | Count |
|---|---|
| incorrect-pitch | 123 |
| onset-mismatch | 84 |
| incorrect-chord | 73 |
| duration-mismatch | 18 |
| missing-note | 9 |
| extra-note | 9 |
| missing-accent | 6 |
| missing-rest | 5 |
| tempo-mismatch | 4 |
| missing-tie | 3 |
| extra-rest | 2 |
| dotted-rhythm-error | 2 |
| voice-mismatch | 1 |
| missing-dot | 1 |
| split-measure | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| accidental-or-staff-position | 98 |
| voice-onset-assignment | 84 |
| chord-grouping | 73 |
| staff-pitch-assignment | 25 |
| duration-inference | 22 |
| missing-or-extra-extraction | 18 |
| other | 11 |
| articulation | 6 |
| sustain-tie | 3 |
| measure-structure | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 12 | 32/32 | onset-mismatch:5, duration-mismatch:3, missing-rest:1, missing-note:1 |
| piano-grand-voices-vector | 41 | 88/88 | incorrect-pitch:27, incorrect-chord:11, missing-tie:2, tempo-mismatch:1 |
| piano-rhythm-tuplets-vector | 79 | 63/63 | onset-mismatch:24, duration-mismatch:15, incorrect-pitch:13, incorrect-chord:7 |
| piano-dense-advanced-vector | 209 | 264/264 | incorrect-pitch:83, incorrect-chord:55, onset-mismatch:55, missing-accent:6 |

## Pipeline provenance coverage

- withPage: 341/341
- withCandidateIds: 317/341
- withGlyphIds: 317/341
- withStemOwnership: 317/341
- withBeamOwnership: 317/341
- withAccidentalProvenance: 317/341
- withFirstDivergence: 341/341

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

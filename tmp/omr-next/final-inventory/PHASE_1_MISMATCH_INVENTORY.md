# Phase 1 — Semantic Mismatch Inventory

- Commit: `3404694`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 9/9
- Total structured mismatches: **1016**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 247 |
| duration-mismatch | 227 |
| incorrect-pitch | 156 |
| incorrect-chord | 150 |
| extra-note | 89 |
| missing-note | 85 |
| missing-accent | 11 |
| tempo-mismatch | 9 |
| missing-staccato | 8 |
| missing-tie | 6 |
| missing-rest | 5 |
| incorrect-tie | 4 |
| volta-mismatch | 4 |
| split-measure | 4 |
| repeat-mismatch | 4 |
| extra-rest | 2 |
| dotted-rhythm-error | 2 |
| voice-mismatch | 1 |
| missing-dot | 1 |
| merged-measure | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| voice-onset-assignment | 247 |
| duration-inference | 231 |
| missing-or-extra-extraction | 174 |
| chord-grouping | 150 |
| accidental-or-staff-position | 115 |
| staff-pitch-assignment | 41 |
| other | 24 |
| articulation | 19 |
| sustain-tie | 10 |
| measure-structure | 5 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 12 | 32/32 | onset-mismatch:5, duration-mismatch:3, missing-rest:1, missing-note:1 |
| piano-grand-voices-vector | 61 | 88/88 | incorrect-pitch:25, duration-mismatch:18, incorrect-chord:11, missing-tie:2 |
| piano-rhythm-tuplets-vector | 59 | 63/63 | onset-mismatch:24, duration-mismatch:15, missing-rest:4, missing-note:3 |
| piano-articulation-scan | 195 | 88/113 | incorrect-pitch:40, extra-note:39, incorrect-chord:37, duration-mismatch:24 |
| piano-dense-advanced-vector | 437 | 264/264 | onset-mismatch:129, duration-mismatch:115, incorrect-pitch:78, incorrect-chord:66 |
| guitar-tab-sparse-vector | 72 | 32/40 | duration-mismatch:30, onset-mismatch:23, extra-note:8, incorrect-pitch:4 |
| guitar-standard-chords-vector | 97 | 115/71 | onset-mismatch:38, missing-note:22, duration-mismatch:14, incorrect-chord:13 |
| guitar-paired-chords-vector | 80 | 116/103 | missing-note:24, incorrect-chord:19, extra-note:14, duration-mismatch:8 |
| guitar-techniques-paired-vector | 3 | 32/32 | missing-tie:2, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 1016/1016
- withCandidateIds: 913/1016
- withGlyphIds: 846/1016
- withStemOwnership: 846/1016
- withBeamOwnership: 846/1016
- withAccidentalProvenance: 678/1016
- withFirstDivergence: 1016/1016

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

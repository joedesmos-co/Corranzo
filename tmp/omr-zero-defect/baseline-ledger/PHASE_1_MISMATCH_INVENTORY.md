# Phase 1 — Semantic Mismatch Inventory

- Commit: `2366c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 9/9
- Total structured mismatches: **511**

## Counts by defect code

| Code | Count |
|---|---|
| incorrect-pitch | 106 |
| incorrect-chord | 95 |
| duration-mismatch | 80 |
| onset-mismatch | 78 |
| extra-note | 65 |
| missing-note | 34 |
| tempo-mismatch | 9 |
| missing-staccato | 8 |
| missing-tie | 6 |
| missing-rest | 5 |
| incorrect-tie | 4 |
| missing-accent | 4 |
| volta-mismatch | 4 |
| repeat-mismatch | 4 |
| split-measure | 3 |
| extra-rest | 2 |
| dotted-rhythm-error | 2 |
| voice-mismatch | 1 |
| missing-dot | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| missing-or-extra-extraction | 99 |
| chord-grouping | 95 |
| duration-inference | 84 |
| accidental-or-staff-position | 83 |
| voice-onset-assignment | 78 |
| other | 24 |
| staff-pitch-assignment | 23 |
| articulation | 12 |
| sustain-tie | 10 |
| measure-structure | 3 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 12 | 32/32 | onset-mismatch:5, duration-mismatch:3, missing-rest:1, missing-note:1 |
| piano-grand-voices-vector | 30 | 88/88 | incorrect-pitch:19, incorrect-chord:8, missing-tie:2, tempo-mismatch:1 |
| piano-rhythm-tuplets-vector | 59 | 63/63 | onset-mismatch:24, duration-mismatch:15, missing-rest:4, missing-note:3 |
| piano-articulation-scan | 195 | 88/113 | incorrect-pitch:40, extra-note:39, incorrect-chord:37, duration-mismatch:24 |
| piano-dense-advanced-vector | 51 | 264/264 | incorrect-pitch:26, incorrect-chord:23, split-measure:1, tempo-mismatch:1 |
| guitar-tab-sparse-vector | 72 | 32/40 | duration-mismatch:30, onset-mismatch:23, extra-note:8, incorrect-pitch:4 |
| guitar-standard-chords-vector | 20 | 115/115 | incorrect-pitch:12, incorrect-chord:7, tempo-mismatch:1 |
| guitar-paired-chords-vector | 69 | 116/116 | incorrect-chord:16, missing-note:16, extra-note:14, duration-mismatch:8 |
| guitar-techniques-paired-vector | 3 | 32/32 | missing-tie:2, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 511/511
- withCandidateIds: 449/511
- withGlyphIds: 382/511
- withStemOwnership: 382/511
- withBeamOwnership: 382/511
- withAccidentalProvenance: 214/511
- withFirstDivergence: 511/511

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

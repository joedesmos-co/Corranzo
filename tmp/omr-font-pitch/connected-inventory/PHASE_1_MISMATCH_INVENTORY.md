# Phase 1 — Semantic Mismatch Inventory

- Commit: `73f0ef6`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 9/9
- Total structured mismatches: **746**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 161 |
| incorrect-pitch | 154 |
| incorrect-chord | 136 |
| duration-mismatch | 94 |
| extra-note | 73 |
| missing-note | 69 |
| tempo-mismatch | 9 |
| missing-staccato | 8 |
| missing-accent | 8 |
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
| voice-onset-assignment | 161 |
| missing-or-extra-extraction | 142 |
| chord-grouping | 136 |
| accidental-or-staff-position | 118 |
| duration-inference | 98 |
| staff-pitch-assignment | 36 |
| other | 24 |
| articulation | 16 |
| sustain-tie | 10 |
| measure-structure | 5 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 12 | 32/32 | onset-mismatch:5, duration-mismatch:3, missing-rest:1, missing-note:1 |
| piano-grand-voices-vector | 43 | 88/88 | incorrect-pitch:30, incorrect-chord:10, missing-tie:2, tempo-mismatch:1 |
| piano-rhythm-tuplets-vector | 59 | 63/63 | onset-mismatch:24, duration-mismatch:15, missing-rest:4, missing-note:3 |
| piano-articulation-scan | 195 | 88/113 | incorrect-pitch:40, extra-note:39, incorrect-chord:37, duration-mismatch:24 |
| piano-dense-advanced-vector | 185 | 264/264 | incorrect-pitch:71, incorrect-chord:53, onset-mismatch:45, missing-note:5 |
| guitar-tab-sparse-vector | 72 | 32/40 | duration-mismatch:30, onset-mismatch:23, extra-note:8, incorrect-pitch:4 |
| guitar-standard-chords-vector | 97 | 115/71 | onset-mismatch:38, missing-note:22, duration-mismatch:14, incorrect-chord:13 |
| guitar-paired-chords-vector | 80 | 116/103 | missing-note:24, incorrect-chord:19, extra-note:14, duration-mismatch:8 |
| guitar-techniques-paired-vector | 3 | 32/32 | missing-tie:2, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 746/746
- withCandidateIds: 662/746
- withGlyphIds: 595/746
- withStemOwnership: 595/746
- withBeamOwnership: 595/746
- withAccidentalProvenance: 427/746
- withFirstDivergence: 746/746

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

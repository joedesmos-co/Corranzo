# Phase 1 — Semantic Mismatch Inventory

- Commit: `3404694`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 9/9
- Total structured mismatches: **976**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 229 |
| duration-mismatch | 224 |
| incorrect-pitch | 153 |
| incorrect-chord | 140 |
| extra-note | 92 |
| missing-note | 66 |
| split-measure | 12 |
| missing-accent | 11 |
| tempo-mismatch | 9 |
| missing-staccato | 8 |
| missing-tie | 6 |
| missing-rest | 5 |
| incorrect-tie | 4 |
| volta-mismatch | 4 |
| repeat-mismatch | 4 |
| extra-measure | 3 |
| extra-rest | 2 |
| dotted-rhythm-error | 2 |
| voice-mismatch | 1 |
| missing-dot | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| voice-onset-assignment | 229 |
| duration-inference | 228 |
| missing-or-extra-extraction | 155 |
| chord-grouping | 140 |
| accidental-or-staff-position | 114 |
| staff-pitch-assignment | 39 |
| other | 24 |
| articulation | 19 |
| measure-structure | 15 |
| sustain-tie | 10 |
| alignment-symptom-from-onset-or-pitch | 3 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 12 | 32/32 | onset-mismatch:5, duration-mismatch:3, missing-rest:1, missing-note:1 |
| piano-grand-voices-vector | 61 | 88/88 | incorrect-pitch:25, duration-mismatch:18, incorrect-chord:11, missing-tie:2 |
| piano-rhythm-tuplets-vector | 59 | 63/63 | onset-mismatch:24, duration-mismatch:15, missing-rest:4, missing-note:3 |
| piano-articulation-scan | 195 | 88/113 | incorrect-pitch:40, extra-note:39, incorrect-chord:37, duration-mismatch:24 |
| piano-dense-advanced-vector | 437 | 264/264 | onset-mismatch:129, duration-mismatch:115, incorrect-pitch:78, incorrect-chord:66 |
| guitar-tab-sparse-vector | 72 | 32/40 | duration-mismatch:30, onset-mismatch:23, extra-note:8, incorrect-pitch:4 |
| guitar-standard-chords-vector | 53 | 115/86 | onset-mismatch:20, duration-mismatch:11, extra-note:6, split-measure:5 |
| guitar-paired-chords-vector | 80 | 116/103 | missing-note:24, incorrect-chord:19, extra-note:14, duration-mismatch:8 |
| guitar-techniques-paired-vector | 7 | 32/32 | split-measure:4, missing-tie:2, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 976/976
- withCandidateIds: 875/976
- withGlyphIds: 808/976
- withStemOwnership: 808/976
- withBeamOwnership: 808/976
- withAccidentalProvenance: 640/976
- withFirstDivergence: 976/976

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

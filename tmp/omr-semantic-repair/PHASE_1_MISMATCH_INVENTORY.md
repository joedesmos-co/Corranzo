# Phase 1 — Semantic Mismatch Inventory

- Commit: `2462c1d`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 9/9
- Total structured mismatches: **125**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 35 |
| incorrect-pitch | 27 |
| incorrect-chord | 27 |
| tempo-mismatch | 9 |
| missing-staccato | 8 |
| onset-mismatch | 4 |
| missing-accent | 4 |
| missing-rest | 3 |
| incorrect-tie | 3 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| dotted-rhythm-error | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 36 |
| accidental-or-staff-position | 27 |
| chord-grouping | 27 |
| other | 14 |
| articulation | 12 |
| sustain-tie | 5 |
| voice-onset-assignment | 4 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 1 | 32/32 | tempo-mismatch:1 |
| piano-grand-voices-vector | 1 | 88/88 | tempo-mismatch:1 |
| piano-rhythm-tuplets-vector | 12 | 63/63 | onset-mismatch:4, missing-rest:3, duration-mismatch:3, tempo-mismatch:1 |
| piano-articulation-scan | 52 | 88/88 | duration-mismatch:32, missing-staccato:8, missing-accent:4, incorrect-tie:3 |
| piano-dense-advanced-vector | 55 | 264/264 | incorrect-pitch:27, incorrect-chord:27, tempo-mismatch:1 |
| guitar-tab-sparse-vector | 1 | 32/32 | tempo-mismatch:1 |
| guitar-standard-chords-vector | 1 | 115/115 | tempo-mismatch:1 |
| guitar-paired-chords-vector | 1 | 116/116 | tempo-mismatch:1 |
| guitar-techniques-paired-vector | 1 | 32/32 | tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 125/125
- withCandidateIds: 99/125
- withGlyphIds: 99/125
- withStemOwnership: 99/125
- withBeamOwnership: 99/125
- withAccidentalProvenance: 62/125
- withFirstDivergence: 125/125

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

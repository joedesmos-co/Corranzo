# Phase 1 — Semantic Mismatch Inventory

- Commit: `9b97141`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **71**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 28 |
| duration-mismatch | 24 |
| missing-note | 4 |
| extra-note | 4 |
| missing-rest | 3 |
| incorrect-chord | 3 |
| extra-rest | 1 |
| missing-tie | 1 |
| tempo-mismatch | 1 |
| rest-duration-error | 1 |
| dotted-rhythm-error | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| voice-onset-assignment | 28 |
| duration-inference | 25 |
| missing-or-extra-extraction | 8 |
| other | 6 |
| chord-grouping | 3 |
| sustain-tie | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-rhythm-tuplets-vector | 71 | 63/63 | onset-mismatch:28, duration-mismatch:24, missing-note:4, extra-note:4 |

## Pipeline provenance coverage

- withPage: 71/71
- withCandidateIds: 60/71
- withGlyphIds: 60/71
- withStemOwnership: 60/71
- withBeamOwnership: 60/71
- withAccidentalProvenance: 60/71
- withFirstDivergence: 71/71

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

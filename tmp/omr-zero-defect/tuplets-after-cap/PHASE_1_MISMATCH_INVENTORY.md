# Phase 1 — Semantic Mismatch Inventory

- Commit: `9b97141`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **60**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 26 |
| onset-mismatch | 21 |
| missing-rest | 3 |
| missing-note | 2 |
| extra-note | 2 |
| extra-rest | 1 |
| missing-tie | 1 |
| incorrect-chord | 1 |
| tempo-mismatch | 1 |
| rest-duration-error | 1 |
| dotted-rhythm-error | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 27 |
| voice-onset-assignment | 21 |
| other | 6 |
| missing-or-extra-extraction | 4 |
| sustain-tie | 1 |
| chord-grouping | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-rhythm-tuplets-vector | 60 | 63/63 | duration-mismatch:26, onset-mismatch:21, missing-rest:3, missing-note:2 |

## Pipeline provenance coverage

- withPage: 60/60
- withCandidateIds: 52/60
- withGlyphIds: 52/60
- withStemOwnership: 52/60
- withBeamOwnership: 52/60
- withAccidentalProvenance: 52/60
- withFirstDivergence: 60/60

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

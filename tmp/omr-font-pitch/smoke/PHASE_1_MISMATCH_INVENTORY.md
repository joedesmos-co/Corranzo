# Phase 1 — Semantic Mismatch Inventory

- Commit: `73f0ef6`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **12**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 5 |
| duration-mismatch | 3 |
| missing-rest | 1 |
| missing-note | 1 |
| extra-note | 1 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| voice-onset-assignment | 5 |
| duration-inference | 3 |
| other | 2 |
| missing-or-extra-extraction | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 12 | 32/32 | onset-mismatch:5, duration-mismatch:3, missing-rest:1, missing-note:1 |

## Pipeline provenance coverage

- withPage: 12/12
- withCandidateIds: 10/12
- withGlyphIds: 10/12
- withStemOwnership: 10/12
- withBeamOwnership: 10/12
- withAccidentalProvenance: 10/12
- withFirstDivergence: 12/12

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

# Phase 1 — Semantic Mismatch Inventory

- Commit: `c2d374d`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **12**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 4 |
| missing-rest | 3 |
| duration-mismatch | 3 |
| tempo-mismatch | 1 |
| dotted-rhythm-error | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| voice-onset-assignment | 4 |
| other | 4 |
| duration-inference | 4 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-rhythm-tuplets-vector | 12 | 63/63 | onset-mismatch:4, missing-rest:3, duration-mismatch:3, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 12/12
- withCandidateIds: 8/12
- withGlyphIds: 8/12
- withStemOwnership: 8/12
- withBeamOwnership: 8/12
- withAccidentalProvenance: 8/12
- withFirstDivergence: 12/12

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

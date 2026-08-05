# Phase 1 — Semantic Mismatch Inventory

- Commit: `f0c0c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **9**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 3 |
| duration-mismatch | 3 |
| missing-rest | 1 |
| tempo-mismatch | 1 |
| dotted-rhythm-error | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 4 |
| voice-onset-assignment | 3 |
| other | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-rhythm-tuplets-vector | 9 | 63/63 | onset-mismatch:3, duration-mismatch:3, missing-rest:1, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 9/9
- withCandidateIds: 6/9
- withGlyphIds: 6/9
- withStemOwnership: 6/9
- withBeamOwnership: 6/9
- withAccidentalProvenance: 6/9
- withFirstDivergence: 9/9

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

# Phase 1 — Semantic Mismatch Inventory

- Commit: `f0c0c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **7**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 3 |
| duration-mismatch | 2 |
| tempo-mismatch | 1 |
| rest-duration-error | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| voice-onset-assignment | 3 |
| duration-inference | 2 |
| other | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-rhythm-tuplets-vector | 7 | 63/63 | onset-mismatch:3, duration-mismatch:2, tempo-mismatch:1, rest-duration-error:1 |

## Pipeline provenance coverage

- withPage: 7/7
- withCandidateIds: 5/7
- withGlyphIds: 5/7
- withStemOwnership: 5/7
- withBeamOwnership: 5/7
- withAccidentalProvenance: 5/7
- withFirstDivergence: 7/7

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

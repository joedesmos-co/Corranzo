# Phase 1 — Semantic Mismatch Inventory

- Commit: `f0c0c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **5**

## Counts by defect code

| Code | Count |
|---|---|
| onset-mismatch | 2 |
| duration-mismatch | 1 |
| tempo-mismatch | 1 |
| rest-duration-error | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| voice-onset-assignment | 2 |
| other | 2 |
| duration-inference | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-rhythm-tuplets-vector | 5 | 63/63 | onset-mismatch:2, duration-mismatch:1, tempo-mismatch:1, rest-duration-error:1 |

## Pipeline provenance coverage

- withPage: 5/5
- withCandidateIds: 3/5
- withGlyphIds: 3/5
- withStemOwnership: 3/5
- withBeamOwnership: 3/5
- withAccidentalProvenance: 3/5
- withFirstDivergence: 5/5

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

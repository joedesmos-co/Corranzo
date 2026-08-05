# Phase 1 — Semantic Mismatch Inventory

- Commit: `83c48f3`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **37**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| other | 3 |
| sustain-tie | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 37 | 88/88 | duration-mismatch:32, missing-tie:2, volta-mismatch:2, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 37/37
- withCandidateIds: 34/37
- withGlyphIds: 34/37
- withStemOwnership: 34/37
- withBeamOwnership: 34/37
- withAccidentalProvenance: 0/37
- withFirstDivergence: 37/37

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

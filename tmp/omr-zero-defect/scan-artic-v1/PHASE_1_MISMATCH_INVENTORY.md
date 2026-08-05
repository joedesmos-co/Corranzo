# Phase 1 — Semantic Mismatch Inventory

- Commit: `5252f36`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **56**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-staccato | 7 |
| missing-accent | 6 |
| missing-tenuto | 6 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| articulation | 13 |
| other | 9 |
| sustain-tie | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 56 | 88/88 | duration-mismatch:32, missing-staccato:7, missing-accent:6, missing-tenuto:6 |

## Pipeline provenance coverage

- withPage: 56/56
- withCandidateIds: 34/56
- withGlyphIds: 34/56
- withStemOwnership: 34/56
- withBeamOwnership: 34/56
- withAccidentalProvenance: 0/56
- withFirstDivergence: 56/56

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

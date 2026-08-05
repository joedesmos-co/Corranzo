# Phase 1 — Semantic Mismatch Inventory

- Commit: `c017923`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **50**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-accent | 8 |
| missing-staccato | 5 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| articulation | 13 |
| other | 3 |
| sustain-tie | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 50 | 88/88 | duration-mismatch:32, missing-accent:8, missing-staccato:5, missing-tie:2 |

## Pipeline provenance coverage

- withPage: 50/50
- withCandidateIds: 34/50
- withGlyphIds: 34/50
- withStemOwnership: 34/50
- withBeamOwnership: 34/50
- withAccidentalProvenance: 0/50
- withFirstDivergence: 50/50

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

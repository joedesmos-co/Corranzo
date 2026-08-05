# Phase 1 — Semantic Mismatch Inventory

- Commit: `15422cd`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **52**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-staccato | 8 |
| missing-accent | 5 |
| incorrect-tie | 2 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| articulation | 13 |
| sustain-tie | 4 |
| other | 3 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 52 | 88/88 | duration-mismatch:32, missing-staccato:8, missing-accent:5, incorrect-tie:2 |

## Pipeline provenance coverage

- withPage: 52/52
- withCandidateIds: 36/52
- withGlyphIds: 36/52
- withStemOwnership: 36/52
- withBeamOwnership: 36/52
- withAccidentalProvenance: 0/52
- withFirstDivergence: 52/52

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

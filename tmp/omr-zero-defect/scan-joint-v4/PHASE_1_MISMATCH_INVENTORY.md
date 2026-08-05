# Phase 1 — Semantic Mismatch Inventory

- Commit: `15422cd`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **54**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-staccato | 8 |
| missing-accent | 6 |
| incorrect-tie | 3 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| articulation | 14 |
| sustain-tie | 5 |
| other | 3 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 54 | 88/88 | duration-mismatch:32, missing-staccato:8, missing-accent:6, incorrect-tie:3 |

## Pipeline provenance coverage

- withPage: 54/54
- withCandidateIds: 37/54
- withGlyphIds: 37/54
- withStemOwnership: 37/54
- withBeamOwnership: 37/54
- withAccidentalProvenance: 0/54
- withFirstDivergence: 54/54

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

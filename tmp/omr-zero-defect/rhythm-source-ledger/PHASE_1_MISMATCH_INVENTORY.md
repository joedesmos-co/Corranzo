# Phase 1 — Semantic Mismatch Inventory

- Commit: `2366c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **48**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 28 |
| missing-staccato | 8 |
| missing-accent | 4 |
| incorrect-tie | 3 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 28 |
| articulation | 12 |
| sustain-tie | 5 |
| other | 3 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 48 | 88/88 | duration-mismatch:28, missing-staccato:8, missing-accent:4, incorrect-tie:3 |

## Pipeline provenance coverage

- withPage: 48/48
- withCandidateIds: 33/48
- withGlyphIds: 33/48
- withStemOwnership: 33/48
- withBeamOwnership: 33/48
- withAccidentalProvenance: 0/48
- withFirstDivergence: 48/48

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

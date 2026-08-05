# Phase 1 — Semantic Mismatch Inventory

- Commit: `c017923`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **49**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-accent | 8 |
| missing-staccato | 4 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| articulation | 12 |
| other | 3 |
| sustain-tie | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 49 | 88/88 | duration-mismatch:32, missing-accent:8, missing-staccato:4, missing-tie:2 |

## Pipeline provenance coverage

- withPage: 49/49
- withCandidateIds: 34/49
- withGlyphIds: 34/49
- withStemOwnership: 34/49
- withBeamOwnership: 34/49
- withAccidentalProvenance: 0/49
- withFirstDivergence: 49/49

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

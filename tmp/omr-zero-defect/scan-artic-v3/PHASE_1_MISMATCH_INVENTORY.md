# Phase 1 — Semantic Mismatch Inventory

- Commit: `5252f36`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **41**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-accent | 3 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| missing-staccato | 1 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| articulation | 4 |
| other | 3 |
| sustain-tie | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 41 | 88/88 | duration-mismatch:32, missing-accent:3, missing-tie:2, volta-mismatch:2 |

## Pipeline provenance coverage

- withPage: 41/41
- withCandidateIds: 34/41
- withGlyphIds: 34/41
- withStemOwnership: 34/41
- withBeamOwnership: 34/41
- withAccidentalProvenance: 0/41
- withFirstDivergence: 41/41

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

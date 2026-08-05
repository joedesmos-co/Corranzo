# Phase 1 — Semantic Mismatch Inventory

- Commit: `83c48f3`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **39**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |
| missing-staccato | 1 |
| missing-accent | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| other | 3 |
| sustain-tie | 2 |
| articulation | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 39 | 88/88 | duration-mismatch:32, missing-tie:2, volta-mismatch:2, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 39/39
- withCandidateIds: 34/39
- withGlyphIds: 34/39
- withStemOwnership: 34/39
- withBeamOwnership: 34/39
- withAccidentalProvenance: 0/39
- withFirstDivergence: 39/39

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

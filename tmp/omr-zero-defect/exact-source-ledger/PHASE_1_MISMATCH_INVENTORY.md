# Phase 1 — Semantic Mismatch Inventory

- Commit: `2366c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **55**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 31 |
| missing-staccato | 8 |
| onset-mismatch | 4 |
| missing-accent | 4 |
| incorrect-tie | 3 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 31 |
| articulation | 12 |
| sustain-tie | 5 |
| voice-onset-assignment | 4 |
| other | 3 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 55 | 88/88 | duration-mismatch:31, missing-staccato:8, onset-mismatch:4, missing-accent:4 |

## Pipeline provenance coverage

- withPage: 55/55
- withCandidateIds: 40/55
- withGlyphIds: 40/55
- withStemOwnership: 40/55
- withBeamOwnership: 40/55
- withAccidentalProvenance: 0/55
- withFirstDivergence: 55/55

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

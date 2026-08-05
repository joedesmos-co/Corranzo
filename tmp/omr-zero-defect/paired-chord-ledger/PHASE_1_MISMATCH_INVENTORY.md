# Phase 1 — Semantic Mismatch Inventory

- Commit: `2366c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **61**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 32 |
| missing-staccato | 8 |
| onset-mismatch | 4 |
| missing-accent | 4 |
| incorrect-tie | 3 |
| missing-tie | 2 |
| incorrect-chord | 2 |
| extra-note | 2 |
| volta-mismatch | 2 |
| missing-note | 1 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 32 |
| articulation | 12 |
| sustain-tie | 5 |
| voice-onset-assignment | 4 |
| missing-or-extra-extraction | 3 |
| other | 3 |
| chord-grouping | 2 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 61 | 88/89 | duration-mismatch:32, missing-staccato:8, onset-mismatch:4, missing-accent:4 |

## Pipeline provenance coverage

- withPage: 61/61
- withCandidateIds: 46/61
- withGlyphIds: 46/61
- withStemOwnership: 46/61
- withBeamOwnership: 46/61
- withAccidentalProvenance: 0/61
- withFirstDivergence: 61/61

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

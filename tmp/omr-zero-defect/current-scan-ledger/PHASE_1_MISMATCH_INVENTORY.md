# Phase 1 — Semantic Mismatch Inventory

- Commit: `2366c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **60**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 28 |
| missing-staccato | 8 |
| missing-accent | 4 |
| incorrect-tie | 3 |
| missing-note | 3 |
| incorrect-chord | 3 |
| onset-mismatch | 3 |
| extra-note | 2 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| incorrect-pitch | 1 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 28 |
| articulation | 12 |
| sustain-tie | 5 |
| missing-or-extra-extraction | 5 |
| chord-grouping | 3 |
| voice-onset-assignment | 3 |
| other | 3 |
| accidental-or-staff-position | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 60 | 88/87 | duration-mismatch:28, missing-staccato:8, missing-accent:4, incorrect-tie:3 |

## Pipeline provenance coverage

- withPage: 60/60
- withCandidateIds: 42/60
- withGlyphIds: 42/60
- withStemOwnership: 42/60
- withBeamOwnership: 42/60
- withAccidentalProvenance: 0/60
- withFirstDivergence: 60/60

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

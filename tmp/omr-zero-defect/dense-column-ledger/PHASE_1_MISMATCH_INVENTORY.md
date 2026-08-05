# Phase 1 — Semantic Mismatch Inventory

- Commit: `2366c37`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **59**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 31 |
| missing-staccato | 8 |
| onset-mismatch | 4 |
| missing-accent | 4 |
| incorrect-tie | 3 |
| missing-note | 2 |
| missing-tie | 2 |
| volta-mismatch | 2 |
| incorrect-chord | 1 |
| incorrect-pitch | 1 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 31 |
| articulation | 12 |
| sustain-tie | 5 |
| voice-onset-assignment | 4 |
| other | 3 |
| missing-or-extra-extraction | 2 |
| chord-grouping | 1 |
| accidental-or-staff-position | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-articulation-scan | 59 | 88/86 | duration-mismatch:31, missing-staccato:8, onset-mismatch:4, missing-accent:4 |

## Pipeline provenance coverage

- withPage: 59/59
- withCandidateIds: 41/59
- withGlyphIds: 41/59
- withStemOwnership: 41/59
- withBeamOwnership: 41/59
- withAccidentalProvenance: 0/59
- withFirstDivergence: 59/59

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

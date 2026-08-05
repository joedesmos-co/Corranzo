# Phase 1 — Semantic Mismatch Inventory

- Commit: `15422cd`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **53**

## Counts by defect code

| Code | Count |
|---|---|
| incorrect-pitch | 26 |
| incorrect-chord | 26 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| accidental-or-staff-position | 26 |
| chord-grouping | 26 |
| other | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-dense-advanced-vector | 53 | 264/264 | incorrect-pitch:26, incorrect-chord:26, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 53/53
- withCandidateIds: 52/53
- withGlyphIds: 52/53
- withStemOwnership: 52/53
- withBeamOwnership: 52/53
- withAccidentalProvenance: 52/53
- withFirstDivergence: 53/53

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

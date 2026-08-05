# Phase 1 — Semantic Mismatch Inventory

- Commit: `417850e`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **48**

## Counts by defect code

| Code | Count |
|---|---|
| incorrect-pitch | 23 |
| incorrect-chord | 23 |
| split-measure | 1 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| accidental-or-staff-position | 23 |
| chord-grouping | 23 |
| measure-structure | 1 |
| other | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-dense-advanced-vector | 48 | 264/264 | incorrect-pitch:23, incorrect-chord:23, split-measure:1, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 48/48
- withCandidateIds: 46/48
- withGlyphIds: 46/48
- withStemOwnership: 46/48
- withBeamOwnership: 46/48
- withAccidentalProvenance: 46/48
- withFirstDivergence: 48/48

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

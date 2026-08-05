# Phase 1 — Semantic Mismatch Inventory

- Commit: `d50254d`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **55**

## Counts by defect code

| Code | Count |
|---|---|
| incorrect-pitch | 27 |
| incorrect-chord | 27 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| accidental-or-staff-position | 27 |
| chord-grouping | 27 |
| other | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-dense-advanced-vector | 55 | 264/264 | incorrect-pitch:27, incorrect-chord:27, tempo-mismatch:1 |

## Pipeline provenance coverage

- withPage: 55/55
- withCandidateIds: 54/55
- withGlyphIds: 54/55
- withStemOwnership: 54/55
- withBeamOwnership: 54/55
- withAccidentalProvenance: 54/55
- withFirstDivergence: 55/55

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

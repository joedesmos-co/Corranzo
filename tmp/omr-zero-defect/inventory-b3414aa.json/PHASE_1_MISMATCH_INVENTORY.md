# Phase 1 — Semantic Mismatch Inventory

- Commit: `b3414aa`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **8**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 2 |
| incorrect-chord | 2 |
| onset-mismatch | 1 |
| missing-note | 1 |
| extra-note | 1 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 2 |
| missing-or-extra-extraction | 2 |
| chord-grouping | 2 |
| voice-onset-assignment | 1 |
| other | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| guitar-standard-chords-vector | 8 | 115/115 | duration-mismatch:2, incorrect-chord:2, onset-mismatch:1, missing-note:1 |

## Pipeline provenance coverage

- withPage: 8/8
- withCandidateIds: 7/8
- withGlyphIds: 7/8
- withStemOwnership: 7/8
- withBeamOwnership: 7/8
- withAccidentalProvenance: 7/8
- withFirstDivergence: 8/8

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

# Phase 1 — Semantic Mismatch Inventory

- Commit: `3ff28ab`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 1/1
- Total structured mismatches: **27**

## Counts by defect code

| Code | Count |
|---|---|
| incorrect-pitch | 12 |
| incorrect-chord | 9 |
| duration-mismatch | 2 |
| onset-mismatch | 1 |
| missing-note | 1 |
| extra-note | 1 |
| tempo-mismatch | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| accidental-or-staff-position | 12 |
| chord-grouping | 9 |
| duration-inference | 2 |
| missing-or-extra-extraction | 2 |
| voice-onset-assignment | 1 |
| other | 1 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| guitar-standard-chords-vector | 27 | 115/115 | incorrect-pitch:12, incorrect-chord:9, duration-mismatch:2, onset-mismatch:1 |

## Pipeline provenance coverage

- withPage: 27/27
- withCandidateIds: 26/27
- withGlyphIds: 26/27
- withStemOwnership: 26/27
- withBeamOwnership: 26/27
- withAccidentalProvenance: 26/27
- withFirstDivergence: 27/27

Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.
Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.

Machine-readable: `error_inventory.json`, `mismatches.csv`.

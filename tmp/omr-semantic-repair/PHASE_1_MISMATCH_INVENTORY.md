# Phase 1 — Semantic Mismatch Inventory

- Commit: `48757fc`
- Evaluator: frozen 2.0.0 / schema 2
- Fixtures: 9/9
- Total structured mismatches: **810**

## Counts by defect code

| Code | Count |
|---|---|
| duration-mismatch | 202 |
| onset-mismatch | 143 |
| incorrect-pitch | 120 |
| incorrect-chord | 120 |
| missing-note | 81 |
| extra-note | 75 |
| split-measure | 11 |
| tempo-mismatch | 9 |
| missing-accent | 9 |
| missing-staccato | 8 |
| missing-tie | 6 |
| missing-rest | 5 |
| volta-mismatch | 4 |
| repeat-mismatch | 4 |
| missing-dot | 3 |
| incorrect-tie | 3 |
| extra-rest | 2 |
| merged-measure | 2 |
| voice-mismatch | 1 |
| dotted-rhythm-error | 1 |
| extra-measure | 1 |

## Counts by inferred cluster hint

| Cluster hint | Count |
|---|---|
| duration-inference | 207 |
| missing-or-extra-extraction | 156 |
| voice-onset-assignment | 143 |
| chord-grouping | 120 |
| accidental-or-staff-position | 83 |
| staff-pitch-assignment | 37 |
| other | 24 |
| articulation | 17 |
| measure-structure | 14 |
| sustain-tie | 9 |

## Per-fixture

| Fixture | Mismatches | Notes T/G | Top codes |
|---|---|---|---|
| piano-beginner-single-vector | 14 | 32/32 | onset-mismatch:5, duration-mismatch:4, missing-rest:1, missing-note:1 |
| piano-grand-voices-vector | 95 | 88/88 | duration-mismatch:40, incorrect-pitch:32, incorrect-chord:16, missing-tie:2 |
| piano-rhythm-tuplets-vector | 59 | 63/63 | onset-mismatch:25, duration-mismatch:14, missing-rest:4, missing-note:3 |
| piano-articulation-scan | 182 | 88/111 | incorrect-pitch:42, extra-note:34, incorrect-chord:33, duration-mismatch:26 |
| piano-dense-advanced-vector | 240 | 264/264 | duration-mismatch:62, onset-mismatch:45, incorrect-chord:43, missing-note:38 |
| guitar-tab-sparse-vector | 72 | 32/40 | duration-mismatch:30, onset-mismatch:23, extra-note:8, incorrect-pitch:4 |
| guitar-standard-chords-vector | 54 | 115/86 | onset-mismatch:21, duration-mismatch:11, incorrect-chord:5, split-measure:5 |
| guitar-paired-chords-vector | 87 | 116/103 | missing-note:24, incorrect-chord:19, duration-mismatch:15, extra-note:14 |
| guitar-techniques-paired-vector | 7 | 32/32 | split-measure:4, missing-tie:2, tempo-mismatch:1 |

## Provenance limits

Generated MusicXML notes do not carry OMR geometry provenance (glyph, confidence, duration/pitch provenance).
Pipeline stage is inferred from mismatch pattern for ranking; Phase 2 traces representative examples through intermediate structures.

Machine-readable: `mismatches.json`, `mismatches.csv`.

# Phase 1 — Register-binned chord baseline

- Commit: `39eb37e`
- Evaluator: frozen 2.0.0 / schema 2
- Created: 2026-08-03T12:40:51.749Z
- Fixtures: 9/9

## Frozen corpus scoreboard

See `corpus-baseline.txt` (overall 67.12%, pitch 66.86%, rhythm 74.64%, measure 72.85%, sustain 55.56%).

Defect totals from corpus run: incorrect-chord ×182, incorrect-pitch ×161, onset-mismatch ×170, duration-mismatch ×102, missing-note ×136, extra-note ×112.

## Register-bin definitions

| Bin | Rule |
|---|---|
| low-extreme | Tone needs ledger(s) below bass (MIDI < F2 / ledger-below on bass) |
| low-normal | Bass staff ± immediate vicinity (F2–B3) |
| middle | Between-staff / mid range (C4–D♯4) |
| high-normal | Treble staff ± immediate vicinity (E4–G5) |
| high-extreme | Tone needs ledger(s) above treble (MIDI ≥ A5 / ledger-above on treble) |

Chord bin = most extreme member tone (low-extreme beats high-extreme when both present).

## Register-binned chord metrics

| Bin | Chords | Exact % | Incorrect | Missing tones | Extra tones | Incorrect pitches | Octave errors | Staff errors | Dup ownership rows | Dropped-candidate rows |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 230 | 58.26% | 96 | 117 | 141 | 258 | 10 | 0 | 0 | 0 |
| low-extreme | 17 | 76.47% | 4 | 6 | 2 | 8 | 0 | 0 | 0 | 0 |
| low-normal | 69 | 72.46% | 19 | 25 | 30 | 55 | 1 | 0 | 0 | 0 |
| middle | 30 | 50% | 15 | 12 | 18 | 30 | 9 | 0 | 0 | 0 |
| high-normal | 94 | 51.06% | 46 | 62 | 79 | 141 | 0 | 0 | 0 | 0 |
| high-extreme | 20 | 40% | 12 | 12 | 12 | 24 | 0 | 0 | 0 | 0 |

## First incorrect pipeline stage (incorrect chords only)

| Stage | Count |
|---|---:|
| pitch_mapping | 34 |
| chord_column_grouping | 29 |
| notehead_detection_or_pitch_filter | 19 |
| ledger_line_ownership_or_pitch_anchor | 14 |

## Per-fixture chord load

| Fixture | Chord events | Incorrect | low-ext | high-ext | low-norm | high-norm | middle |
|---|---:|---:|---:|---:|---:|---:|---:|
| piano-grand-voices-vector | 32 | 9 | 0/6 | 0/0 | 0/10 | 9/16 | 0/0 |
| piano-rhythm-tuplets-vector | 8 | 2 | 0/0 | 0/0 | 0/0 | 2/8 | 0/0 |
| piano-articulation-scan | 38 | 37 | 4/4 | 0/0 | 11/12 | 18/18 | 4/4 |
| piano-dense-advanced-vector | 84 | 23 | 0/3 | 12/20 | 0/25 | 11/36 | 0/0 |
| guitar-tab-sparse-vector | 2 | 2 | 0/0 | 0/0 | 2/2 | 0/0 | 0/0 |
| guitar-standard-chords-vector | 40 | 7 | 0/4 | 0/0 | 6/20 | 1/6 | 0/10 |
| guitar-paired-chords-vector | 26 | 16 | 0/0 | 0/0 | 0/0 | 5/10 | 11/16 |

## Extreme-register incorrect samples (first 40)

| # | Fixture | M | Staff/Voice | Bin | Expected → generated | Missing | Extra | Stage |
|---:|---|---:|---|---|---|---|---|---|
| 1 | piano-articulation-scan | 1 | 2/2 | low-extreme | C2 G2 → G2 | C2 | — | notehead_detection_or_pitch_filter |
| 2 | piano-articulation-scan | 2 | 2/2 | low-extreme | D2 A2 → A2 A2 C3 | D2 | A2 C3 | chord_column_grouping |
| 3 | piano-articulation-scan | 3 | 2/2 | low-extreme | E2 B2 →  | E2 B2 | — | notehead_detection_or_pitch_filter |
| 4 | piano-articulation-scan | 8 | 2/2 | low-extreme | E2 B2 →  | E2 B2 | — | notehead_detection_or_pitch_filter |
| 5 | piano-dense-advanced-vector | 5 | 1/1 | high-extreme | D5 F#5 A5 → D#5 F#5 A5 | D5 | D#5 | pitch_mapping |
| 6 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | pitch_mapping |
| 7 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | D5 F#5 A5 → D#5 F#5 A5 | D5 | D#5 | ledger_line_ownership_or_pitch_anchor |
| 8 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | D5 F#5 A5 → D#5 F#5 A5 | D5 | D#5 | ledger_line_ownership_or_pitch_anchor |
| 9 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | pitch_mapping |
| 10 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor |
| 11 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | D#5 G5 A#5 → D#5 G#5 A#5 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor |
| 12 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | D#5 G5 A#5 → D#5 G#5 A#5 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor |
| 13 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor |
| 14 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | F5 A5 C6 → F#5 A5 C6 | F5 | F#5 | pitch_mapping |
| 15 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | G5 B5 D6 → G#5 B5 D6 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor |
| 16 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | F5 A5 C6 → F#5 A5 C6 | F5 | F#5 | pitch_mapping |

## Artifacts

- `high_extreme_inventory_full.json` — full chord event records
- `corpus-baseline.json` / `corpus-baseline.txt` — frozen semantic corpus
- `generated/*.musicxml` — OMR outputs used for inventory
- `diagnostics/*.pipeline.json` — measure-level pipeline joins

Production code was not modified in Phase 1.

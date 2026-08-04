# Phase 1 — Register-binned chord baseline

- Commit: `2622914`
- Evaluator: frozen 2.0.0 / schema 2
- Created: 2026-08-01T02:58:48.986Z
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
| overall | 231 | 41.56% | 135 | 184 | 208 | 392 | 10 | 0 | 0 | 0 |
| low-extreme | 17 | 76.47% | 4 | 6 | 2 | 8 | 0 | 0 | 0 | 0 |
| low-normal | 69 | 62.32% | 26 | 33 | 38 | 71 | 1 | 0 | 0 | 0 |
| middle | 31 | 35.48% | 20 | 18 | 24 | 42 | 9 | 0 | 0 | 0 |
| high-normal | 94 | 27.66% | 68 | 103 | 123 | 226 | 0 | 0 | 0 | 0 |
| high-extreme | 20 | 15% | 17 | 24 | 21 | 45 | 0 | 0 | 0 | 0 |

## First incorrect pipeline stage (incorrect chords only)

| Stage | Count |
|---|---:|
| pitch_mapping | 57 |
| chord_column_grouping | 40 |
| notehead_detection_or_pitch_filter | 27 |
| ledger_line_ownership_or_pitch_anchor | 11 |

## Per-fixture chord load

| Fixture | Chord events | Incorrect | low-ext | high-ext | low-norm | high-norm | middle |
|---|---:|---:|---:|---:|---:|---:|---:|
| piano-grand-voices-vector | 32 | 10 | 0/6 | 0/0 | 0/10 | 10/16 | 0/0 |
| piano-rhythm-tuplets-vector | 8 | 2 | 0/0 | 0/0 | 0/0 | 2/8 | 0/0 |
| piano-articulation-scan | 38 | 37 | 4/4 | 0/0 | 11/12 | 18/18 | 4/4 |
| piano-dense-advanced-vector | 84 | 53 | 0/3 | 17/20 | 4/25 | 32/36 | 0/0 |
| guitar-tab-sparse-vector | 2 | 2 | 0/0 | 0/0 | 2/2 | 0/0 | 0/0 |
| guitar-standard-chords-vector | 41 | 15 | 0/4 | 0/0 | 9/20 | 1/6 | 5/11 |
| guitar-paired-chords-vector | 26 | 16 | 0/0 | 0/0 | 0/0 | 5/10 | 11/16 |

## Extreme-register incorrect samples (first 40)

| # | Fixture | M | Staff/Voice | Bin | Expected → generated | Missing | Extra | Stage |
|---:|---|---:|---|---|---|---|---|---|
| 1 | piano-articulation-scan | 1 | 2/2 | low-extreme | C2 G2 → G2 | C2 | — | notehead_detection_or_pitch_filter |
| 2 | piano-articulation-scan | 2 | 2/2 | low-extreme | D2 A2 → A2 A2 C3 | D2 | A2 C3 | chord_column_grouping |
| 3 | piano-articulation-scan | 3 | 2/2 | low-extreme | E2 B2 →  | E2 B2 | — | notehead_detection_or_pitch_filter |
| 4 | piano-articulation-scan | 8 | 2/2 | low-extreme | E2 B2 →  | E2 B2 | — | notehead_detection_or_pitch_filter |
| 5 | piano-dense-advanced-vector | 5 | 1/1 | high-extreme | D5 F#5 A5 → C#5 F#5 | D5 A5 | C#5 | notehead_detection_or_pitch_filter |
| 6 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | C#5 F5 G#5 → C#5 F5 F5 | G#5 | F5 | pitch_mapping |
| 7 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | D5 F#5 A5 → C#5 F#5 A5 | D5 | C#5 | pitch_mapping |
| 8 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | E5 G#5 B5 → D#5 F5 G#5 | E5 B5 | D#5 F5 | pitch_mapping |
| 9 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | D5 F#5 A5 → C#5 F#5 | D5 A5 | C#5 | notehead_detection_or_pitch_filter |
| 10 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | C#5 F5 G#5 → C#5 F5 F#5 | G#5 | F#5 | pitch_mapping |
| 11 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | D#5 G5 A#5 → D#5 F#5 A#5 | G5 | F#5 | pitch_mapping |
| 12 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | E5 G#5 B5 → C#5 F5 G#5 | E5 B5 | C#5 F5 | ledger_line_ownership_or_pitch_anchor |
| 13 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | F#5 A#5 C#6 → F#5 A#5 C6 | C#6 | C6 | pitch_mapping |
| 14 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | E5 G#5 B5 → F#5 G#5 | E5 B5 | F#5 | notehead_detection_or_pitch_filter |
| 15 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | D#5 G5 A#5 → C#5 D#5 F#5 | G5 A#5 | C#5 F#5 | pitch_mapping |
| 16 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | F5 A5 C6 → F#5 A5 C6 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor |
| 17 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | F5 A5 C6 → A5 C6 | F5 | — | notehead_detection_or_pitch_filter |
| 18 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | D5 F#5 A5 → C5 D5 F#5 A5 | — | C5 | chord_column_grouping |
| 19 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | E5 G#5 B5 → D5 E5 G#5 G#5 | B5 | D5 G#5 | chord_column_grouping |
| 20 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | E5 G#5 B5 → E5 E5 G#5 | B5 | E5 | ledger_line_ownership_or_pitch_anchor |
| 21 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | G5 B5 D6 → F#5 C6 | G5 B5 D6 | F#5 C6 | notehead_detection_or_pitch_filter |

## Artifacts

- `chord_inventory.json` — full chord event records
- `corpus-baseline.json` / `corpus-baseline.txt` — frozen semantic corpus
- `generated/*.musicxml` — OMR outputs used for inventory
- `diagnostics/*.pipeline.json` — measure-level pipeline joins

Production code was not modified in Phase 1.

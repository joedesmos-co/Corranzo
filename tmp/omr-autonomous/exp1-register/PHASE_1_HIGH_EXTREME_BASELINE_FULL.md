# Phase 1 — Register-binned chord baseline

- Commit: `beeb5f0`
- Evaluator: frozen 2.0.0 / schema 2
- Created: 2026-08-03T02:10:44.572Z
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
| overall | 230 | 46.52% | 123 | 169 | 193 | 362 | 10 | 0 | 0 | 0 |
| low-extreme | 17 | 76.47% | 4 | 6 | 2 | 8 | 0 | 0 | 0 | 0 |
| low-normal | 69 | 71.01% | 20 | 26 | 31 | 57 | 1 | 0 | 0 | 0 |
| middle | 30 | 40% | 18 | 15 | 21 | 36 | 9 | 0 | 0 | 0 |
| high-normal | 94 | 31.91% | 64 | 97 | 114 | 211 | 0 | 0 | 0 | 0 |
| high-extreme | 20 | 15% | 17 | 25 | 25 | 50 | 0 | 0 | 0 | 0 |

## First incorrect pipeline stage (incorrect chords only)

| Stage | Count |
|---|---:|
| pitch_mapping | 46 |
| chord_column_grouping | 32 |
| ledger_line_ownership_or_pitch_anchor | 26 |
| notehead_detection_or_pitch_filter | 19 |

## Per-fixture chord load

| Fixture | Chord events | Incorrect | low-ext | high-ext | low-norm | high-norm | middle |
|---|---:|---:|---:|---:|---:|---:|---:|
| piano-grand-voices-vector | 32 | 12 | 0/6 | 0/0 | 0/10 | 12/16 | 0/0 |
| piano-rhythm-tuplets-vector | 8 | 2 | 0/0 | 0/0 | 0/0 | 2/8 | 0/0 |
| piano-articulation-scan | 38 | 37 | 4/4 | 0/0 | 11/12 | 18/18 | 4/4 |
| piano-dense-advanced-vector | 84 | 43 | 0/3 | 17/20 | 0/25 | 26/36 | 0/0 |
| guitar-tab-sparse-vector | 2 | 2 | 0/0 | 0/0 | 2/2 | 0/0 | 0/0 |
| guitar-standard-chords-vector | 40 | 11 | 0/4 | 0/0 | 7/20 | 1/6 | 3/10 |
| guitar-paired-chords-vector | 26 | 16 | 0/0 | 0/0 | 0/0 | 5/10 | 11/16 |

## Extreme-register incorrect samples (first 40)

| # | Fixture | M | Staff/Voice | Bin | Expected → generated | Missing | Extra | Stage |
|---:|---|---:|---|---|---|---|---|---|
| 1 | piano-articulation-scan | 1 | 2/2 | low-extreme | C2 G2 → G2 | C2 | — | notehead_detection_or_pitch_filter |
| 2 | piano-articulation-scan | 2 | 2/2 | low-extreme | D2 A2 → A2 A2 C3 | D2 | A2 C3 | chord_column_grouping |
| 3 | piano-articulation-scan | 3 | 2/2 | low-extreme | E2 B2 →  | E2 B2 | — | notehead_detection_or_pitch_filter |
| 4 | piano-articulation-scan | 8 | 2/2 | low-extreme | E2 B2 →  | E2 B2 | — | notehead_detection_or_pitch_filter |
| 5 | piano-dense-advanced-vector | 5 | 1/1 | high-extreme | D5 F#5 A5 → D#5 F#5 A5 | D5 | D#5 | pitch_mapping |
| 6 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor |
| 7 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | D5 F#5 A5 → D#5 F#5 A#5 | D5 A5 | D#5 A#5 | pitch_mapping |
| 8 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | E5 G#5 B5 → F5 G#5 B5 | E5 | F5 | ledger_line_ownership_or_pitch_anchor |
| 9 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | D5 F#5 A5 → D#5 F#5 A#5 | D5 A5 | D#5 A#5 | pitch_mapping |
| 10 | piano-dense-advanced-vector | 6 | 1/1 | high-extreme | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor |
| 11 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | C#5 F5 G#5 → C5 F#5 G#5 | C#5 F5 | C5 F#5 | ledger_line_ownership_or_pitch_anchor |
| 12 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | D#5 G5 A#5 → D#5 G#5 A#5 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor |
| 13 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | E5 G#5 B5 → F5 G#5 C6 | E5 B5 | F5 C6 | ledger_line_ownership_or_pitch_anchor |
| 14 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | E5 G#5 B5 → F5 G#5 C6 | E5 B5 | F5 C6 | ledger_line_ownership_or_pitch_anchor |
| 15 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | D#5 G5 A#5 → D#5 G#5 A#5 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor |
| 16 | piano-dense-advanced-vector | 7 | 1/1 | high-extreme | C#5 F5 G#5 → C5 F#5 G#5 | C#5 F5 | C5 F#5 | ledger_line_ownership_or_pitch_anchor |
| 17 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | D5 F#5 A5 → D5 F5 A#5 | F#5 A5 | F5 A#5 | ledger_line_ownership_or_pitch_anchor |
| 18 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | F5 A5 C6 → F5 A#5 C6 | A5 | A#5 | ledger_line_ownership_or_pitch_anchor |
| 19 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | G5 B5 D6 → G#5 B5 D6 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor |
| 20 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | F5 A5 C6 → F5 A#5 C6 | A5 | A#5 | ledger_line_ownership_or_pitch_anchor |
| 21 | piano-dense-advanced-vector | 8 | 1/1 | high-extreme | D5 F#5 A5 → D5 F5 A#5 | F#5 A5 | F5 A#5 | ledger_line_ownership_or_pitch_anchor |

## Artifacts

- `high_extreme_inventory_full.json` — full chord event records
- `corpus-baseline.json` / `corpus-baseline.txt` — frozen semantic corpus
- `generated/*.musicxml` — OMR outputs used for inventory
- `diagnostics/*.pipeline.json` — measure-level pipeline joins

Production code was not modified in Phase 1.

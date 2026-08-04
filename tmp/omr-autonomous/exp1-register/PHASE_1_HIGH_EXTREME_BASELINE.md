# Phase 1 — High-extreme chord baseline

- Commit: `beeb5f0`
- Created: 2026-08-03T02:10:44.572Z
- Evaluator: frozen 2.0.0 / schema 2
- Production code: **not modified**

## Definition

High-extreme = treble tones requiring ledger(s) above the staff and/or MIDI ≥ A5. Chord bin uses the most extreme member tone (low-extreme still wins when both extremes are present).

## Scoreboard (high-extreme chords only)

| Metric | Value |
|---|---:|
| Chord events | 20 |
| Exact pitch-set matches | 3 |
| Exact chord accuracy | **15%** |
| Incorrect chords | 17 |
| Missing tones | 25 |
| Extra tones | 25 |
| Incorrect pitches (matched+unmatched defects) | 50 |
| Octave errors | 0 |
| Wrong-staff errors | 0 |
| Near diatonic step misses (±1–2 semitone unpaired) | 25 |
| Duplicate physical notehead ownership | 0 |
| Dropped physical candidates (inventory) | 0 |

## Context: all register bins (safety)

| Bin | Chords | Exact % | Incorrect | Missing | Extra | Octave | Wrong staff |
|---|---:|---:|---:|---:|---:|---:|---:|
| low-extreme | 17 | 76.47% | 4 | 6 | 2 | 0 | 0 |
| low-normal | 69 | 71.01% | 20 | 26 | 31 | 1 | 0 |
| middle | 30 | 40% | 18 | 15 | 21 | 9 | 0 |
| high-normal | 94 | 31.91% | 64 | 97 | 114 | 0 | 0 |
| high-extreme | 20 | 15% | 17 | 25 | 25 | 0 | 0 |

## Anchor method / fallback rates (high-extreme tones)

Ink geometry successes: **6** · Glyph-metrics fallbacks: **1**

| Anchor source / reject reason | Tone touches | On incorrect chords |
|---|---:|---:|
| `self-calibrated-glyph-fallback` | 42 | 36 |
| `ink-notehead-geometry` | 6 | 6 |
| `glyph-metrics-fallback/ambiguous-components` | 1 | 1 |

## First pipeline stage where pitch diverges

| Stage | High-extreme chords |
|---|---:|
| ledger_line_ownership_or_pitch_anchor | 14 |
| pitch_mapping | 3 |
| none | 3 |

## Incorrect high-extreme chords

| # | Fixture | M | Staff/Voice | Expected → Generated | Missing | Extra | Stage | Anchor sources |
|---:|---|---:|---|---|---|---|---|---|
| 1 | piano-dense-advanced-vector | 5 | 1/1 | D5 F#5 A5 → D#5 F#5 A5 | D5 | D#5 | pitch_mapping | ink-notehead-geometry |
| 2 | piano-dense-advanced-vector | 6 | 1/1 | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback, ink-notehead-geometry |
| 3 | piano-dense-advanced-vector | 6 | 1/1 | D5 F#5 A5 → D#5 F#5 A#5 | D5 A5 | D#5 A#5 | pitch_mapping | ink-notehead-geometry, self-calibrated-glyph-fallback |
| 4 | piano-dense-advanced-vector | 6 | 1/1 | E5 G#5 B5 → F5 G#5 B5 | E5 | F5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 5 | piano-dense-advanced-vector | 6 | 1/1 | D5 F#5 A5 → D#5 F#5 A#5 | D5 A5 | D#5 A#5 | pitch_mapping | ink-notehead-geometry, glyph-metrics-fallback/ambiguous-components |
| 6 | piano-dense-advanced-vector | 6 | 1/1 | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback, ink-notehead-geometry |
| 7 | piano-dense-advanced-vector | 7 | 1/1 | C#5 F5 G#5 → C5 F#5 G#5 | C#5 F5 | C5 F#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 8 | piano-dense-advanced-vector | 7 | 1/1 | D#5 G5 A#5 → D#5 G#5 A#5 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 9 | piano-dense-advanced-vector | 7 | 1/1 | E5 G#5 B5 → F5 G#5 C6 | E5 B5 | F5 C6 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 10 | piano-dense-advanced-vector | 7 | 1/1 | E5 G#5 B5 → F5 G#5 C6 | E5 B5 | F5 C6 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 11 | piano-dense-advanced-vector | 7 | 1/1 | D#5 G5 A#5 → D#5 G#5 A#5 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 12 | piano-dense-advanced-vector | 7 | 1/1 | C#5 F5 G#5 → C5 F#5 G#5 | C#5 F5 | C5 F#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback, ink-notehead-geometry |
| 13 | piano-dense-advanced-vector | 8 | 1/1 | D5 F#5 A5 → D5 F5 A#5 | F#5 A5 | F5 A#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 14 | piano-dense-advanced-vector | 8 | 1/1 | F5 A5 C6 → F5 A#5 C6 | A5 | A#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 15 | piano-dense-advanced-vector | 8 | 1/1 | G5 B5 D6 → G#5 B5 D6 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 16 | piano-dense-advanced-vector | 8 | 1/1 | F5 A5 C6 → F5 A#5 C6 | A5 | A#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 17 | piano-dense-advanced-vector | 8 | 1/1 | D5 F#5 A5 → D5 F5 A#5 | F#5 A5 | F5 A#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |

## Exact matches (control)

- piano-dense-advanced-vector m7 @2: F#5 A#5 C#6
- piano-dense-advanced-vector m8 @1: E5 G#5 B5
- piano-dense-advanced-vector m8 @3: E5 G#5 B5

## Artifacts

- `high_extreme_inventory.json` — high-extreme chords only + fallback rates
- `high_extreme_inventory_full.json` — full register-binned inventory
- `generated/*.musicxml`, `diagnostics/*.pipeline.json`
- Next: Phase 2 visual PDF + anchor trace (`PHASE_2_RC_B_ROOT_CAUSE.md`)


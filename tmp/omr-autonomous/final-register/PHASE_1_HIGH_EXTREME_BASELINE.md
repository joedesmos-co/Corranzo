# Phase 1 — High-extreme chord baseline

- Commit: `50a3ea3`
- Created: 2026-08-04T02:10:23.564Z
- Evaluator: frozen 2.0.0 / schema 2
- Production code: **not modified**

## Definition

High-extreme = treble tones requiring ledger(s) above the staff and/or MIDI ≥ A5. Chord bin uses the most extreme member tone (low-extreme still wins when both extremes are present).

## Scoreboard (high-extreme chords only)

| Metric | Value |
|---|---:|
| Chord events | 20 |
| Exact pitch-set matches | 8 |
| Exact chord accuracy | **40%** |
| Incorrect chords | 12 |
| Missing tones | 12 |
| Extra tones | 12 |
| Incorrect pitches (matched+unmatched defects) | 24 |
| Octave errors | 0 |
| Wrong-staff errors | 0 |
| Near diatonic step misses (±1–2 semitone unpaired) | 12 |
| Duplicate physical notehead ownership | 0 |
| Dropped physical candidates (inventory) | 0 |

## Context: all register bins (safety)

| Bin | Chords | Exact % | Incorrect | Missing | Extra | Octave | Wrong staff |
|---|---:|---:|---:|---:|---:|---:|---:|
| low-extreme | 17 | 76.47% | 4 | 6 | 2 | 0 | 0 |
| low-normal | 69 | 72.46% | 19 | 25 | 30 | 1 | 0 |
| middle | 30 | 50% | 15 | 12 | 18 | 9 | 0 |
| high-normal | 94 | 52.13% | 45 | 63 | 80 | 0 | 0 |
| high-extreme | 20 | 40% | 12 | 12 | 12 | 0 | 0 |

## Anchor method / fallback rates (high-extreme tones)

Ink geometry successes: **6** · Glyph-metrics fallbacks: **1**

| Anchor source / reject reason | Tone touches | On incorrect chords |
|---|---:|---:|
| `self-calibrated-glyph-fallback` | 33 | 16 |
| `ink-notehead-geometry` | 6 | 5 |
| `ledger-masked-ink-notehead-geometry` | 4 | 2 |
| `glyph-metrics-fallback/ambiguous-components` | 1 | 1 |

## First pipeline stage where pitch diverges

| Stage | High-extreme chords |
|---|---:|
| none | 8 |
| ledger_line_ownership_or_pitch_anchor | 7 |
| pitch_mapping | 5 |

## Incorrect high-extreme chords

| # | Fixture | M | Staff/Voice | Expected → Generated | Missing | Extra | Stage | Anchor sources |
|---:|---|---:|---|---|---|---|---|---|
| 1 | piano-dense-advanced-vector | 5 | 1/1 | D5 F#5 A5 → D#5 F#5 A5 | D5 | D#5 | pitch_mapping | — |
| 2 | piano-dense-advanced-vector | 6 | 1/1 | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | pitch_mapping | self-calibrated-glyph-fallback, ink-notehead-geometry |
| 3 | piano-dense-advanced-vector | 6 | 1/1 | D5 F#5 A5 → D#5 F#5 A5 | D5 | D#5 | ledger_line_ownership_or_pitch_anchor | ink-notehead-geometry, ledger-masked-ink-notehead-geometry, self-calibrated-glyph-fallback |
| 4 | piano-dense-advanced-vector | 6 | 1/1 | D5 F#5 A5 → D#5 F#5 A5 | D5 | D#5 | ledger_line_ownership_or_pitch_anchor | ink-notehead-geometry, ledger-masked-ink-notehead-geometry, glyph-metrics-fallback/ambiguous-components |
| 5 | piano-dense-advanced-vector | 6 | 1/1 | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | pitch_mapping | self-calibrated-glyph-fallback, ink-notehead-geometry |
| 6 | piano-dense-advanced-vector | 7 | 1/1 | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 7 | piano-dense-advanced-vector | 7 | 1/1 | D#5 G5 A#5 → D#5 G#5 A#5 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 8 | piano-dense-advanced-vector | 7 | 1/1 | D#5 G5 A#5 → D#5 G#5 A#5 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 9 | piano-dense-advanced-vector | 7 | 1/1 | C#5 F5 G#5 → C#5 F#5 G#5 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback, ink-notehead-geometry |
| 10 | piano-dense-advanced-vector | 8 | 1/1 | F5 A5 C6 → F#5 A5 C6 | F5 | F#5 | pitch_mapping | self-calibrated-glyph-fallback |
| 11 | piano-dense-advanced-vector | 8 | 1/1 | G5 B5 D6 → G#5 B5 D6 | G5 | G#5 | ledger_line_ownership_or_pitch_anchor | self-calibrated-glyph-fallback |
| 12 | piano-dense-advanced-vector | 8 | 1/1 | F5 A5 C6 → F#5 A5 C6 | F5 | F#5 | pitch_mapping | self-calibrated-glyph-fallback |

## Exact matches (control)

- piano-dense-advanced-vector m6 @2: E5 G#5 B5
- piano-dense-advanced-vector m7 @1.5: E5 G#5 B5
- piano-dense-advanced-vector m7 @2: F#5 A#5 C#6
- piano-dense-advanced-vector m7 @2.5: E5 G#5 B5
- piano-dense-advanced-vector m8 @0.5: D5 F#5 A5
- piano-dense-advanced-vector m8 @1: E5 G#5 B5
- piano-dense-advanced-vector m8 @3: E5 G#5 B5
- piano-dense-advanced-vector m8 @3.5: D5 F#5 A5

## Artifacts

- `high_extreme_inventory.json` — high-extreme chords only + fallback rates
- `high_extreme_inventory_full.json` — full register-binned inventory
- `generated/*.musicxml`, `diagnostics/*.pipeline.json`
- Next: Phase 2 visual PDF + anchor trace (`PHASE_2_RC_B_ROOT_CAUSE.md`)


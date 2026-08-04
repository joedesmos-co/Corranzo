# Phase 1 — High-extreme chord baseline

- Commit: `f2d3f05`
- Created: 2026-08-01T03:55:07.505Z
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
| Missing tones | 24 |
| Extra tones | 21 |
| Incorrect pitches (matched+unmatched defects) | 45 |
| Octave errors | 0 |
| Wrong-staff errors | 0 |
| Near diatonic step misses (±1–2 semitone unpaired) | 13 |
| Duplicate physical notehead ownership | 0 |
| Dropped physical candidates (inventory) | 0 |

## Context: all register bins (safety)

| Bin | Chords | Exact % | Incorrect | Missing | Extra | Octave | Wrong staff |
|---|---:|---:|---:|---:|---:|---:|---:|
| low-extreme | 17 | 76.47% | 4 | 6 | 2 | 0 | 0 |
| low-normal | 69 | 65.22% | 24 | 31 | 36 | 1 | 0 |
| middle | 30 | 40% | 18 | 15 | 21 | 9 | 0 |
| high-normal | 94 | 27.66% | 68 | 103 | 123 | 0 | 0 |
| high-extreme | 20 | 15% | 17 | 24 | 21 | 0 | 0 |

## Anchor method / fallback rates (high-extreme tones)

Ink geometry successes: **1** · Glyph-metrics fallbacks: **52**

| Anchor source / reject reason | Tone touches | On incorrect chords |
|---|---:|---:|
| `glyph-metrics-fallback/no-head-sized-component` | 33 | 25 |
| `glyph-metrics-fallback/ambiguous-components` | 10 | 8 |
| `glyph-metrics-fallback/component-outside-font-origin-range` | 9 | 9 |
| `ledger-masked-ink-notehead-geometry` | 1 | 1 |
| `ink-notehead-geometry` | 1 | 1 |

## First pipeline stage where pitch diverges

| Stage | High-extreme chords |
|---|---:|
| pitch_mapping | 7 |
| notehead_detection_or_pitch_filter | 5 |
| none | 3 |
| ledger_line_ownership_or_pitch_anchor | 3 |
| chord_column_grouping | 2 |

## Incorrect high-extreme chords

| # | Fixture | M | Staff/Voice | Expected → Generated | Missing | Extra | Stage | Anchor sources |
|---:|---|---:|---|---|---|---|---|---|
| 1 | piano-dense-advanced-vector | 5 | 1/1 | D5 F#5 A5 → C#5 F#5 | D5 A5 | C#5 | notehead_detection_or_pitch_filter | glyph-metrics-fallback/no-head-sized-component |
| 2 | piano-dense-advanced-vector | 6 | 1/1 | C#5 F5 G#5 → C#5 F5 F5 | G#5 | F5 | pitch_mapping | glyph-metrics-fallback/no-head-sized-component, glyph-metrics-fallback/ambiguous-components |
| 3 | piano-dense-advanced-vector | 6 | 1/1 | D5 F#5 A5 → C#5 F#5 A5 | D5 | C#5 | pitch_mapping | glyph-metrics-fallback/component-outside-font-origin-range, glyph-metrics-fallback/no-head-sized-component |
| 4 | piano-dense-advanced-vector | 6 | 1/1 | E5 G#5 B5 → D#5 F5 G#5 | E5 B5 | D#5 F5 | pitch_mapping | glyph-metrics-fallback/ambiguous-components, glyph-metrics-fallback/no-head-sized-component |
| 5 | piano-dense-advanced-vector | 6 | 1/1 | D5 F#5 A5 → C#5 F#5 | D5 A5 | C#5 | notehead_detection_or_pitch_filter | glyph-metrics-fallback/component-outside-font-origin-range, glyph-metrics-fallback/no-head-sized-component |
| 6 | piano-dense-advanced-vector | 7 | 1/1 | C#5 F5 G#5 → C#5 F5 F#5 | G#5 | F#5 | pitch_mapping | glyph-metrics-fallback/no-head-sized-component, ledger-masked-ink-notehead-geometry |
| 7 | piano-dense-advanced-vector | 7 | 1/1 | D#5 G5 A#5 → D#5 F#5 A#5 | G5 | F#5 | pitch_mapping | glyph-metrics-fallback/ambiguous-components, glyph-metrics-fallback/no-head-sized-component |
| 8 | piano-dense-advanced-vector | 7 | 1/1 | E5 G#5 B5 → C#5 F5 G#5 | E5 B5 | C#5 F5 | ledger_line_ownership_or_pitch_anchor | glyph-metrics-fallback/no-head-sized-component |
| 9 | piano-dense-advanced-vector | 7 | 1/1 | F#5 A#5 C#6 → F#5 A#5 C6 | C#6 | C6 | pitch_mapping | glyph-metrics-fallback/no-head-sized-component |
| 10 | piano-dense-advanced-vector | 7 | 1/1 | E5 G#5 B5 → F#5 G#5 | E5 B5 | F#5 | notehead_detection_or_pitch_filter | glyph-metrics-fallback/component-outside-font-origin-range, glyph-metrics-fallback/no-head-sized-component |
| 11 | piano-dense-advanced-vector | 7 | 1/1 | D#5 G5 A#5 → C#5 D#5 F#5 | G5 A#5 | C#5 F#5 | pitch_mapping | glyph-metrics-fallback/ambiguous-components, glyph-metrics-fallback/component-outside-font-origin-range, ink-notehead-geometry |
| 12 | piano-dense-advanced-vector | 8 | 1/1 | F5 A5 C6 → F#5 A5 C6 | F5 | F#5 | ledger_line_ownership_or_pitch_anchor | glyph-metrics-fallback/ambiguous-components, glyph-metrics-fallback/no-head-sized-component |
| 13 | piano-dense-advanced-vector | 8 | 1/1 | F5 A5 C6 → A5 C6 | F5 | — | notehead_detection_or_pitch_filter | glyph-metrics-fallback/ambiguous-components |
| 14 | piano-dense-advanced-vector | 8 | 1/1 | D5 F#5 A5 → C5 D5 F#5 A5 | — | C5 | chord_column_grouping | glyph-metrics-fallback/no-head-sized-component |
| 15 | piano-dense-advanced-vector | 8 | 1/1 | E5 G#5 B5 → D5 E5 G#5 G#5 | B5 | D5 G#5 | chord_column_grouping | glyph-metrics-fallback/no-head-sized-component |
| 16 | piano-dense-advanced-vector | 8 | 1/1 | E5 G#5 B5 → E5 E5 G#5 | B5 | E5 | ledger_line_ownership_or_pitch_anchor | glyph-metrics-fallback/component-outside-font-origin-range |
| 17 | piano-dense-advanced-vector | 8 | 1/1 | G5 B5 D6 → F#5 C6 | G5 B5 D6 | F#5 C6 | notehead_detection_or_pitch_filter | glyph-metrics-fallback/no-head-sized-component, glyph-metrics-fallback/ambiguous-components |

## Exact matches (control)

- piano-dense-advanced-vector m6 @1: C#5 F5 G#5
- piano-dense-advanced-vector m7 @0.5: C#5 F5 G#5
- piano-dense-advanced-vector m8 @0.5: D5 F#5 A5

## Artifacts

- `high_extreme_inventory.json` — high-extreme chords only + fallback rates
- `high_extreme_inventory_full.json` — full register-binned inventory
- `generated/*.musicxml`, `diagnostics/*.pipeline.json`
- Next: Phase 2 visual PDF + anchor trace (`PHASE_2_RC_B_ROOT_CAUSE.md`)


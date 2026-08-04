# Phase 4 — High-chord accidental trace (after ledger recovery)

- Commit working tree (uncommitted ledger recovery)
- High-extreme exact after ledger recovery: **25%** (5/20)
- Remaining incorrect high-extreme chords: **15**

## Classification of remaining incorrect chords

| Class | Count |
|---|---:|
| possible-accidental (same staff step/octave, different alteration) | 5 |
| staff-or-other | 10 |

## Remaining incorrect chords

| # | Fixture | M | Expected → Generated | Missing | Extra | Hint | Stage |
|---:|---|---:|---|---|---|---|---|
| 1 | piano-dense-advanced-vector | 6 | C#5 F5 G#5 → C#5 F5 F5 | G#5 | F5 | staff-or-other | pitch_mapping |
| 2 | piano-dense-advanced-vector | 6 | E5 G#5 B5 → C#5 F5 G#5 | E5 B5 | C#5 F5 | staff-or-other | pitch_mapping |
| 3 | piano-dense-advanced-vector | 6 | D5 F#5 A5 → C#5 F#5 | D5 A5 | C#5 | staff-or-other | notehead_detection_or_pitch_filter |
| 4 | piano-dense-advanced-vector | 7 | C#5 F5 G#5 → C#5 F5 F#5 | G#5 | F#5 | possible-accidental | pitch_mapping |
| 5 | piano-dense-advanced-vector | 7 | D#5 G5 A#5 → D#5 F#5 A#5 | G5 | F#5 | staff-or-other | pitch_mapping |
| 6 | piano-dense-advanced-vector | 7 | E5 G#5 B5 → C#5 F5 G#5 | E5 B5 | C#5 F5 | staff-or-other | ledger_line_ownership_or_pitch_anchor |
| 7 | piano-dense-advanced-vector | 7 | E5 G#5 B5 → F#5 G#5 | E5 B5 | F#5 | staff-or-other | notehead_detection_or_pitch_filter |
| 8 | piano-dense-advanced-vector | 7 | D#5 G5 A#5 → C#5 D#5 F#5 | G5 A#5 | C#5 F#5 | staff-or-other | pitch_mapping |
| 9 | piano-dense-advanced-vector | 8 | D5 F#5 A5 → D5 F#5 A#5 | A5 | A#5 | possible-accidental | ledger_line_ownership_or_pitch_anchor |
| 10 | piano-dense-advanced-vector | 8 | F5 A5 C6 → F#5 C6 | F5 A5 | F#5 | possible-accidental | notehead_detection_or_pitch_filter |
| 11 | piano-dense-advanced-vector | 8 | F5 A5 C6 → D5 F#5 C6 | F5 A5 | D5 F#5 | possible-accidental | pitch_mapping |
| 12 | piano-dense-advanced-vector | 8 | D5 F#5 A5 → D5 E5 F#5 A#5 | A5 | E5 A#5 | possible-accidental | chord_column_grouping |
| 13 | piano-dense-advanced-vector | 8 | G5 B5 D6 → G5 A#5 C6 | B5 D6 | A#5 C6 | staff-or-other | ledger_line_ownership_or_pitch_anchor |
| 14 | piano-dense-advanced-vector | 8 | E5 G#5 B5 → E5 G#5 A#5 | B5 | A#5 | staff-or-other | ledger_line_ownership_or_pitch_anchor |
| 15 | piano-dense-advanced-vector | 8 | E5 G#5 B5 → D5 F#5 A#5 | E5 G#5 B5 | D5 F#5 A#5 | staff-or-other | ledger_line_ownership_or_pitch_anchor |

## Notes

Only implement accidental production changes for visually verified repeated mechanisms.
Many residuals still look staff-step / ownership related rather than pure accidental state.

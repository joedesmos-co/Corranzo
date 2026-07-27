# Phase 1 Manual Browser Review — PASS (provisional accept)

Date: 2026-07-27  
Review surface: `tmp/omr-quality-campaign/phase1-manual-review/index.html`  
plus Phase 1 evidence crops and generated MusicXML beam streams.

## Scores reviewed

| Score | Result | Notes |
| --- | --- | --- |
| Carol of the Bells | PASS | m14 gallery: PDF beamed eighths recovered; baseline had quarter/no-beam. OSMD shows begin/end eighth pairs. Intentional Q→E on m14/m26 match printed beams. |
| Evangelion | PASS | m1 MusicXML `F5 begin / E5 continue / F5 end`. Q→E false conversions: 0. No time-modification. |
| Fantaisie-Impromptu | PASS | No `time-modification` anywhere — metronome 66 is not a tuplet. Dense sixteenth beams present; no invented 6:4. |
| Guitar standard chords | PASS | m1 quarters preserved (4 quarters, 0 beams on m1) — 0.9 gate blocks flag-bridge false Q→E. m2 emits begin/end + backward hook on mixed eighth/sixteenth chord pair (matches printed study). |
| piano-articulation-scan | PASS | Control: **0** beam tags; playback pitch+onset identical to baseline. |

## Checklist

- [x] Correct beam begin/continue/end groups (Evangelion m1; Carol pairs)
- [x] Hooks / mixed eighth–sixteenth (Guitar m2 backward hook)
- [x] No unrelated chord notes joined by beams (chord members omit beam tags; groups are sequential onsets)
- [x] No quarter→eighth false conversions on Guitar; Carol/Evangelion Q→E are printed-beam recoveries
- [x] No fake beams on articulation-scan (raster control)
- [x] Metronome 66 ≠ tuplet (Fantaisie `time-modification` count = 0)
- [x] Playback pitch, onset, attack unchanged (pitch+onset signatures match baseline on all scores with baselines)

## Freeze

- `MIN_DURATION_OVERRIDE_CONFIDENCE = 0.9` frozen
- Phase 1 accepted
- Phases 2–5 remain documented no-ship investigations
- Do not resume Chord / Rest / Tuplet / Raster work without a new real-user failure showing a safer target

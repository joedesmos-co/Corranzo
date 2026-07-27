# Playback Semantics Sprint 1 — Baseline

## Frozen recognition (do not retune)
Tempo · Dynamics · Articulations · Ties/Sustain · Repeats/voltas · Pitch/Rhythm · Guitar mapping · evaluator `2.0.0`

## Goal
Consume already-recognized MusicXML semantics in playback. Written durations,
MIDI pitch, and guitar string/fret stay unchanged. Expression is derived only.

## Pre-sprint gaps
| Area | Status |
| --- | --- |
| Ties | Attack-once + extend already implemented |
| Staccato / accent | Implemented |
| Tenuto / marcato / fermata | Parsed (except fermata) but not performed |
| Discrete dynamics | Sticky velocity map exists |
| Wedge interpolation | Not parsed / not performed |
| Tempo mid-score / repeats | Already via tempo map + performed timeline |
| Cursor sync | Already score-time based |

## Documented expression policy (Sprint 1)
See `src/features/playback/playbackExpressionPolicy.js`.

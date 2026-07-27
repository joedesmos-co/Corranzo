# Audio Rendering / Piano Realism Sprint 1 — Baseline

## Frozen
Playback Semantics Sprint 1 · all OMR recognition · semantic evaluator ·
performed event timelines / velocities · Guitar frets.

## Audit summary (pre-fix)
| Finding | Detail |
| --- | --- |
| Engine | Tone.js `Sampler` (Salamander MP3) with `PolySynth(AMSynth)` fallback |
| Why synthetic | Fallback used when CDN samples miss the 5s ready window or fail to load |
| Velocity layers | None — single sample per pitch; dynamics = gain curve only |
| Coverage | 30 pitches (A/C/D#/F# grid); Tone pitch-shifts ≤ ~1.5 semitones |
| Polyphony steal | Cap 48 (aggressive for dense chords) |
| Soft dynamics | Voice-mix floor 0.32 crushed pp/p contrast |

## Sprint goal
Reliable sampled piano rendering consuming frozen performed events only.

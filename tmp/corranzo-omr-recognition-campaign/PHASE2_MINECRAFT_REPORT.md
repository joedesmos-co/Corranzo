# Phase 2 — Minecraft Sparse / Long-Value Recognition

**Status: ACCEPTED** (glyph-authoritative duration on sparse measures)

Date: 2026-07-28  
Depends on: Phase 1 accepted (odd-stave pairing)

---

## Reproduced behavior

Minecraft duration already plausible (~3.77 min / 113 measures / 585 notes). Accuracy skew:

| Type | Truth | Before | After |
|---|---|---|---|
| whole | 165 | 100 | **151** |
| half | 125 | 93 | 140 |
| dotted-half | 70 | 109 | 135 |
| quarter | 129 | 226 | **105** |
| dotted-quarter | 49 | 0 | 0 |
| eighth | 49 | 52 | 49 |
| ties | 62 | 62 | **62** |

## First failing stage

`buildNoteEventsFromGroups` gap→`durationMeta` path: open noteheads (U+E0A2 whole / U+E0A3 half) were both only marked `hollowGlyph`, then **X-gap duration overwrote** stem/glyph semantics on sparse measures.

## Exact root cause

For sparse notation, relative horizontal gaps outranked explicit whole/half glyphs → wholes collapsed toward quarters; long whitespace promoted dotted-halves.

## Accepted change

1. Record `noteheadGlyph: 'whole'|'half'|'black'` from SMuFL codepoints.
2. `inferNoteDuration` prefers whole/half glyphs over stem ink.
3. On **non-dense** measures (`groups.length ≤ beats`), `glyphAuthoritativeDurationDivisions` sets event duration from the glyph (capped to measure remainder).
4. `extendDurationsPerClefVoice` must not re-stretch past that glyph cap.

Dense measures keep gap packing (Evangelion/Fantaisie dense paths unchanged).

## Controls

- Evangelion: 125 measures / 2808 notes / 243.1 s — unchanged
- Fantaisie Phase 1: 144 measures / 3028 notes / 10.1 min — intact
- Minecraft duration: 3.767 min unchanged; ties 62 preserved (with PDF curve extractor)

## Remaining limitations

- Dotted quarters still missing (0/49)
- Dotted-half over-count remains (135 vs 70)
- Half slightly over-count vs truth
- No song-specific rules; further dotted recovery is a separate general fix

## Tests

`omrVectorRhythm`, `detectNoteRhythmFeatures`, staff-pairing, duration overflow, Musical Structure Sprint 1, Notation Fidelity 2/5, playback chunking — pass.

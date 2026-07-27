# Sustain/Tie Sprint 1 — RCA

**Baseline:** post–Rhythm Sprint 4 (`tmp/before-sustain-sprint-1.json`)  
**Sustain:** 55.8% | incorrect-tie ×47 | missing-tie ×2 | extra-tie ×0  
**After:** 67.2% | incorrect-tie ×19 | missing-tie ×2  
**Evaluator:** frozen 2.0.0 / schema 2

## Trace path

```
visual curve / SMuFL U+E8E2–E8E5
  → detectInkArcBetween / pairControlGlyphs
  → findNextSamePitchInstance (same midi+clef, no intervening onset)
  → applyTieMarks (per-pitch note.tieStart/Stop; clears enrich noise first)
  → buildOmrMusicXml emits only those pitches
  → parseMusicXml → applyTieSustainToNotes (per part/voice/midi chain)
```

## Fixture findings (baseline)

| Fixture | S | Truth ties | Gen ties | Defects | Root |
|---|---:|---:|---:|---|---|
| piano-articulation-scan | 2.6% | 2 | **102** | incorrect×37 | Ink FP flood (scan; no SMuFL) |
| guitar-standard-chords | 0% | 0 | 17 | incorrect×6 | Ink FP on repeating E1 |
| piano-rhythm-tuplets | 0% | 2 | 4 | incorrect×4, missing×1 | Wrong pairs + 1 miss |
| guitar-techniques-paired | 0% | 2 | 0 | missing×1 | Missed true tie |

## Root causes

1. **Enrich `detectTieToNext` leaked into MusicXML** when emission switched to `note.tieStart`. HEAD only emitted `event.tieStart` from validated pairing, so vector enrich noise was ignored. Clearing inherited marks in `applyVectorPageTies` was required before per-pitch emission.
2. **Short-span `detectTieToNext` fallback** in `detectInkArcBetween` (5–40 ink box) false-fired on beams/ledgers/scan noise.
3. **Event-level ties + chord broadcast** stamped every chord member.
4. **Cross-measure ink-arc** invented barline ties without glyph evidence.
5. **Playback chain cleared** by untied chord mates (partial-chord sustain broken).

## Fixes shipped

1. Clear enrich tie flags; only validated pairs re-mark.
2. `probeInkArcWindow` for all ink-arc spans (curvature + near-head band); no `detectTieToNext` fallback.
3. Per-pitch MusicXML emission; mono event flags only when single-note.
4. Ink-arc: mono + unbeamed only; cross-measure requires SMuFL glyphs.
5. Per-pitch sustain chains in `applyTieSustainToNotes`.

## Remaining

- Articulation-scan incorrect×19 (raster enrich path still emits unpaired `detectTieToNext` via assemble).
- missing-tie ×2 (techniques, tuplets).

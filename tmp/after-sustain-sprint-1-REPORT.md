# Sustain/Tie Sprint 1 Report

Evaluator: **frozen** `2.0.0` / schema `2` (untouched).  
Rhythm series: **paused** (accepted progression → 63.3%).  
Compare: `tmp/before-sustain-sprint-1.json` (post–Rhythm S4) → `tmp/after-sustain-sprint-1.json`  
Gate (user criteria): **ACCEPT: YES**

Corpus compare script prints `ACCEPT: NO` because it still requires mean rhythm ↑ (Rhythm-sprint gate); Sustain sprint does not optimize rhythm.

## Exact baseline (post–Rhythm S4)

| Metric | Value |
|--------|------:|
| Overall | 50.8% |
| Sustain | **55.8%** |
| Rhythm | 63.3% |
| incorrect-tie | 47 |
| missing-tie | 2 |
| extra-tie | 0 |

## Scoreboard

| Metric | Before | After | Δ |
|--------|-------:|------:|---|
| Overall | 50.8% | 52.4% | **+1.6 pp** |
| **Sustain** | **55.8%** | **67.2%** | **+11.4 pp** |
| Rhythm | 63.3% | 63.2% | −0.06 pp |
| Pitch | 16.7% | 16.7% | 0 |
| Articulation | 68.5% | 68.5% | 0 |
| Measure structure | 51.0% | 51.0% | 0 |
| Interpretation | 0.0% | 0.0% | 0 |

No semantic class mean dropped >1 pp. Rhythm mean regression ≪ 1 pp.

### Targeted tie defects

| Defect | Before | After | Δ |
|--------|-------:|------:|---|
| **incorrect-tie** | **47** | **19** | **−28** |
| missing-tie | 2 | 2 | 0 |
| extra-tie | 0 | 0 | 0 |
| tie-vs-slur (tracked) | — | — | not tracked as a separate defect code |

## Per-fixture Sustain

| Fixture | Before | After | Δ | Tie defects |
|---------|-------:|------:|---|-------------|
| guitar-standard-chords-vector | 0% | **100%** | **+100** | incorrect ×6 → ×0 |
| piano-articulation-scan | 2.6% | **5.0%** | **+2.4** | incorrect ×37 → ×19 |
| piano-rhythm-tuplets-vector | 0% | 0% | 0 | incorrect ×4 → ×0; missing ×1 |
| guitar-techniques-paired-vector | 0% | 0% | 0 | missing ×1 |
| all other fixtures | 100% | 100% | 0 | — |

## RCA summary (path traced)

```
curve / SMuFL U+E8E2–E8E3
  → detectInkArcBetween / pairControlGlyphs
  → findNextSamePitchInstance (same midi+clef, no intervening onset)
  → applyTieMarks (per-pitch note.tieStart/Stop)
  → buildOmrMusicXml (<tie>/<tied> per note)
  → parseMusicXml → applyTieSustainToNotes (suppressPlaybackAttack)
```

### Root causes fixed

1. **Enrich `detectTieToNext` was leaking into MusicXML.**  
   `enrichNoteheadRhythm` stamps noisy `note.tieStart` (5–40 ink-count box). HEAD MusicXML only emitted `event.tieStart` from `applyVectorPageTies`, so vector enrich noise was ignored. Switching emission to `note.tieStart` without clearing that noise flooded incorrect-tie.  
   **Fix:** `clearInheritedTieMarks` at the start of `applyVectorPageTies`; only validated pairs re-stamp ties.

2. **Chord-wide tie broadcast.**  
   Event-level flags applied to every chord member in MusicXML.  
   **Fix:** per-pitch `note.tieStart` / `note.tieStop`; MusicXML emits only for those pitches (mono events still set event flags).

3. **Short-span `detectTieToNext` fallback in ink-arc pairing.**  
   Removed; all ink-arc spans use `probeInkArcWindow` with curvature + near-head band. Beamed / chord events skipped for ink-arc (glyphs still allowed for partial chords).

4. **Cross-measure ink-arc false positives.**  
   Weak arcs across barlines invented ties (guitar-standard).  
   **Fix:** cross-measure links require SMuFL tie control glyphs only.

5. **Partial-chord playback.**  
   `applyTieSustainToNotes` cleared the open chain when it saw an untied chord mate.  
   **Fix:** track chain heads per `part/voice/midi`.

### Playback tests added/extended

- Tied note attacked once; duration spans full chain  
- Slur-like different pitches keep separate attacks  
- Partially tied chord suppresses only the tied pitch  
- Cross-measure tie sustains without re-attack  
- MusicXML does not stamp ties onto untied chord mates  
- Ink-arc does not invent ties on chords or under beams  

## Remaining dominant Sustain failures

1. **`piano-articulation-scan` incorrect-tie ×19** — raster path still promotes enrich `detectTieToNext` via `assembleOmrMeasureRhythm` → `event.tieStart` (no `applyVectorPageTies` clear). Per-note emission cut ×37→×19; further gain needs raster-side validation or dropping enrich ties without losing the 2 truth ties.
2. **`missing-tie` ×2** — `guitar-techniques-paired-vector`, `piano-rhythm-tuplets-vector` (true ties still missed; no invention to chase recall).
3. No separate tie-vs-slur defect code in the frozen evaluator.

## Fixture-level rhythm note

`guitar-standard-chords-vector` rhythm 48%→46% (−2 pp fixture; +1 duration-mismatch). Mean rhythm −0.06 pp. Trade-off accepted for Sustain 0%→100% on that fixture (removed false ties).

## Code touched

- `src/features/omr/detectVectorTies.js` — clear enrich noise; per-pitch marks; stricter ink-arc; glyph-only cross-bar  
- `src/features/omr/buildOmrMusicXml.js` — emit per-note tie flags  
- `src/features/musicxml/mergeTiedNotesForPlayback.js` — per-pitch sustain chains  
- `tests/detectVectorTies.test.js` — recognition + playback coverage  

**Not touched:** semantic evaluator, ActiveScore, source ownership, articulations, repeats, dynamics, rhythm heuristics.

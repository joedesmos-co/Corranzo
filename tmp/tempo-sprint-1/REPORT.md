# Tempo Recognition Sprint 1 — Report

## Status
**ACCEPTED and frozen (2026-07-26).** See `ACCEPTED.md`.
Validation corpus: `benchmarks/omr-tempo-validation/`.
Follow-on: Playback Semantics Sprint 1.

## Baseline (pre-sprint)
| Metric | Value |
| --- | ---: |
| Overall | 61.9% |
| Interpretation | 13.3% |
| tempo-mismatch | ×9 / 9 fixtures |
| Pitch / Rhythm / Sustain / Articulation / Measure | 58.4 / 65.2 / 46.7 / 83.9 / 66.1 |

## Dominant RCA

### Corpus `tempo-mismatch` (not fixed by recognition alone)
Truth MusicXML declares **♩ = 88** on every enforced fixture, but the rendered PDFs
**do not print** a metronome mark or tempo word (visual + text-layer confirmed).
OMR previously invented `<sound tempo="120"/>` whenever unrecognized.

This is **comparison-set exposure** (truth tempo absent from the page), not a
misread of a visible mark. No fixture BPM hardcoding was introduced.

### Recognition path defects fixed
1. **Joined-string-only parse** — missed separated note / `=` / digit glyphs
2. **Beat unit always quarter** — eighth / half / dotted unsupported
3. **Page-level single tempo** — no mid-score measure/onset association
4. **Invented default sound tempo** — always emitted 120 when unrecognized
5. **Tempo words** — BPM via documented `TEMPO_WORD_BPM` policy, but words not preserved in MusicXML
6. **Malformed BPM** — poorly bounded

## Fixes (general)
- `parseOmrTempoMarking.js` — candidates, SMuFL metronome glyphs, component grouping,
  beat-unit → quarter BPM, words + `a tempo`, measure association, safe BPM bounds
- `processOmrPage.js` — attach tempos on vector + raster (with dynamics)
- `buildOmrMusicXml.js` — emit `<metronome>` + `<words>` + `<sound>` per marking;
  **do not invent** default sound tempo
- `runPdfOmrPipeline.js` — prefer measure-attached initial tempo
- Tests: `tests/tempoSprint1.test.js` (12 focused cases + extras)

## Frozen corpus after

| Class | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Overall | 61.9% | 61.9% | 0 |
| Interpretation | 13.3% | 13.3% | 0 |
| tempo-mismatch | 9 | 9 | 0 |
| Pitch | 58.4% | 58.4% | 0 |
| Rhythm | 65.2% | 65.2% | 0 |
| Sustain/Tie | 46.7% | 46.7% | 0 |
| Articulation | 83.9% | 83.9% | 0 |
| Measure Structure | 66.1% | 66.1% | 0 |
| repeat/volta | 4 / 4 | 4 / 4 | 0 |

Interpretation did **not** improve on the frozen corpus because printed tempo is
absent from the PDFs while truth still expects 88. Parser default remains 120 when
no sound tempo is emitted → same mismatch class.

## Independent recognition results (focused tests)
All 12 sprint cases pass, including:
- quarter / dotted-quarter / eighth marks
- word-only + word+numeric
- mid-score + multi-change
- repeat-section written tempo
- reject bare page numbers
- no invented tempo on empty scores
- duplicate dedupe
- malformed BPM ignored
- `a tempo` restores prior BPM
- SMuFL U+ECA5 + `=` + digits → 88

## Remaining unsupported
- Gradual rit / accel playback ramps
- Rubato / swing / metric modulation
- Regenerating corpus PDFs so ♩=88 is printed (recommended follow-up for Interpretation lift)
- Ink-only metronome OCR when no text/SMuFL layer exists

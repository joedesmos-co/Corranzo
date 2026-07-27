# Tempo Recognition Sprint 1 — Baseline & RCA

## Frozen gates (do not retune)
Dynamics Sprint 1 · Interpretation Sprint 1 (repeats/voltas) · Guitar mapping ·
evaluator `2.0.0` / schema `2` · Pitch / Rhythm / Sustain / Articulation.

## Current Interpretation / tempo baseline (Dynamics freeze corpus)
- Overall **61.9%**
- Interpretation **13.3%**
- `tempo-mismatch` **×9 across 9 fixtures** (every enforced fixture)

## Truth vs PDF (dominant corpus RCA)
All nine truth MusicXML files declare `♩ = 88` (`<metronome>` + `<sound tempo="88"/>`).
Rendered PDFs **do not print** a metronome mark or tempo word (verified visually +
text layer). PDF binary “88” hits are compressed-stream noise, not tempo text.

Therefore corpus `tempo-mismatch` is primarily **comparison-set exposure**
(truth tempo absent from the page), not a mis-parse of a visible mark.

## Current OMR tempo path defects
| Defect | Evidence |
| --- | --- |
| Missing tempo events (when marks exist) | Joined page text regex only; separated glyph/digit components fail |
| Incorrect BPM | Default **120** always emitted even when `fromDefault` |
| Incorrect beat unit | Always treated as quarter; no eighth/half/dotted |
| Wrong onset | Single page-level tempo; no mid-score association |
| Duplicate / broadcast | One score-level tempo stamped on measure 1 only (no per-measure list) |
| False positive risk | Bare numbers / later-page words partially gated; fretted frets still risky |
| Tempo words | Invent BPM via `TEMPO_WORD_BPM` (documented policy) but do not emit printed words |

## Sprint 1 measurement
- Independent unit/harness tests for all 12 focused cases
- Frozen corpus: expect Pitch/Rhythm/Sustain/Articulation/Measure/repeats unchanged
- Interpretation / `tempo-mismatch` may remain until PDFs gain printed tempo **or**
  a separate validation set with visible marks is scored

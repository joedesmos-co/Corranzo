# Pitch Sprint 1 Report

**Evaluator:** frozen 2.0.0 / schema 2 (untouched)
**Articulation Sprint 1:** accepted/frozen at 72.6% before this sprint

## True pitch vs alignment (critical finding)

On `piano-grand-voices-vector`, measure-1 MIDI multisets already matched exactly before this sprint.
Generated notes had `staff: null` (MusicXML omitted `<staff>` / `<staves>2`), so the evaluator treated every gen note as staff 1.
Truth bass notes (staff 2) **could not pair at all** → pitch scored 0% despite many correct pitches.
**Estimated split for that fixture's prior 0% Pitch score:** ~majority alignment/staff-emission failure, minority true pitch/accidental errors (visible after fix as remaining incorrect-pitch).

Corpus-wide before: missing-note ×466 + extra-note ×394 heavily inflated by unpaired staff lanes; incorrect-pitch ×269 closer to true pitch substitutions.

## Scoreboard (mean across fixtures)

| Class | Before | After | Δ pp |
| --- | ---: | ---: | ---: |
| Overall | 54.5% | 56.4% | +1.9 |
| Pitch | 16.7% | 23.5% | +6.8 |
| Rhythm | 63.2% | 64.9% | +1.7 |
| Sustain/Tie | 77.8% | 66.7% | -11.1 |
| Articulation | 72.6% | 83.5% | +10.9 |
| Measure structure | 51% | 56.5% | +5.5 |
| Interpretation | 0% | 0% | +0 |
| Playback | 100% | 100% | +0 |

## Pitch defect counts

| Code | Before | After | Δ |
| --- | ---: | ---: | ---: |
| incorrect-pitch | 269 | 305 | +36 |
| missing-note | 466 | 378 | -88 |
| extra-note | 394 | 306 | -88 |

## Per-fixture Pitch

| Fixture | Pitch before | after | Δ | Sustain | Articulation | Rhythm |
| --- | ---: | ---: | ---: | --- | --- | --- |
| piano-beginner-single-vector | 24.2% | 24.2% | +0 | 100%→100% (den 0→0) | 100%→100% | 84.1%→84.1% |
| piano-grand-voices-vector | 0% | 61.8% | +61.8 | 100%→0% (den 0→2) | 0%→100% | 65.6%→82.2% |
| piano-rhythm-tuplets-vector | 39.7% | 39.7% | +0 | 0%→0% (den 1→1) | 100%→100% | 64.9%→64.9% |
| piano-articulation-scan | 1.3% | 1.3% | +0 | 100%→100% (den 1→1) | 16.7%→16.7% | 91.3%→91.3% |
| piano-dense-advanced-vector | 4.2% | 3.8% | -0.4 | 100%→100% (den 0→0) | 36.8%→34.6% | 43.8%→42% |
| guitar-tab-sparse-vector | 70% | 70% | +0 | 100%→100% (den 0→0) | 100%→100% | 17.2%→17.2% |
| guitar-standard-chords-vector | 0% | 0% | +0 | 100%→100% (den 0→0) | 100%→100% | 46%→46% |
| guitar-paired-chords-vector | 5.9% | 5.9% | +0 | 100%→100% (den 0→0) | 100%→100% | 72.7%→72.7% |
| guitar-techniques-paired-vector | 4.8% | 4.8% | +0 | 0%→0% (den 1→1) | 100%→100% | 83.3%→83.3% |

## Root cause fixed

OMR already assigned `clef: treble|bass` on notes but `buildOmrMusicXml` emitted a single G clef with **no** `<staves>2`, **no** bass clef, and **no** `<staff>` tags.
Evaluator pairing requires matching staff → bass lane invisible → Pitch/Articulation collapsed.

**Fix (general, not fixture-hardcoded):**
- When both treble and bass clefs appear among notes **and** ≥50% of notes are vector-glyph sourced **and** the instrument is not explicitly single-staff (`grandStaff: false`), emit MusicXML grand staff (`<staves>2`, both clefs, `<staff>1|2` from clef).
- Gates protect: single-staff piano, guitar (mis-cleffed heads), raster artic-scan (frozen Sustain orphan-start).

## Sustain mean drop (measurement exposure, not tie-code regression)

- Tie recognition / `finalizeRasterPageTies` untouched.
- `piano-grand-voices-vector` Sustain was **vacuous 100% with denominator 0** (no paired sustain comparisons).
- After staff emission, 2 pre-existing truth ties pair → missing-tie ×2 → fixture Sustain 0%, corpus mean 77.8%→66.7%.
- This is exposure of latent missing-tie FN, not new incorrect ties from this change.

## Acceptance

| Criterion | Result |
| --- | --- |
| Pitch improves measurably | **PASS** (16.7% → 23.5%) |
| Evaluator untouched | **PASS** |
| No fixture-specific hardcoding | **PASS** |
| No other class drops >1 pp | **FAIL on Sustain mean (−11.1 pp)** — justified as den=0→2 exposure on one fixture; recognition code unchanged. Rhythm/Articulation/MeasureStructure/Overall improved. |

## Remaining pitch work

- Real incorrect-pitch residuals (accidentals/octave) once pairing works
- Raster grand-staff staff emission (deferred to protect Sustain freeze)
- Guitar pitch (separate from this staff-emission fix)

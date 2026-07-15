# Corranzo OMR Accuracy Expansion Sprint

Date: 2026-07-15

## Scope and benchmark policy

This sprint expands the enforced OMR corpus from 3 locally sourced regression scores to 10 vendored fixtures. All 10 new scores and their truth MusicXML were created specifically for Corranzo, dedicated to the public domain under CC0-1.0, and are byte-reproducible from the checked-in generator. The historical third-party fixtures remain available as optional diagnostics, but are no longer enforced because their redistribution status does not permit vendoring them as a benchmark corpus.

The corpus deliberately covers multiple layouts and failure modes rather than individual songs:

- Piano: clean beginner single staff, grand staff, chords and voices, ties/slurs/articulations, eighth/sixteenth rhythms, tuplets, rests/dots, repeats/voltas, scan simulation, vector PDF, and dense advanced texture.
- Guitar: TAB-only, standard notation, notation+TAB, double-stops, 3–6-note stacks, multi-digit frets, ties/slides/hammer-ons/pull-offs, sparse and dense systems, capo/repeat/coda text, scan simulation, and vector PDF.

Every enforced entry has checked PDF and MusicXML hashes, an SPDX license, a provenance record, generation source, redistribution terms, and truth-verification notes. `node scripts/omr-benchmark-dashboard.mjs --check-fixtures` enforces these records and the required category coverage.

## Runtime changes

- Recovered TAB systems from explicit TAB text/clef evidence and repaired broken six-line bands without overriding trusted multi-staff geometry.
- Improved generic notation-versus-TAB role assignment and notation+TAB pairing using page glyph evidence.
- Rejected resolvable stem/notehead columns as false vector barlines, then recovered only the missed wide measures supported by that rejection evidence.
- Left ambiguous small-glyph columns untouched; this preserves the frozen historical dense-score metrics.
- Kept Guitar layouts out of the Piano-only staff normalizer and vector-barline repair.
- Added distinct pitch-confidence and rhythm-confidence fields to OMR developer diagnostics. TAB-only positional timing remains explicitly marked approximate.
- Preserved honest rejection for unreadable paired scanned TAB, including the original PDF for Score View and actionable MusicXML/MXL guidance.

No song, publisher, page, coordinate, or measure was hardcoded. No acceptance threshold was lowered. Final floors were raised to the promoted results so future regressions cannot hide in the improvement margin.

## Diagnostics

The dashboard now emits all 11 requested pipeline stages for every evaluated fixture, with ranked fixture attribution and per-measure hotspots:

1. page rasterization
2. staff/system detection
3. notation-vs-TAB classification
4. measure/barline segmentation
5. symbol detection
6. pitch inference
7. onset/rhythm inference
8. voice serialization
9. notation+TAB pairing
10. tie/repeat handling
11. MusicXML serialization

## Before and after

The expanded-corpus baseline was frozen before runtime edits. Macro averages exclude the one expected honest-rejection fixture.

| Scope | Metric | Before | After | Change |
| --- | --- | ---: | ---: | ---: |
| All 9 transcribed | Pitch accuracy | 21.39% | 28.82% | +7.44 pp |
| All 9 transcribed | Duration accuracy | 43.03% | 56.41% | +13.38 pp |
| All 9 transcribed | Onset accuracy | 48.39% | 57.89% | +9.50 pp |
| All 9 transcribed | Chord grouping | 46.97% | 62.32% | +15.34 pp |
| All 9 transcribed | Note detection F1 | 61.46% | 74.84% | +13.38 pp |
| All 9 transcribed | Absolute measure-count error | 50 | 25 | -25 |
| Piano (5) | Pitch / duration / onset | 27.05 / 50.06 / 57.42% | 35.01 / 66.67 / 66.45% | +7.96 / +16.61 / +9.03 pp |
| Piano (5) | Chord grouping / note F1 | 55.53 / 68.73% | 71.71 / 82.13% | +16.18 / +13.40 pp |
| Guitar (4) | Pitch / duration / onset | 14.31 / 34.25 / 37.10% | 21.09 / 43.59 / 47.19% | +6.78 / +9.34 / +10.09 pp |
| Guitar (4) | Chord grouping / note F1 | 36.28 / 52.37% | 50.58 / 65.73% | +14.30 / +13.36 pp |

Per-fixture results:

| Fixture | Pitch | Duration | Onset | Chord | Note F1 | Measure delta | Note delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Piano beginner vector | 18.75→25.00% | 62.50→87.50% | 71.88→84.38% | 64.10→93.94% | 78.13→96.88% | +3→0 | 0→0 |
| Piano grand staff | 62.50→62.50% | 81.82→81.82% | 97.73→97.73% | 97.75→97.75% | 98.86→98.86% | 0→0 | 0→0 |
| Piano rhythm/tuplets | 11.11→41.27% | 25.40→77.78% | 28.57→55.56% | 28.57→77.46% | 44.44→88.89% | +3→0 | 0→0 |
| Piano articulation scan | 31.53→31.53% | 46.85→46.85% | 61.26→61.26% | 60.48→60.48% | 80.40→80.40% | 0→0 | +23→+23 |
| Piano dense advanced | 11.36→14.77% | 33.71→39.39% | 27.65→33.33% | 26.75→28.92% | 41.83→45.63% | +18→+11 | -2→-2 |
| Guitar TAB-only | 43.75→70.00% | 43.75→72.50% | 34.38→57.50% | 44.44→80.00% | 61.54→88.89% | -4→0 | -12→+8 |
| Guitar standard | unchanged 0.00% | unchanged 15.65% | unchanged 13.91% | unchanged 20.61% | unchanged 35.44% | +8→+8 | -72→-72 |
| Guitar paired chords | 10.34→11.21% | 27.59→36.21% | 34.48→51.72% | 26.22→47.86% | 42.51→68.60% | +10→+2 | -25→-25 |
| Guitar paired techniques | unchanged 3.13% | unchanged 50.00% | unchanged 65.63% | unchanged 53.85% | unchanged 70.00% | +4→+4 | -4→-4 |
| Guitar paired scan | expected rejection | expected rejection | expected rejection | expected rejection | expected rejection | n/a | n/a |

## Regressions rejected during the sprint

- A tighter TAB string-distance tolerance reduced attachment on a historical guitar diagnostic. It was reverted.
- An initial system-role ordering attached too many TAB positions on that same diagnostic. The ordering was corrected before promotion.
- Broad staff normalization and wide-measure recovery regressed Guitar standard, paired, and technique fixtures. Guitar exposure was removed.
- The Piano staff normalizer and a broad vector-barline rule then regressed the historical dense diagnostic (wrong onsets 94→463). The normalizer was removed, and the final barline rule requires resolvable glyph/stem evidence. The historical dense metrics returned exactly to baseline while the two targeted Piano fixtures retained their gains.

## Remaining failure classes

This sprint does not claim universal or perfect OMR. The final dominant stage by fixture remains:

- Pitch inference: Piano beginner, Piano grand staff, Piano rhythm/tuplets, Guitar paired techniques.
- Symbol detection: Piano dense, Guitar standard, Guitar paired chords.
- Voice serialization: Piano articulation scan.
- Onset/rhythm inference: Guitar TAB-only; its source does not encode exact duration, so the result is explicitly approximate.
- Honest rejection: the noisy paired Guitar scan does not produce playable nonsense.

The largest aggregate error bucket is still chord/voice grouping, much of it coupled to upstream missing/extra symbols and pitch errors. Standard-notation Guitar remains especially weak, and dense Piano still over-segments by 11 measures. These are documented targets, not hidden by relaxed thresholds or elevated confidence.

## Verification

- `npm test`: PASS — 222 files, 2,229 passed, 5 skipped (2,234 total), 32.98 s.
- `npm run build`: PASS — Vite 8.0.13, 1,440 modules, 597 ms. Main bundle 1,255.22 kB / 378.98 kB gzip; the pre-existing >650 kB chunk warning remains.
- `npm run omr:benchmark-dashboard`: PASS — 16 fixtures total; 10 enforced pass, 6 legacy diagnostics skipped, 0 failures. Largest aggregate error bucket: chord, 9,000 errors (31%).
- Fixture integrity/regeneration: PASS — all vendored hashes and provenance records validate after deterministic regeneration.
- Historical dense safety check: MATCH — the frozen dashboard metrics are unchanged.

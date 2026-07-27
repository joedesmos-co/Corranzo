# Pitch Sprint 3 — Final Report

## Frozen baseline (Pitch Sprint 2 accepted)
Overall 60.9% · Pitch 48.2% · Rhythm 66.9% · Sustain 66.7% · Articulation 85.3% · Measure 59.1%

## Taxonomy (rebuilt from baseline)

Live paired incorrect-pitch: **270** (dashboard rollup 224)

### Splits
- **Piano vs Guitar:** 146 / 124
- **Vector vs Raster:** 232 / 38
- **Single vs Grand staff:** 124 / 146
- **Piano vector buckets:** {"accidental-or-alter":27,"one-diatonic-step":25,"small-interval-other":8,"larger-interval":47,"octave-error":1}
- **Piano vector chord vs single:** chord 99 / single 9
- **Piano vector clef (staff):** {"treble-staff":104,"bass-staff":4}
- **Truth has accidental label:** 55 / natural 53

### ±1 proof (accidental vs staff-degree)
- Piano-vector "accidental-or-alter" bucket: **27**
- Same-letter missing alter (true accidental): **27** — all are truth `#` → gen natural
- Staff-degree misfiled as ±1: **0**
- **Verdict:** true accidental failures exist, but PDFs have **zero** SMuFL accidental glyphs (U+E260–E262) and no reliable sharp ink — not a glyph→note association bug. Deferred.

### Target selection
| Candidate | Why not / why yes |
| --- | --- |
| Accidentals | True F#→F errors, but no glyphs to detect |
| Raster scan (1% Pitch) | Grand pairing already OK; Y/register mapping |
| **Dense staff grouping** | Degenerate stave broke `n%2===0` pairing → bass mapped as treble |

## Implementation
`filterViableStaves` in `detectStaffLines.js`, applied when `stavesPerSystem >= 2` only.

## Corpus deltas

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Overall | 60.9% | 61.2% | 0.3 |
| Pitch | 48.2% | 50% | 1.8 |
| Rhythm | 66.9% | 66.6% | -0.3 |
| Sustain/Tie | 66.7% | 66.7% | 0.0 |
| Articulation | 85.3% | 84.3% | -1.0 |
| Measure structure | 59.1% | 60.6% | 1.5 |
| incorrect-pitch | 224 | 208 | -16 |
| missing-note | 314 | 275 | -39 |
| extra-note | 304 | 264 | -40 |

### Interval buckets (message extract)
| Bucket | Before | After |
| --- | ---: | ---: |
| larger-interval | 94 | 71 |
| accidental-or-alter | 44 | 52 |
| one-diatonic-step | 64 | 65 |
| octave-error | 8 | 7 |
| small-interval-other | 14 | 13 |

### Per-fixture Pitch
- piano-beginner-single-vector: 94% → 94% (+0 pp)
- piano-grand-voices-vector: 62% → 62% (+0 pp)
- piano-rhythm-tuplets-vector: 91% → 91% (+0 pp)
- piano-articulation-scan: 1% → 1% (+0 pp)
- piano-dense-advanced-vector: 10% → 27% (+16.3 pp)
- guitar-tab-sparse-vector: 70% → 70% (+0 pp)
- guitar-standard-chords-vector: 2% → 2% (+0 pp)
- guitar-paired-chords-vector: 31% → 31% (+0 pp)
- guitar-techniques-paired-vector: 72% → 72% (+0 pp)

Dense artic 51%→42%: comparison denominator grew after bass pairing (more accents scored); mean artic −1.0 pp (at acceptance boundary, justified exposure).

## Remaining dominant pitch problem
1. Missing local accidentals (no glyphs in vector PDFs) — grand-voices + dense
2. Dense residual larger-interval / chord association
3. Raster articulation-scan pitch mapping

# OMR Accidentals and Key Signature Sprint — diagnosis

**Date:** 2026-07-02  
**Algorithm changes:** None

## Benchmark baseline (enforced fixtures)

| Fixture | Pitch | wrongPitch | pitch@correctOnset | ±1-accidental (all) |
|---------|------:|-----------:|-------------------:|--------------------:|
| Gymnopédie | 100% | 0 | 100% | 0 |
| Cruel Angel | 94% | 147 | 96.1% | 19 |
| Twinkle | 100% | 0 | 100% | 0 |

Aggregate `accidentals = 450` is ~98% La Campanella (diagnostic-only); on enforced fixtures ±1 count is **19 on dense only**.

## wrongPitch at correct onset (dense, n=69)

Root-cause rerank (`classifyPitchErrorRootCause`):

| Rank | Bucket | Count | Role |
|-----:|--------|------:|------|
| 1 | **staff/clef/register** | 25 | Treble accompaniment matched to bass register (e.g. C4 ↔ D#2, Δ−21) |
| 2 | **diatonic-step** | 21 | ±2 semitone staff-step slips at correct onset |
| 3 | **grouping-artifact** | 12 | Residual duration mismatch at nominally correct onset |
| 4 | **accidental-miss** | 7 | Same step/octave, missing sharp (A#2→A2, D#5→D5) |
| 5 | **other** | 4 | |

All 147 wrong pitches:

| Bucket | Count |
|--------|------:|
| **grouping-artifact** | **90** |
| staff/clef/register | 25 |
| diatonic-step | 21 |
| accidental-miss | 7 |
| other | 4 |

## Decision

**No algorithm change.** Accidentals/key signatures are **not** the largest proven generic bucket on enforced fixtures. The ±1 accidental class (19 total, 7–9 at correct onset) is a **small tail** compared to grouping artifacts (90) and staff/register pairing (25). Fixing accidentals in isolation would not move Cruel Angel pitch materially without addressing matcher/onset coupling first.

Missed sharps (A#→A) are real but narrow; existing `assignLocalAccidentals` / key-carry paths already have unit coverage in `omrPitchAlteration.test.js` and `pdfOmrMusical.test.js`.

## Next largest bucket

**Grouping-artifact pitch errors (90)** — onset/duration coupling in greedy matcher; same root cause as chord/onset sprint findings.

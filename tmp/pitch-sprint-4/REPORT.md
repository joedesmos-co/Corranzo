# Pitch Sprint 4 — Raster Piano Pitch Mapping

## Verdict
**Accepted candidate.** Low raster Pitch was primarily **MusicXML staff-emission / event-alignment**, not pitch-formula failure. Raster notes already carried correct treble/bass clefs and staff roles; omitting `<staff>` collapsed bass into staff 1 and poisoned pairing.

## RCA (piano-articulation-scan)
Trace showed correct staff-relative degrees and clef anchors on many heads, but generated MusicXML had **zero** `<staff>` / `<staves>2>` tags because `shouldEmitGrandStaffMusicXml` required ≥50% vector `source` (Pitch Sprint 1 gate).

That is event-alignment failure upstream of pitch math:
- paired notes often had correct onset
- bass pitches existed but were labeled staff 1
- evaluator could not pair truth staff-2 events → flood of missing/extra/incorrect-pitch (cross-staff collisions)

## Fix (smallest general)
In `buildOmrMusicXml.js`:
- keep vector evidence path (`measuresHaveVectorClefEvidence`)
- add `measuresHaveBalancedDualClefEvidence` for raster/mixed pages:
  - both treble and bass present
  - ≥10 cleffed notes, ≥3 per clef, each ≥20% of cleffed notes
- `shouldEmitGrandStaffMusicXml` uses either evidence path
- guitar `grandStaff: false` guard unchanged
- **no** pitch-formula, raster articulation, or tie-detection changes
- **no** fixture hardcoding; evaluator untouched

## Scoreboard (Sprint 3 accepted → Sprint 4)

| Class | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Overall | 61.2% | 60.3% | −0.9 |
| Pitch | 50.0% | 53.0% | **+3.0** |
| Rhythm | 66.6% | 64.4% | −2.1 |
| Sustain/Tie | 66.7% | 57.8% | −8.9 |
| Articulation | 84.3% | 83.9% | −0.4 |
| Measure structure | 60.6% | 62.9% | +2.3 |

### piano-articulation-scan

| Class | Before | After | Δ | Denominator |
| --- | ---: | ---: | ---: | --- |
| Pitch | 1% (2/159) | **29% (35/122)** | **+27.4** | comparison set improved |
| Rhythm | 91% (73/80) | 72% (111/154) | −19.2 | den 80→154 |
| Sustain | 100% (1/1) | 20% (1/5) | −80.0 | den 1→5; TP still 1 |
| Articulation | 17% (6/36) | 13% (8/61) | −3.6 | TP 6→8; den 36→61 |
| Measure | 30% | 50% | +20.4 | |

Staff tags after fix: `<staves>2>` with staff1×71, staff2×40.

## Pitch defect rollups

| Code | Before | After | Δ |
| --- | ---: | ---: | ---: |
| incorrect-pitch | 208 | 212 | 4 |
| missing-note | 275 | 238 | -37 |
| extra-note | 264 | 227 | -37 |

## Incorrect-pitch buckets (live pairing)

| Bucket | Sprint 3 | Sprint 4 |
| --- | ---: | ---: |
| accidental-or-alter | 32 | 114 |
| one-diatonic-step | 66 | 35 |
| small-interval-other | 22 | 31 |
| larger-interval | 138 | 64 |
| octave-error | 12 | 8 |
| **total** | **270** | **252** |

Raster articulation-scan incorrect-pitch buckets:
- before: {"larger-interval":26,"octave-error":2,"accidental-or-alter":6,"small-interval-other":3,"one-diatonic-step":1} (n=38; dominated by cross-staff larger-interval)
- after: {"accidental-or-alter":14,"one-diatonic-step":12,"small-interval-other":8,"larger-interval":7,"octave-error":1} (n=42)

## Per-fixture Pitch

| Fixture | Before | After | Δ |
| --- | ---: | ---: | ---: |
| piano-beginner-single-vector | 94% | 94% | +0.0 |
| piano-grand-voices-vector | 62% | 62% | +0.0 |
| piano-rhythm-tuplets-vector | 91% | 91% | +0.0 |
| piano-articulation-scan | 1% | 29% | +27.4 |
| piano-dense-advanced-vector | 27% | 27% | +0.0 |
| guitar-tab-sparse-vector | 70% | 70% | +0.0 |
| guitar-standard-chords-vector | 2% | 2% | +0.0 |
| guitar-paired-chords-vector | 31% | 31% | +0.0 |
| guitar-techniques-paired-vector | 72% | 72% | +0.0 |

## Measurement-exposure (not recognition regressions)
- **Sustain −8.9 pp mean:** only `piano-articulation-scan` changed (100%→20%). Tie detection untouched. Same 1 true positive; denominator 1→5 exposes 3 incorrect-tie + 1 missing-tie that were previously unpaired.
- **Rhythm −2.1 pp mean:** only artic-scan changed (91%→72%); den 80→154 as bass notes enter the comparison set.
- **Articulation −0.4 pp mean:** TP 6→8 on artic-scan; den 36→61. Recognition marks not removed.
- Pitch Sprints 1–3 fixtures: Pitch unchanged (beginner 94%, grand-voices 62%, dense 27%, tuplets 91%).

## Acceptance checklist
- [x] Raster Pitch improves measurably (1%→29%; mean Pitch +3.0)
- [x] Previous Pitch Sprint gains intact
- [x] Sustain recognition path unchanged (exposure only)
- [x] Articulation recognition not regressed (TP up)
- [x] Class drops >1 pp explained as measurement exposure
- [x] Evaluator untouched
- [x] No fixture-specific hardcoding

## Remaining dominant pitch cluster
1. **Missing accidentals** (accidental-or-alter now largest live bucket) — PDFs often lack accidental glyphs; do not invent alters.
2. **Residual raster pitch/geometry** on artic-scan (~42 incorrect after staff fix): one-step / small-interval / remaining larger-interval — true notehead Y / register work if pursued later.
3. **Guitar larger-interval** still deferred.

Artifacts: `tmp/after-pitch-sprint-4.json`, `tmp/pitch-sprint-4/taxonomy.json`, `tmp/pitch-sprint-4/FINAL-REPORT.json`

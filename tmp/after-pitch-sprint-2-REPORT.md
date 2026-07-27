# Pitch Sprint 2 Report

## RCA
`estimateGrandStaffLines` treated short single-staff detection bands (`staveCount===1`, height≈0.04) as merged grand staff and split them into phantom treble/bass halves. Notes assigned to the phantom lower half used wrong degree/octave anchors (E4→E2, F4→E4, A4→B4).

## Fix
- Single short bands → one staff (full y0–y1), empty bass (forces upper/treble mapping)
- Tall merged bands (height ≥ 0.07) still invent grand staff
- Measured nested staves (≥2) unchanged (Pitch Sprint 1 grand-voices intact)
- Single-staff clef glyph detection still sets upper clef

## Scoreboard (mean %)

| Class | Before (Pitch S1) | After (Pitch S2) | Δ pp |
| --- | ---: | ---: | ---: |
| Overall | 56.4 | 60.9 | +4.5 |
| Pitch | 23.5 | 48.2 | +24.7 |
| Rhythm | 64.9 | 66.9 | +2.0 |
| Sustain/Tie | 66.7 | 66.7 | 0.0 |
| Articulation | 83.5 | 85.3 | +1.8 |
| Measure structure | 56.5 | 59.1 | +2.6 |

## incorrect-pitch defects
- Before: 305 message hits / rollup 305
- After: 224 message hits / rollup undefined

### Taxonomy (from Incorrect pitch messages in reports)
Before: {"accidental-or-alter":56,"one-diatonic-step":42,"larger-interval":148,"octave-error":32,"small-interval-other":27}
After: {"one-diatonic-step":34,"small-interval-other":14,"larger-interval":94,"accidental-or-alter":74,"octave-error":8}
Piano-only before: {"accidental-or-alter":55,"one-diatonic-step":25,"larger-interval":92,"octave-error":20,"small-interval-other":22} (n=214)
Piano-only after: {"one-diatonic-step":18,"small-interval-other":10,"larger-interval":61,"accidental-or-alter":61,"octave-error":3} (n=153)

## Per-fixture Pitch

- piano-beginner-single-vector: 24% → 94% (+70 pp)
- piano-grand-voices-vector: 62% → 62% (+0 pp)
- piano-rhythm-tuplets-vector: 40% → 91% (+51 pp)
- piano-articulation-scan: 1% → 1% (+0 pp)
- piano-dense-advanced-vector: 4% → 10% (+6 pp)
- guitar-tab-sparse-vector: 70% → 70% (+0 pp)
- guitar-standard-chords-vector: 0% → 2% (+2 pp)
- guitar-paired-chords-vector: 6% → 31% (+25 pp)
- guitar-techniques-paired-vector: 5% → 72% (+67 pp)

## Known examples (piano-beginner)
All corrected; beginner pitch measure multisets now match truth exactly.
- F4 expected / E4 gen → fixed
- A4 expected / B4 gen → fixed  
- E4 expected / E2 gen → fixed (phantom lower staff)

## Grand-staff Pitch Sprint 1
piano-grand-voices-vector Pitch 62% → 62% (intact)

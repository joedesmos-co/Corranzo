# High-extreme semantic attribution report

- Starting and final HEAD: `beeb5f066e7bdcb3043df5fa001c92abdadb0088` (`beeb5f0`)
- Evaluator: frozen `2.0.0` / schema `2`; evaluator, fixtures, truth, scoring, and thresholds unchanged
- Production `src/` and `tests/`: clean before attribution and clean after validation
- Decision: **REJECT / LEAVE PRODUCTION UNCHANGED**
- Commit created: none

## Executive finding

The corrected trace proves that the dominant residual is not accidental ownership, voice routing, grouping, or evaluator alignment. **43 of 60 designated high-extreme expected tones first become semantically wrong at staff-position pitch calculation after a rejected glyph-metric anchor.** Every one is an embedded MuseScore SMuFL black notehead (`g_d1_f3`, U+E0A4), remains on treble staff 1 / voice 1 / the correct physical measure and chord column, and quantizes exactly one diatonic step low before any accidental is applied. The 14 tones that stay correct use trusted ink anchors. Only one tone first fails at accidental binding and two at accidental-state carry.

An isolated offline correction of the 43 physical candidates projects high-extreme exact from 25% to 85%, but every general production mechanism that can realize it belongs to a strategy explicitly excluded or previously rejected in this campaign: optical/font center profiles, raster/body recovery, broad stacked ownership, or a hard-coded register/MIDI shift. The independently actionable accidental category projects only 30%, below the 35% acceptance floor. No production experiment was therefore promoted.

## Phase log

1. Verified exact full HEAD and clean production tree; read all eight prerequisite reports in full.
2. Re-ran the frozen 9-fixture semantic baseline before any implementation.
3. Reproduced the dense fixture and captured PDF glyphs, raw note candidates, anchor provenance, natural pitch, accidental candidate/selection/state, final events, MusicXML, and frozen evaluator matching.
4. Rejected the prior inventory join: truth m1 aligns to generated m1+m2, so later truth mN aligns to generated mN+1. The old inventory looked up truth measure geometry first and attached the preceding generated measure. All attribution below uses the actual frozen alignment.
5. Visually rendered and inspected every one of the 15 incorrect designated chords in source measure bands 5-8.
6. Simulated each mutually exclusive first-fault category in isolation without editing the evaluator or production code.
7. Determined that the only gate-clearing category requires prohibited/rejected anchor mechanisms. No runtime/test edit was made, so no revert was necessary.
8. Ran focused tests, the full unit suite, production build, and heavy-score harness on unchanged `beeb5f0`.

## Exact runtime path and 15-stage trace

| # | Stage | Current implementation / retained evidence |
|---:|---|---|
| 1 | PDF glyph/path extraction | `makePdfTextExtractor` and vector operator extraction; `textGlyphsToImage` converts PDF coordinates and retains font/codepoint/origin. |
| 2 | Note candidate creation | `noteheadsForMeasure` creates one candidate per existing U+E0A2-E0A4 glyph; no high-extreme physical candidate is absent. |
| 3 | Notehead anchor resolution | `resolveNoteheadAnchor`; vector metric is `fallbackYNorm`, ledger/ink result is `yNorm` plus `source`, classifier, and reject reason. |
| 4 | Staff/measure assignment | `vectorGlyphInMeasure`, grand-staff role resolution, and generated measure grid; designated tones remain treble/staff 1. |
| 5 | Staff-position pitch | `resolvePitchFromGrandStaff` / `midiFromStaffPosition`; this is the first semantic fault for 43 tones. |
| 6 | Clef/key signature | `resolveNotePitchWithMeasureState`; clef is treble and detected fifths are 0 in the traced measures. |
| 7 | Local accidental detection | `detectVectorPathAccidentals` emits glyph-shaped sharp candidates with path provenance. |
| 8 | Accidental ownership/binding | `assignLocalAccidentals` scores x/y/staff-line proximity; one A5 receives the neighboring F-sharp path. |
| 9 | Accidental-state propagation | Measure-local `accidentalState` keyed by clef + written step/octave; two natural tones inherit a prior sharp in the frozen truth interpretation. |
| 10 | Chord grouping | `groupVectorNoteheads`, beat-slot merge, and chord proximity; all 60 expected physical candidates remain in direct chord events. |
| 11 | Voice assignment | Treble candidates serialize in voice 1; no cross-staff or cross-voice transition occurs. |
| 12 | Rhythm packing/resnap | Dense lane normalization, beam/onset refinement, coalescing, reconstruction, and clamping; designated onsets remain deterministic. |
| 13 | Deduplication/coalescing | Spatial `dedupeNoteheads` and `coalesceSameOnsetChordEvents`; no designated physical candidate is removed or duplicated. |
| 14 | MusicXML creation | `buildOmrMusicXml`; raw candidate IDs are joined to final normalized MusicXML notes by aligned generated measure/onset/staff/MIDI. |
| 15 | Evaluator alignment | `alignMeasureSequences` then `matchSemanticEvents`; alignment confidence 0.9486. It reassigns 24 expected tones to nearby generated onsets and leaves 3 missing, but is downstream of the physical staff-step faults. |

## Frozen baseline reproduced

| Metric | Reproduced value |
|---|---:|
| Overall | 69.439% |
| Pitch | 72.329% |
| Rhythm | 80.468% |
| High-extreme exact | 25% (5/20) |
| High-extreme missing / extra | 23 / 21 |
| Low-extreme exact / missing | 76.47% / 6 |
| Guitar-standard Pitch / Rhythm | 86% / 100% |
| Global incorrect pitch / chord | 168 / 160 |
| Global missing / extra | 72 / 105 |

## Root-cause clusters

| Mutually exclusive first fault | Tones | Chords touched | Perfect isolated projection | Exact gain | Missing delta | Extra delta |
|---|---:|---:|---:|---:|---:|---:|
| wrong staff-step quantization | 43 | 20 | 85% (17/20) | 12 | -20 | -18 |
| correct through final MusicXML | 14 | 14 | n/a | — | — | — |
| accidental detected but bound to wrong tone | 1 | 1 | 30% (6/20) | 1 | -1 | -1 |
| accidental state incorrectly inherited | 2 | 2 | 25% (5/20) | 0 | -2 | -2 |

Counts for the 46 incorrect expected tones:

| Dimension | Counts |
|---|---|
| Failure stage | S5 staff-position pitch calculation ×43; S9 accidental-state propagation ×2; S8 accidental ownership/binding ×1 |
| Pitch class | G# ×9; F# ×6; F ×6; A ×6; E ×5; D ×3; A# ×3; G ×3; B ×3; D# ×2 |
| Octave | 5 ×46 |
| Glyph/font | g_d1_f3/U+E0A4 ×46 |
| Anchor outcome | glyph-metrics-fallback/no-head-sized-component ×39; glyph-metrics-fallback/component-outside-font-origin-range ×4; ledger-masked-ink-notehead-geometry/null ×3 |

### Complete expected-tone first-fault inventory (60/60)

| Chord | Rank | Expected | Direct raw/final | PDF glyph and origin | Vector metric; ledger/ink result | Assignment/column | Accidental transition | Frozen evaluator result | First fault |
|---|---:|---|---|---|---|---|---|---|---|
| m5@2 | 0 | D5 (74; nat 74; alt 0; dur 0.5) | m6-raw-20: 72→73 | pdf-glyph-260 g_d1_f3/U+E0A4 @244.4,705.8 | metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | gM6; treble/s1/v1; event 7 x=244.4 | selected sharp@243.0,699.3 score=28.8; key=0 | D5 gM6@1.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m5@2 | 1 | F#5 (78; nat 77; alt 1; dur 0.5) | m6-raw-19: 76→77 | pdf-glyph-261 g_d1_f3/U+E0A4 @244.4,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM6; treble/s1/v1; event 7 x=244.4 | selected sharp@243.0,686.3 score=28.81; key=0 | F#5 gM6@1.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m5@2 | 2 | A5 (81; nat 81; alt 0; dur 0.5) | m6-raw-18: 81→81 | pdf-glyph-262 g_d1_f3/U+E0A4 @244.4,679.7 | metric 675.4px; ledger-masked-ink-notehead-geometry 673.0px | gM6; treble/s1/v1; event 7 x=244.4 | no local; key=0 | A5 gM6@2 Δp=0 Δt=0 | correct |
| m6@1 | 0 | C#5 (73; nat 72; alt 1; dur 0.5) | m7-raw-10: 72→73 | pdf-glyph-292 g_d1_f3/U+E0A4 @381.9,712.4 | metric 708.1px; ink-notehead-geometry 705.5px | gM7; treble/s1/v1; event 4 x=382.4 | no local; carry=1; key=0 | C#5 gM7@1 Δp=0 Δt=0 | correct |
| m6@1 | 1 | F5 (77; nat 77; alt 0; dur 0.5) | m7-raw-9: 76→77 | pdf-glyph-293 g_d1_f3/U+E0A4 @381.9,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM7; treble/s1/v1; event 4 x=382.4 | no local; carry=1; key=0 | F5 gM7@1 Δp=0 Δt=0 | S5 wrong staff-step quantization |
| m6@1 | 2 | G#5 (80; nat 79; alt 1; dur 0.5) | m7-raw-13: 77→78 | pdf-glyph-294 g_d1_f3/U+E0A4 @384.3,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM7; treble/s1/v1; event 4 x=382.4 | selected sharp@371.5,686.3 score=21.66; key=0 | G#5 gM7@1.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m6@2 | 0 | E5 (76; nat 76; alt 0; dur 0.5) | m7-raw-19: 74→75 | pdf-glyph-298 g_d1_f3/U+E0A4 @417.8,699.3 | metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | gM7; treble/s1/v1; event 7 x=417.8 | no local; carry=1; key=0 | D#5 gM7@2 Δp=-1 Δt=0 | S5 wrong staff-step quantization |
| m6@2 | 1 | G#5 (80; nat 79; alt 1; dur 0.5) | m7-raw-18: 77→78 | pdf-glyph-299 g_d1_f3/U+E0A4 @417.8,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM7; treble/s1/v1; event 7 x=417.8 | selected sharp@407.4,686.3 score=19.23; key=0 | G#5 gM7@2.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m6@2 | 2 | B5 (83; nat 83; alt 0; dur 0.5) | m7-raw-17: 83→83 | pdf-glyph-300 g_d1_f3/U+E0A4 @417.8,673.1 | metric 668.9px; ledger-masked-ink-notehead-geometry 666.5px | gM7; treble/s1/v1; event 7 x=417.8 | no local; key=0 | B5 gM7@2 Δp=0 Δt=0 | correct |
| m6@3 | 0 | C#5 (73; nat 72; alt 1; dur 0.5) | m7-raw-26: 72→73 | pdf-glyph-305 g_d1_f3/U+E0A4 @453.7,712.4 | metric 708.1px; ink-notehead-geometry 705.5px | gM7; treble/s1/v1; event 10 x=455.0 | no local; carry=1; key=0 | C#5 gM7@3 Δp=0 Δt=0 | correct |
| m6@3 | 1 | F5 (77; nat 77; alt 0; dur 0.5) | m7-raw-25: 76→77 | pdf-glyph-306 g_d1_f3/U+E0A4 @453.7,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM7; treble/s1/v1; event 10 x=455.0 | selected sharp@443.3,699.3 score=38.98; key=0 | F5 gM7@3 Δp=0 Δt=0 | S5 wrong staff-step quantization |
| m6@3 | 2 | G#5 (80; nat 79; alt 1; dur 0.5) | m7-raw-29: 77→78 | pdf-glyph-307 g_d1_f3/U+E0A4 @457.8,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=component-outside-font-origin-range | gM7; treble/s1/v1; event 10 x=455.0 | selected sharp@443.3,686.3 score=23.31; key=0 | F5 gM7@2.5 Δp=-3 Δt=0.5 | S5 wrong staff-step quantization |
| m6@1.5 | 0 | D5 (74; nat 74; alt 0; dur 0.5) | m7-raw-15: 72→73 | pdf-glyph-295 g_d1_f3/U+E0A4 @399.9,705.8 | metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | gM7; treble/s1/v1; event 5 x=400.0 | no local; carry=1; key=0 | C#5 gM7@1.5 Δp=-1 Δt=0 | S5 wrong staff-step quantization |
| m6@1.5 | 1 | F#5 (78; nat 77; alt 1; dur 0.5) | m7-raw-14: 76→77 | pdf-glyph-296 g_d1_f3/U+E0A4 @399.9,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM7; treble/s1/v1; event 5 x=400.0 | no local; carry=1; key=0 | F#5 gM7@2 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m6@1.5 | 2 | A5 (81; nat 81; alt 0; dur 0.5) | m7-raw-16: 79→80 | pdf-glyph-297 g_d1_f3/U+E0A4 @400.2,679.7 | metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | gM7; treble/s1/v1; event 5 x=400.0 | selected sharp@389.5,679.7 score=32.36; key=0 | F5 gM7@1.5 Δp=-4 Δt=0 | S5 wrong staff-step quantization |
| m6@2.5 | 0 | D5 (74; nat 74; alt 0; dur 0.5) | m7-raw-24: 72→73 | pdf-glyph-302 g_d1_f3/U+E0A4 @435.7,705.8 | metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | gM7; treble/s1/v1; event 8 x=435.7 | selected sharp@425.4,705.9 score=21.91; key=0 | C#5 gM7@2.5 Δp=-1 Δt=0 | S5 wrong staff-step quantization |
| m6@2.5 | 1 | F#5 (78; nat 77; alt 1; dur 0.5) | m7-raw-23: 76→77 | pdf-glyph-303 g_d1_f3/U+E0A4 @435.7,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM7; treble/s1/v1; event 8 x=435.7 | no local; carry=1; key=0 | F#5 gM7@3 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m6@2.5 | 2 | A5 (81; nat 81; alt 0; dur 0.5) | m7-raw-22: 79→80 | pdf-glyph-304 g_d1_f3/U+E0A4 @435.7,679.7 | metric 675.4px; glyph-metrics-fallback 675.4px; reject=component-outside-font-origin-range | gM7; treble/s1/v1; event 8 x=435.7 | selected sharp@429.5,679.7 score=27.88; key=0 | missing | S5 wrong staff-step quantization |
| m7@0.5 | 0 | C#5 (73; nat 72; alt 1; dur 0.5) | m8-raw-7: 72→73 | pdf-glyph-325 g_d1_f3/U+E0A4 @563.3,712.4 | metric 708.1px; ink-notehead-geometry 705.5px | gM8; treble/s1/v1; event 2 x=564.1 | no local; carry=1; key=0 | C#5 gM8@0.5 Δp=0 Δt=0 | correct |
| m7@0.5 | 1 | F5 (77; nat 77; alt 0; dur 0.5) | m8-raw-6: 76→77 | pdf-glyph-326 g_d1_f3/U+E0A4 @563.3,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM8; treble/s1/v1; event 2 x=564.1 | selected sharp@552.9,699.3 score=38.98; key=0 | F5 gM8@0.5 Δp=0 Δt=0 | S5 wrong staff-step quantization |
| m7@0.5 | 2 | G#5 (80; nat 79; alt 1; dur 0.5) | m8-raw-8: 77→78 | pdf-glyph-327 g_d1_f3/U+E0A4 @565.8,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM8; treble/s1/v1; event 2 x=564.1 | selected sharp@539.1,679.7 score=54.07; key=0 | G#5 gM8@1 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m7@2 | 0 | F#5 (78; nat 77; alt 1; dur 0.5) | m8-raw-19: 76→77 | pdf-glyph-334 g_d1_f3/U+E0A4 @617.1,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM8; treble/s1/v1; event 7 x=617.1 | no local; carry=1; key=0 | F#5 gM8@1.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m7@2 | 1 | A#5 (82; nat 81; alt 1; dur 0.5) | m8-raw-18: 79→80 | pdf-glyph-335 g_d1_f3/U+E0A4 @617.1,679.7 | metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | gM8; treble/s1/v1; event 7 x=617.1 | selected sharp@606.8,679.7 score=31.97; key=0 | A#5 gM8@2.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m7@2 | 2 | C#6 (85; nat 84; alt 1; dur 0.5) | m8-raw-17: 84→85 | pdf-glyph-336 g_d1_f3/U+E0A4 @617.1,666.6 | metric 662.4px; ledger-masked-ink-notehead-geometry 659.5px | gM8; treble/s1/v1; event 7 x=617.1 | selected sharp@588.8,660.1 score=47.65; key=0 | C#6 gM8@2 Δp=0 Δt=0 | correct |
| m7@3.5 | 0 | C#5 (73; nat 72; alt 1; dur 0.5) | m8-raw-31: 72→73 | pdf-glyph-344 g_d1_f3/U+E0A4 @671.0,712.4 | metric 708.1px; ink-notehead-geometry 705.5px | gM8; treble/s1/v1; event 11 x=672.3 | no local; carry=1; key=0 | C#5 gM8@3.5 Δp=0 Δt=0 | correct |
| m7@3.5 | 1 | F5 (77; nat 77; alt 0; dur 0.5) | m8-raw-30: 76→77 | pdf-glyph-345 g_d1_f3/U+E0A4 @671.0,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM8; treble/s1/v1; event 11 x=672.3 | no local; carry=1; key=0 | F5 gM8@3.5 Δp=0 Δt=0 | S5 wrong staff-step quantization |
| m7@3.5 | 2 | G#5 (80; nat 79; alt 1; dur 0.5) | m8-raw-32: 77→78 | pdf-glyph-346 g_d1_f3/U+E0A4 @675.0,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM8; treble/s1/v1; event 11 x=672.3 | no local; carry=1; key=0 | F#5 gM8@3.5 Δp=-2 Δt=0 | S5 wrong staff-step quantization |
| m7@1 | 0 | D#5 (75; nat 74; alt 1; dur 0.5) | m8-raw-10: 72→73 | pdf-glyph-328 g_d1_f3/U+E0A4 @581.3,705.8 | metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | gM8; treble/s1/v1; event 4 x=581.7 | no local; carry=1; key=0 | D#5 gM8@1.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m7@1 | 1 | G5 (79; nat 79; alt 0; dur 0.5) | m8-raw-9: 77→78 | pdf-glyph-329 g_d1_f3/U+E0A4 @581.3,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM8; treble/s1/v1; event 4 x=581.7 | selected sharp@570.9,679.7 score=37.78; key=0 | F#5 gM8@1 Δp=-1 Δt=0 | S5 wrong staff-step quantization |
| m7@1 | 2 | A#5 (82; nat 81; alt 1; dur 0.5) | m8-raw-13: 79→80 | pdf-glyph-330 g_d1_f3/U+E0A4 @583.7,679.7 | metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | gM8; treble/s1/v1; event 4 x=581.7 | selected sharp@579.9,679.7 score=25.43; key=0 | A#5 gM8@1.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m7@1.5 | 0 | E5 (76; nat 76; alt 0; dur 0.5) | m8-raw-15: 74→75 | pdf-glyph-331 g_d1_f3/U+E0A4 @599.2,699.3 | metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | gM8; treble/s1/v1; event 5 x=599.3 | selected sharp@557.0,673.2 score=150.38; key=0 | F5 gM8@2 Δp=1 Δt=0.5 | S5 wrong staff-step quantization |
| m7@1.5 | 1 | G#5 (80; nat 79; alt 1; dur 0.5) | m8-raw-14: 77→78 | pdf-glyph-332 g_d1_f3/U+E0A4 @599.2,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM8; treble/s1/v1; event 5 x=599.3 | selected sharp@588.8,686.3 score=19.23; key=0 | G#5 gM8@2 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m7@1.5 | 2 | B5 (83; nat 83; alt 0; dur 0.5) | m8-raw-16: 81→82 | pdf-glyph-333 g_d1_f3/U+E0A4 @599.6,673.1 | metric 668.9px; glyph-metrics-fallback 668.9px; reject=no-head-sized-component | gM8; treble/s1/v1; event 5 x=599.3 | selected sharp@588.8,673.2 score=32.35; key=0 | C#5 gM8@1 Δp=-10 Δt=0.5 | S5 wrong staff-step quantization |
| m7@2.5 | 0 | E5 (76; nat 76; alt 0; dur 0.5) | m8-raw-24: 74→75 | pdf-glyph-338 g_d1_f3/U+E0A4 @635.1,699.3 | metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | gM8; treble/s1/v1; event 8 x=635.1 | selected sharp@624.7,699.3 score=21.02; key=0 | F#5 gM8@2.5 Δp=2 Δt=0 | S5 wrong staff-step quantization |
| m7@2.5 | 1 | G#5 (80; nat 79; alt 1; dur 0.5) | m8-raw-23: 77→78 | pdf-glyph-339 g_d1_f3/U+E0A4 @635.1,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM8; treble/s1/v1; event 8 x=635.1 | no local; carry=1; key=0 | G#5 gM8@3 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m7@2.5 | 2 | B5 (83; nat 83; alt 0; dur 0.5) | m8-raw-22: 81→82 | pdf-glyph-340 g_d1_f3/U+E0A4 @635.1,673.1 | metric 668.9px; glyph-metrics-fallback 668.9px; reject=component-outside-font-origin-range | gM8; treble/s1/v1; event 8 x=635.1 | selected sharp@628.8,673.2 score=27.88; key=0 | missing | S5 wrong staff-step quantization |
| m7@3 | 0 | D#5 (75; nat 74; alt 1; dur 0.5) | m8-raw-26: 72→73 | pdf-glyph-341 g_d1_f3/U+E0A4 @653.0,705.8 | metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | gM8; treble/s1/v1; event 10 x=654.4 | selected sharp@642.7,705.9 score=21.91; key=0 | D#5 gM8@2.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m7@3 | 1 | G5 (79; nat 79; alt 0; dur 0.5) | m8-raw-25: 77→78 | pdf-glyph-342 g_d1_f3/U+E0A4 @653.0,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM8; treble/s1/v1; event 10 x=654.4 | no local; carry=1; key=0 | F#5 gM8@3 Δp=-1 Δt=0 | S5 wrong staff-step quantization |
| m7@3 | 2 | A#5 (82; nat 81; alt 1; dur 0.5) | m8-raw-29: 79→80 | pdf-glyph-343 g_d1_f3/U+E0A4 @657.1,679.7 | metric 675.4px; glyph-metrics-fallback 675.4px; reject=component-outside-font-origin-range | gM8; treble/s1/v1; event 10 x=654.4 | selected sharp@646.7,679.7 score=31.97; key=0 | C#5 gM8@3 Δp=-9 Δt=0 | S5 wrong staff-step quantization |
| m8@0.5 | 0 | D5 (74; nat 74; alt 0; dur 0.5) | m9-raw-7: 74→74 | pdf-glyph-361 g_d1_f3/U+E0A4 @762.7,705.8 | metric 701.6px; ledger-masked-ink-notehead-geometry 699.0px | gM9; treble/s1/v1; event 2 x=762.8 | no local; key=0 | D5 gM9@0.5 Δp=0 Δt=0 | correct |
| m8@0.5 | 1 | F#5 (78; nat 77; alt 1; dur 0.5) | m9-raw-6: 76→76 | pdf-glyph-362 g_d1_f3/U+E0A4 @762.7,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM9; treble/s1/v1; event 2 x=762.8 | no local; key=0 | F#5 gM9@0 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m8@0.5 | 2 | A5 (81; nat 81; alt 0; dur 0.5) | m9-raw-8: 81→82 | pdf-glyph-363 g_d1_f3/U+E0A4 @763.1,679.7 | metric 675.4px; ledger-masked-ink-notehead-geometry 673.0px | gM9; treble/s1/v1; event 2 x=762.8 | selected sharp@752.3,679.7 score=44.61; key=0 | A#5 gM9@0.5 Δp=1 Δt=0 | S8 accidental detected but bound to wrong tone |
| m8@1 | 0 | E5 (76; nat 76; alt 0; dur 0.5) | m9-raw-10: 74→74 | pdf-glyph-364 g_d1_f3/U+E0A4 @780.6,699.3 | metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | gM9; treble/s1/v1; event 4 x=780.7 | no local; key=0 | D5 gM9@1 Δp=-2 Δt=0 | S5 wrong staff-step quantization |
| m8@1 | 1 | G#5 (80; nat 79; alt 1; dur 0.5) | m9-raw-9: 77→78 | pdf-glyph-365 g_d1_f3/U+E0A4 @780.6,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM9; treble/s1/v1; event 4 x=780.7 | no local; carry=1; key=0 | F#5 gM9@1 Δp=-2 Δt=0 | S5 wrong staff-step quantization |
| m8@1 | 2 | B5 (83; nat 83; alt 0; dur 0.5) | m9-raw-13: 83→83 | pdf-glyph-366 g_d1_f3/U+E0A4 @781.0,673.1 | metric 668.9px; ledger-masked-ink-notehead-geometry 666.5px | gM9; treble/s1/v1; event 4 x=780.7 | no local; key=0 | B5 gM9@1 Δp=0 Δt=0 | correct |
| m8@1.5 | 0 | F5 (77; nat 77; alt 0; dur 0.5) | m9-raw-15: 77→78 | pdf-glyph-367 g_d1_f3/U+E0A4 @798.5,692.7 | metric 688.5px; ledger-masked-ink-notehead-geometry 686.0px | gM9; treble/s1/v1; event 5 x=798.7 | no local; carry=1; key=0 | F#5 gM9@1.5 Δp=1 Δt=0 | S9 accidental state incorrectly inherited |
| m8@1.5 | 1 | A5 (81; nat 81; alt 0; dur 0.5) | m9-raw-14: 79→79 | pdf-glyph-368 g_d1_f3/U+E0A4 @798.5,679.7 | metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | gM9; treble/s1/v1; event 5 x=798.7 | no local; key=0 | missing | S5 wrong staff-step quantization |
| m8@1.5 | 2 | C6 (84; nat 84; alt 0; dur 0.5) | m9-raw-16: 84→84 | pdf-glyph-369 g_d1_f3/U+E0A4 @798.9,666.6 | metric 662.4px; ledger-masked-ink-notehead-geometry 659.5px | gM9; treble/s1/v1; event 5 x=798.7 | no local; key=0 | C6 gM9@1.5 Δp=0 Δt=0 | correct |
| m8@2 | 0 | G5 (79; nat 79; alt 0; dur 0.5) | m9-raw-19: 77→78 | pdf-glyph-370 g_d1_f3/U+E0A4 @816.5,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM9; treble/s1/v1; event 7 x=816.5 | no local; carry=1; key=0 | G5 gM9@1.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m8@2 | 1 | B5 (83; nat 83; alt 0; dur 0.5) | m9-raw-18: 81→82 | pdf-glyph-371 g_d1_f3/U+E0A4 @816.5,673.1 | metric 668.9px; glyph-metrics-fallback 668.9px; reject=no-head-sized-component | gM9; treble/s1/v1; event 7 x=816.5 | no local; carry=1; key=0 | A#5 gM9@2 Δp=-1 Δt=0 | S5 wrong staff-step quantization |
| m8@2 | 2 | D6 (86; nat 86; alt 0; dur 0.5) | m9-raw-17: 86→86 | pdf-glyph-372 g_d1_f3/U+E0A4 @816.5,660.1 | metric 655.8px; ledger-masked-ink-notehead-geometry 653.5px | gM9; treble/s1/v1; event 7 x=816.5 | no local; key=0 | D6 gM9@2 Δp=0 Δt=0 | correct |
| m8@2.5 | 0 | F5 (77; nat 77; alt 0; dur 0.5) | m9-raw-24: 76→76 | pdf-glyph-374 g_d1_f3/U+E0A4 @834.4,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM9; treble/s1/v1; event 8 x=834.4 | no local; key=0 | F#5 gM9@2 Δp=1 Δt=0.5 | S5 wrong staff-step quantization |
| m8@2.5 | 1 | A5 (81; nat 81; alt 0; dur 0.5) | m9-raw-23: 79→80 | pdf-glyph-375 g_d1_f3/U+E0A4 @834.4,679.7 | metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | gM9; treble/s1/v1; event 8 x=834.4 | selected sharp@824.1,679.7 score=31.97; key=0 | D5 gM9@3 Δp=-7 Δt=0.5 | S5 wrong staff-step quantization |
| m8@2.5 | 2 | C6 (84; nat 84; alt 0; dur 0.5) | m9-raw-22: 84→84 | pdf-glyph-376 g_d1_f3/U+E0A4 @834.4,666.6 | metric 662.4px; ledger-masked-ink-notehead-geometry 659.5px | gM9; treble/s1/v1; event 8 x=834.4 | no local; key=0 | C6 gM9@2.5 Δp=0 Δt=0 | correct |
| m8@3 | 0 | E5 (76; nat 76; alt 0; dur 0.5) | m9-raw-27: 74→74 | pdf-glyph-377 g_d1_f3/U+E0A4 @852.4,699.3 | metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | gM9; treble/s1/v1; event 10 x=852.4 | no local; key=0 | E5 gM9@2.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m8@3 | 1 | G#5 (80; nat 79; alt 1; dur 0.5) | m9-raw-26: 77→78 | pdf-glyph-378 g_d1_f3/U+E0A4 @852.4,686.2 | metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | gM9; treble/s1/v1; event 10 x=852.4 | selected sharp@842.0,686.3 score=19.23; key=0 | G#5 gM9@2.5 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m8@3 | 2 | B5 (83; nat 83; alt 0; dur 0.5) | m9-raw-25: 83→83 | pdf-glyph-379 g_d1_f3/U+E0A4 @852.4,673.1 | metric 668.9px; ledger-masked-ink-notehead-geometry 666.5px | gM9; treble/s1/v1; event 10 x=852.4 | no local; key=0 | B5 gM9@3 Δp=0 Δt=0 | correct |
| m8@3.5 | 0 | D5 (74; nat 74; alt 0; dur 0.5) | m9-raw-32: 74→74 | pdf-glyph-380 g_d1_f3/U+E0A4 @870.3,705.8 | metric 701.6px; ink-notehead-geometry 699.5px | gM9; treble/s1/v1; event 11 x=870.3 | no local; key=0 | D5 gM9@3.5 Δp=0 Δt=0 | correct |
| m8@3.5 | 1 | F#5 (78; nat 77; alt 1; dur 0.5) | m9-raw-31: 76→76 | pdf-glyph-381 g_d1_f3/U+E0A4 @870.3,692.7 | metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | gM9; treble/s1/v1; event 11 x=870.3 | no local; key=0 | F#5 gM9@3 Δp=0 Δt=0.5 | S5 wrong staff-step quantization |
| m8@3.5 | 2 | A5 (81; nat 81; alt 0; dur 0.5) | m9-raw-30: 81→82 | pdf-glyph-382 g_d1_f3/U+E0A4 @870.3,679.7 | metric 675.4px; ledger-masked-ink-notehead-geometry 673.0px | gM9; treble/s1/v1; event 11 x=870.3 | no local; carry=1; key=0 | A#5 gM9@3.5 Δp=1 Δt=0 | S9 accidental state incorrectly inherited |

### Complete produced-tone inventory contributing to the 20 frozen chord records (58/58)

| Chord | Produced tone | Generated location | Raw source | Glyph/anchor | Accidental | Evaluator ownership | First fault relative to printed tone |
|---|---|---|---|---|---|---|---|
| m5-o2 | A5 (81) | gM6@2; dur 0.5; s1/v1 | m6-raw-18: nat 81→81 | pdf-glyph-262; metric 675.4px; ledger-masked-ink-notehead-geometry 673.0px | no local; key=0 | A5 truth@2 | S— correct through final MusicXML |
| m5-o2 | D5 (74) | gM6@1.5; dur 0.5; s1/v1 | m6-raw-15: nat 74→74 | pdf-glyph-258; metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | no local; key=0 | D5 truth@2 | S5 wrong staff-step quantization |
| m5-o2 | F#5 (78) | gM6@1.5; dur 0.5; s1/v1 | m6-raw-14: nat 77→78 | pdf-glyph-259; metric 682.0px; glyph-metrics-fallback 682.0px; reject=component-outside-font-origin-range | selected sharp@216.1,686.3 score=21.86; key=0 | F#5 truth@2 | S5 wrong staff-step quantization |
| m6-o1 | C#5 (73) | gM7@1; dur 0.5; s1/v1 | m7-raw-10: nat 72→73 | pdf-glyph-292; metric 708.1px; ink-notehead-geometry 705.5px | no local; carry=1; key=0 | C#5 truth@1 | S— correct through final MusicXML |
| m6-o1 | F5 (77) | gM7@1; dur 0.5; s1/v1 | m7-raw-9: nat 76→77 | pdf-glyph-293; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | no local; carry=1; key=0 | F5 truth@1 | S5 wrong staff-step quantization |
| m6-o1 | G#5 (80) | gM7@1.5; dur 0.5; s1/v1 | m7-raw-16: nat 79→80 | pdf-glyph-297; metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | selected sharp@389.5,679.7 score=32.36; key=0 | G#5 truth@1 | S5 wrong staff-step quantization |
| m6-o2 | B5 (83) | gM7@2; dur 0.5; s1/v1 | m7-raw-17: nat 83→83 | pdf-glyph-300; metric 668.9px; ledger-masked-ink-notehead-geometry 666.5px | no local; key=0 | B5 truth@2 | S— correct through final MusicXML |
| m6-o2 | G#5 (80) | gM7@2.5; dur 0.5; s1/v1 | m7-raw-22: nat 79→80 | pdf-glyph-304; metric 675.4px; glyph-metrics-fallback 675.4px; reject=component-outside-font-origin-range | selected sharp@429.5,679.7 score=27.88; key=0 | G#5 truth@2 | S5 wrong staff-step quantization |
| m6-o2 | D#5 (75) | gM7@2; dur 0.5; s1/v1 | m7-raw-19: nat 74→75 | pdf-glyph-298; metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | no local; carry=1; key=0 | E5 truth@2 | S5 wrong staff-step quantization |
| m6-o3 | C#5 (73) | gM7@3; dur 0.5; s1/v1 | m7-raw-26: nat 72→73 | pdf-glyph-305; metric 708.1px; ink-notehead-geometry 705.5px | no local; carry=1; key=0 | C#5 truth@3 | S— correct through final MusicXML |
| m6-o3 | F5 (77) | gM7@3; dur 0.5; s1/v1 | m7-raw-25: nat 76→77 | pdf-glyph-306; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | selected sharp@443.3,699.3 score=38.98; key=0 | F5 truth@3 | S5 wrong staff-step quantization |
| m6-o3 | F5 (77) | gM7@2.5; dur 0.5; s1/v1 | m7-raw-23: nat 76→77 | pdf-glyph-303; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | no local; carry=1; key=0 | G#5 truth@3 | S5 wrong staff-step quantization |
| m6-o1.5 | F#5 (78) | gM7@2; dur 0.5; s1/v1 | m7-raw-18: nat 77→78 | pdf-glyph-299; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | selected sharp@407.4,686.3 score=19.23; key=0 | F#5 truth@1.5 | S5 wrong staff-step quantization |
| m6-o1.5 | C#5 (73) | gM7@1.5; dur 0.5; s1/v1 | m7-raw-15: nat 72→73 | pdf-glyph-295; metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | no local; carry=1; key=0 | D5 truth@1.5 | S5 wrong staff-step quantization |
| m6-o1.5 | F5 (77) | gM7@1.5; dur 0.5; s1/v1 | m7-raw-14: nat 76→77 | pdf-glyph-296; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | no local; carry=1; key=0 | A5 truth@1.5 | S5 wrong staff-step quantization |
| m6-o2.5 | F#5 (78) | gM7@3; dur 0.5; s1/v1 | m7-raw-29: nat 77→78 | pdf-glyph-307; metric 682.0px; glyph-metrics-fallback 682.0px; reject=component-outside-font-origin-range | selected sharp@443.3,686.3 score=23.31; key=0 | F#5 truth@2.5 | S5 wrong staff-step quantization |
| m6-o2.5 | C#5 (73) | gM7@2.5; dur 0.5; s1/v1 | m7-raw-24: nat 72→73 | pdf-glyph-302; metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | selected sharp@425.4,705.9 score=21.91; key=0 | D5 truth@2.5 | S5 wrong staff-step quantization |
| m7-o0.5 | C#5 (73) | gM8@0.5; dur 0.5; s1/v1 | m8-raw-7: nat 72→73 | pdf-glyph-325; metric 708.1px; ink-notehead-geometry 705.5px | no local; carry=1; key=0 | C#5 truth@0.5 | S— correct through final MusicXML |
| m7-o0.5 | F5 (77) | gM8@0.5; dur 0.5; s1/v1 | m8-raw-6: nat 76→77 | pdf-glyph-326; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | selected sharp@552.9,699.3 score=38.98; key=0 | F5 truth@0.5 | S5 wrong staff-step quantization |
| m7-o0.5 | G#5 (80) | gM8@1; dur 0.5; s1/v1 | m8-raw-13: nat 79→80 | pdf-glyph-330; metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | selected sharp@579.9,679.7 score=25.43; key=0 | G#5 truth@0.5 | S5 wrong staff-step quantization |
| m7-o2 | C#6 (85) | gM8@2; dur 0.5; s1/v1 | m8-raw-17: nat 84→85 | pdf-glyph-336; metric 662.4px; ledger-masked-ink-notehead-geometry 659.5px | selected sharp@588.8,660.1 score=47.65; key=0 | C#6 truth@2 | S— correct through final MusicXML |
| m7-o2 | F#5 (78) | gM8@1.5; dur 0.5; s1/v1 | m8-raw-14: nat 77→78 | pdf-glyph-332; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | selected sharp@588.8,686.3 score=19.23; key=0 | F#5 truth@2 | S5 wrong staff-step quantization |
| m7-o2 | A#5 (82) | gM8@2.5; dur 0.5; s1/v1 | m8-raw-22: nat 81→82 | pdf-glyph-340; metric 668.9px; glyph-metrics-fallback 668.9px; reject=component-outside-font-origin-range | selected sharp@628.8,673.2 score=27.88; key=0 | A#5 truth@2 | S5 wrong staff-step quantization |
| m7-o3.5 | C#5 (73) | gM8@3.5; dur 0.5; s1/v1 | m8-raw-31: nat 72→73 | pdf-glyph-344; metric 708.1px; ink-notehead-geometry 705.5px | no local; carry=1; key=0 | C#5 truth@3.5 | S— correct through final MusicXML |
| m7-o3.5 | F5 (77) | gM8@3.5; dur 0.5; s1/v1 | m8-raw-30: nat 76→77 | pdf-glyph-345; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | no local; carry=1; key=0 | F5 truth@3.5 | S5 wrong staff-step quantization |
| m7-o3.5 | F#5 (78) | gM8@3.5; dur 0.5; s1/v1 | m8-raw-32: nat 77→78 | pdf-glyph-346; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | no local; carry=1; key=0 | G#5 truth@3.5 | S5 wrong staff-step quantization |
| m7-o1 | D#5 (75) | gM8@1.5; dur 0.5; s1/v1 | m8-raw-15: nat 74→75 | pdf-glyph-331; metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | selected sharp@557.0,673.2 score=150.38; key=0 | D#5 truth@1 | S5 wrong staff-step quantization |
| m7-o1 | A#5 (82) | gM8@1.5; dur 0.5; s1/v1 | m8-raw-16: nat 81→82 | pdf-glyph-333; metric 668.9px; glyph-metrics-fallback 668.9px; reject=no-head-sized-component | selected sharp@588.8,673.2 score=32.35; key=0 | A#5 truth@1 | S5 wrong staff-step quantization |
| m7-o1 | F#5 (78) | gM8@1; dur 0.5; s1/v1 | m8-raw-9: nat 77→78 | pdf-glyph-329; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | selected sharp@570.9,679.7 score=37.78; key=0 | G5 truth@1 | S5 wrong staff-step quantization |
| m7-o1.5 | G#5 (80) | gM8@2; dur 0.5; s1/v1 | m8-raw-18: nat 79→80 | pdf-glyph-335; metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | selected sharp@606.8,679.7 score=31.97; key=0 | G#5 truth@1.5 | S5 wrong staff-step quantization |
| m7-o1.5 | F5 (77) | gM8@2; dur 0.5; s1/v1 | m8-raw-19: nat 76→77 | pdf-glyph-334; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | no local; carry=1; key=0 | E5 truth@1.5 | S5 wrong staff-step quantization |
| m7-o1.5 | C#5 (73) | gM8@1; dur 0.5; s1/v1 | m8-raw-10: nat 72→73 | pdf-glyph-328; metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | no local; carry=1; key=0 | B5 truth@1.5 | S5 wrong staff-step quantization |
| m7-o2.5 | G#5 (80) | gM8@3; dur 0.5; s1/v1 | m8-raw-29: nat 79→80 | pdf-glyph-343; metric 675.4px; glyph-metrics-fallback 675.4px; reject=component-outside-font-origin-range | selected sharp@646.7,679.7 score=31.97; key=0 | G#5 truth@2.5 | S5 wrong staff-step quantization |
| m7-o2.5 | F#5 (78) | gM8@2.5; dur 0.5; s1/v1 | m8-raw-23: nat 77→78 | pdf-glyph-339; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | no local; carry=1; key=0 | E5 truth@2.5 | S5 wrong staff-step quantization |
| m7-o3 | D#5 (75) | gM8@2.5; dur 0.5; s1/v1 | m8-raw-24: nat 74→75 | pdf-glyph-338; metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | selected sharp@624.7,699.3 score=21.02; key=0 | D#5 truth@3 | S5 wrong staff-step quantization |
| m7-o3 | F#5 (78) | gM8@3; dur 0.5; s1/v1 | m8-raw-25: nat 77→78 | pdf-glyph-342; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | no local; carry=1; key=0 | G5 truth@3 | S5 wrong staff-step quantization |
| m7-o3 | C#5 (73) | gM8@3; dur 0.5; s1/v1 | m8-raw-26: nat 72→73 | pdf-glyph-341; metric 701.6px; glyph-metrics-fallback 701.6px; reject=no-head-sized-component | selected sharp@642.7,705.9 score=21.91; key=0 | A#5 truth@3 | S5 wrong staff-step quantization |
| m8-o0.5 | D5 (74) | gM9@0.5; dur 0.5; s1/v1 | m9-raw-7: nat 74→74 | pdf-glyph-361; metric 701.6px; ledger-masked-ink-notehead-geometry 699.0px | no local; key=0 | D5 truth@0.5 | S— correct through final MusicXML |
| m8-o0.5 | F#5 (78) | gM9@0; dur 0.5; s1/v1 | m9-raw-0: nat 77→78 | pdf-glyph-359; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | selected sharp@734.4,686.3 score=19.23; key=0 | F#5 truth@0.5 | S5 wrong staff-step quantization |
| m8-o0.5 | A#5 (82) | gM9@0.5; dur 0.5; s1/v1 | m9-raw-8: nat 81→82 | pdf-glyph-363; metric 675.4px; ledger-masked-ink-notehead-geometry 673.0px | selected sharp@752.3,679.7 score=44.61; key=0 | A5 truth@0.5 | S8 accidental detected but bound to wrong tone |
| m8-o1 | B5 (83) | gM9@1; dur 0.5; s1/v1 | m9-raw-13: nat 83→83 | pdf-glyph-366; metric 668.9px; ledger-masked-ink-notehead-geometry 666.5px | no local; key=0 | B5 truth@1 | S— correct through final MusicXML |
| m8-o1 | D5 (74) | gM9@1; dur 0.5; s1/v1 | m9-raw-10: nat 74→74 | pdf-glyph-364; metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | no local; key=0 | E5 truth@1 | S5 wrong staff-step quantization |
| m8-o1 | F#5 (78) | gM9@1; dur 0.5; s1/v1 | m9-raw-9: nat 77→78 | pdf-glyph-365; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | no local; carry=1; key=0 | G#5 truth@1 | S5 wrong staff-step quantization |
| m8-o1.5 | C6 (84) | gM9@1.5; dur 0.5; s1/v1 | m9-raw-16: nat 84→84 | pdf-glyph-369; metric 662.4px; ledger-masked-ink-notehead-geometry 659.5px | no local; key=0 | C6 truth@1.5 | S— correct through final MusicXML |
| m8-o1.5 | F#5 (78) | gM9@1.5; dur 0.5; s1/v1 | m9-raw-15: nat 77→78 | pdf-glyph-367; metric 688.5px; ledger-masked-ink-notehead-geometry 686.0px | no local; carry=1; key=0 | F5 truth@1.5 | S9 accidental state incorrectly inherited |
| m8-o2 | D6 (86) | gM9@2; dur 0.5; s1/v1 | m9-raw-17: nat 86→86 | pdf-glyph-372; metric 655.8px; ledger-masked-ink-notehead-geometry 653.5px | no local; key=0 | D6 truth@2 | S— correct through final MusicXML |
| m8-o2 | G5 (79) | gM9@1.5; dur 0.5; s1/v1 | m9-raw-14: nat 79→79 | pdf-glyph-368; metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | no local; key=0 | G5 truth@2 | S5 wrong staff-step quantization |
| m8-o2 | A#5 (82) | gM9@2; dur 0.5; s1/v1 | m9-raw-18: nat 81→82 | pdf-glyph-371; metric 668.9px; glyph-metrics-fallback 668.9px; reject=no-head-sized-component | no local; carry=1; key=0 | B5 truth@2 | S5 wrong staff-step quantization |
| m8-o2.5 | C6 (84) | gM9@2.5; dur 0.5; s1/v1 | m9-raw-22: nat 84→84 | pdf-glyph-376; metric 662.4px; ledger-masked-ink-notehead-geometry 659.5px | no local; key=0 | C6 truth@2.5 | S— correct through final MusicXML |
| m8-o2.5 | F#5 (78) | gM9@2; dur 0.5; s1/v1 | m9-raw-19: nat 77→78 | pdf-glyph-370; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | no local; carry=1; key=0 | F5 truth@2.5 | S5 wrong staff-step quantization |
| m8-o2.5 | D5 (74) | gM9@3; dur 0.5; s1/v1 | m9-raw-27: nat 74→74 | pdf-glyph-377; metric 695.1px; glyph-metrics-fallback 695.1px; reject=no-head-sized-component | no local; key=0 | A5 truth@2.5 | S5 wrong staff-step quantization |
| m8-o3 | B5 (83) | gM9@3; dur 0.5; s1/v1 | m9-raw-25: nat 83→83 | pdf-glyph-379; metric 668.9px; ledger-masked-ink-notehead-geometry 666.5px | no local; key=0 | B5 truth@3 | S— correct through final MusicXML |
| m8-o3 | E5 (76) | gM9@2.5; dur 0.5; s1/v1 | m9-raw-24: nat 76→76 | pdf-glyph-374; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | no local; key=0 | E5 truth@3 | S5 wrong staff-step quantization |
| m8-o3 | G#5 (80) | gM9@2.5; dur 0.5; s1/v1 | m9-raw-23: nat 79→80 | pdf-glyph-375; metric 675.4px; glyph-metrics-fallback 675.4px; reject=no-head-sized-component | selected sharp@824.1,679.7 score=31.97; key=0 | G#5 truth@3 | S5 wrong staff-step quantization |
| m8-o3.5 | D5 (74) | gM9@3.5; dur 0.5; s1/v1 | m9-raw-32: nat 74→74 | pdf-glyph-380; metric 701.6px; ink-notehead-geometry 699.5px | no local; key=0 | D5 truth@3.5 | S— correct through final MusicXML |
| m8-o3.5 | F#5 (78) | gM9@3; dur 0.5; s1/v1 | m9-raw-26: nat 77→78 | pdf-glyph-378; metric 682.0px; glyph-metrics-fallback 682.0px; reject=no-head-sized-component | selected sharp@842.0,686.3 score=19.23; key=0 | F#5 truth@3.5 | S5 wrong staff-step quantization |
| m8-o3.5 | A#5 (82) | gM9@3.5; dur 0.5; s1/v1 | m9-raw-30: nat 81→82 | pdf-glyph-382; metric 675.4px; ledger-masked-ink-notehead-geometry 673.0px | no local; carry=1; key=0 | A5 truth@3.5 | S9 accidental state incorrectly inherited |
| m8-o3.5 | E5 (76) | gM9@3.5; dur 0.5; s1/v1 | m9-raw-31: nat 76→76 | pdf-glyph-381; metric 688.5px; glyph-metrics-fallback 688.5px; reject=no-head-sized-component | no local; key=0 | extra/unmatched | S15 unmatched produced tone |

The machine-readable inventory `high-extreme-semantic-attribution.json` retains every considered accidental candidate, selected/rejected attachment, raw and final coordinates, full pitch-alteration state, per-stage existence flags, transition flags, and evaluator IDs without truncating table cells.

## Visual verification of all 15 incorrect chords

The source PDF was rendered at 1000 px page width and reviewed both as a full page and as enlarged measure 5-8 bands. The paired truth interpretation is visually supported in every listed chord. All are treble-clef, staff 1, voice 1, three distinct filled heads with upward stems; no cross-staff notes, opposing voices, or displaced seconds occur. Sharps are local to individual printed tones, not whole-chord symbols.

| Chord | Source x | Printed notes | Printed accidentals | Ledger/head relation | Other visual ownership | Corpus supported |
|---|---:|---|---|---|---|---|
| m6@2 | 417.8 | E5 G#5 B5 | sharp on G#5 | B5 is between/above visible ledger rows; ledger ink is adjacent rather than through the body. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m6@3 | 455.0 | C#5 F5 G#5 | sharp on C#5, G#5 | No ledger row crosses a head in this chord; the top G/G# is immediately above the staff. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m6@1.5 | 400.0 | D5 F#5 A5 | sharp on F#5 | The upper A5/A#5 head is crossed by the first ledger line. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m6@2.5 | 435.7 | D5 F#5 A5 | sharp on F#5 | The upper A5/A#5 head is crossed by the first ledger line. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m7@3.5 | 672.3 | C#5 F5 G#5 | sharp on C#5, G#5 | No ledger row crosses a head in this chord; the top G/G# is immediately above the staff. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m7@1 | 581.7 | D#5 G5 A#5 | sharp on D#5, A#5 | The upper A5/A#5 head is crossed by the first ledger line. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m7@1.5 | 599.3 | E5 G#5 B5 | sharp on G#5 | B5 is between/above visible ledger rows; ledger ink is adjacent rather than through the body. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m7@2.5 | 635.1 | E5 G#5 B5 | sharp on G#5 | B5 is between/above visible ledger rows; ledger ink is adjacent rather than through the body. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m7@3 | 654.4 | D#5 G5 A#5 | sharp on D#5, A#5 | The upper A5/A#5 head is crossed by the first ledger line. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m8@0.5 | 762.8 | D5 F#5 A5 | sharp on F#5 | The upper A5/A#5 head is crossed by the first ledger line. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m8@1 | 780.7 | E5 G#5 B5 | sharp on G#5 | B5 is between/above visible ledger rows; ledger ink is adjacent rather than through the body. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m8@1.5 | 798.7 | F5 A5 C6 | none | The upper C6/C#6 head is crossed by its second ledger line. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m8@2 | 816.5 | G5 B5 D6 | none | Top D6 sits above two visible ledger rows; adjacent ledger ink does not hide the head. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m8@2.5 | 834.4 | F5 A5 C6 | none | The upper C6/C#6 head is crossed by its second ledger line. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |
| m8@3.5 | 870.3 | D5 F#5 A5 | sharp on F#5 | The upper A5/A#5 head is crossed by the first ledger line. | Distinct origins; one treble voice; no displaced second/cross-staff ownership. | yes |

## Selected root cause

The exact dominant transition is:

`PDF U+E0A4 glyph exists` → `candidate exists` → `ink/ledger body rejects` → `glyph-metrics-fallback` → **`midiFromStaffPosition` chooses the adjacent lower diatonic step** → accidental processing continues from that already-wrong natural pitch.

For all 43 tones, the delta is one written staff step: D→C, E→D, F→E, G→F, A→G, or B→A. Semitone deltas are -1 or -2 only because diatonic step sizes differ. The font family and glyph are constant; 39 reject as `no-head-sized-component`, four as `component-outside-font-origin-range`. This is not an octave error, wrong clef, wrong staff, missing candidate, chord merge, or evaluator-only error.

## Alternatives rejected

- Accidental binding: one first-fault tone; perfect correction reaches 30%, below the gate.
- Accidental-state carry: two tones; removes two missing/two extra but yields no new exact chord in isolation.
- Evaluator alignment: downstream re-pairing is real (24 nearby-onset reassignments), but the direct physical candidates are already wrong at stage 5. Evaluator changes are frozen and prohibited.
- Staff/clef/voice/measure/chord ownership: trace shows the candidates survive with the correct ownership; changing those semantics would not address the first fault.
- Raster, broad component/fragment recovery, broad stacked ownership, and optical-center profiles: explicitly out of scope and already rejected by preceding campaigns.
- Uniform register or MIDI shifting: would hard-code a symptom and violates the global MIDI-window / song-specific correction constraints.

## Production change and tests

No production or test file was changed. No focused production test was added because the only gate-clearing mechanism is excluded; adding a test for an unimplemented or prohibited behavior would not back a production fix. Diagnostic scripts and JSON remain under `tmp/` only and are not commit candidates.

| Validation | Result |
|---|---|
| Focused anchor/ledger/accidental/extreme/rhythm tests | PASS: 6 files, 81 tests |
| High-extreme fixture and attribution | PASS/reproduced: 20 chords, 25% exact, 23 missing, 21 extra |
| Frozen semantic corpus | PASS: 9/9; evaluator 2.0.0/schema 2 |
| Low-extreme and Guitar-standard gates | unchanged: 76.47% / missing 6; 86% Pitch / 100% Rhythm |
| Full OMR, Guitar/TAB, microphone, playback/audio, ownership/switching, report/export, and full unit suite | PASS: 282 files; 2,852 passed; 5 skipped |
| Production build | PASS; existing chunk-size advisory only |
| Heavy-score performance harness | PASS: 802 notes/49 measures; cold parse 38.13 ms; visual groups 3.97 ms; cache hit true; all relative assertions true |

## Before/after and acceptance decision

| Metric | Before | After accepted production |
|---|---:|---:|
| High-extreme exact | 25% | 25% (unchanged) |
| High-extreme missing / extra | 23 / 21 | 23 / 21 |
| Overall | 69.439% | 69.439% |
| Pitch / Rhythm | 72.329% / 80.468% | same |
| Low-extreme exact / missing | 76.47% / 6 | same |
| Guitar-standard Pitch / Rhythm | 86% / 100% | same |

**Decision: REVERT/REJECT.** There were no production/test edits to revert. The working tree remains production-clean at exact `beeb5f066e7bdcb3043df5fa001c92abdadb0088`; no commit was created.

## Next blocker

The next blocker is a safe, newly authorized source of optical-center/staff-step evidence for embedded SMuFL heads when trusted ink anchoring rejects. It must be materially different from the rejected fixed optical profiles, raster recovery, and broad stacked ownership, and must independently clear the semantic gate. Accidental-state work should remain secondary until that dominant natural-step fault is resolved.


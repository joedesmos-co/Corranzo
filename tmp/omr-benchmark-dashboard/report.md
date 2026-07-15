# OMR benchmark dashboard

Generated: 2026-07-15T16:33:57.220Z
Fixtures: 16
Overall: PASS
Largest remaining error bucket: chord = 9000 (31%)

## Status
- pass: 10
- fail: 0
- rejected: 0
- skipped: 6
- error: 0

## Fixtures

### CC0 Beginner Line Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.musicxml`
- License: CC0-1.0 (piano-beginner-single-vector)
- Categories: clean-beginner-single-staff, rests-dotted-rhythms, eighth-notes, modern-vector-pdf
  pitch 25% | duration 88% | onset 84% | chord 94% | F1 97%
  measureΔ 0 | noteΔ 0 | wrongPitch 23 | wrongDuration 3 | wrongOnset 4 | chordMismatch 2
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (2 sampled)
  top pitch error category: ±octave (7 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.871)
  - Source scores: rhythm-inference=0.871, pitch-mapping=0.7048, measure-allocation=0.2481
  - Pitch errors (23): ±octave=7, ±1-accidental=6, ±2-diatonic=6, other=4
  - Duration errors (3): onset-coupled=2, too-short=1
  - Detection: chord-grouping=2, extra-notes=1, missing-notes=1
  - Error buckets: pitch=23, accidentals=6, onset=4, duration=3, chord=2, rests=2, extra/missing-notes=2
  - Largest remaining error bucket: pitch = 23 (55%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 5
  - onset-phase-shift: 4
  - voice-serialization-shift: 2
  - onset-coupled-duration: 2
  - chord-grouping-symptom: 2
  - balanced-missing-extra-serialization: 2
  - chord symptom coupled share: 100%
  - missing/extra balanced: 1/1
  Written vs sounding duration (V2 Phase 3):
  - onset-coupled-duration: 2
  - written-duration-wrong: 1
  - Dominant: onset-coupled-duration (2)
  - Hotspot duration traces:
    - m7: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m8: 1 wrong durations (onset-coupled-duration=1)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 1
  - sounding-release-too-short: 1
  - Dominant: expected-cross-measure-tie (1)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 23 (23 wrong pitch match(es))
  - onset-rhythm-inference: 7 (3 duration; 4 onset error(s))
  - symbol-detection: 2 (1 missing; 1 extra note(s))
  - voice-serialization: 2 (2 chord/voice grouping mismatch(es))
  - measure hotspots: m8 pitch-inference (13), m7 onset-rhythm-inference (10), m4 pitch-inference (8), m2 pitch-inference (7), m5 pitch-inference (7), m6 pitch-inference (7), m1 pitch-inference (6), m3 pitch-inference (6)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 1 candidates / 1 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 4 → 4 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 2 → 2 (Δ 0)
- Rejected candidates: m8:no-improvement

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 4 → 4 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 2 → 2 (Δ 0)
  ScoreGraph IR (observation): 51 nodes, 97 edges across 8 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 14 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Grand Staff Voice Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml`
- License: CC0-1.0 (piano-grand-voices-vector)
- Categories: grand-staff, chords-multiple-voices, ties-slurs-articulations, repeats-voltas, modern-vector-pdf
  pitch 63% | duration 82% | onset 98% | chord 98% | F1 99%
  measureΔ 0 | noteΔ 0 | wrongPitch 32 | wrongDuration 15 | wrongOnset 1 | chordMismatch 2
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-long (14 sampled)
  top pitch error category: ±1-accidental (12 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.848)
  - Source scores: rhythm-inference=0.8483, pitch-mapping=0.3494, measure-allocation=0.2302
  - Pitch errors (32): ±1-accidental=12, ±2-diatonic=11, other=9
  - Duration errors (15): too-long=14, too-short=1
  - Detection: chord-grouping=2, extra-notes=1, missing-notes=1
  - Error buckets: slurs=40, pitch=32, duration=15, accidentals=12, chord=2, extra/missing-notes=2, onset=1, ties=1
  - Largest remaining error bucket: slurs = 40 (38%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 11
  - chord-grouping-symptom: 2
  - balanced-missing-extra-serialization: 2
  - onset-phase-shift: 1
  - chord symptom coupled share: 100%
  - missing/extra balanced: 1/1
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 14
  - serialization-artifact: 1
  - Dominant: written-duration-wrong (14)
  - Hotspot duration traces:
    - m1: 2 wrong durations (written-duration-wrong=2)
    - m2: 2 wrong durations (written-duration-wrong=2)
    - m3: 2 wrong durations (written-duration-wrong=2)
    - m4: 2 wrong durations (written-duration-wrong=2)
    - m5: 1 wrong durations (serialization-artifact=1)
    - m6: 2 wrong durations (written-duration-wrong=2)
    - m7: 2 wrong durations (written-duration-wrong=2)
    - m8: 2 wrong durations (written-duration-wrong=2)
  Tie/sustain constraints (V2 Phase 4):
  - written-correct-sustain-wrong: 7
  - slur-like-arc-pitch-differs: 1
  - Dominant: written-correct-sustain-wrong (7)
  - Tie glyphs: detected 1, applied 0, slur-like rejected 1, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 32 (32 wrong pitch match(es))
  - onset-rhythm-inference: 16 (15 duration; 1 onset error(s))
  - symbol-detection: 2 (1 missing; 1 extra note(s))
  - voice-serialization: 2 (2 chord/voice grouping mismatch(es))
  - measure hotspots: m5 pitch-inference (21), m6 pitch-inference (21), m7 pitch-inference (19), m8 pitch-inference (19), m3 pitch-inference (16), m2 pitch-inference (15), m4 pitch-inference (15), m1 onset-rhythm-inference (8)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 8 candidates / 8 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 1 → 1 (Δ 0), wrongDuration 15 → 15 (Δ 0), chord 2 → 2 (Δ 0)
- Rejected candidates: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 1 → 1 (Δ 0), wrongDuration 15 → 15 (Δ 0), chord 2 → 2 (Δ 0)
  ScoreGraph IR (observation): 163 nodes, 352 edges across 8 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 62 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Rhythm and Tuplet Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml`
- License: CC0-1.0 (piano-rhythm-tuplets-vector)
- Categories: eighth-sixteenth-rhythms, tuplets, rests-dotted-rhythms, ties, modern-vector-pdf
  pitch 41% | duration 78% | onset 56% | chord 77% | F1 89%
  measureΔ 0 | noteΔ 0 | wrongPitch 30 | wrongDuration 7 | wrongOnset 21 | chordMismatch 16
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: beamed-subdivision (4 sampled)
  top pitch error category: other (18 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.884)
  - Source scores: rhythm-inference=0.8839, pitch-mapping=0.5089, measure-allocation=0.3811, chord-grouping=0.2029, notehead-detection=0.1222
  - Pitch errors (30): other=18, ±octave=7, ±1-accidental=4, ±2-diatonic=1
  - Duration errors (7): beamed-subdivision=4, onset-coupled=2, too-short=1
  - Detection: chord-grouping=16, extra-notes=7, missing-notes=7
  - Error buckets: pitch=30, onset=21, chord=16, extra/missing-notes=14, slurs=8, duration=7, accidentals=4, ties=2, rests=2
  - Largest remaining error bucket: pitch = 30 (29%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 25
  - onset-phase-shift: 19
  - chord-grouping-symptom: 16
  - balanced-missing-extra-serialization: 14
  - voice-serialization-shift: 11
  - onset-coupled-duration: 2
  - chord symptom coupled share: 100%
  - missing/extra balanced: 7/7
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 3
  - onset-coupled-duration: 2
  - serialization-artifact: 2
  - Dominant: written-duration-wrong (3)
  - Hotspot duration traces:
    - m1: 1 wrong durations (written-duration-wrong=1)
    - m2: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m3: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m4: 1 wrong durations (serialization-artifact=1)
    - m5: 1 wrong durations (written-duration-wrong=1)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 2
  - written-correct-sustain-wrong: 1
  - Dominant: slur-like-arc-pitch-differs (2)
  - Tie glyphs: detected 4, applied 2, slur-like rejected 2, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 30 (30 wrong pitch match(es))
  - onset-rhythm-inference: 28 (7 duration; 21 onset error(s))
  - voice-serialization: 16 (16 chord/voice grouping mismatch(es))
  - symbol-detection: 14 (7 missing; 7 extra note(s))
  - measure hotspots: m2 onset-rhythm-inference (44), m3 pitch-inference (27), m7 pitch-inference (26), m1 onset-rhythm-inference (15), m4 pitch-inference (12), m8 onset-rhythm-inference (12), m5 symbol-detection (7)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 1 accepted / 5 candidates / 5 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 21 → 21 (Δ 0), wrongDuration 7 → 7 (Δ 0), chord 16 → 16 (Δ 0)
- Rejected candidates: m1:duration-changed, m2:duration-changed+chord-split, m3:duration-changed+chord-split, m7:duration-changed+chord-split, m8:chord-regression+pitch-regression+duration-regression

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 21 → 21 (Δ 0), wrongDuration 7 → 7 (Δ 0), chord 16 → 16 (Δ 0)
  ScoreGraph IR (observation): 117 nodes, 217 edges across 8 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 3 node(s) sounding≠written; 18 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Articulation Scan Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml`
- License: CC0-1.0 (piano-articulation-scan)
- Categories: scanned-score, grand-staff, ties-slurs-articulations, chords-multiple-voices
  pitch 32% | duration 47% | onset 61% | chord 60% | F1 80%
  measureΔ 0 | noteΔ 23 | wrongPitch 45 | wrongDuration 28 | wrongOnset 12 | chordMismatch 49
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-short (25 sampled)
  top pitch error category: other (21 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.866)
  - Source scores: rhythm-inference=0.8663, pitch-mapping=0.5344, notehead-detection=0.359, chord-grouping=0.3557, measure-allocation=0.3317
  - Pitch errors (45): other=21, ±1-accidental=13, ±2-diatonic=11
  - Duration errors (28): too-short=25, onset-coupled=3
  - Detection: chord-grouping=49, extra-notes=31, missing-notes=8
  - Error buckets: chord=49, pitch=45, extra/missing-notes=39, duration=28, accidentals=13, onset=12
  - Largest remaining error bucket: chord = 49 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 25
  - pitch-grouping-symptom: 21
  - onset-phase-shift: 12
  - onset-coupled-duration: 3
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 22
  - onset-coupled-duration: 3
  - serialization-artifact: 3
  - Dominant: written-duration-wrong (22)
  - Hotspot duration traces:
    - m1: 3 wrong durations (written-duration-wrong=3)
    - m2: 4 wrong durations (written-duration-wrong=4)
    - m3: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m4: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m5: 4 wrong durations (written-duration-wrong=4)
    - m6: 4 wrong durations (written-duration-wrong=4)
    - m7: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m8: 3 wrong durations (written-duration-wrong=3)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 13
  - sounding-release-too-short: 13
  - written-correct-sustain-wrong: 11
  - Dominant: expected-cross-measure-tie (13)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: voice-serialization
  - voice-serialization: 49 (49 chord/voice grouping mismatch(es))
  - pitch-inference: 45 (45 wrong pitch match(es))
  - onset-rhythm-inference: 40 (28 duration; 12 onset error(s))
  - symbol-detection: 39 (8 missing; 31 extra note(s))
  - page-rasterization: 1 (scanned fixture; 1/1 page(s) not classified as scanned)
  - measure hotspots: m7 voice-serialization (39), m6 pitch-inference (38), m2 symbol-detection (34), m4 onset-rhythm-inference (34), m8 pitch-inference (32), m5 pitch-inference (29), m3 pitch-inference (28), m1 symbol-detection (16)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 4 candidates / 4 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 28 → 28 (Δ 0), chord 49 → 49 (Δ 0)
- Rejected candidates: m1:chord-split, m4:chord-split, m5:chord-split, m8:chord-split

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 8 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 28 → 28 (Δ 0), chord 49 → 49 (Δ 0)
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed
  ScoreGraph IR (observation): 122 nodes, 242 edges across 8 measures; geometry bridge n/a
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 47 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Dense Advanced Texture Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml`
- License: CC0-1.0 (piano-dense-advanced-vector)
- Categories: dense-advanced-score, grand-staff, chords-multiple-voices, eighth-sixteenth-rhythms, modern-vector-pdf
  pitch 15% | duration 39% | onset 33% | chord 29% | F1 46%
  measureΔ 11 | noteΔ -2 | wrongPitch 81 | wrongDuration 16 | wrongOnset 32 | chordMismatch 290
  top error category: Measure allocation (measure-allocation)
  top duration error category: too-short (9 sampled)
  top pitch error category: other (49 sampled)
  - Primary: Measure allocation (measure-allocation, confidence 1)
  - Source scores: measure-allocation=1, rhythm-inference=0.8775, pitch-mapping=0.6413, chord-grouping=0.6397, notehead-detection=0.6019
  - Pitch errors (81): other=49, ±1-accidental=19, ±2-diatonic=12, ±octave=1
  - Duration errors (16): too-short=9, onset-coupled=4, beamed-subdivision=3
  - Detection: chord-grouping=290, missing-notes=144, extra-notes=142
  - Error buckets: chord=290, extra/missing-notes=286, pitch=81, ties=47, slurs=46, onset=32, accidentals=19, duration=16
  - Largest remaining error bucket: chord = 290 (36%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 106
  - pitch-grouping-symptom: 55
  - onset-phase-shift: 32
  - voice-serialization-shift: 8
  - onset-coupled-duration: 4
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 7
  - serialization-artifact: 5
  - onset-coupled-duration: 4
  - Dominant: written-duration-wrong (7)
  - Hotspot duration traces:
    - m1: 3 wrong durations (written-duration-wrong=3)
    - m2: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
    - m3: 5 wrong durations (written-duration-wrong=1, serialization-artifact=4)
    - m4: 3 wrong durations (written-duration-wrong=2, onset-coupled-duration=1)
    - m5: 1 wrong durations (serialization-artifact=1)
    - m6: 1 wrong durations (onset-coupled-duration=1)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 46
  - written-correct-sustain-wrong: 3
  - expected-cross-measure-tie: 1
  - sounding-release-too-short: 1
  - Dominant: slur-like-arc-pitch-differs (46)
  - Tie glyphs: detected 50, applied 3, slur-like rejected 46, unresolved 1
  Pipeline attribution: voice-serialization
  - voice-serialization: 290 (290 chord/voice grouping mismatch(es))
  - symbol-detection: 286 (144 missing; 142 extra note(s))
  - pitch-inference: 81 (81 wrong pitch match(es))
  - onset-rhythm-inference: 48 (16 duration; 32 onset error(s))
  - measure-barline-segmentation: 12 (measure count 19/8 (Δ11); 1 irregular system grid(s))
  - measure hotspots: m3 pitch-inference (76), m4 pitch-inference (70), m5 pitch-inference (67), m6 symbol-detection (67), m7 symbol-detection (66), m8 symbol-detection (65), m2 symbol-detection (64), m1 symbol-detection (63)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 14 candidates / 14 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 32 → 32 (Δ 0), wrongDuration 16 → 16 (Δ 0), chord 290 → 290 (Δ 0)
- Rejected candidates: m2:duration-changed+chord-split, m3:duration-changed+chord-split, m4:duration-changed+chord-split+onset-group-regression, m5:duration-changed+chord-split+onset-group-regression, m6:duration-changed+chord-split, m9:constraints-failed, m12:constraints-failed, m13:duration-changed+chord-split…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 13 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 32 → 32 (Δ 0), wrongDuration 16 → 16 (Δ 0), chord 290 → 290 (Δ 0)
- Rejected measures: m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m9:constraints-failed, m12:constraints-failed, m13:constraints-failed, m14:constraints-failed…
  ScoreGraph IR (observation): 516 nodes, 1004 edges across 19 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 1 underfill measure(s)
  IR duration split: 5 node(s) sounding≠written; 91 tie; 3 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Sparse TAB Technique Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-tab-sparse-vector/guitar-tab-sparse-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-tab-sparse-vector/guitar-tab-sparse-vector.musicxml`
- License: CC0-1.0 (guitar-tab-sparse-vector)
- Categories: tab-only, multi-digit-frets, techniques, sparse-layout, capo-repeat-coda, vector-pdf
  pitch 70% | duration 73% | onset 57% | chord 80% | F1 89%
  measureΔ 0 | noteΔ 8 | wrongPitch 4 | wrongDuration 3 | wrongOnset 9 | chordMismatch 8
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (2 sampled)
  top pitch error category: other (3 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.816)
  - Source scores: rhythm-inference=0.8156, measure-allocation=0.2763, notehead-detection=0.27, chord-grouping=0.18, pitch-mapping=0.1188
  - Pitch errors (4): other=3, ±1-accidental=1
  - Duration errors (3): onset-coupled=2, too-short=1
  - Detection: chord-grouping=8, extra-notes=8
  - Error buckets: onset=9, chord=8, extra/missing-notes=8, pitch=4, duration=3, accidentals=1
  - Largest remaining error bucket: onset = 9 (27%)
  Rhythm/voice attribution (V2 Phase 1):
  - onset-phase-shift: 9
  - chord-grouping-symptom: 8
  - pitch-grouping-symptom: 4
  - onset-coupled-duration: 2
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - onset-coupled-duration: 2
  - serialization-artifact: 1
  - Dominant: onset-coupled-duration (2)
  - Hotspot duration traces:
    - m1: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m5: 1 wrong durations (onset-coupled-duration=1)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 2
  - sounding-release-too-short: 2
  - Dominant: expected-cross-measure-tie (2)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: onset-rhythm-inference
  - onset-rhythm-inference: 12 (3 duration; 9 onset error(s))
  - symbol-detection: 8 (0 missing; 8 extra note(s))
  - voice-serialization: 8 (8 chord/voice grouping mismatch(es))
  - pitch-inference: 4 (4 wrong pitch match(es))
  - tie-repeat-handling: 1 (0 tie candidate(s); 0 applied)
  - measure hotspots: m5 pitch-inference (10), m1 onset-rhythm-inference (9), m2 symbol-detection (7), m3 symbol-detection (7), m4 symbol-detection (7), m6 symbol-detection (7), m7 symbol-detection (7), m8 symbol-detection (7)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 0 candidates / 0 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 9 → 9 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 8 → 8 (Δ 0)

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 9 → 9 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 8 → 8 (Δ 0)
  ScoreGraph IR (observation): 40 nodes, 40 edges across 8 measures; geometry bridge n/a
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 0 tie; 2 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Standard Guitar Chord Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-standard-chords-vector/guitar-standard-chords-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-standard-chords-vector/guitar-standard-chords-vector.musicxml`
- License: CC0-1.0 (guitar-standard-chords-vector)
- Categories: standard-notation-only, double-stops, three-to-six-note-chord-stacks, sparse-and-dense-layouts, vector-pdf
  pitch 0% | duration 16% | onset 14% | chord 21% | F1 35%
  measureΔ 8 | noteΔ -72 | wrongPitch 28 | wrongDuration 10 | wrongOnset 12 | chordMismatch 104
  top error category: Mixed errors (mixed)
  top duration error category: too-long (6 sampled)
  top pitch error category: other (21 sampled)
  - Primary: Mixed errors (mixed, confidence 1)
  - Source scores: measure-allocation=1, notehead-detection=0.9887, pitch-mapping=0.95, rhythm-inference=0.9, chord-grouping=0.7145
  - Pitch errors (28): other=21, ±octave=7
  - Duration errors (10): too-long=6, too-short=4
  - Detection: chord-grouping=104, missing-notes=87, extra-notes=15
  - Error buckets: chord=104, extra/missing-notes=102, pitch=28, onset=12, duration=10, slurs=8, ties=1
  - Largest remaining error bucket: chord = 104 (39%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 50
  - pitch-grouping-symptom: 25
  - onset-phase-shift: 12
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - serialization-artifact: 6
  - written-duration-wrong: 4
  - Dominant: serialization-artifact (6)
  - Hotspot duration traces:
    - m1: 2 wrong durations (serialization-artifact=2)
    - m2: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m3: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m4: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m8: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 1
  - Dominant: slur-like-arc-pitch-differs (1)
  - Tie glyphs: detected 10, applied 9, slur-like rejected 1, unresolved 0
  Pipeline attribution: symbol-detection
  - symbol-detection: 111 (87 missing; 15 extra note(s); 9 rejected orphan candidate(s))
  - voice-serialization: 104 (104 chord/voice grouping mismatch(es))
  - pitch-inference: 28 (28 wrong pitch match(es))
  - onset-rhythm-inference: 22 (10 duration; 12 onset error(s))
  - measure-barline-segmentation: 8 (measure count 16/8 (Δ8))
  - measure hotspots: m8 symbol-detection (54), m4 symbol-detection (38), m7 measure-barline-segmentation (34), m3 symbol-detection (30), m1 pitch-inference (27), m6 measure-barline-segmentation (26), m2 pitch-inference (25), m5 measure-barline-segmentation (20)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 5 candidates / 5 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 10 → 10 (Δ 0), chord 104 → 104 (Δ 0)
- Rejected candidates: m1:duration-changed+chord-split, m2:duration-changed, m3:duration-changed, m4:duration-changed, m8:duration-changed

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 10 → 10 (Δ 0), chord 104 → 104 (Δ 0)
  ScoreGraph IR (observation): 94 nodes, 176 edges across 16 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 1 underfill measure(s)
  IR duration split: 12 node(s) sounding≠written; 31 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Paired Notation and TAB Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-paired-chords-vector/guitar-paired-chords-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-paired-chords-vector/guitar-paired-chords-vector.musicxml`
- License: CC0-1.0 (guitar-paired-chords-vector)
- Categories: paired-notation-tab, three-to-six-note-chord-stacks, multi-digit-frets, dense-layout, capo-repeat-coda, vector-pdf
  pitch 11% | duration 36% | onset 52% | chord 48% | F1 69%
  measureΔ 2 | noteΔ -25 | wrongPitch 58 | wrongDuration 29 | wrongOnset 11 | chordMismatch 73
  top error category: Mixed errors (mixed)
  top duration error category: too-short (15 sampled)
  top pitch error category: other (38 sampled)
  - Primary: Mixed errors (mixed, confidence 0.849)
  - Source scores: rhythm-inference=0.8493, pitch-mapping=0.7761, measure-allocation=0.7209, notehead-detection=0.4806, chord-grouping=0.4693
  - Pitch errors (58): other=38, ±2-diatonic=10, ±octave=6, ±1-accidental=4
  - Duration errors (29): too-short=15, too-long=12, onset-coupled=2
  - Detection: chord-grouping=73, missing-notes=45, extra-notes=20
  - Error buckets: chord=73, extra/missing-notes=65, pitch=58, slurs=37, duration=29, onset=11, accidentals=4
  - Largest remaining error bucket: chord = 73 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 32
  - pitch-grouping-symptom: 26
  - onset-phase-shift: 11
  - onset-coupled-duration: 2
  - voice-serialization-shift: 1
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 17
  - serialization-artifact: 10
  - onset-coupled-duration: 2
  - Dominant: written-duration-wrong (17)
  - Hotspot duration traces:
    - m1: 10 wrong durations (written-duration-wrong=4, onset-coupled-duration=1, serialization-artifact=5)
    - m4: 2 wrong durations (written-duration-wrong=2)
    - m5: 3 wrong durations (written-duration-wrong=3)
    - m6: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m7: 8 wrong durations (written-duration-wrong=4, onset-coupled-duration=1, serialization-artifact=3)
    - m8: 2 wrong durations (written-duration-wrong=2)
  Tie/sustain constraints (V2 Phase 4):
  - written-correct-sustain-wrong: 3
  - expected-cross-measure-tie: 1
  - continuation-without-tie-start: 1
  - sounding-release-too-short: 1
  - Dominant: written-correct-sustain-wrong (3)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: symbol-detection
  - symbol-detection: 80 (45 missing; 20 extra note(s); 15 rejected orphan candidate(s))
  - voice-serialization: 73 (73 chord/voice grouping mismatch(es))
  - pitch-inference: 58 (58 wrong pitch match(es))
  - notation-tab-pairing: 45 (81 attached position(s); 10 unpaired notation note(s); 35 unused TAB digit(s))
  - onset-rhythm-inference: 40 (29 duration; 11 onset error(s))
  - measure hotspots: m7 onset-rhythm-inference (51), m3 pitch-inference (38), m1 onset-rhythm-inference (37), m8 symbol-detection (37), m6 symbol-detection (36), m4 symbol-detection (35), m2 pitch-inference (29), m5 pitch-inference (20)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 5 candidates / 5 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 11 → 11 (Δ 0), wrongDuration 29 → 29 (Δ 0), chord 73 → 73 (Δ 0)
- Rejected candidates: m1:duration-changed+chord-split, m3:chord-split+onset-group-regression, m4:constraints-failed, m6:onset-group-regression, m7:duration-changed+chord-split+onset-group-regression

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 4 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 11 → 11 (Δ 0), wrongDuration 29 → 29 (Δ 0), chord 73 → 73 (Δ 0)
- Rejected measures: m3:constraints-failed, m4:constraints-failed, m6:no-improvement, m7:constraints-failed
  ScoreGraph IR (observation): 169 nodes, 367 edges across 10 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 2 node(s) sounding≠written; 57 tie; 4 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Guitar Technique Pairing Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-techniques-paired-vector/guitar-techniques-paired-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-techniques-paired-vector/guitar-techniques-paired-vector.musicxml`
- License: CC0-1.0 (guitar-techniques-paired-vector)
- Categories: paired-notation-tab, techniques-ties-slides-hammer-ons-pull-offs, double-stops, sparse-layout, vector-pdf
  pitch 3% | duration 50% | onset 66% | chord 54% | F1 70%
  measureΔ 4 | noteΔ -4 | wrongPitch 20 | wrongDuration 5 | wrongOnset 0 | chordMismatch 18
  top error category: Measure allocation (measure-allocation)
  top duration error category: too-long (5 sampled)
  top pitch error category: other (15 sampled)
  - Primary: Measure allocation (measure-allocation, confidence 1)
  - Source scores: measure-allocation=1, pitch-mapping=0.9048, rhythm-inference=0.8571, chord-grouping=0.4154, notehead-detection=0.4094
  - Pitch errors (20): other=15, ±octave=3, ±2-diatonic=2
  - Duration errors (5): too-long=5
  - Detection: chord-grouping=18, missing-notes=11, extra-notes=7
  - Error buckets: pitch=20, chord=18, extra/missing-notes=18, duration=5
  - Largest remaining error bucket: pitch = 20 (33%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 18
  - pitch-grouping-symptom: 4
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 5
  - Dominant: written-duration-wrong (5)
  - Hotspot duration traces:
    - m2: 1 wrong durations (written-duration-wrong=1)
    - m3: 1 wrong durations (written-duration-wrong=1)
    - m4: 1 wrong durations (written-duration-wrong=1)
    - m5: 1 wrong durations (written-duration-wrong=1)
    - m8: 1 wrong durations (written-duration-wrong=1)
  Tie/sustain constraints (V2 Phase 4):
  - written-correct-sustain-wrong: 1
  - Dominant: written-correct-sustain-wrong (1)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 20 (20 wrong pitch match(es))
  - symbol-detection: 18 (11 missing; 7 extra note(s))
  - voice-serialization: 18 (18 chord/voice grouping mismatch(es))
  - onset-rhythm-inference: 5 (5 duration; 0 onset error(s))
  - measure-barline-segmentation: 4 (measure count 12/8 (Δ4))
  - measure hotspots: m3 symbol-detection (9), m4 pitch-inference (9), m5 symbol-detection (9), m8 pitch-inference (9), m2 pitch-inference (8), m6 symbol-detection (8), m7 pitch-inference (8), m1 pitch-inference (7)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 0 candidates / 0 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 0 → 0 (Δ 0), wrongDuration 5 → 5 (Δ 0), chord 18 → 18 (Δ 0)

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 0 → 0 (Δ 0), wrongDuration 5 → 5 (Δ 0), chord 18 → 18 (Δ 0)
  ScoreGraph IR (observation): 41 nodes, 81 edges across 12 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 2 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 12 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Paired Guitar Scan Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-paired-scan/guitar-paired-scan.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-paired-scan/guitar-paired-scan.musicxml`
- License: CC0-1.0 (guitar-paired-scan)
- Categories: paired-notation-tab, scanned-score, multi-digit-frets, three-to-six-note-chord-stacks, dense-layout
- Expected honest rejection: no-notes
- reasons: no-notes
- error: TAB staff lines were detected, but Corranzo could not read enough fret digits or barlines for playback. Try a cleaner digital TAB PDF or upload MusicXML/MXL for accurate timing.

### Gymnopedie No. 1 (legacy local diagnostic) (`skipped`)
- PDF: `/Users/ryland/Downloads/gymnopedie-no-1-satie.pdf`
- Truth: `/Users/ryland/Downloads/gymnopedie-no-1-satie.mxl`
  pitch 100% | duration 100% | onset 100% | chord 100% | F1 100%
  measureΔ 0 | noteΔ 0 | wrongPitch 0 | wrongDuration 0 | wrongOnset 0 | chordMismatch 0
  top error category: Measure allocation (measure-allocation)
  - Primary: Measure allocation (measure-allocation, confidence 0.22)
  - Source scores: measure-allocation=0.22
  - Error buckets: slurs=164
  - Largest remaining error bucket: slurs = 164 (100%)
  Rhythm/voice attribution: (no dense rhythm errors)
  Written vs sounding duration (V2 Phase 3):
  - (no duration errors in report sample)
  Tie/sustain constraints (V2 Phase 4):
  - (no tie/sustain constraint candidates in report sample)
  - Tie glyphs: detected 6, applied 6, slur-like rejected 0, unresolved 0
  - Tie chains (clean): 370 chain(s) in 78 measure(s), 5 malformed
  Pipeline attribution: no attributed failures
  - measure hotspots: m78 null (7)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 78 candidates / 78 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 0 → 0 (Δ 0), wrongDuration 0 → 0 (Δ 0), chord 0 → 0 (Δ 0)
- Rejected candidates: m1:, m2:, m3:, m4:, m5:onset-group-regression, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 2 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 0 → 0 (Δ 0), wrongDuration 0 → 0 (Δ 0), chord 0 → 0 (Δ 0)
- Rejected measures: m37:constraints-failed, m76:constraints-failed
  ScoreGraph IR (observation): 989 nodes, 1963 edges across 78 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 3 node(s) sounding≠written; 375 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### A Cruel Angel's Thesis (legacy copyrighted diagnostic) (`skipped`)
- PDF: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf`
- Truth: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl`
  pitch 94% | duration 96% | onset 96% | chord 94% | F1 99%
  measureΔ 0 | noteΔ 0 | wrongPitch 147 | wrongDuration 77 | wrongOnset 94 | chordMismatch 172
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (44 sampled)
  top pitch error category: other (73 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.899)
  - Source scores: rhythm-inference=0.8987, measure-allocation=0.229
  - Pitch errors (147): other=73, ±2-diatonic=52, ±1-accidental=19, ±octave=3
  - Duration errors (77): onset-coupled=44, too-short=20, too-long=9, beamed-subdivision=4
  - Detection: chord-grouping=172, extra-notes=28, missing-notes=28
  - Error buckets: slurs=800, chord=172, pitch=147, onset=94, duration=77, extra/missing-notes=56, rests=52, accidentals=19, ties=16
  - Largest remaining error bucket: slurs = 800 (56%)
  Rhythm/voice attribution (V2 Phase 1):
  - onset-phase-shift: 94
  - pitch-grouping-symptom: 90
  - chord-grouping-symptom: 81
  - balanced-missing-extra-serialization: 52
  - onset-coupled-duration: 44
  - voice-serialization-shift: 35
  - chord symptom coupled share: 89%
  - missing/extra balanced: 28/28
  Written vs sounding duration (V2 Phase 3):
  - onset-coupled-duration: 44
  - written-duration-wrong: 33
  - Dominant: onset-coupled-duration (44)
  - Hotspot duration traces:
    - m7: 2 wrong durations (onset-coupled-duration=2)
    - m9: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
    - m121: 2 wrong durations (written-duration-wrong=2)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 42
  - sounding-release-too-short: 42
  - written-correct-sustain-wrong: 31
  - slur-like-arc-pitch-differs: 16
  - tie-start-without-continuation: 8
  - continuation-without-tie-start: 4
  - Dominant: expected-cross-measure-tie (42)
  - Tie glyphs: detected 27, applied 11, slur-like rejected 16, unresolved 0
  Hotspot measures (dense):
  - m7: 8 wrong onsets (unique-pitch-slot-shift=1, cross-voice-matcher=2, serialization-voice-shift=5)
  - m9: 18 wrong onsets (duplicate-pitch-instance=2, cross-voice-matcher=5, serialization-voice-shift=11)
  - m121: 9 wrong onsets (cross-voice-matcher=7, serialization-voice-shift=2)
  Pipeline attribution: voice-serialization
  - voice-serialization: 172 (172 chord/voice grouping mismatch(es))
  - onset-rhythm-inference: 171 (77 duration; 94 onset error(s))
  - pitch-inference: 147 (147 wrong pitch match(es))
  - symbol-detection: 56 (28 missing; 28 extra note(s))
  - measure hotspots: m9 voice-serialization (90), m7 voice-serialization (65), m8 voice-serialization (65), m61 voice-serialization (59), m121 pitch-inference (56), m119 pitch-inference (51), m123 pitch-inference (51), m125 pitch-inference (50)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 125 candidates / 125 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 94 → 94 (Δ 0), wrongDuration 77 → 77 (Δ 0), chord 172 → 172 (Δ 0)
- Rejected candidates: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:duration-changed+chord-split…
- Hotspot per-measure Δ:
  - m7: onset Δ 0, duration Δ 0, chord Δ 0
  - m9: onset Δ 0, duration Δ 0, chord Δ 0
  - m121: onset Δ 0, duration Δ 0, chord Δ 0

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 115 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 94 → 94 (Δ 0), wrongDuration 77 → 77 (Δ 0), chord 172 → 172 (Δ 0)
- Rejected measures: m2:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed, m9:constraints-failed, m10:constraints-failed…
- Hotspot deltas: m7(onsetΔ0,durΔ0,chordΔ0), m9(onsetΔ0,durΔ0,chordΔ0), m121(onsetΔ0,durΔ0,chordΔ0)
  ScoreGraph IR (observation): 5933 nodes, 12564 edges across 125 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 229 node(s) sounding≠written; 2044 tie; 70 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### Twinkle Twinkle (legacy local diagnostic) (`skipped`)
- PDF: `/Users/ryland/Downloads/twinkle-twinkle-little-star-easy.pdf`
- Truth: `/Users/ryland/Downloads/twinkle-twinkle-little-star-easy.mxl`
  pitch 100% | duration 97% | onset 93% | chord 100% | F1 100%
  measureΔ 0 | noteΔ 0 | wrongPitch 0 | wrongDuration 3 | wrongOnset 6 | chordMismatch 0
  top error category: Measure allocation (measure-allocation)
  top duration error category: onset-coupled (2 sampled)
  - Primary: Measure allocation (measure-allocation, confidence 0.22)
  - Source scores: measure-allocation=0.22
  - Duration errors (3): onset-coupled=2, beamed-subdivision=1
  - Error buckets: onset=6, duration=3
  - Largest remaining error bucket: onset = 6 (67%)
  Rhythm/voice attribution (V2 Phase 1):
  - onset-phase-shift: 6
  - voice-serialization-shift: 4
  - onset-coupled-duration: 2
  - missing/extra balanced: 0/0
  Written vs sounding duration (V2 Phase 3):
  - onset-coupled-duration: 2
  - written-duration-wrong: 1
  - Dominant: onset-coupled-duration (2)
  - Hotspot duration traces:
    - m10: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 2
  - sounding-release-too-short: 2
  - written-correct-sustain-wrong: 1
  - Dominant: expected-cross-measure-tie (2)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  - False-tie guard (simple): 0 applied (clean)
  Hotspot measures (simple):
  - m10: 6 wrong onsets (unique-pitch-slot-shift=2, serialization-voice-shift=4)
  Pipeline attribution: onset-rhythm-inference
  - onset-rhythm-inference: 9 (3 duration; 6 onset error(s))
  - measure hotspots: m10 onset-rhythm-inference (15)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 12 candidates / 12 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 6 → 6 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 0 → 0 (Δ 0)
- Rejected candidates: m1:no-improvement, m2:no-improvement, m3:no-improvement, m4:no-improvement, m5:no-improvement, m6:no-improvement, m7:no-improvement, m8:no-improvement…
- Hotspot per-measure Δ:
  - m10: onset Δ 0, duration Δ 0, chord Δ 0

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 12 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 6 → 6 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 0 → 0 (Δ 0)
- Rejected measures: m1:no-improvement, m2:no-improvement, m3:no-improvement, m4:no-improvement, m5:no-improvement, m6:no-improvement, m7:no-improvement, m8:no-improvement…
- Hotspot deltas: m10(onsetΔ0,durΔ0,chordΔ0)
  ScoreGraph IR (observation): 172 nodes, 311 edges across 12 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 20 node(s) sounding≠written; 53 tie; 1 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### Wet Hands (legacy copyrighted guitar diagnostic) (`skipped`)
- PDF: `/Users/ryland/Downloads/wet-hands-minecraft.pdf`
- Truth: `/Users/ryland/Downloads/wet-hands-minecraft.mxl`
  pitch 4% | duration 40% | onset 30% | chord 56% | F1 69%
  measureΔ 5 | noteΔ -27 | wrongPitch 135 | wrongDuration 56 | wrongOnset 77 | chordMismatch 119
  top error category: Pitch mapping (pitch-mapping)
  top duration error category: beamed-subdivision (50 sampled)
  top pitch error category: other (94 sampled)
  - Primary: Pitch mapping (pitch-mapping, confidence 0.884)
  - Source scores: pitch-mapping=0.8845, measure-allocation=0.7215, rhythm-inference=0.6579, notehead-detection=0.415, chord-grouping=0.3982
  - Pitch errors (135): other=94, ±2-diatonic=28, ±1-accidental=11, ±octave=2
  - Duration errors (56): beamed-subdivision=50, onset-coupled=5, too-short=1
  - Detection: chord-grouping=119, missing-notes=78, extra-notes=51
  - Error buckets: pitch=135, extra/missing-notes=129, chord=119, onset=77, duration=56, rests=20, slurs=15, accidentals=11, ties=1
  - Largest remaining error bucket: pitch = 135 (24%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 120
  - chord-grouping-symptom: 110
  - onset-phase-shift: 77
  - onset-coupled-duration: 5
  - voice-serialization-shift: 2
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - serialization-artifact: 33
  - written-duration-wrong: 18
  - onset-coupled-duration: 5
  - Dominant: serialization-artifact (33)
  - Hotspot duration traces:
    - m2: 4 wrong durations (written-duration-wrong=3, serialization-artifact=1)
    - m3: 1 wrong durations (serialization-artifact=1)
    - m4: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m5: 1 wrong durations (serialization-artifact=1)
    - m6: 2 wrong durations (written-duration-wrong=2)
    - m7: 1 wrong durations (serialization-artifact=1)
    - m8: 2 wrong durations (serialization-artifact=2)
    - m9: 1 wrong durations (serialization-artifact=1)
    - m10: 1 wrong durations (written-duration-wrong=1)
    - m11: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m12: 5 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=3)
    - m13: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m14: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m15: 1 wrong durations (serialization-artifact=1)
    - m16: 1 wrong durations (serialization-artifact=1)
    - m17: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m18: 1 wrong durations (onset-coupled-duration=1)
    - m19: 1 wrong durations (serialization-artifact=1)
    - m20: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m21: 1 wrong durations (serialization-artifact=1)
    - m22: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=2)
    - m23: 2 wrong durations (serialization-artifact=2)
    - m24: 1 wrong durations (serialization-artifact=1)
    - m25: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m26: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m27: 3 wrong durations (serialization-artifact=3)
    - m28: 3 wrong durations (serialization-artifact=3)
    - m30: 1 wrong durations (written-duration-wrong=1)
  Tie/sustain constraints (V2 Phase 4):
  - tie-start-without-continuation: 4
  - written-correct-sustain-wrong: 2
  - slur-like-arc-pitch-differs: 1
  - Dominant: tie-start-without-continuation (4)
  - Tie glyphs: detected 15, applied 14, slur-like rejected 1, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 135 (135 wrong pitch match(es))
  - onset-rhythm-inference: 133 (56 duration; 77 onset error(s))
  - symbol-detection: 129 (78 missing; 51 extra note(s))
  - voice-serialization: 119 (119 chord/voice grouping mismatch(es))
  - measure-barline-segmentation: 7 (measure count 37/32 (Δ5); 2 irregular system grid(s))
  - measure hotspots: m29 symbol-detection (32), m24 pitch-inference (29), m20 pitch-inference (28), m30 symbol-detection (28), m12 onset-rhythm-inference (27), m22 symbol-detection (26), m9 symbol-detection (25), m18 pitch-inference (24)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 2 accepted / 25 candidates / 25 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 77 → 77 (Δ 0), wrongDuration 56 → 56 (Δ 0), chord 119 → 119 (Δ 0)
- Rejected candidates: m1:duration-changed, m2:duration-changed, m3:duration-changed, m4:duration-changed, m5:duration-changed, m6:constraints-failed, m7:duration-changed, m9:duration-changed+chord-split…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **diagnostic-only**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Solver: 7 structurally applied (5 duration-coupled) / 1 truth-approved / 25 candidates
- Runtime vs shadow: wrongOnset 77 → 79 (Δ 2), wrongDuration 56 → 53 (Δ -3), chord 119 → 119 (Δ 0)
- Accepted measures: m16:accompaniment-minus-3-coupled
- Rejected measures: m2:constraints-failed, m3:no-improvement, m6:constraints-failed, m7:no-improvement, m9:constraints-failed, m12:constraints-failed, m14:no-improvement, m15:constraints-failed…
  ScoreGraph IR (observation): 479 nodes, 774 edges across 37 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 2 underfill measure(s)
  IR duration split: 10 node(s) sounding≠written; 89 tie; 16 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### La Campanella (legacy local diagnostic) (`skipped`)
- PDF: `/Users/ryland/Downloads/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.pdf`
- Truth: `/Users/ryland/Downloads/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.mxl`
  pitch 25% | duration 65% | onset 39% | chord 52% | F1 77%
  measureΔ 10 | noteΔ -286 | wrongPitch 2165 | wrongDuration 385 | wrongOnset 1532 | chordMismatch 2690
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: beamed-subdivision (296 sampled)
  top pitch error category: other (1415 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.891)
  - Source scores: rhythm-inference=0.8906, pitch-mapping=0.634, measure-allocation=0.5693, chord-grouping=0.4341, notehead-detection=0.3007
  - Pitch errors (2165): other=1415, ±1-accidental=280, ±octave=264, ±2-diatonic=197, ±octave-other=9
  - Duration errors (385): beamed-subdivision=296, onset-coupled=81, too-short=8
  - Detection: chord-grouping=2690, missing-notes=1131, extra-notes=845
  - Error buckets: chord=2690, pitch=2165, extra/missing-notes=1976, onset=1532, slurs=907, duration=385, ties=304, rests=285, accidentals=280
  - Largest remaining error bucket: chord = 2690 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 1863
  - chord-grouping-symptom: 1630
  - onset-phase-shift: 1282
  - voice-serialization-shift: 265
  - onset-coupled-duration: 81
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - serialization-artifact: 161
  - written-duration-wrong: 143
  - onset-coupled-duration: 81
  - Dominant: serialization-artifact (161)
  - Hotspot duration traces:
    - m2: 2 wrong durations (onset-coupled-duration=2)
    - m3: 6 wrong durations (onset-coupled-duration=3, serialization-artifact=3)
    - m4: 2 wrong durations (written-duration-wrong=2)
    - m6: 3 wrong durations (written-duration-wrong=3)
    - m7: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m8: 1 wrong durations (written-duration-wrong=1)
    - m10: 3 wrong durations (written-duration-wrong=3)
    - m11: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m12: 2 wrong durations (written-duration-wrong=2)
    - m14: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m15: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m16: 1 wrong durations (onset-coupled-duration=1)
    - m18: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m19: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m20: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m21: 1 wrong durations (onset-coupled-duration=1)
    - m22: 8 wrong durations (written-duration-wrong=1, onset-coupled-duration=7)
    - m23: 3 wrong durations (serialization-artifact=3)
    - m24: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m25: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m26: 3 wrong durations (onset-coupled-duration=3)
    - m27: 4 wrong durations (onset-coupled-duration=3, serialization-artifact=1)
    - m28: 1 wrong durations (onset-coupled-duration=1)
    - m29: 1 wrong durations (serialization-artifact=1)
    - m30: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=1)
    - m31: 1 wrong durations (serialization-artifact=1)
    - m32: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m33: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m34: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m35: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m36: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=1)
    - m37: 4 wrong durations (written-duration-wrong=3, onset-coupled-duration=1)
    - m38: 6 wrong durations (written-duration-wrong=1, onset-coupled-duration=3, serialization-artifact=2)
    - m39: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m40: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m43: 1 wrong durations (onset-coupled-duration=1)
    - m44: 2 wrong durations (written-duration-wrong=2)
    - m45: 2 wrong durations (written-duration-wrong=2)
    - m46: 2 wrong durations (serialization-artifact=2)
    - m47: 3 wrong durations (onset-coupled-duration=1, serialization-artifact=2)
    - m48: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m49: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m50: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m52: 5 wrong durations (onset-coupled-duration=1, serialization-artifact=4)
    - m54: 1 wrong durations (written-duration-wrong=1)
    - m55: 1 wrong durations (serialization-artifact=1)
    - m57: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m58: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m62: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m63: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=2)
    - m64: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m65: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m66: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m67: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m68: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m69: 3 wrong durations (serialization-artifact=3)
    - m70: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m72: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m73: 1 wrong durations (serialization-artifact=1)
    - m74: 5 wrong durations (onset-coupled-duration=1, serialization-artifact=4)
    - m75: 2 wrong durations (written-duration-wrong=2)
    - m76: 2 wrong durations (written-duration-wrong=2)
    - m77: 2 wrong durations (written-duration-wrong=2)
    - m78: 2 wrong durations (written-duration-wrong=2)
    - m79: 2 wrong durations (written-duration-wrong=2)
    - m85: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m86: 2 wrong durations (serialization-artifact=2)
    - m87: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m88: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m89: 7 wrong durations (written-duration-wrong=4, serialization-artifact=3)
    - m90: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m91: 2 wrong durations (serialization-artifact=2)
    - m92: 7 wrong durations (written-duration-wrong=5, serialization-artifact=2)
    - m93: 10 wrong durations (written-duration-wrong=6, onset-coupled-duration=1, serialization-artifact=3)
    - m95: 4 wrong durations (serialization-artifact=4)
    - m96: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m98: 1 wrong durations (written-duration-wrong=1)
    - m99: 1 wrong durations (onset-coupled-duration=1)
    - m100: 6 wrong durations (written-duration-wrong=2, serialization-artifact=4)
    - m101: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m102: 1 wrong durations (written-duration-wrong=1)
    - m103: 15 wrong durations (onset-coupled-duration=2, serialization-artifact=13)
    - m104: 7 wrong durations (written-duration-wrong=1, onset-coupled-duration=2, serialization-artifact=4)
    - m105: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m106: 1 wrong durations (serialization-artifact=1)
    - m107: 2 wrong durations (written-duration-wrong=2)
    - m109: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m110: 1 wrong durations (written-duration-wrong=1)
    - m111: 7 wrong durations (written-duration-wrong=3, onset-coupled-duration=3, serialization-artifact=1)
    - m113: 8 wrong durations (written-duration-wrong=3, serialization-artifact=5)
    - m114: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m115: 6 wrong durations (written-duration-wrong=2, serialization-artifact=4)
    - m117: 1 wrong durations (serialization-artifact=1)
    - m122: 6 wrong durations (written-duration-wrong=1, serialization-artifact=5)
    - m123: 6 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=4)
    - m124: 6 wrong durations (written-duration-wrong=4, serialization-artifact=2)
    - m125: 5 wrong durations (written-duration-wrong=3, serialization-artifact=2)
    - m126: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m128: 1 wrong durations (serialization-artifact=1)
    - m129: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m131: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m132: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m133: 1 wrong durations (written-duration-wrong=1)
    - m137: 6 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=2)
    - m138: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m139: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m140: 3 wrong durations (written-duration-wrong=2, onset-coupled-duration=1)
    - m141: 4 wrong durations (onset-coupled-duration=1, serialization-artifact=3)
    - m142: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m143: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m144: 1 wrong durations (onset-coupled-duration=1)
    - m145: 8 wrong durations (written-duration-wrong=2, onset-coupled-duration=4, serialization-artifact=2)
    - m147: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m148: 1 wrong durations (serialization-artifact=1)
    - m149: 6 wrong durations (written-duration-wrong=3, serialization-artifact=3)
    - m150: 3 wrong durations (written-duration-wrong=3)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 304
  - tie-start-without-continuation: 130
  - continuation-without-tie-start: 43
  - written-correct-sustain-wrong: 37
  - expected-cross-measure-tie: 1
  - sounding-release-too-short: 1
  - Dominant: slur-like-arc-pitch-differs (304)
  - Tie glyphs: detected 333, applied 29, slur-like rejected 304, unresolved 0
  Pipeline attribution: voice-serialization
  - voice-serialization: 2690 (2690 chord/voice grouping mismatch(es))
  - pitch-inference: 2165 (2165 wrong pitch match(es))
  - symbol-detection: 1976 (1131 missing; 845 extra note(s))
  - onset-rhythm-inference: 1917 (385 duration; 1532 onset error(s))
  - measure-barline-segmentation: 14 (measure count 160/150 (Δ10); 4 irregular system grid(s))
  - measure hotspots: m87 voice-serialization (170), m79 voice-serialization (159), m101 voice-serialization (156), m134 pitch-inference (149), m137 symbol-detection (147), m139 onset-rhythm-inference (134), m68 voice-serialization (132), m136 pitch-inference (132)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 148 candidates / 148 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 1532 → 1532 (Δ 0), wrongDuration 385 → 385 (Δ 0), chord 2690 → 2690 (Δ 0)
- Rejected candidates: m1:duration-changed+chord-split, m2:duration-changed+chord-split+onset-group-regression, m3:duration-changed+chord-split+onset-group-regression, m5:duration-changed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed, m9:constraints-failed…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 1 structurally applied (1 duration-coupled) / 0 truth-approved / 139 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 1532 → 1532 (Δ 0), wrongDuration 385 → 385 (Δ 0), chord 2690 → 2690 (Δ 0)
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m6:constraints-failed, m7:constraints-failed, m9:constraints-failed, m10:constraints-failed, m11:constraints-failed…
  ScoreGraph IR (observation): 9092 nodes, 17003 edges across 160 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 4 underfill measure(s)
  IR duration split: 62 node(s) sounding≠written; 1667 tie; 68 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### La Campanella alternate engraving (legacy local diagnostic) (`skipped`)
- PDF: `/Users/ryland/Downloads/etude-s-1413-in-g-minor-la-campanella-liszt.pdf`
- Truth: `/Users/ryland/Downloads/etude-s-1413-in-g-minor-la-campanella-liszt.mxl`
  pitch 11% | duration 26% | onset 18% | chord 20% | F1 37%
  measureΔ 76 | noteΔ -399 | wrongPitch 1012 | wrongDuration 388 | wrongOnset 740 | chordMismatch 5457
  top error category: Measure allocation (measure-allocation)
  top duration error category: beamed-subdivision (293 sampled)
  top pitch error category: other (665 sampled)
  - Primary: Measure allocation (measure-allocation, confidence 1)
  - Source scores: measure-allocation=1, rhythm-inference=0.8831, notehead-detection=0.7387, chord-grouping=0.7221, pitch-mapping=0.6435
  - Pitch errors (1012): other=665, ±1-accidental=135, ±2-diatonic=128, ±octave=78, ±octave-other=6
  - Duration errors (388): beamed-subdivision=293, onset-coupled=92, too-long=2, too-short=1
  - Detection: chord-grouping=5457, missing-notes=2779, extra-notes=2380
  - Error buckets: chord=5457, extra/missing-notes=5159, pitch=1012, slurs=800, onset=740, duration=388, rests=307, ties=162, accidentals=135
  - Largest remaining error bucket: chord = 5457 (39%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 2440
  - pitch-grouping-symptom: 916
  - onset-phase-shift: 631
  - voice-serialization-shift: 112
  - onset-coupled-duration: 92
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - serialization-artifact: 171
  - written-duration-wrong: 124
  - onset-coupled-duration: 93
  - Dominant: serialization-artifact (171)
  - Hotspot duration traces:
    - m3: 6 wrong durations (written-duration-wrong=3, serialization-artifact=3)
    - m5: 3 wrong durations (written-duration-wrong=3)
    - m6: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m7: 1 wrong durations (written-duration-wrong=1)
    - m9: 6 wrong durations (written-duration-wrong=3, onset-coupled-duration=1, serialization-artifact=2)
    - m10: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m11: 2 wrong durations (written-duration-wrong=2)
    - m13: 2 wrong durations (onset-coupled-duration=2)
    - m14: 2 wrong durations (onset-coupled-duration=2)
    - m15: 1 wrong durations (serialization-artifact=1)
    - m17: 2 wrong durations (onset-coupled-duration=2)
    - m18: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m19: 6 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=2)
    - m20: 2 wrong durations (serialization-artifact=2)
    - m21: 9 wrong durations (written-duration-wrong=2, onset-coupled-duration=7)
    - m22: 5 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=3)
    - m23: 4 wrong durations (written-duration-wrong=3, serialization-artifact=1)
    - m24: 5 wrong durations (onset-coupled-duration=2, serialization-artifact=3)
    - m25: 5 wrong durations (written-duration-wrong=1, onset-coupled-duration=2, serialization-artifact=2)
    - m26: 4 wrong durations (onset-coupled-duration=3, serialization-artifact=1)
    - m27: 1 wrong durations (written-duration-wrong=1)
    - m29: 4 wrong durations (onset-coupled-duration=2, serialization-artifact=2)
    - m31: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=2)
    - m32: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m33: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m34: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m35: 6 wrong durations (written-duration-wrong=4, onset-coupled-duration=1, serialization-artifact=1)
    - m36: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m37: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=2)
    - m38: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=2)
    - m39: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m40: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m41: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=2)
    - m42: 5 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=3)
    - m43: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m44: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m47: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m48: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m49: 1 wrong durations (serialization-artifact=1)
    - m50: 9 wrong durations (written-duration-wrong=1, onset-coupled-duration=4, serialization-artifact=4)
    - m51: 5 wrong durations (written-duration-wrong=1, serialization-artifact=4)
    - m52: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=2, serialization-artifact=1)
    - m53: 6 wrong durations (written-duration-wrong=4, serialization-artifact=2)
    - m54: 5 wrong durations (onset-coupled-duration=1, serialization-artifact=4)
    - m55: 8 wrong durations (written-duration-wrong=3, serialization-artifact=5)
    - m57: 6 wrong durations (onset-coupled-duration=1, serialization-artifact=5)
    - m58: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m59: 3 wrong durations (serialization-artifact=3)
    - m60: 1 wrong durations (serialization-artifact=1)
    - m61: 1 wrong durations (serialization-artifact=1)
    - m62: 4 wrong durations (serialization-artifact=4)
    - m63: 1 wrong durations (serialization-artifact=1)
    - m67: 3 wrong durations (serialization-artifact=3)
    - m68: 1 wrong durations (serialization-artifact=1)
    - m69: 10 wrong durations (written-duration-wrong=5, serialization-artifact=5)
    - m70: 6 wrong durations (written-duration-wrong=4, onset-coupled-duration=2)
    - m71: 9 wrong durations (written-duration-wrong=6, serialization-artifact=3)
    - m72: 4 wrong durations (serialization-artifact=4)
    - m73: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m74: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=2)
    - m75: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m76: 4 wrong durations (written-duration-wrong=3, serialization-artifact=1)
    - m77: 1 wrong durations (onset-coupled-duration=1)
    - m78: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m79: 5 wrong durations (written-duration-wrong=4, serialization-artifact=1)
    - m80: 2 wrong durations (written-duration-wrong=2)
    - m81: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m82: 5 wrong durations (written-duration-wrong=2, serialization-artifact=3)
    - m84: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m85: 7 wrong durations (written-duration-wrong=1, serialization-artifact=6)
    - m86: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m87: 2 wrong durations (onset-coupled-duration=2)
    - m88: 8 wrong durations (written-duration-wrong=3, onset-coupled-duration=1, serialization-artifact=4)
    - m89: 5 wrong durations (onset-coupled-duration=1, serialization-artifact=4)
    - m90: 3 wrong durations (onset-coupled-duration=1, serialization-artifact=2)
    - m91: 3 wrong durations (written-duration-wrong=3)
    - m92: 1 wrong durations (serialization-artifact=1)
    - m93: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m94: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=2, serialization-artifact=1)
    - m95: 7 wrong durations (written-duration-wrong=2, onset-coupled-duration=4, serialization-artifact=1)
    - m96: 1 wrong durations (onset-coupled-duration=1)
    - m97: 3 wrong durations (onset-coupled-duration=1, serialization-artifact=2)
    - m98: 1 wrong durations (written-duration-wrong=1)
    - m99: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m100: 3 wrong durations (onset-coupled-duration=1, serialization-artifact=2)
    - m101: 4 wrong durations (onset-coupled-duration=2, serialization-artifact=2)
    - m102: 1 wrong durations (serialization-artifact=1)
    - m103: 4 wrong durations (onset-coupled-duration=3, serialization-artifact=1)
    - m104: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m105: 4 wrong durations (written-duration-wrong=3, serialization-artifact=1)
    - m106: 1 wrong durations (written-duration-wrong=1)
    - m107: 3 wrong durations (written-duration-wrong=2, onset-coupled-duration=1)
    - m109: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m110: 3 wrong durations (serialization-artifact=3)
    - m111: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=2, serialization-artifact=1)
    - m112: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=3)
    - m113: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
    - m115: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m116: 1 wrong durations (serialization-artifact=1)
    - m118: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m119: 1 wrong durations (serialization-artifact=1)
    - m120: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m121: 5 wrong durations (written-duration-wrong=3, serialization-artifact=2)
    - m122: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m123: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m124: 1 wrong durations (serialization-artifact=1)
    - m126: 1 wrong durations (written-duration-wrong=1)
    - m127: 1 wrong durations (written-duration-wrong=1)
    - m128: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m131: 1 wrong durations (serialization-artifact=1)
    - m132: 1 wrong durations (serialization-artifact=1)
    - m133: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=2)
    - m134: 1 wrong durations (serialization-artifact=1)
    - m135: 1 wrong durations (written-duration-wrong=1)
    - m136: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 162
  - tie-start-without-continuation: 85
  - continuation-without-tie-start: 27
  - written-correct-sustain-wrong: 22
  - Dominant: slur-like-arc-pitch-differs (162)
  - Tie glyphs: detected 227, applied 65, slur-like rejected 162, unresolved 0
  Pipeline attribution: voice-serialization
  - voice-serialization: 5457 (5457 chord/voice grouping mismatch(es))
  - symbol-detection: 5159 (2779 missing; 2380 extra note(s))
  - onset-rhythm-inference: 1128 (388 duration; 740 onset error(s))
  - pitch-inference: 1012 (1012 wrong pitch match(es))
  - measure-barline-segmentation: 95 (measure count 222/146 (Δ76); 19 irregular system grid(s))
  - measure hotspots: m77 symbol-detection (289), m127 symbol-detection (133), m123 pitch-inference (130), m207 measure-barline-segmentation (128), m165 measure-barline-segmentation (120), m89 voice-serialization (112), m95 symbol-detection (112), m65 voice-serialization (110)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 187 candidates / 187 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 740 → 740 (Δ 0), wrongDuration 388 → 388 (Δ 0), chord 5457 → 5457 (Δ 0)
- Rejected candidates: m1:chord-split, m2:duration-changed+chord-split, m3:duration-changed+chord-split+onset-group-regression, m4:duration-changed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-improved**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Solver: 8 structurally applied (8 duration-coupled) / 2 truth-approved / 141 candidates
- Runtime vs shadow: wrongOnset 740 → 737 (Δ -3), wrongDuration 388 → 380 (Δ -8), chord 5457 → 5453 (Δ -4)
- Accepted measures: m50:accompaniment-adaptive-phase-coupled, m118:accompaniment-adaptive-phase-coupled
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m5:constraints-failed, m6:constraints-failed, m8:constraints-failed, m9:no-improvement, m10:constraints-failed…
  ScoreGraph IR (observation): 8506 nodes, 15834 edges across 222 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 15 underfill measure(s)
  IR duration split: 51 node(s) sounding≠written; 1588 tie; 49 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

## Top error categories (across fixtures)
- rhythm-inference: 7
- measure-allocation: 5
- mixed: 2
- pitch-mapping: 1

## Aggregated duration error histogram
- beamed-subdivision: 651
- onset-coupled: 239
- too-short: 87
- too-long: 48

## Aggregated pitch error histogram
- other: 2425
- ±1-accidental: 504
- ±2-diatonic: 458
- ±octave: 378
- ±octave-other: 15

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 9000
- extra/missing-notes: 7856
- pitch: 3780
- slurs: 2825
- onset: 2551
- duration: 1025
- rests: 668
- ties: 534
- accidentals: 504
- **Largest remaining error bucket: chord = 9000 (31% of counted errors)**

## Tier breakdown
- guitar-paired-dense: 1 fixture(s) (pass=1)
- guitar-paired-sparse: 1 fixture(s) (pass=1)
- guitar-scan: 1 fixture(s) (pass=1)
- guitar-standard: 1 fixture(s) (pass=1)
- guitar-tab: 1 fixture(s) (pass=1)
- legacy-local: 6 fixture(s) (skipped=6)
- piano-clean: 1 fixture(s) (pass=1)
- piano-dense: 1 fixture(s) (pass=1)
- piano-grand: 1 fixture(s) (pass=1)
- piano-rhythm: 1 fixture(s) (pass=1)
- piano-scan: 1 fixture(s) (pass=1)

## V2 rollout gate
V2 rollout gate (Phase 5):
- Recommended: **voice-aware-serialization** (composite 2.65)
- Parallel prep: onset-grid-refinement
- Target ranking:
  - onset-grid-refinement: composite=4.1, status=eligible-prep
  - written-sounding-duration-solver: composite=3.25, status=blocked-premature
  - tie-sustain-constraint-solver: composite=3.2, status=blocked-premature
  - voice-aware-serialization: composite=2.65, status=recommended
  - measure-level-solver-variant: composite=1.85, status=blocked-exhausted
- Blocked:
  - written-sounding-duration-solver (blocked-premature): 44 onset-coupled duration errors cannot be fixed until onsets/voices are stable.
  - tie-sustain-constraint-solver (blocked-premature): Most sustain deficits are downstream of wrong onsets/voices, not missing tie glyphs.
  - measure-level-solver-variant (blocked-exhausted): Clef-only phase-shift family exhausted: 0 changed, 0 truth-approved on dense.
- Frozen baseline: MATCH

## Voice serialization qualification (Phase 6B)
**NO — zero truth-approved measures on live enforced fixtures.**
Voice serialization qualification (Phase 7):
- Verdict: Blocker is hard constraints (voice overlap) — duration coupling insufficient; inspect gapToNextOnset IR or multi-voice overlap.
- Truth-approved: 0 | Structural: 0
- Global shadow Δ: wrongOnset 0, wrongDuration 0, chord 0
Voice serialization qualification (Phase 7):
- Verdict: Blocker is hard constraints (voice overlap) — duration coupling insufficient; inspect gapToNextOnset IR or multi-voice overlap.
- Truth-approved: 0 | Structural: 0
- Hotspots:
  - m7: structurally-rejected (hard-constraints) onsetΔ0
  - m9: structurally-rejected (hard-constraints) onsetΔ0
  - m121: structurally-rejected (hard-constraints) onsetΔ0
- Global shadow Δ: wrongOnset 0, wrongDuration 0, chord 0
Voice serialization qualification (Phase 7):
- Verdict: No structural candidates on live fixtures — extend lane detection or onset-column IR.
- Truth-approved: 0 | Structural: 0
- Hotspots:
  - m10: structurally-rejected (hard-constraints) onsetΔ0
- Global shadow Δ: wrongOnset 0, wrongDuration 0, chord 0
